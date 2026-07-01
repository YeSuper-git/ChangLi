#![cfg_attr(windows, windows_subsystem = "windows")]
#![allow(unused_must_use)]

use std::{
    env,
    ffi::OsStr,
    fs,
    os::windows::ffi::OsStrExt,
    path::PathBuf,
    process::Command,
    ptr::null_mut,
    sync::atomic::{AtomicBool, AtomicI32, Ordering},
    thread,
    time::Duration,
};

use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::{COLORREF, HWND, LPARAM, LRESULT, RECT, WPARAM},
        Graphics::Gdi::{
            BeginPaint, CreateFontW, CreatePen, CreateSolidBrush, DeleteObject, EndPaint, FillRect,
            GetStockObject, InvalidateRect, LineTo, MoveToEx, RoundRect, SelectObject, SetBkMode,
            SetTextColor, TextOutW, FONT_CHARSET, FONT_CLIP_PRECISION, FONT_OUTPUT_PRECISION,
            FONT_QUALITY, HDC, HFONT, HGDIOBJ, PAINTSTRUCT, PS_SOLID, TRANSPARENT, WHITE_BRUSH,
        },
        System::LibraryLoader::GetModuleHandleW,
        UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, DrawIconEx,
            GetMessageW, LoadImageW, PostQuitMessage, RegisterClassW, SetTimer, ShowWindow,
            TranslateMessage, CS_HREDRAW, CS_VREDRAW, CW_USEDEFAULT, DI_NORMAL, HICON, HTCAPTION,
            IMAGE_ICON, LR_LOADFROMFILE, MSG, SW_SHOW, WM_CLOSE, WM_CREATE, WM_DESTROY,
            WM_LBUTTONDOWN, WM_NCHITTEST, WM_PAINT, WM_TIMER, WNDCLASSW, WS_POPUP, WS_VISIBLE,
        },
    },
};

static INSTALLING: AtomicBool = AtomicBool::new(false);
static DONE: AtomicBool = AtomicBool::new(false);
static FAILED: AtomicBool = AtomicBool::new(false);
static PROGRESS: AtomicI32 = AtomicI32::new(0);

const SETUP_BYTES: &[u8] = include_bytes!(env!("CHANGLI_NSIS_SETUP"));
const ICON_BYTES: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../src-tauri/icons/icon.ico"
));

const W: i32 = 880;
const H: i32 = 520;

#[derive(Clone, Copy)]
struct RectI {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}
impl RectI {
    fn contains(self, x: i32, y: i32) -> bool {
        x >= self.x && x <= self.x + self.w && y >= self.y && y <= self.y + self.h
    }
}

const CLOSE_RECT: RectI = RectI {
    x: 832,
    y: 18,
    w: 30,
    h: 30,
};
const INSTALL_RECT: RectI = RectI {
    x: 680,
    y: 444,
    w: 146,
    h: 44,
};
const CANCEL_RECT: RectI = RectI {
    x: 560,
    y: 444,
    w: 98,
    h: 44,
};

fn wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(Some(0)).collect()
}
fn rgb(r: u8, g: u8, b: u8) -> COLORREF {
    COLORREF((r as u32) | ((g as u32) << 8) | ((b as u32) << 16))
}

unsafe fn font(size: i32, weight: i32) -> HFONT {
    let name = wide("Microsoft YaHei UI");
    CreateFontW(
        size,
        0,
        0,
        0,
        weight,
        0,
        0,
        0,
        FONT_CHARSET(1),
        FONT_OUTPUT_PRECISION(0),
        FONT_CLIP_PRECISION(0),
        FONT_QUALITY(5),
        0,
        PCWSTR(name.as_ptr()),
    )
}

unsafe fn text(hdc: HDC, x: i32, y: i32, s: &str, size: i32, weight: i32, color: COLORREF) {
    let f = font(size, weight);
    let old = SelectObject(hdc, HGDIOBJ(f.0));
    SetBkMode(hdc, TRANSPARENT);
    SetTextColor(hdc, color);
    let ws = wide(s);
    TextOutW(hdc, x, y, &ws[..ws.len() - 1]).ok();
    SelectObject(hdc, old);
    DeleteObject(HGDIOBJ(f.0)).ok();
}

unsafe fn fill_round(hdc: HDC, r: RectI, radius: i32, color: COLORREF) {
    let brush = CreateSolidBrush(color);
    let pen = CreatePen(PS_SOLID, 1, color);
    let old_b = SelectObject(hdc, HGDIOBJ(brush.0));
    let old_p = SelectObject(hdc, HGDIOBJ(pen.0));
    RoundRect(hdc, r.x, r.y, r.x + r.w, r.y + r.h, radius, radius).ok();
    SelectObject(hdc, old_b);
    SelectObject(hdc, old_p);
    DeleteObject(HGDIOBJ(brush.0)).ok();
    DeleteObject(HGDIOBJ(pen.0)).ok();
}

unsafe fn stroke_round(hdc: HDC, r: RectI, radius: i32, color: COLORREF) {
    let brush = GetStockObject(WHITE_BRUSH);
    let pen = CreatePen(PS_SOLID, 1, color);
    let old_b = SelectObject(hdc, brush);
    let old_p = SelectObject(hdc, HGDIOBJ(pen.0));
    RoundRect(hdc, r.x, r.y, r.x + r.w, r.y + r.h, radius, radius).ok();
    SelectObject(hdc, old_b);
    SelectObject(hdc, old_p);
    DeleteObject(HGDIOBJ(pen.0)).ok();
}

fn write_embedded(name: &str, bytes: &[u8]) -> PathBuf {
    let mut p = env::temp_dir();
    p.push(name);
    let _ = fs::write(&p, bytes);
    p
}

unsafe fn draw_sidebar(hdc: HDC) {
    for y in 0..H {
        let t = y as f32 / H as f32;
        let r = (251.0 + (255.0 - 251.0) * t) as u8;
        let g = (91.0 + (138.0 - 91.0) * t) as u8;
        let b = (123.0 + (76.0 - 123.0) * t) as u8;
        let pen = CreatePen(PS_SOLID, 1, rgb(r, g, b));
        let old = SelectObject(hdc, HGDIOBJ(pen.0));
        MoveToEx(hdc, 0, y, None).ok();
        LineTo(hdc, 286, y).ok();
        SelectObject(hdc, old);
        DeleteObject(HGDIOBJ(pen.0)).ok();
    }

    let icon_path = write_embedded("changli-installer-icon.ico", ICON_BYTES);
    let icon_path_w = wide(icon_path.to_string_lossy().as_ref());
    let icon = LoadImageW(
        None,
        PCWSTR(icon_path_w.as_ptr()),
        IMAGE_ICON,
        54,
        54,
        LR_LOADFROMFILE,
    )
    .unwrap_or_default();
    DrawIconEx(hdc, 36, 34, HICON(icon.0), 54, 54, 0, None, DI_NORMAL).ok();

    text(hdc, 104, 38, "ChangLi", 28, 700, rgb(255, 255, 255));
    text(hdc, 106, 70, "私人影音资料库", 14, 400, rgb(255, 242, 245));
    text(hdc, 36, 142, "装好后", 42, 800, rgb(255, 255, 255));
    text(hdc, 36, 194, "直接进入", 42, 800, rgb(255, 255, 255));
    text(hdc, 36, 246, "收藏宇宙", 42, 800, rgb(255, 255, 255));

    for (i, label) in ["本地数据库", "内置播放器", "自动建库"].iter().enumerate() {
        fill_round(
            hdc,
            RectI {
                x: 36,
                y: 348 + (i as i32) * 38,
                w: 116,
                h: 28,
            },
            18,
            rgb(255, 164, 168),
        );
        text(
            hdc,
            51,
            353 + (i as i32) * 38,
            label,
            13,
            700,
            rgb(255, 255, 255),
        );
    }
}

unsafe fn draw_main(hdc: HDC) {
    let bg = CreateSolidBrush(rgb(255, 255, 255));
    FillRect(
        hdc,
        &RECT {
            left: 286,
            top: 0,
            right: W,
            bottom: H,
        },
        bg,
    );
    DeleteObject(HGDIOBJ(bg.0)).ok();

    text(hdc, 330, 44, "●  ○  ○", 17, 700, rgb(251, 91, 123));
    let version = option_env!("CHANGLI_APP_VERSION").unwrap_or("dev");
    text(
        hdc,
        330,
        78,
        &format!("ChangLi {version}"),
        17,
        700,
        rgb(251, 91, 123),
    );
    text(hdc, 330, 114, "准备安装长离", 36, 800, rgb(24, 23, 29));
    text(
        hdc,
        330,
        162,
        "安装完成后即可打开你的本地影音资料库，继续保留原有数据与播放环境。",
        16,
        400,
        rgb(107, 114, 128),
    );

    fill_round(
        hdc,
        RectI {
            x: 330,
            y: 206,
            w: 476,
            h: 76,
        },
        22,
        rgb(249, 250, 252),
    );
    stroke_round(
        hdc,
        RectI {
            x: 330,
            y: 206,
            w: 476,
            h: 76,
        },
        22,
        rgb(232, 235, 242),
    );
    text(hdc, 352, 222, "安装位置", 14, 700, rgb(107, 114, 128));
    text(
        hdc,
        352,
        248,
        "当前用户 AppData / ChangLi",
        18,
        700,
        rgb(24, 23, 29),
    );
    fill_round(
        hdc,
        RectI {
            x: 730,
            y: 228,
            w: 54,
            h: 34,
        },
        17,
        rgb(255, 238, 241),
    );
    text(hdc, 742, 236, "更改", 14, 700, rgb(213, 63, 100));

    let cards = [
        (330, "保留本地数据", "升级安装会沿用现有资料库。"),
        (494, "播放器就绪", "内置播放环境，安装后直接使用。"),
        (658, "一键启动", "完成后可立即打开 ChangLi。"),
    ];
    for (x, title, body) in cards {
        fill_round(
            hdc,
            RectI {
                x,
                y: 314,
                w: 148,
                h: 92,
            },
            22,
            rgb(255, 255, 255),
        );
        stroke_round(
            hdc,
            RectI {
                x,
                y: 314,
                w: 148,
                h: 92,
            },
            22,
            rgb(232, 235, 242),
        );
        text(hdc, x + 16, 334, title, 16, 800, rgb(24, 23, 29));
        text(hdc, x + 16, 362, body, 13, 400, rgb(107, 114, 128));
    }

    let progress = PROGRESS.load(Ordering::SeqCst);
    fill_round(
        hdc,
        RectI {
            x: 330,
            y: 444,
            w: 196,
            h: 8,
        },
        8,
        rgb(241, 243, 247),
    );
    if progress > 0 {
        fill_round(
            hdc,
            RectI {
                x: 330,
                y: 444,
                w: 196 * progress / 100,
                h: 8,
            },
            8,
            rgb(251, 91, 123),
        );
    }
    let status = if FAILED.load(Ordering::SeqCst) {
        "安装失败，请重新运行安装程序"
    } else if DONE.load(Ordering::SeqCst) {
        "安装完成 · 可以打开 ChangLi"
    } else if INSTALLING.load(Ordering::SeqCst) {
        "正在安装 ChangLi..."
    } else {
        "准备就绪 · 约 1 分钟完成"
    };
    text(hdc, 330, 462, status, 14, 400, rgb(107, 114, 128));

    fill_round(hdc, CANCEL_RECT, 22, rgb(255, 255, 255));
    stroke_round(hdc, CANCEL_RECT, 22, rgb(232, 235, 242));
    text(hdc, 592, 456, "取消", 16, 700, rgb(82, 82, 91));

    let label = if DONE.load(Ordering::SeqCst) {
        "完成"
    } else if INSTALLING.load(Ordering::SeqCst) {
        "安装中"
    } else {
        "开始安装"
    };
    fill_round(hdc, INSTALL_RECT, 22, rgb(251, 91, 123));
    text(
        hdc,
        if label == "开始安装" { 718 } else { 728 },
        456,
        label,
        16,
        800,
        rgb(255, 255, 255),
    );

    text(hdc, 842, 20, "×", 24, 400, rgb(130, 130, 140));
}

fn start_install(hwnd: HWND) {
    if INSTALLING.swap(true, Ordering::SeqCst) || DONE.load(Ordering::SeqCst) {
        return;
    }
    PROGRESS.store(8, Ordering::SeqCst);
    let hwnd_raw = hwnd.0 as isize;
    thread::spawn(move || {
        let hwnd = HWND(hwnd_raw as *mut _);
        let setup = write_embedded("ChangLi-inner-setup.exe", SETUP_BYTES);
        for p in [18, 30, 46, 62] {
            PROGRESS.store(p, Ordering::SeqCst);
            unsafe {
                InvalidateRect(Some(hwnd), None, false).ok();
            }
            thread::sleep(Duration::from_millis(260));
        }
        let result = Command::new(&setup).arg("/S").status();
        match result {
            Ok(s) if s.success() => {
                PROGRESS.store(100, Ordering::SeqCst);
                DONE.store(true, Ordering::SeqCst);
            }
            _ => FAILED.store(true, Ordering::SeqCst),
        }
        INSTALLING.store(false, Ordering::SeqCst);
        unsafe {
            InvalidateRect(Some(hwnd), None, false).ok();
        }
    });
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    match msg {
        WM_CREATE => {
            SetTimer(Some(hwnd), 1, 120, None);
            LRESULT(0)
        }
        WM_TIMER => {
            if INSTALLING.load(Ordering::SeqCst) {
                InvalidateRect(Some(hwnd), None, false).ok();
            }
            LRESULT(0)
        }
        WM_NCHITTEST => LRESULT(HTCAPTION as isize),
        WM_LBUTTONDOWN => {
            let x = (l.0 & 0xffff) as i16 as i32;
            let y = ((l.0 >> 16) & 0xffff) as i16 as i32;
            if CLOSE_RECT.contains(x, y) || CANCEL_RECT.contains(x, y) {
                DestroyWindow(hwnd).ok();
            } else if INSTALL_RECT.contains(x, y) {
                if DONE.load(Ordering::SeqCst) {
                    DestroyWindow(hwnd).ok();
                } else {
                    start_install(hwnd);
                }
            }
            LRESULT(0)
        }
        WM_PAINT => {
            let mut ps = PAINTSTRUCT::default();
            let hdc = BeginPaint(hwnd, &mut ps);
            draw_sidebar(hdc);
            draw_main(hdc);
            EndPaint(hwnd, &ps).ok();
            LRESULT(0)
        }
        WM_CLOSE => {
            DestroyWindow(hwnd).ok();
            LRESULT(0)
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, w, l),
    }
}

fn main() -> windows::core::Result<()> {
    unsafe {
        let instance = GetModuleHandleW(None)?;
        let class_name = wide("ChangLiCustomInstaller");
        let wc = WNDCLASSW {
            hInstance: instance.into(),
            lpszClassName: PCWSTR(class_name.as_ptr()),
            lpfnWndProc: Some(wndproc),
            style: CS_HREDRAW | CS_VREDRAW,
            ..Default::default()
        };
        RegisterClassW(&wc);
        let title = wide("ChangLi Installer");
        let hwnd = CreateWindowExW(
            Default::default(),
            PCWSTR(class_name.as_ptr()),
            PCWSTR(title.as_ptr()),
            WS_POPUP | WS_VISIBLE,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            W,
            H,
            None,
            None,
            Some(instance.into()),
            Some(null_mut()),
        )?;
        ShowWindow(hwnd, SW_SHOW);
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
    Ok(())
}
