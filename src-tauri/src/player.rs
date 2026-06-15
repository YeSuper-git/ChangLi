use anyhow::{anyhow, Context, Result};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{
    AppHandle, GlobalShortcutManager, LogicalPosition, LogicalSize, Manager, Window, WindowBuilder,
    WindowEvent, WindowUrl,
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

    if let Some(path) = app.path_resolver().resolve_resource("mpv/mpv.exe") {
        candidates.push(path);
    }
    if let Some(path) = app
        .path_resolver()
        .resolve_resource("resources/mpv/mpv.exe")
    {
        candidates.push(path);
    }

    if let Some(resource_dir) = app.path_resolver().resource_dir() {
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
    // Windows 使用 mpv 原生窗口；如果旧版本/快捷键曾创建过 Tauri 播放壳，先关闭它，
    // 避免继续出现仿 macOS 的无边框三色点窗口。
    if let Some(window) = app.get_window(PLAYER_WINDOW_LABEL) {
        let _ = window.close();
    }

    let mut session = MPV_SESSION
        .lock()
        .map_err(|_| anyhow!("mpv session lock poisoned"))?;

    if reuse_existing_session(&mut session, video_path)? {
        return Ok(());
    }

    let new_session = spawn_mpv_native_window(app, video_path)?;
    *session = Some(new_session);
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
    if let Some(window) = app.get_window(PLAYER_WINDOW_LABEL) {
        let _ = window.close();
    }
    kill_mpv();
}

pub fn handle_main_window_event(app: &AppHandle, event: &WindowEvent) {
    match event {
        WindowEvent::Moved(_) => {
            if let Some(player) = app.get_window(PLAYER_WINDOW_LABEL) {
                let _ = position_player_window_next_to_main(app, &player);
            }
        }
        WindowEvent::Resized(_) => {
            if let Some(player) = app.get_window(PLAYER_WINDOW_LABEL) {
                let _ = sync_player_minimize_state(app, &player);
                let _ = position_player_window_next_to_main(app, &player);
            }
        }
        WindowEvent::Destroyed => close_player_window(app),
        WindowEvent::CloseRequested { .. } => close_player_window(app),
        _ => {}
    }
}

#[cfg(target_os = "windows")]
pub fn toggle_always_on_top(_app: &AppHandle) -> Result<bool> {
    let mut flag = ALWAYS_ON_TOP
        .lock()
        .map_err(|_| anyhow!("always-on-top lock poisoned"))?;
    *flag = !*flag;
    Ok(*flag)
}

#[cfg(not(target_os = "windows"))]
pub fn toggle_always_on_top(app: &AppHandle) -> Result<bool> {
    let player_window = get_or_create_player_window(app)?;
    let mut flag = ALWAYS_ON_TOP
        .lock()
        .map_err(|_| anyhow!("always-on-top lock poisoned"))?;
    *flag = !*flag;
    player_window.set_always_on_top(*flag)?;
    Ok(*flag)
}

pub fn register_shortcuts(app: &AppHandle) -> Result<()> {
    let app_for_shortcut = app.clone();
    app.global_shortcut_manager()
        .register("Ctrl+Shift+T", move || {
            let _ = toggle_always_on_top(&app_for_shortcut);
        })
        .context("register Ctrl+Shift+T shortcut for player always-on-top")?;
    Ok(())
}

fn get_or_create_player_window(app: &AppHandle) -> Result<Window> {
    if let Some(window) = app.get_window(PLAYER_WINDOW_LABEL) {
        apply_player_window_style(&window)?;
        return Ok(window);
    }

    let window = WindowBuilder::new(
        app,
        PLAYER_WINDOW_LABEL,
        WindowUrl::App("index.html?window=player".into()),
    )
    .title("ChangLi Player")
    .inner_size(PLAYER_WIDTH, PLAYER_HEIGHT)
    .min_inner_size(480.0, 270.0)
    .resizable(true)
    .decorations(false)
    .transparent(true)
    .skip_taskbar(true)
    .visible(false)
    .build()
    .context("create player window")?;

    window.on_window_event(|event| match event {
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => kill_mpv(),
        _ => {}
    });

    apply_player_window_style(&window)?;
    Ok(window)
}

fn apply_player_window_style(window: &Window) -> Result<()> {
    let always_on_top = *ALWAYS_ON_TOP
        .lock()
        .map_err(|_| anyhow!("always-on-top lock poisoned"))?;
    window.set_always_on_top(always_on_top)?;
    set_windows_11_rounded_corners(window);
    Ok(())
}

fn position_player_window_next_to_main(app: &AppHandle, player: &Window) -> Result<()> {
    let Some(main) = app.get_window("main") else {
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

fn sync_player_minimize_state(app: &AppHandle, player: &Window) -> Result<()> {
    let Some(main) = app.get_window("main") else {
        return Ok(());
    };

    if main.is_minimized()? {
        player.minimize()?;
    } else if player.is_minimized()? {
        player.unminimize()?;
    }

    Ok(())
}

fn spawn_mpv(app: &AppHandle, window: &Window, video_path: &PathBuf) -> Result<MpvSession> {
    let ipc_path = unique_ipc_path();
    let wid = native_window_id(window).context("获取独立播放窗口原生句柄失败")?;
    spawn_mpv_with_options(app, wid.as_deref(), None, &ipc_path, video_path)
}

#[cfg(target_os = "windows")]
fn spawn_mpv_native_window(app: &AppHandle, video_path: &PathBuf) -> Result<MpvSession> {
    let ipc_path = unique_ipc_path();
    let geometry = windows_mpv_geometry(app);
    spawn_mpv_with_options(app, None, geometry.as_deref(), &ipc_path, video_path)
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
    geometry: Option<&str>,
    ipc_path: &str,
    video_path: &PathBuf,
) -> Result<Child> {
    let mut command = Command::new(mpv_path);
    command
        .arg("--force-window=yes")
        .arg("--hwdec=auto-safe")
        .arg("--osc=yes")
        .arg("--input-default-bindings=yes")
        .arg("--keep-open=no")
        .arg("--title=ChangLi - ${media-title}")
        .arg(format!("--input-ipc-server={ipc_path}"));

    #[cfg(target_os = "windows")]
    {
        command.arg("--border=yes");
        if ALWAYS_ON_TOP.lock().map(|flag| *flag).unwrap_or(false) {
            command.arg("--ontop");
        }
    }

    #[cfg(not(target_os = "windows"))]
    command.arg("--border=no");

    if let Some(wid) = wid {
        command.arg(format!("--wid={wid}"));
    }

    if let Some(geometry) = geometry {
        command.arg(format!("--geometry={geometry}"));
    }

    command.arg(video_path);

    command
        .spawn()
        .with_context(|| format!("启动 mpv 失败: {}", mpv_path.display()))
}

#[cfg(target_os = "windows")]
fn windows_mpv_geometry(app: &AppHandle) -> Option<String> {
    let main = app.get_window("main")?;
    let pos = main.outer_position().ok()?;
    let size = main.outer_size().ok()?;
    let x = pos
        .x
        .saturating_add(size.width as i32)
        .saturating_add(PLAYER_OFFSET_X as i32);
    let y = pos.y;
    Some(format!(
        "{}x{}{}{}",
        PLAYER_WIDTH as i32,
        PLAYER_HEIGHT as i32,
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

fn native_window_id(_window: &Window) -> Result<Option<String>> {
    // Windows 使用 mpv 自己的原生窗口，避免 WebView2 覆盖 --wid 嵌入画面导致黑屏。
    // macOS 保持现有独立控制窗口逻辑，不传平台私有句柄。
    Ok(None)
}

#[cfg(target_os = "windows")]
fn set_windows_11_rounded_corners(window: &Window) {
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
fn set_windows_11_rounded_corners(_window: &Window) {}
