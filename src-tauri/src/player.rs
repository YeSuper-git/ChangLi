use anyhow::{anyhow, Context, Result};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
#[cfg(target_os = "windows")]
use std::thread;
#[cfg(target_os = "windows")]
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

const PLAYER_WINDOW_LABEL: &str = "player";
const PLAYER_OFFSET_X: f64 = 40.0;
const PLAYER_WIDTH: f64 = 720.0;
const PLAYER_HEIGHT: f64 = 420.0;

static MPV_SESSION: Mutex<Option<MpvSession>> = Mutex::new(None);
static ALWAYS_ON_TOP: Mutex<bool> = Mutex::new(false);

struct MpvSession {
    child: Child,
    ipc_path: String,
}

fn candidate_mpv_paths(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(path) = std::env::var("CHANGLI_MPV_PATH") {
        if !path.trim().is_empty() {
            candidates.push(PathBuf::from(path));
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("mpv").join("mpv.exe"));
        candidates.push(resource_dir.join("resources").join("mpv").join("mpv.exe"));
    }

    candidates
}

pub fn play(app: &AppHandle, path: &str) -> Result<()> {
    let video_path = PathBuf::from(path);
    if !video_path.exists() || !video_path.is_file() {
        return Err(anyhow!("视频文件不存在: {}", path));
    }

    play_platform(app, &video_path)
}

#[cfg(target_os = "windows")]
fn play_platform(app: &AppHandle, video_path: &PathBuf) -> Result<()> {
    // 根因确认：此前 Windows 路径创建了一个 Tauri WebView 播放壳，再把 mpv --wid
    // 嵌入到这个 WebView HWND。这个架构在 WebView2/DWM 合成下反复出现“外部悬浮、
    // 黑屏/无声、无边框无法关闭”：
    // 1) position_player_window_next_to_main 会把播放壳放到主窗口右侧（不是主窗口内）；
    // 2) 播放壳 decorations(false) 且前端只渲染空 div，没有真实系统关闭入口；
    // 3) --wid 嵌入 WebView HWND 已加 attach-parent/ANGLE/不透明黑底仍不稳定。
    // 因此 Windows 仍使用 mpv 原生窗口兜底：不传 --wid，保留 mpv 自身可关闭窗口。
    // 用户要求视觉上在原程序窗口内播放：把 mpv 几何位置覆盖到主窗口内容区，
    // 同时给原生窗口加 --ontop，避免它被 ChangLi 主窗口遮挡。
    if let Some(window) = app.get_webview_window(PLAYER_WINDOW_LABEL) {
        let _ = window.close();
    }

    let mut session = MPV_SESSION
        .lock()
        .map_err(|_| anyhow!("mpv session lock poisoned"))?;

    if reuse_existing_session(&mut session, video_path)? {
        return Ok(());
    }

    let ipc_path = unique_ipc_path();
    let geometry = windows_mpv_geometry(app);
    let new_session =
        spawn_mpv_with_options(app, None, geometry.as_deref(), &ipc_path, video_path)?;
    *session = Some(new_session);
    // 延迟一小段时间等 mpv 窗口创建，然后尝试激活到前台
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(500));
        // 查找 mpv 窗口并激活
        #[cfg(target_os = "windows")]
        {
            use windows::Win32::UI::WindowsAndMessaging::*;
            use windows::Win32::Foundation::*;
            unsafe {
                // 查找标题含 "ChangLi" 的窗口（mpv --title 设置的）
                let mut found_hwnd = HWND::default();
                EnumWindows(Some(enum_windows_callback), LPARAM(&mut found_hwnd as *mut _ as isize));
                if !found_hwnd.0.is_null() {
                    let _ = SetForegroundWindow(found_hwnd);
                    let _ = ShowWindow(found_hwnd, SW_SHOW);
                }
            }
        }
    });
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn play_platform(app: &AppHandle, video_path: &PathBuf) -> Result<()> {
    let player_window = get_or_create_player_window(app)?;
    position_player_window_next_to_main(app, &player_window)?;
    sync_player_minimize_state(app, &player_window)?;
    player_window.show()?;
    player_window.set_focus()?;

    let mut session = MPV_SESSION
        .lock()
        .map_err(|_| anyhow!("mpv session lock poisoned"))?;

    if reuse_existing_session(&mut session, video_path)? {
        return Ok(());
    }

    let new_session = spawn_mpv(app, &player_window, video_path)?;
    *session = Some(new_session);
    Ok(())
}

pub fn close_player_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(PLAYER_WINDOW_LABEL) {
        let _ = window.close();
    }
    kill_mpv();
}

pub fn handle_main_window_event(app: &AppHandle, event: &WindowEvent) {
    match event {
        WindowEvent::Moved(_) => {
            if let Some(player) = app.get_webview_window(PLAYER_WINDOW_LABEL) {
                let _ = position_player_window_next_to_main(app, &player);
            }
        }
        WindowEvent::Resized(_) => {
            if let Some(player) = app.get_webview_window(PLAYER_WINDOW_LABEL) {
                let _ = sync_player_minimize_state(app, &player);
                let _ = position_player_window_next_to_main(app, &player);
            }
        }
        WindowEvent::Destroyed => close_player_window(app),
        WindowEvent::CloseRequested { .. } => close_player_window(app),
        _ => {}
    }
}

#[allow(unused_variables)]
pub fn toggle_always_on_top(app: &AppHandle) -> Result<bool> {
    let mut flag = ALWAYS_ON_TOP
        .lock()
        .map_err(|_| anyhow!("always-on-top lock poisoned"))?;
    *flag = !*flag;
    #[cfg(not(target_os = "windows"))]
    {
        let player_window = get_or_create_player_window(app)?;
        player_window.set_always_on_top(*flag)?;
    }
    Ok(*flag)
}

pub fn register_shortcuts(app: &AppHandle) -> Result<()> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let app_for_shortcut = app.clone();
    app.global_shortcut()
        .on_shortcut("Ctrl+Shift+T", move |_app, _shortcut, _event| {
            let _ = toggle_always_on_top(&app_for_shortcut);
        })
        .context("register Ctrl+Shift+T shortcut for player always-on-top")?;
    Ok(())
}

/// Game DVR 注册表键路径
#[cfg(target_os = "windows")]
const GAME_DVR_KEY: &str = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR";
#[cfg(target_os = "windows")]
const GAME_CONFIG_KEY: &str = "System\\GameConfigStore";
#[cfg(target_os = "windows")]
const GAME_BAR_KEY: &str = "SOFTWARE\\Microsoft\\GameBar";

/// 一键禁用游戏覆盖（Game DVR + NVIDIA Profile）
#[cfg(target_os = "windows")]
pub fn set_game_overlay_disabled(disabled: bool) -> Result<String, String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE};
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let val: u32 = if disabled { 0 } else { 1 };

    // Game DVR
    if let Ok(key) = hkcu.create_subkey_with_flags(GAME_DVR_KEY, KEY_SET_VALUE) {
        let _ = key.0.set_value("AppCaptureEnabled", &val);
    }
    // GameConfigStore
    if let Ok(key) = hkcu.create_subkey_with_flags(GAME_CONFIG_KEY, KEY_SET_VALUE) {
        let _ = key.0.set_value("GameDVR_Enabled", &val);
    }
    // GameBar
    if let Ok(key) = hkcu.create_subkey_with_flags(GAME_BAR_KEY, KEY_SET_VALUE) {
        let _ = key.0.set_value("AllowAutoGameMode", &val);
    }

    // NVIDIA Profile Inspector 导入（仅禁用时）
    if disabled {
        if let Ok(exe_dir) = std::env::current_exe().map(|p| p.parent().unwrap().to_path_buf()) {
            let nip_exe = exe_dir.join("nvidiaProfileInspector.exe");
            let nip_xml = exe_dir.join("changli-disable-overlay.xml");
            if nip_exe.exists() && nip_xml.exists() {
                let _ = std::process::Command::new(&nip_exe)
                    .arg("-import")
                    .arg(&nip_xml)
                    .output();
            }
        }
    }

    // 读取当前状态
    let current = read_game_overlay_disabled().unwrap_or(disabled);
    Ok(if current { "disabled".into() } else { "enabled".into() })
}

/// 读取当前游戏覆盖禁用状态
#[cfg(target_os = "windows")]
pub fn read_game_overlay_disabled() -> Result<bool, String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(key) = hkcu.open_subkey_with_flags(GAME_DVR_KEY, KEY_READ) {
        if let Ok(val) = key.get_value::<u32, _>("AppCaptureEnabled") {
            return Ok(val == 0);
        }
    }
    Ok(false)
}

#[cfg(not(target_os = "windows"))]
pub fn set_game_overlay_disabled(_disabled: bool) -> Result<String, String> {
    Ok("unsupported".into())
}

#[cfg(not(target_os = "windows"))]
pub fn read_game_overlay_disabled() -> Result<bool, String> {
    Ok(false)
}

/// 启动时自动禁用 Game DVR（保持向后兼容）
pub fn disable_game_dvr() {
    let _ = set_game_overlay_disabled(true);
}

fn get_or_create_player_window(app: &AppHandle) -> Result<WebviewWindow> {
    if let Some(window) = app.get_webview_window(PLAYER_WINDOW_LABEL) {
        apply_player_window_style(&window)?;
        return Ok(window);
    }

    let mut builder = WebviewWindowBuilder::new(
        app,
        PLAYER_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=player".into()),
    )
    .title("ChangLi Player")
    .inner_size(PLAYER_WIDTH, PLAYER_HEIGHT)
    .min_inner_size(480.0, 270.0)
    .resizable(true)
    .decorations(false)
    .skip_taskbar(true)
    .visible(false);

    #[cfg(target_os = "windows")]
    {
        // Windows + mpv --wid 嵌入到透明 WebView 窗口时容易被 DWM/WebView2 合成成
        // 悬浮透明孤儿窗或有声音无画面。Windows 播放承载窗改为不透明黑底，
        // 让 mpv 子窗口严格限制在 Tauri 的黑色播放区域内。
        builder = builder.transparent(false);
    }

    #[cfg(not(target_os = "windows"))]
    {
        builder = builder.transparent(true);
    }

    let window = builder.build().context("create player window")?;

    window.on_window_event(|event| match event {
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => kill_mpv(),
        _ => {}
    });

    apply_player_window_style(&window)?;
    Ok(window)
}

fn apply_player_window_style(window: &WebviewWindow) -> Result<()> {
    let always_on_top = *ALWAYS_ON_TOP
        .lock()
        .map_err(|_| anyhow!("always-on-top lock poisoned"))?;
    window.set_decorations(false)?;
    window.set_skip_taskbar(true)?;
    window.set_always_on_top(always_on_top)?;
    set_windows_11_rounded_corners(window);
    Ok(())
}

fn position_player_window_next_to_main(app: &AppHandle, player: &WebviewWindow) -> Result<()> {
    let Some(main) = app.get_webview_window("main") else {
        return Ok(());
    };

    let main_pos = main.outer_position()?;
    let main_size = main.outer_size()?;
    let scale = main.scale_factor().unwrap_or(1.0);
    let x = main_pos.x as f64 / scale + main_size.width as f64 / scale + PLAYER_OFFSET_X;
    let y = main_pos.y as f64 / scale;

    player.set_position(LogicalPosition::new(x, y))?;
    if let Ok(size) = player.inner_size() {
        if size.width == 0 || size.height == 0 {
            player.set_size(LogicalSize::new(PLAYER_WIDTH, PLAYER_HEIGHT))?;
        }
    }
    Ok(())
}

fn sync_player_minimize_state(app: &AppHandle, player: &WebviewWindow) -> Result<()> {
    let Some(main) = app.get_webview_window("main") else {
        return Ok(());
    };

    if main.is_minimized()? {
        player.minimize()?;
    } else if player.is_minimized()? {
        player.unminimize()?;
    }

    Ok(())
}

fn spawn_mpv(app: &AppHandle, window: &WebviewWindow, video_path: &PathBuf) -> Result<MpvSession> {
    let ipc_path = unique_ipc_path();
    let wid = native_window_id(window).context("获取独立播放窗口原生句柄失败")?;
    spawn_mpv_with_options(app, wid.as_deref(), None, &ipc_path, video_path)
}

fn spawn_mpv_with_options(
    app: &AppHandle,
    wid: Option<&str>,
    geometry: Option<&str>,
    ipc_path: &str,
    video_path: &PathBuf,
) -> Result<MpvSession> {
    let mut last_error: Option<anyhow::Error> = None;
    for mpv_path in candidate_mpv_paths(app) {
        if !mpv_path.exists() || !mpv_path.is_file() {
            continue;
        }

        match spawn_mpv_process(&mpv_path, wid, geometry, ipc_path, video_path) {
            Ok(child) => {
                return Ok(MpvSession {
                    child,
                    ipc_path: ipc_path.to_string(),
                })
            }
            Err(error) => last_error = Some(error),
        }
    }

    match spawn_mpv_process(&PathBuf::from("mpv"), wid, geometry, ipc_path, video_path) {
        Ok(child) => Ok(MpvSession {
            child,
            ipc_path: ipc_path.to_string(),
        }),
        Err(error) => Err(last_error.unwrap_or(error)).context(
            "无法启动 mpv。请确认安装包已内置 mpv，或本机 PATH 中存在 mpv；也可以设置 CHANGLI_MPV_PATH 指向 mpv.exe。",
        ),
    }
}

fn spawn_mpv_process(
    mpv_path: &PathBuf,
    wid: Option<&str>,
    _geometry: Option<&str>,
    ipc_path: &str,
    video_path: &PathBuf,
) -> Result<Child> {
    let mut command = Command::new(mpv_path);

    #[cfg(target_os = "windows")]
    {
        if let Some(wid) = wid {
            command
                .arg("--attach-parent-window")
                .arg(format!("--wid={wid}"));
        }

        if wid.is_some() {
            command
                .arg("--vo=gpu-next")
                .arg("--gpu-context=d3d11")
                .arg("--no-keepaspect-window")
                .arg("--background=none")
                .arg("--no-border");
        } else {
            command.arg("--border=yes").arg("--ontop");
            if let Some(geometry) = _geometry {
                command.arg(format!("--geometry={geometry}"));
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Some(wid) = wid {
            command.arg(format!("--wid={wid}"));
        }
        command.arg("--border=no");
    }

    command
        .arg("--force-window=yes")
        .arg("--hwdec=d3d11va")
        .arg("--d3d11-sync-interval=0")
        .arg("--video-sync=audio")
        .arg("--osc=yes")
        .arg("--input-default-bindings=yes")
        .arg("--keep-open=no")
        .arg("--title=ChangLi - ${media-title}")
        .arg(format!("--input-ipc-server={ipc_path}"));

    #[cfg(target_os = "windows")]
    if *ALWAYS_ON_TOP
        .lock()
        .map_err(|_| anyhow!("always-on-top lock poisoned"))?
    {
        command.arg("--ontop");
    }

    command.arg(video_path);

    command
        .spawn()
        .with_context(|| format!("启动 mpv 失败: {}", mpv_path.display()))
}

#[cfg(target_os = "windows")]
fn windows_mpv_geometry(app: &AppHandle) -> Option<String> {
    let main = app.get_webview_window("main")?;
    let pos = main.outer_position().ok()?;
    let size = main.outer_size().ok()?;
    let margin_x = 32_i32;
    let top_margin = 88_i32;
    let bottom_margin = 44_i32;
    let x = pos.x.saturating_add(margin_x);
    let y = pos.y.saturating_add(top_margin);
    let width = (size.width as i32 - margin_x * 2).max(640);
    let height = (size.height as i32 - top_margin - bottom_margin).max(360);

    Some(format!(
        "{}x{}{}{}",
        width,
        height,
        signed_geometry_offset(x),
        signed_geometry_offset(y)
    ))
}

#[cfg(target_os = "windows")]
fn signed_geometry_offset(value: i32) -> String {
    if value >= 0 {
        format!("+{value}")
    } else {
        value.to_string()
    }
}

fn reuse_existing_session(session: &mut Option<MpvSession>, video_path: &PathBuf) -> Result<bool> {
    let should_discard = if let Some(existing) = session.as_mut() {
        if existing.child.try_wait()?.is_none() {
            if send_loadfile(&existing.ipc_path, video_path).is_ok() {
                return Ok(true);
            }
            true
        } else {
            true
        }
    } else {
        false
    };

    if should_discard {
        if let Some(existing) = session.take() {
            cleanup_mpv_session(existing);
        }
    }

    Ok(false)
}

fn send_loadfile(ipc_path: &str, video_path: &PathBuf) -> Result<()> {
    let escaped = video_path
        .to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\"");
    let command = format!(
        r#"{{"command":["loadfile","{}","replace"]}}
"#,
        escaped
    );

    #[cfg(windows)]
    {
        let mut pipe = std::fs::OpenOptions::new()
            .write(true)
            .open(ipc_path)
            .with_context(|| format!("connect mpv named pipe {ipc_path}"))?;
        pipe.write_all(command.as_bytes())?;
        pipe.flush()?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::net::UnixStream;
        let mut stream = UnixStream::connect(ipc_path)
            .with_context(|| format!("connect mpv ipc socket {ipc_path}"))?;
        stream.write_all(command.as_bytes())?;
        stream.flush()?;
    }

    Ok(())
}

fn kill_mpv() {
    if let Ok(mut session) = MPV_SESSION.lock() {
        if let Some(existing) = session.take() {
            cleanup_mpv_session(existing);
        }
    }
}

fn cleanup_mpv_session(mut existing: MpvSession) {
    let _ = existing.child.kill();
    let _ = existing.child.wait();
    #[cfg(unix)]
    let _ = std::fs::remove_file(existing.ipc_path);
}

fn unique_ipc_path() -> String {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);

    #[cfg(windows)]
    {
        format!(r"\\.\pipe\changli-mpv-{suffix}")
    }

    #[cfg(unix)]
    {
        std::env::temp_dir()
            .join(format!("changli-mpv-{suffix}.sock"))
            .to_string_lossy()
            .to_string()
    }
}

#[cfg(target_os = "windows")]
fn native_window_id(window: &WebviewWindow) -> Result<Option<String>> {
    let mut last_hwnd = windows::Win32::Foundation::HWND(std::ptr::null_mut());
    let mut stable_count = 0_u8;

    for _ in 0..20 {
        let hwnd = window
            .hwnd()
            .map_err(|e| anyhow!("获取 HWND 失败: {}", e))?;

        if !hwnd.0.is_null() {
            if hwnd == last_hwnd {
                stable_count += 1;
            } else {
                last_hwnd = hwnd;
                stable_count = 1;
            }

            if stable_count >= 2 {
                return Ok(Some((hwnd.0 as isize).to_string()));
            }
        }

        thread::sleep(Duration::from_millis(50));
    }

    Err(anyhow!(
        "独立播放窗口 HWND 获取失败或不稳定，拒绝启动 mpv；window label={}",
        window.label()
    ))
}

#[cfg(not(target_os = "windows"))]
fn native_window_id(_window: &WebviewWindow) -> Result<Option<String>> {
    // macOS 保持现有独立控制窗口逻辑，不传平台私有句柄。
    Ok(None)
}

#[cfg(target_os = "windows")]
fn set_windows_11_rounded_corners(window: &WebviewWindow) {
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE};

    const DWMWCP_ROUND: u32 = 2;
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            let preference = DWMWCP_ROUND;
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &preference as *const _ as _,
                std::mem::size_of::<u32>() as u32,
            );
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn set_windows_11_rounded_corners(_window: &WebviewWindow) {}
