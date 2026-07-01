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
        Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
        Graphics::Gdi::{
            BeginPaint, CreateFontW, CreatePen, CreateRoundRectRgn, CreateSolidBrush, DeleteObject,
            EndPaint, FillRect, GetStockObject, InvalidateRect, LineTo, MoveToEx, RoundRect,
            ScreenToClient, SelectObject, SetBkMode, SetTextColor, SetWindowRgn, TextOutW,
            FONT_CHARSET, FONT_CLIP_PRECISION, FONT_OUTPUT_PRECISION, FONT_QUALITY, HDC, HFONT,
            HGDIOBJ, PAINTSTRUCT, PS_SOLID, TRANSPARENT, WHITE_BRUSH,
        },
        System::LibraryLoader::GetModuleHandleW,
        UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, DrawIconEx,
            GetMessageW, GetSystemMetrics, LoadImageW, PostQuitMessage, RegisterClassW, SetTimer,
            ShowWindow, TranslateMessage, CS_HREDRAW, CS_VREDRAW, DI_NORMAL, HICON, HTCAPTION,
            HTCLIENT, IMAGE_ICON, LR_LOADFROMFILE, MSG, SM_CXSCREEN, SM_CYSCREEN, SW_SHOW,
            WM_CLOSE, WM_CREATE, WM_DESTROY, WM_LBUTTONDOWN, WM_NCHITTEST, WM_PAINT, WM_TIMER,
            WNDCLASSW, WS_POPUP, WS_VISIBLE,
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

const W: i32 = 980;
const H: i32 = 640;
const SIDEBAR_W: i32 = 318;
const RADIUS: i32 = 34;

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
    x: 932,
    y: 28,
    w: 32,
    h: 32,
};
const INSTALL_RECT: RectI = RectI {
    x: 832,
    y: 574,
    w: 114,
    h: 46,
};
const CANCEL_RECT: RectI = RectI {
    x: 742,
    y: 574,
    w: 78,
    h: 46,
};
const TITLE_DRAG_RECT: RectI = RectI {
    x: 0,
    y: 0,
    w: W,
    h: 74,
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
        -size,
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

unsafe fn fill_rect(hdc: HDC, r: RectI, color: COLORREF) {
    let brush = CreateSolidBrush(color);
    FillRect(
        hdc,
        &RECT {
            left: r.x,
            top: r.y,
            right: r.x + r.w,
            bottom: r.y + r.h,
        },
        brush,
    );
    DeleteObject(HGDIOBJ(brush.0)).ok();
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

unsafe fn pill(hdc: HDC, x: i32, y: i32, w: i32, label: &str) {
    fill_round(hdc, RectI { x, y, w, h: 32 }, 18, rgb(255, 153, 154));
    stroke_round(hdc, RectI { x, y, w, h: 32 }, 18, rgb(255, 195, 196));
    text(hdc, x + 14, y + 8, label, 12, 800, rgb(255, 255, 255));
}

fn write_embedded(name: &str, bytes: &[u8]) -> PathBuf {
    let mut p = env::temp_dir();
    p.push(name);
    let _ = fs::write(&p, bytes);
    p
}

unsafe fn draw_left_gradient(hdc: HDC) {
    for y in 0..H {
        let t = y as f32 / H as f32;
        let r = (246.0 + (255.0 - 246.0) * t) as u8;
        let g = (78.0 + (143.0 - 78.0) * t) as u8;
        let b = (116.0 + (73.0 - 116.0) * t) as u8;
        let pen = CreatePen(PS_SOLID, 1, rgb(r, g, b));
        let old = SelectObject(hdc, HGDIOBJ(pen.0));
        MoveToEx(hdc, 0, y, None).ok();
        LineTo(hdc, SIDEBAR_W, y).ok();
        SelectObject(hdc, old);
        DeleteObject(HGDIOBJ(pen.0)).ok();
    }

    // subtle brand glow blocks from the HTML preview direction
    fill_round(
        hdc,
        RectI {
            x: -80,
            y: 350,
            w: 240,
            h: 160,
        },
        80,
        rgb(255, 149, 128),
    );
    fill_round(
        hdc,
        RectI {
            x: 178,
            y: -68,
            w: 210,
            h: 170,
        },
        80,
        rgb(255, 126, 112),
    );
}

unsafe fn draw_icon(hdc: HDC, x: i32, y: i32, size: i32) {
    let icon_path = write_embedded("changli-installer-icon.ico", ICON_BYTES);
    let icon_path_w = wide(icon_path.to_string_lossy().as_ref());
    let icon = LoadImageW(
        None,
        PCWSTR(icon_path_w.as_ptr()),
        IMAGE_ICON,
        size,
        size,
        LR_LOADFROMFILE,
    )
    .unwrap_or_default();
    DrawIconEx(hdc, x, y, HICON(icon.0), size, size, 0, None, DI_NORMAL).ok();
}

unsafe fn draw_sidebar(hdc: HDC) {
    draw_left_gradient(hdc);
    fill_round(
        hdc,
        RectI {
            x: 34,
            y: 34,
            w: 64,
            h: 64,
        },
        24,
        rgb(255, 255, 255),
    );
    draw_icon(hdc, 43, 43, 46);

    text(hdc, 118, 38, "ChangLi", 26, 800, rgb(255, 255, 255));
    text(
        hdc,
        120,
        72,
        "PRIVATE MEDIA LIBRARY",
        10,
        700,
        rgb(255, 237, 242),
    );

    text(hdc, 36, 148, "装好后", 40, 800, rgb(255, 255, 255));
    text(hdc, 36, 202, "直接进入", 40, 800, rgb(255, 255, 255));
    text(hdc, 36, 256, "收藏宇宙", 40, 800, rgb(255, 255, 255));
    text(
        hdc,
        38,
        318,
        "本地资料、海报、播放器和收藏路径会原样保留。",
        13,
        500,
        rgb(255, 239, 243),
    );

    pill(hdc, 36, 392, 120, "本地数据库");
    pill(hdc, 36, 434, 120, "内置播放器");
    pill(hdc, 36, 476, 104, "自动建库");
}

unsafe fn card(hdc: HDC, x: i32, title: &str, body1: &str, body2: &str) {
    fill_round(
        hdc,
        RectI {
            x,
            y: 330,
            w: 156,
            h: 104,
        },
        26,
        rgb(255, 255, 255),
    );
    stroke_round(
        hdc,
        RectI {
            x,
            y: 330,
            w: 156,
            h: 104,
        },
        26,
        rgb(232, 235, 242),
    );
    fill_round(
        hdc,
        RectI {
            x: x + 18,
            y: 350,
            w: 26,
            h: 26,
        },
        18,
        rgb(255, 238, 241),
    );
    text(hdc, x + 20, 351, "✓", 18, 800, rgb(238, 82, 118));
    text(hdc, x + 18, 386, title, 15, 800, rgb(24, 23, 29));
    text(hdc, x + 18, 410, body1, 12, 400, rgb(113, 113, 122));
    text(hdc, x + 18, 426, body2, 12, 400, rgb(113, 113, 122));
}

unsafe fn draw_main(hdc: HDC) {
    fill_rect(
        hdc,
        RectI {
            x: SIDEBAR_W,
            y: 0,
            w: W - SIDEBAR_W,
            h: H,
        },
        rgb(250, 250, 252),
    );
    fill_round(
        hdc,
        RectI {
            x: SIDEBAR_W + 28,
            y: 28,
            w: 544,
            h: 504,
        },
        34,
        rgb(255, 255, 255),
    );

    text(hdc, 366, 56, "●  ○  ○", 16, 800, rgb(244, 80, 116));
    let version = option_env!("CHANGLI_APP_VERSION").unwrap_or("dev");
    text(
        hdc,
        366,
        92,
        &format!("ChangLi {version}"),
        14,
        800,
        rgb(244, 80, 116),
    );
    text(hdc, 366, 130, "准备安装长离", 34, 800, rgb(24, 23, 29));
    text(
        hdc,
        368,
        180,
        "安装完成后即可打开你的本地影音资料库，",
        15,
        400,
        rgb(102, 102, 116),
    );
    text(
        hdc,
        368,
        204,
        "继续保留原有数据与播放环境。",
        15,
        400,
        rgb(102, 102, 116),
    );

    fill_round(
        hdc,
        RectI {
            x: 366,
            y: 244,
            w: 478,
            h: 64,
        },
        24,
        rgb(249, 250, 252),
    );
    stroke_round(
        hdc,
        RectI {
            x: 366,
            y: 244,
            w: 478,
            h: 64,
        },
        24,
        rgb(230, 232, 238),
    );
    text(hdc, 388, 258, "安装位置", 12, 700, rgb(113, 113, 122));
    text(
        hdc,
        388,
        281,
        "当前用户 AppData / ChangLi",
        16,
        800,
        rgb(24, 23, 29),
    );
    fill_round(
        hdc,
        RectI {
            x: 774,
            y: 260,
            w: 52,
            h: 32,
        },
        18,
        rgb(255, 238, 241),
    );
    text(hdc, 786, 268, "更改", 13, 800, rgb(221, 69, 105));

    card(hdc, 366, "保留本地数据", "升级安装会沿用", "现有资料库。");
    card(hdc, 532, "播放器就绪", "内置播放环境，", "安装后直接用。");
    card(hdc, 698, "一键启动", "完成后可立即", "打开 ChangLi。");

    let progress = PROGRESS.load(Ordering::SeqCst);
    fill_round(
        hdc,
        RectI {
            x: 366,
            y: 582,
            w: 184,
            h: 8,
        },
        8,
        rgb(241, 243, 247),
    );
    if progress > 0 {
        fill_round(
            hdc,
            RectI {
                x: 366,
                y: 582,
                w: 184 * progress / 100,
                h: 8,
            },
            8,
            rgb(244, 80, 116),
        );
    }

    let status = if FAILED.load(Ordering::SeqCst) {
        "安装失败，请重新运行安装程序"
    } else if DONE.load(Ordering::SeqCst) {
        "安装完成，可以打开 ChangLi"
    } else if INSTALLING.load(Ordering::SeqCst) {
        "正在安装 ChangLi..."
    } else {
        "准备就绪，约 1 分钟完成"
    };
    text(hdc, 366, 604, status, 13, 400, rgb(113, 113, 122));

    fill_round(hdc, CANCEL_RECT, 22, rgb(255, 255, 255));
    stroke_round(hdc, CANCEL_RECT, 22, rgb(225, 228, 236));
    text(hdc, 766, 588, "取消", 15, 800, rgb(82, 82, 91));

    let label = if DONE.load(Ordering::SeqCst) {
        "完成"
    } else if INSTALLING.load(Ordering::SeqCst) {
        "安装中"
    } else {
        "开始安装"
    };
    fill_round(hdc, INSTALL_RECT, 24, rgb(244, 80, 116));
    text(
        hdc,
        if label == "开始安装" { 858 } else { 872 },
        588,
        label,
        15,
        800,
        rgb(255, 255, 255),
    );

    text(hdc, 942, 32, "×", 24, 400, rgb(128, 128, 138));
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

unsafe fn client_point(hwnd: HWND, l: LPARAM) -> (i32, i32) {
    let mut pt = POINT {
        x: (l.0 & 0xffff) as i16 as i32,
        y: ((l.0 >> 16) & 0xffff) as i16 as i32,
    };
    ScreenToClient(hwnd, &mut pt).ok();
    (pt.x, pt.y)
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, _w: WPARAM, l: LPARAM) -> LRESULT {
    match msg {
        WM_CREATE => {
            let region = CreateRoundRectRgn(0, 0, W + 1, H + 1, RADIUS, RADIUS);
            SetWindowRgn(hwnd, Some(region), true);
            SetTimer(Some(hwnd), 1, 120, None);
            LRESULT(0)
        }
        WM_TIMER => {
            if INSTALLING.load(Ordering::SeqCst) {
                InvalidateRect(Some(hwnd), None, false).ok();
            }
            LRESULT(0)
        }
        WM_NCHITTEST => {
            let (x, y) = client_point(hwnd, l);
            if CLOSE_RECT.contains(x, y)
                || INSTALL_RECT.contains(x, y)
                || CANCEL_RECT.contains(x, y)
            {
                LRESULT(HTCLIENT as isize)
            } else if TITLE_DRAG_RECT.contains(x, y) {
                LRESULT(HTCAPTION as isize)
            } else {
                LRESULT(HTCLIENT as isize)
            }
        }
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
            fill_round(
                hdc,
                RectI {
                    x: 0,
                    y: 0,
                    w: W,
                    h: H,
                },
                RADIUS,
                rgb(255, 255, 255),
            );
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
        _ => DefWindowProcW(hwnd, msg, _w, l),
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

        let x = (GetSystemMetrics(SM_CXSCREEN) - W) / 2;
        let y = (GetSystemMetrics(SM_CYSCREEN) - H) / 2;
        let title = wide("ChangLi Installer");
        let hwnd = CreateWindowExW(
            Default::default(),
            PCWSTR(class_name.as_ptr()),
            PCWSTR(title.as_ptr()),
            WS_POPUP | WS_VISIBLE,
            x,
            y,
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
