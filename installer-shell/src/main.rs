#![cfg_attr(windows, windows_subsystem = "windows")]

use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    thread,
};

use base64::{engine::general_purpose, Engine as _};
use tao::{
    dpi::{LogicalSize, PhysicalPosition},
    event::{Event, StartCause, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy},
    window::WindowBuilder,
};
use wry::WebViewBuilder;

#[cfg(target_os = "windows")]
use winreg::{enums::*, RegKey};

#[cfg(target_os = "windows")]
use tao::platform::windows::WindowExtWindows;

#[cfg(target_os = "windows")]
use windows::Win32::{
    Foundation::HWND,
    Graphics::Gdi::{CreateRoundRectRgn, SetWindowRgn},
};

const W: i32 = 980;
const H: i32 = 640;
const RADIUS: i32 = 28;
const SETUP_BYTES: &[u8] = include_bytes!(env!("CHANGLI_NSIS_SETUP"));
const ICON_BYTES: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../src-tauri/icons/icon.png"
));

#[derive(Debug)]
enum InstallerEvent {
    Drag,
    Close,
    ChooseDir,
    Install,
    InstallDone { success: bool, code: Option<i32> },
}

#[cfg(target_os = "windows")]
fn display_icon_parent(value: &str) -> Option<PathBuf> {
    let cleaned = value.trim().trim_matches('"');
    let exe_end = cleaned.to_ascii_lowercase().find(".exe")? + 4;
    let path = PathBuf::from(&cleaned[..exe_end]);
    path.parent().map(Path::to_path_buf)
}

#[cfg(target_os = "windows")]
fn find_existing_install_dir() -> Option<PathBuf> {
    let roots = [
        RegKey::predef(HKEY_CURRENT_USER),
        RegKey::predef(HKEY_LOCAL_MACHINE),
    ];
    let paths = [
        r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
        r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    ];

    for root in roots {
        for path in paths {
            let Ok(uninstall) = root.open_subkey_with_flags(path, KEY_READ) else {
                continue;
            };
            for key in uninstall.enum_keys().flatten() {
                let Ok(app) = uninstall.open_subkey_with_flags(key, KEY_READ) else {
                    continue;
                };
                let name: String = app.get_value("DisplayName").unwrap_or_default();
                if !(name.contains("ChangLi") || name.contains("长离")) {
                    continue;
                }
                if let Ok(location) = app.get_value::<String, _>("InstallLocation") {
                    let dir = PathBuf::from(location.trim().trim_matches('"'));
                    if !dir.as_os_str().is_empty() {
                        return Some(dir);
                    }
                }
                if let Ok(icon) = app.get_value::<String, _>("DisplayIcon") {
                    if let Some(dir) = display_icon_parent(&icon) {
                        return Some(dir);
                    }
                }
            }
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn find_existing_install_dir() -> Option<PathBuf> {
    None
}

fn default_install_dir() -> PathBuf {
    find_existing_install_dir().unwrap_or_else(|| {
        env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .or_else(|| env::var_os("APPDATA").map(PathBuf::from))
            .unwrap_or_else(env::temp_dir)
            .join("ChangLi")
    })
}

fn path_label(path: &Path) -> String {
    path.to_string_lossy().replace('\\', " / ")
}

fn write_embedded(name: &str, bytes: &[u8]) -> PathBuf {
    let mut p = env::temp_dir();
    p.push(name);
    let _ = fs::write(&p, bytes);
    p
}

fn start_install(install_dir: PathBuf, proxy: EventLoopProxy<InstallerEvent>) {
    thread::spawn(move || {
        let setup = write_embedded("ChangLi-inner-setup.exe", SETUP_BYTES);
        let status = Command::new(&setup)
            .arg("/S")
            .arg(format!("/D={}", install_dir.display()))
            .status();
        let success = status.as_ref().map(|s| s.success()).unwrap_or(false);
        let code = status.ok().and_then(|s| s.code());
        let _ = proxy.send_event(InstallerEvent::InstallDone { success, code });
    });
}

#[cfg(target_os = "windows")]
fn apply_round_window(hwnd: isize) {
    unsafe {
        let region = CreateRoundRectRgn(0, 0, W + 1, H + 1, RADIUS, RADIUS);
        let _ = SetWindowRgn(HWND(hwnd as *mut _), region, true);
    }
}

#[cfg(not(target_os = "windows"))]
fn apply_round_window(_hwnd: isize) {}

fn js_call(name: &str, value: &str) -> String {
    format!("window.{name}({});", serde_json::to_string(value).unwrap())
}

fn html(default_dir: &Path) -> String {
    let version = option_env!("CHANGLI_APP_VERSION").unwrap_or("dev");
    let icon = general_purpose::STANDARD.encode(ICON_BYTES);
    let default_label = path_label(default_dir);
    format!(
        r#"<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ChangLi Installer</title>
<style>
  :root {{
    --rose:#f44975; --rose2:#ff6f8d; --orange:#ff8356; --ink:#111421;
    --muted:#667084; --soft:#f4f6fb; --line:#e7eaf2;
    font-family:"Microsoft YaHei UI","Segoe UI",system-ui,sans-serif;
  }}
  * {{ box-sizing:border-box; }}
  html,body {{ width:100%; height:100%; margin:0; overflow:hidden; background:#f4f6fb; }}
  body {{ user-select:none; }}
  .shell {{ width:980px; height:640px; display:grid; grid-template-columns:318px 1fr; overflow:hidden; background:#f4f6fb; }}
  .drag {{ cursor:default; }}
  .side {{ position:relative; overflow:hidden; padding:32px; color:#fff;
    background:
      radial-gradient(circle at -18% 74%, rgba(255,164,92,.88) 0 24%, transparent 25%),
      radial-gradient(circle at 82% -9%, rgba(255,152,103,.95) 0 25%, transparent 26%),
      linear-gradient(154deg,#f14170 0%,#fb566a 47%,#ff8050 100%);
  }}
  .side::after {{ content:""; position:absolute; inset:0; opacity:.32;
    background-image:
      repeating-linear-gradient(105deg, rgba(255,255,255,.30) 0 1px, transparent 1px 18px),
      linear-gradient(120deg, transparent 0 52%, rgba(255,255,255,.13) 53%, transparent 56%);
    mask-image:linear-gradient(180deg,#000 0, transparent 42%);
  }}
  .orb {{ position:absolute; border-radius:999px; background:rgba(255,102,99,.36); filter:blur(.2px); }}
  .orb.a {{ left:38px; bottom:154px; width:154px; height:90px; border-radius:32px; }}
  .orb.b {{ left:-50px; bottom:20px; width:150px; height:150px; background:rgba(255,180,91,.38); }}
  .brand,.hero,.glass-pills,.stack {{ position:relative; z-index:1; }}
  .brand {{ display:flex; gap:16px; align-items:center; }}
  .brand img {{ width:64px; height:64px; border-radius:16px; display:block; object-fit:cover; box-shadow:0 8px 22px rgba(142,34,60,.24); }}
  .wordmark {{ font-size:30px; font-weight:900; letter-spacing:-.03em; line-height:1; }}
  .tag {{ margin-top:8px; font-size:11px; font-weight:850; letter-spacing:.07em; color:#fff2f6; }}
  .hero {{ margin-top:54px; }}
  .hero h1 {{ margin:0; font-size:42px; line-height:1.25; font-weight:950; letter-spacing:-.06em; }}
  .hero p {{ width:246px; margin:22px 0 0; font-size:13px; line-height:1.78; color:#fff8fa; }}
  .glass-pills {{ margin-top:42px; display:flex; flex-wrap:wrap; gap:10px; }}
  .pill {{ padding:8px 16px; border-radius:999px; color:#fff; font-size:13px; font-weight:850;
    background:linear-gradient(180deg,rgba(255,255,255,.32),rgba(255,255,255,.14));
    border:1px solid rgba(255,255,255,.38); box-shadow:inset 0 1px 0 rgba(255,255,255,.36), 0 10px 24px rgba(159,38,55,.12);
    backdrop-filter:blur(12px);
  }}
  .stack {{ position:absolute; left:34px; bottom:32px; width:210px; height:106px; }}
  .glass-card {{ position:absolute; width:150px; height:64px; border-radius:22px;
    background:linear-gradient(140deg,rgba(255,255,255,.28),rgba(255,255,255,.10));
    border:1px solid rgba(255,255,255,.32); box-shadow:0 18px 38px rgba(154,46,58,.12); backdrop-filter:blur(14px);
  }}
  .glass-card.one {{ left:0; top:28px; }} .glass-card.two {{ left:28px; top:14px; opacity:.82; }} .glass-card.three {{ left:58px; top:0; opacity:.62; }}
  .main {{ position:relative; padding:48px 34px 26px 38px; }}
  .close {{ position:absolute; right:18px; top:17px; width:34px; height:34px; border:0; border-radius:12px; background:transparent; color:#858c9b; font-size:24px; cursor:pointer; }}
  .close:hover {{ background:#e9edf5; color:#111421; }}
  .topline {{ display:flex; align-items:center; justify-content:space-between; margin-right:54px; }}
  .steps {{ display:flex; gap:10px; align-items:center; }}
  .stepbar {{ width:50px; height:8px; border-radius:99px; background:linear-gradient(90deg,var(--rose),var(--orange)); box-shadow:0 8px 18px rgba(244,73,117,.24); }}
  .stepdot {{ width:8px; height:8px; border-radius:50%; background:#d9dee8; }}
  .steps.install .stepbar {{ width:8px; background:#d9dee8; box-shadow:none; }}
  .steps.install .stepdot.one {{ width:50px; border-radius:99px; background:linear-gradient(90deg,var(--rose),var(--orange)); box-shadow:0 8px 18px rgba(244,73,117,.24); }}
  .steps.done .stepbar,.steps.done .stepdot.one {{ width:8px; background:#b9f0d2; box-shadow:none; }}
  .steps.done .stepdot.two {{ width:50px; border-radius:99px; background:linear-gradient(90deg,#34d399,#10b981); box-shadow:0 8px 18px rgba(16,185,129,.22); }}
  .steps.fail .stepbar {{ background:#ef4444; }}
  .ver {{ color:#9aa2b2; font-size:13px; font-weight:750; }}
  .title {{ margin-top:42px; }}
  .title h2 {{ margin:0 0 14px; color:var(--ink); font-size:38px; line-height:1.08; letter-spacing:-.07em; font-weight:950; }}
  .title p {{ margin:0; width:514px; color:#5f6879; font-size:15px; line-height:1.74; }}
  .card {{ margin-top:28px; width:532px; border-radius:28px; background:#fff; border:1px solid #eff2f7; box-shadow:0 20px 54px rgba(41,48,70,.07); padding:22px; }}
  .path-row {{ display:flex; align-items:center; gap:14px; min-height:74px; padding:0 0 18px; border-bottom:1px solid #edf0f6; }}
  .home {{ width:36px; height:36px; border-radius:13px; display:grid; place-items:center; color:var(--rose); background:#fff0f4; font-weight:950; }}
  .path-copy {{ flex:1; min-width:0; }}
  .path-copy small {{ display:block; color:#8b93a4; font-size:12px; font-weight:850; }}
  .path-copy strong {{ display:block; margin-top:6px; color:var(--ink); font-size:16px; line-height:1.35; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }}
  .change {{ border:0; border-radius:999px; padding:9px 16px; background:#ffedf2; color:#cf3d62; font-size:13px; font-weight:900; cursor:pointer; }}
  .flow {{ display:grid; grid-template-columns:repeat(3,1fr); gap:12px; padding-top:18px; }}
  .flow-item {{ min-height:94px; border-radius:20px; padding:14px 13px; background:#fafbfe; border:1px solid #edf0f6; transition:.2s ease; }}
  .flow-item.active {{ background:#fff4f7; border-color:#ffc3d0; box-shadow:0 12px 28px rgba(244,73,117,.12); }}
  .flow-item.done {{ background:#f0fdf6; border-color:#bbf7d0; }}
  .flow-item.fail {{ background:#fff1f2; border-color:#fecdd3; }}
  .num {{ width:26px; height:26px; border-radius:50%; display:grid; place-items:center; color:#fff; font-size:13px; font-weight:950; background:linear-gradient(180deg,var(--rose2),var(--rose)); }}
  .flow-item b {{ display:block; margin-top:10px; color:var(--ink); font-size:14px; line-height:1.25; }}
  .flow-item span {{ display:block; margin-top:5px; color:#6b7382; font-size:12px; line-height:1.35; }}
  .options {{ display:flex; gap:18px; margin-top:18px; padding-top:16px; border-top:1px solid #edf0f6; }}
  .check {{ display:flex; align-items:center; gap:8px; color:#384050; font-size:13px; font-weight:800; }}
  .check input {{ accent-color:#f44975; }}
  .bottom {{ position:absolute; left:38px; right:34px; bottom:26px; display:flex; align-items:center; justify-content:space-between; }}
  .state {{ color:#687184; font-size:13px; font-weight:700; }}
  .progress {{ display:none; margin-top:10px; width:238px; height:8px; border-radius:999px; overflow:hidden; background:#e8ecf3; }}
  .progress.active {{ display:block; }}
  .bar {{ width:38%; height:100%; border-radius:999px; background:linear-gradient(90deg,var(--rose),var(--orange)); animation:slide 1.2s ease-in-out infinite; }}
  @keyframes slide {{ 0%{{ transform:translateX(-95%); }} 100%{{ transform:translateX(270%); }} }}
  .actions {{ display:flex; gap:12px; }}
  .btn {{ height:46px; border-radius:16px; border:1px solid #d9dee8; background:#fff; padding:0 24px; color:#3f4654; font-size:15px; font-weight:900; cursor:pointer; }}
  .btn:disabled {{ opacity:.55; cursor:not-allowed; }}
  .primary {{ min-width:118px; border:0; color:white; background:linear-gradient(180deg,#ff6688,var(--rose)); box-shadow:0 12px 24px rgba(244,73,117,.25); }}
</style>
</head>
<body>
  <div class="shell">
    <aside class="side drag" data-drag="true">
      <div class="orb a"></div><div class="orb b"></div>
      <div class="brand"><img src="data:image/png;base64,{icon}" alt="ChangLi"><div><div class="wordmark">ChangLi</div><div class="tag">私人影音资料库</div></div></div>
      <div class="hero"><h1>装好后<br>直接进入<br>收藏宇宙</h1><p>选择安装位置后，安装器会安静写入组件并创建桌面入口。</p></div>
      <div class="glass-pills"><span class="pill">本地优先</span><span class="pill">路径识别</span><span class="pill">桌面入口</span></div>
      <div class="stack"><div class="glass-card three"></div><div class="glass-card two"></div><div class="glass-card one"></div></div>
    </aside>
    <main class="main">
      <button class="close" id="close">×</button>
      <div class="topline drag" data-drag="true"><div class="steps" id="steps"><i class="stepbar"></i><i class="stepdot one"></i><i class="stepdot two"></i></div><div class="ver">v{version}</div></div>
      <section class="title drag" data-drag="true"><h2>准备安装长离</h2><p>选择安装位置后，安装器会自动写入运行组件并创建桌面入口。<br>过程清楚、安静、不打扰。</p></section>
      <section class="card">
        <div class="path-row"><div class="home">⌂</div><div class="path-copy"><small>安装位置</small><strong id="install-dir" title="{default_label}">{default_label}</strong></div><button class="change" id="choose">更改</button></div>
        <div class="flow"><div class="flow-item" id="flow-1"><div class="num">1</div><b>检测位置</b><span>优先沿用旧版安装目录</span></div><div class="flow-item" id="flow-2"><div class="num">2</div><b>写入组件</b><span>静默执行安装后端</span></div><div class="flow-item" id="flow-3"><div class="num">3</div><b>创建入口</b><span>安装器创建桌面入口</span></div></div>
      </section>
      <div class="bottom"><div><div class="state" id="state">准备就绪</div><div class="progress" id="progress"><div class="bar"></div></div></div><div class="actions"><button class="btn" id="cancel">取消</button><button class="btn primary" id="install">开始安装</button></div></div>
    </main>
  </div>
<script>
  const ipc = (cmd) => window.ipc.postMessage(cmd);
  const state = document.getElementById('state');
  const progress = document.getElementById('progress');
  const install = document.getElementById('install');
  const cancel = document.getElementById('cancel');
  const closeBtn = document.getElementById('close');
  const choose = document.getElementById('choose');
  const dir = document.getElementById('install-dir');
  const steps = document.getElementById('steps');
  const flow1 = document.getElementById('flow-1');
  const flow2 = document.getElementById('flow-2');
  const flow3 = document.getElementById('flow-3');
  let installing = false;
  const setPhase = (phase) => {{
    steps.className = 'steps ' + (phase === 'ready' ? '' : phase);
    [flow1, flow2, flow3].forEach(el => el.classList.remove('active', 'done', 'fail'));
    if (phase === 'ready') flow1.classList.add('active');
    if (phase === 'install') {{ flow1.classList.add('done'); flow2.classList.add('active'); }}
    if (phase === 'done') {{ flow1.classList.add('done'); flow2.classList.add('done'); flow3.classList.add('done'); }}
    if (phase === 'fail') flow2.classList.add('fail');
  }};
  setPhase('ready');
  document.querySelectorAll('[data-drag="true"]').forEach(el => el.addEventListener('mousedown', e => {{
    if (e.button !== 0 || e.target.closest('button,input,label')) return;
    ipc('drag');
  }}));
  const close = () => {{ if (!installing) ipc('close'); }};
  closeBtn.addEventListener('click', close);
  cancel.addEventListener('click', close);
  choose.addEventListener('click', () => {{ if (!installing) ipc('choose-dir'); }});
  install.addEventListener('click', () => {{
    if (installing) return;
    installing = true;
    setPhase('install');
    install.disabled = true; cancel.disabled = true; closeBtn.disabled = true; choose.disabled = true;
    install.textContent = '安装中'; state.textContent = '正在安装 ChangLi，请稍候'; progress.classList.add('active');
    ipc('install');
  }});
  window.setInstallDir = (value) => {{ dir.textContent = value; dir.title = value; }};
  window.installDone = (ok, code) => {{
    progress.classList.remove('active');
    if (ok) {{
      setPhase('done'); state.textContent = '安装完成'; install.textContent = '完成'; install.disabled = false; install.onclick = () => ipc('close');
    }} else {{
      setPhase('fail'); state.textContent = '安装失败' + (code == null ? '' : '，退出码 ' + code); install.textContent = '重试'; install.disabled = false; installing = false; cancel.disabled = false; closeBtn.disabled = false; choose.disabled = false;
    }}
  }};
</script>
</body>
</html>"#,
        icon = icon,
        version = version,
        default_label = default_label
    )
}

fn main() -> wry::Result<()> {
    let event_loop = EventLoopBuilder::<InstallerEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let default_dir = default_install_dir();

    let pos = event_loop.primary_monitor().map(|m| {
        let mp = m.position();
        let ms = m.size();
        PhysicalPosition::new(
            mp.x + (ms.width as i32 - W) / 2,
            mp.y + (ms.height as i32 - H) / 2,
        )
    });

    let mut builder = WindowBuilder::new()
        .with_title("ChangLi Installer")
        .with_decorations(false)
        .with_resizable(false)
        .with_transparent(false)
        .with_inner_size(LogicalSize::new(W as f64, H as f64));
    if let Some(pos) = pos {
        builder = builder.with_position(pos);
    }
    let window = builder.build(&event_loop).expect("create installer window");

    #[cfg(target_os = "windows")]
    apply_round_window(window.hwnd());

    let ipc_proxy = proxy.clone();
    let webview = WebViewBuilder::new()
        .with_html(html(&default_dir))
        .with_ipc_handler(move |request| {
            let body = request.body().trim().trim_matches('"');
            let event = match body {
                "drag" => Some(InstallerEvent::Drag),
                "close" => Some(InstallerEvent::Close),
                "choose-dir" => Some(InstallerEvent::ChooseDir),
                "install" => Some(InstallerEvent::Install),
                _ => None,
            };
            if let Some(event) = event {
                let _ = ipc_proxy.send_event(event);
            }
        })
        .build(&window)?;

    let mut install_dir = default_dir;
    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::NewEvents(StartCause::Init) => {}
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            }
            | Event::UserEvent(InstallerEvent::Close) => *control_flow = ControlFlow::Exit,
            Event::UserEvent(InstallerEvent::Drag) => {
                let _ = window.drag_window();
            }
            Event::UserEvent(InstallerEvent::ChooseDir) => {
                if let Some(path) = rfd::FileDialog::new()
                    .set_directory(&install_dir)
                    .pick_folder()
                {
                    install_dir = path;
                    let _ = webview
                        .evaluate_script(&js_call("setInstallDir", &path_label(&install_dir)));
                }
            }
            Event::UserEvent(InstallerEvent::Install) => {
                start_install(install_dir.clone(), proxy.clone())
            }
            Event::UserEvent(InstallerEvent::InstallDone { success, code }) => {
                let script = format!(
                    "window.installDone({}, {});",
                    success,
                    code.map(|c| c.to_string()).unwrap_or_else(|| "null".into())
                );
                let _ = webview.evaluate_script(&script);
            }
            _ => {}
        }
    });
}
