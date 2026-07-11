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
use tauri_plugin_mpv::MpvExt;

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
        #[cfg(target_os = "windows")]
        {
            candidates.push(resource_dir.join("mpv").join("mpv.exe"));
            candidates.push(resource_dir.join("resources").join("mpv").join("mpv.exe"));
        }
        #[cfg(target_os = "macos")]
        {
            candidates.push(resource_dir.join("mpv").join("mpv"));
            candidates.push(resource_dir.join("mpv").join("mpv.exe"));
        }
        #[cfg(target_os = "linux")]
        {
            candidates.push(resource_dir.join("mpv").join("mpv"));
        }
    }

    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("/opt/homebrew/bin/mpv"));
        candidates.push(PathBuf::from("/usr/local/bin/mpv"));
    }

    #[cfg(target_os = "linux")]
    {
        candidates.push(PathBuf::from("/usr/bin/mpv"));
        candidates.push(PathBuf::from("/usr/local/bin/mpv"));
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
    // mpv 由前端通过 tauri-plugin-mpv 的 init() 管理
    // Rust 端只负责创建/显示播放器窗口和定位
    let player_window = get_or_create_player_window(app)?;
    position_player_window_next_to_main(app, &player_window)?;
    sync_player_minimize_state(app, &player_window)?;
    player_window.show()?;
    player_window.set_focus()?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn play_platform(app: &AppHandle, video_path: &PathBuf) -> Result<()> {
    let player_window = get_or_create_player_window(app)?;
    position_player_window_next_to_main(app, &player_window)?;
    sync_player_minimize_state(app, &player_window)?;
    player_window.show()?;
    player_window.set_focus()?;
    // mpv 由前端通过 tauri-plugin-mpv 的 init() 管理，Rust 端不再单独 spawn
    Ok(())
}

pub fn close_player_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(PLAYER_WINDOW_LABEL) {
        // 窗口已隐藏则跳过，避免重复操作
        if !window.is_visible().unwrap_or(false) {
            return;
        }
        let _ = window.hide();
    }

    // 延迟销毁，避免 GPU 清理冲突
    let app_handle = app.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(600)).await;
        if let Some(window) = app_handle.get_webview_window(PLAYER_WINDOW_LABEL) {
            // 如果窗口已被重新使用（可见），不销毁
            if window.is_visible().unwrap_or(false) {
                return;
            }
            let _ = window.destroy();
            eprintln!("[player] Player window destroyed after delay.");
        }
    });
}

/// 在后端查找 mpv.exe，检查多种可能路径，返回第一个存在的
#[tauri::command]
pub fn find_mpv_path() -> Result<String, String> {
    let exe_path = std::env::current_exe()
        .map_err(|e| format!("获取 exe 路径失败: {}", e))?;
    let mut exe_dir = exe_path
        .parent()
        .ok_or("无法获取 exe 目录")?
        .to_path_buf();

    // 去掉 Windows 长路径前缀 \\?\
    let exe_dir_str = exe_dir.to_string_lossy().to_string();
    if exe_dir_str.starts_with("\\\\?\\") {
        exe_dir = std::path::PathBuf::from(&exe_dir_str[4..]);
    }

    eprintln!("[player] find_mpv_path: exe_dir = {}", exe_dir.display());

    // 可能的 mpv 路径（分平台）
    let mut candidates = vec![];
    #[cfg(target_os = "windows")]
    {
        candidates.push(exe_dir.join("resources").join("mpv").join("mpv.exe"));
        candidates.push(exe_dir.join("mpv").join("mpv.exe"));
        candidates.push(exe_dir.join("resources").join("mpv").join("mpv.com"));
    }
    #[cfg(target_os = "macos")]
    {
        candidates.push(exe_dir.join("../Resources/mpv/mpv"));
        candidates.push(exe_dir.join("mpv/mpv"));
        candidates.push(PathBuf::from("/opt/homebrew/bin/mpv"));
        candidates.push(PathBuf::from("/usr/local/bin/mpv"));
    }
    #[cfg(target_os = "linux")]
    {
        candidates.push(exe_dir.join("mpv/mpv"));
        candidates.push(PathBuf::from("/usr/bin/mpv"));
        candidates.push(PathBuf::from("/usr/local/bin/mpv"));
    }

    for candidate in &candidates {
        eprintln!("[player] find_mpv_path: checking {} → exists={}", candidate.display(), candidate.exists());
        if candidate.exists() {
            let path = candidate.to_string_lossy().to_string();
            eprintln!("[player] find_mpv_path: found {}", path);
            return Ok(path);
        }
    }

    Err(format!("mpv.exe 未找到，已尝试: {}",
        candidates.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join(", ")))
}

/// 返回播放器窗口的原生句柄（十进制），供前端 init mpv 时传 --wid=
#[tauri::command]
pub fn get_player_wid(app: AppHandle) -> Result<u64, String> {
    use raw_window_handle::HasWindowHandle;
    let window = app
        .get_webview_window(PLAYER_WINDOW_LABEL)
        .ok_or_else(|| "player window not found".to_string())?;
    let raw = window
        .window_handle()
        .map_err(|e| format!("get window handle: {}", e))?
        .as_raw();
    match raw {
        #[cfg(target_os = "windows")]
        raw_window_handle::RawWindowHandle::Win32(h) => Ok(h.hwnd.get() as u64),
        #[cfg(target_os = "macos")]
        raw_window_handle::RawWindowHandle::AppKit(h) => Ok(h.ns_view.as_ptr() as u64),
        _ => Err(format!("unsupported platform: {:?}", raw)),
    }
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
        WindowEvent::Destroyed => {
            // 窗口已销毁，无需再操作
        }
        WindowEvent::CloseRequested { .. } => close_player_window(app),
        _ => {}
    }
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
    // 游戏覆盖功能已移除（修改注册表需要重启才能生效，实际无用）
    let _ = disabled;
    Ok("disabled".into())
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

    // 禁用输入法注入：防止微信输入法等第三方 IME 的全局钩子注入到播放器窗口
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::Input::Ime::{ImmAssociateContextEx, IACE_IGNORENOCONTEXT, HIMC};
        if let Ok(handle) = window.hwnd() {
            let hwnd = windows::Win32::Foundation::HWND(handle.0);
            unsafe {
                let _ = ImmAssociateContextEx(hwnd, HIMC(std::ptr::null_mut()), IACE_IGNORENOCONTEXT);
            }
        }
    }

    // 不在 on_window_event 里调 destroy() — Destroyed 时 IPC 通道可能已断，
    // 强行调用会导致 ntdll 堆损坏。mpv 清理由前端 useEffect cleanup 的 destroy() 负责。
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
            command
                .arg("--border=yes")
                .arg("--ontop")
                .arg("--screen=0")
                .arg("--background=black")
                .arg("--no-window-minimized");
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
