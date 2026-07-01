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
            x: 178,
            y: -30,
            w: 170,
            h: 118,
        },
        48,
        rgb(255, 126, 107),
    );
    fill_round(
        hdc,
        RectI {
            x: -62,
            y: 338,
            w: 206,
            h: 206,
        },
        103,
        rgb(255, 146, 101),
    );
    fill_round(
        hdc,
        RectI {
            x: 36,
            y: 392,
            w: 154,
            h: 90,
        },
        30,
        rgb(255, 117, 100),
    );

    fill_round(
        hdc,
        RectI {
            x: 32,
            y: 32,
            w: 64,
            h: 64,
        },
        16,
        rgb(255, 246, 248),
    );
    draw_icon(hdc, 39, 39, 50);

    text(hdc, 116, 40, "ChangLi", 29, 800, rgb(255, 255, 255));
    text(
        hdc,
        118,
        73,
        "PRIVATE MEDIA LIBRARY",
        11,
        700,
        rgb(255, 239, 244),
    );

    text(hdc, 36, 142, "装好后", 41, 900, rgb(255, 255, 255));
    text(hdc, 36, 194, "直接进入", 41, 900, rgb(255, 255, 255));
    text(hdc, 36, 246, "收藏宇宙", 41, 900, rgb(255, 255, 255));
    text(
        hdc,
        38,
        322,
        "本地资料、海报、播放环境和收藏路径会原样保留。",
        13,
        500,
        rgb(255, 246, 248),
    );

    let pills = [
        ("本地数据库", 36, 382, 118),
        ("播放器就绪", 36, 424, 118),
        ("自动建库", 166, 424, 88),
    ];
    for (label, x, y, w) in pills {
        fill_round(hdc, RectI { x, y, w, h: 32 }, 16, rgb(255, 230, 236));
        text(hdc, x + 18, y + 8, label, 13, 800, rgb(224, 64, 96));
    }
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
        rgb(247, 248, 252),
    );

    fill_round(
        hdc,
        RectI {
            x: 330,
            y: 30,
            w: 508,
            h: 404,
        },
        30,
        rgb(255, 255, 255),
    );
    stroke_round(
        hdc,
        RectI {
            x: 330,
            y: 30,
            w: 508,
            h: 404,
        },
        30,
        rgb(243, 244, 248),
    );

    fill_round(
        hdc,
        RectI {
            x: 354,
            y: 62,
            w: 8,
            h: 8,
        },
        4,
        rgb(244, 73, 117),
    );
    fill_round(
        hdc,
        RectI {
            x: 376,
            y: 62,
            w: 8,
            h: 8,
        },
        4,
        rgb(255, 203, 211),
    );
    fill_round(
        hdc,
        RectI {
            x: 398,
            y: 62,
            w: 8,
            h: 8,
        },
        4,
        rgb(255, 203, 211),
    );

    let version = option_env!("CHANGLI_APP_VERSION").unwrap_or("dev");
    text(
        hdc,
        354,
        94,
        &format!("ChangLi {version}"),
        15,
        800,
        rgb(244, 73, 117),
    );
    text(hdc, 354, 130, "准备安装长离", 34, 900, rgb(16, 18, 27));
    text(
        hdc,
        356,
        178,
        "安装完成后立即打开你的本地影音资料库。",
        15,
        500,
        rgb(91, 97, 112),
    );
    text(
        hdc,
        356,
        202,
        "原有数据、海报和播放环境都会继续保留。",
        15,
        500,
        rgb(91, 97, 112),
    );

    fill_round(
        hdc,
        RectI {
            x: 354,
            y: 244,
            w: 460,
            h: 70,
        },
        18,
        rgb(250, 251, 253),
    );
    stroke_round(
        hdc,
        RectI {
            x: 354,
            y: 244,
            w: 460,
            h: 70,
        },
        18,
        rgb(228, 232, 240),
    );
    fill_round(
        hdc,
        RectI {
            x: 372,
            y: 266,
            w: 26,
            h: 26,
        },
        13,
        rgb(255, 232, 238),
    );
    text(hdc, 380, 269, "⌂", 17, 800, rgb(244, 73, 117));
    text(hdc, 412, 260, "安装位置", 13, 800, rgb(91, 97, 112));
    text(
        hdc,
        412,
        284,
        "当前用户 AppData / ChangLi",
        17,
        800,
        rgb(16, 18, 27),
    );
    fill_round(
        hdc,
        RectI {
            x: 742,
            y: 264,
            w: 54,
            h: 30,
        },
        15,
        rgb(255, 235, 240),
    );
    text(hdc, 754, 271, "更改", 13, 800, rgb(213, 63, 100));

    let cards = [
        (
            354,
            "✓",
            "保留本地数据",
            "升级沿用现有资料库",
            rgb(255, 246, 248),
        ),
        (510, "▶", "播放器就绪", "安装后直接播放", rgb(255, 249, 244)),
        (666, "↗", "一键启动", "完成后立即打开", rgb(250, 251, 253)),
    ];
    for (x, mark, title, body, card_bg) in cards {
        fill_round(
            hdc,
            RectI {
                x,
                y: 336,
                w: 140,
                h: 74,
            },
            18,
            card_bg,
        );
        stroke_round(
            hdc,
            RectI {
                x,
                y: 336,
                w: 140,
                h: 74,
            },
            18,
            rgb(234, 237, 244),
        );
        fill_round(
            hdc,
            RectI {
                x: x + 16,
                y: 352,
                w: 24,
                h: 24,
            },
            12,
            rgb(255, 226, 234),
        );
        text(hdc, x + 23, 355, mark, 15, 900, rgb(244, 73, 117));
        text(hdc, x + 48, 350, title, 15, 900, rgb(16, 18, 27));
        text(hdc, x + 48, 374, body, 12, 600, rgb(99, 107, 124));
    }

    let progress = PROGRESS.load(Ordering::SeqCst);
    fill_round(
        hdc,
        RectI {
            x: 354,
            y: 458,
            w: 212,
            h: 8,
        },
        8,
        rgb(233, 236, 243),
    );
    if progress > 0 {
        fill_round(
            hdc,
            RectI {
                x: 354,
                y: 458,
                w: 212 * progress / 100,
                h: 8,
            },
            8,
            rgb(244, 73, 117),
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
    text(hdc, 354, 478, status, 13, 600, rgb(91, 97, 112));

    fill_round(hdc, CANCEL_RECT, 16, rgb(255, 255, 255));
    stroke_round(hdc, CANCEL_RECT, 16, rgb(220, 224, 233));
    text(hdc, 765, 588, "取消", 16, 800, rgb(72, 76, 89));

    let label = if DONE.load(Ordering::SeqCst) {
        "完成"
    } else if INSTALLING.load(Ordering::SeqCst) {
        "安装中"
    } else {
        "开始安装"
    };
    fill_round(hdc, INSTALL_RECT, 16, rgb(244, 73, 117));
    fill_round(
        hdc,
        RectI {
            x: INSTALL_RECT.x + 12,
            y: INSTALL_RECT.y + 6,
            w: INSTALL_RECT.w - 24,
            h: 12,
        },
        8,
        rgb(255, 103, 135),
    );
    text(
        hdc,
        if label == "开始安装" { 856 } else { 873 },
        588,
        label,
        16,
        900,
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
