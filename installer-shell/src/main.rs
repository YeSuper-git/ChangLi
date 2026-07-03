#![cfg_attr(windows, windows_subsystem = "windows")]

use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    thread,
};

use base64::{engine::general_purpose, Engine as _};
#[cfg(target_os = "windows")]
use tao::platform::windows::WindowExtWindows;

use tao::{
    dpi::{LogicalSize, PhysicalPosition},
    event::{Event, StartCause, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy},
    window::WindowBuilder,
};
use wry::{
    dpi::{LogicalPosition as WebLogicalPosition, LogicalSize as WebLogicalSize},
    Rect, WebContext, WebViewBuilder,
};

#[cfg(target_os = "windows")]
use winreg::{enums::*, RegKey};

const W: i32 = 1000;
const H: i32 = 660;
const SETUP_BYTES: &[u8] = include_bytes!(env!("CHANGLI_NSIS_SETUP"));
const ICON_BYTES: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../src-tauri/icons/icon.png"
));

#[derive(Debug)]
enum InstallerEvent {
    Ready,
    Drag,
    Close,
    ChooseDir,
    Install,
    CloseAndLaunch,
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

fn fallback_install_dir() -> PathBuf {
    env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| env::var_os("APPDATA").map(PathBuf::from))
        .unwrap_or_else(env::temp_dir)
        .join("ChangLi")
}

fn webview_data_dir() -> PathBuf {
    env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| env::var_os("APPDATA").map(PathBuf::from))
        .unwrap_or_else(env::temp_dir)
        .join("ChangLi")
        .join("InstallerWebView2")
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

fn launch_installed_app(install_dir: &Path) {
    let exe = install_dir.join("ChangLi.exe");
    if exe.exists() {
        let _ = Command::new(exe).current_dir(install_dir).spawn();
    }
}

fn js_call(name: &str, value: &str) -> String {
    format!("window.{name}({});", serde_json::to_string(value).unwrap())
}

fn html(default_dir: &Path, is_update: bool) -> String {
    let version = option_env!("CHANGLI_APP_VERSION").unwrap_or("dev");
    let icon = general_purpose::STANDARD.encode(ICON_BYTES);
    let default_label = path_label(default_dir);
    let install_mode = if is_update { "update" } else { "fresh" };
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
  a {{ text-decoration:none; }}
  html,body {{ width:100%; height:100%; margin:0; overflow:hidden; background:transparent; }}
  body {{ user-select:none; }}
  .shell {{ width:980px; height:640px; display:grid; grid-template-columns:318px 1fr; overflow:hidden; background:#f6f8fc; border-radius:34px; box-shadow:0 28px 90px rgba(31,35,49,.20); }}
  .drag {{ cursor:default; }}
  .side {{ position:relative; overflow:hidden; padding:32px; color:#fff;
    background:
      radial-gradient(circle at 25% 12%, rgba(255,255,255,.38), transparent 25%),
      radial-gradient(circle at -18% 74%, rgba(255,164,92,.70) 0 24%, transparent 25%),
      radial-gradient(circle at 74% 86%, rgba(255,187,123,.42), transparent 30%),
      radial-gradient(circle at 82% -9%, rgba(255,152,103,.82) 0 25%, transparent 26%),
      linear-gradient(154deg,#f14170 0%,#fb566a 47%,#ff8050 100%);
  }}
  .side::before {{ content:""; position:absolute; inset:0; opacity:.34;
    background-image:
      repeating-linear-gradient(90deg, rgba(255,255,255,.24) 0 1px, transparent 1px 34px),
      repeating-linear-gradient(0deg, rgba(255,255,255,.15) 0 1px, transparent 1px 34px);
    mask-image:linear-gradient(180deg,#000 0, rgba(0,0,0,.72) 45%, transparent 82%);
  }}
  .side::after {{ content:""; position:absolute; inset:0; background:linear-gradient(120deg,rgba(255,255,255,.28),transparent 28%,transparent 72%,rgba(255,255,255,.18)); pointer-events:none; }}
  .orb {{ position:absolute; border-radius:999px; background:rgba(255,102,99,.36); filter:blur(.2px); }}
  .orb.a {{ left:38px; bottom:154px; width:154px; height:90px; border-radius:32px; }}
  .orb.b {{ left:-50px; bottom:20px; width:150px; height:150px; background:rgba(255,180,91,.38); }}
  .brand,.hero,.glass-pills,.stack {{ position:relative; z-index:1; }}
  .brand {{ display:flex; gap:14px; align-items:center; }}
  .brand img {{ width:58px; height:58px; border-radius:18px; display:block; object-fit:cover; background:rgba(255,255,255,.20); border:1px solid rgba(255,255,255,.34); box-shadow:inset 0 1px 0 rgba(255,255,255,.45), 0 14px 30px rgba(112,24,44,.22); }}
  .wordmark {{ font-size:26px; font-weight:900; letter-spacing:-.04em; line-height:1; }}
  .tag {{ margin-top:3px; font-size:13px; font-weight:500; letter-spacing:0; color:rgba(255,255,255,.78); }}
  .hero {{ margin-top:74px; }}
  .kicker {{ font-size:13px; font-weight:800; opacity:.78; letter-spacing:.18em; margin-bottom:14px; }}
  .hero h1 {{ margin:0 0 12px; font-size:42px; line-height:1.05; font-weight:950; letter-spacing:-.07em; }}
  .hero p {{ display:block; width:210px; margin:0; line-height:1.8; font-size:14px; color:rgba(255,255,255,.84); }}
  .glass-pills {{ margin-top:36px; display:flex; flex-wrap:wrap; gap:10px; }}
  .pill {{ padding:9px 12px; border-radius:999px; color:#fff; font-size:12px; font-weight:750;
    background:rgba(255,255,255,.18); border:1px solid rgba(255,255,255,.24);
    box-shadow:none; backdrop-filter:none;
  }}
  .stack {{ position:absolute; z-index:1; left:48px; bottom:-74px; width:230px; height:210px; opacity:.74; }}
  .glass-card {{ position:absolute; width:92px; height:132px; border-radius:16px;
    background:linear-gradient(150deg,rgba(255,255,255,.42),rgba(255,255,255,.20)); border:1px solid rgba(255,255,255,.58); box-shadow:0 18px 50px rgba(94,22,31,.22), inset 0 1px 0 rgba(255,255,255,.42); backdrop-filter:blur(10px) saturate(150%);
  }}
  .glass-card.one {{ left:0; top:24px; transform:rotate(-12deg); }} .glass-card.two {{ left:70px; top:0; transform:rotate(5deg); background:linear-gradient(150deg,rgba(255,255,255,.50),rgba(255,255,255,.24)); }} .glass-card.three {{ left:138px; top:32px; transform:rotate(13deg); }}
  .main {{ position:relative; overflow:hidden; padding:48px 34px 26px 38px; background:linear-gradient(180deg,#f8faff,#f4f7fc); }}
  .main::before {{ content:""; position:absolute; inset:1px; border-radius:0 33px 33px 0; background:linear-gradient(115deg,rgba(255,255,255,.38),transparent 26%,transparent 78%,rgba(255,255,255,.24)); pointer-events:none; }}
  .main > * {{ position:relative; z-index:1; }}
  .close {{ position:absolute; right:18px; top:17px; width:34px; height:34px; border:0; border-radius:12px; background:transparent; color:#858c9b; font-size:24px; cursor:pointer; display:grid; place-items:center; line-height:1; }}
  .close:hover {{ background:#e9edf5; color:#111421; }}
  .topline {{ display:flex; align-items:center; justify-content:space-between; margin-right:54px; }}
  .steps {{ display:flex; gap:10px; align-items:center; }}
  .stepbar {{ width:28px; height:8px; border-radius:99px; background:linear-gradient(90deg,var(--rose),var(--orange)); box-shadow:0 8px 18px rgba(244,73,117,.24); }}
  .stepdot {{ width:8px; height:8px; border-radius:50%; background:#d9dee8; }}
  .steps.install .stepbar {{ width:8px; background:#d9dee8; box-shadow:none; }}
  .steps.install .stepdot.one {{ width:28px; border-radius:99px; background:linear-gradient(90deg,var(--rose),var(--orange)); box-shadow:0 8px 18px rgba(244,73,117,.24); }}
  .steps.done .stepbar,.steps.done .stepdot.one {{ width:8px; background:#b9f0d2; box-shadow:none; }}
  .steps.done .stepdot.two {{ width:28px; border-radius:99px; background:linear-gradient(90deg,#34d399,#10b981); box-shadow:0 8px 18px rgba(16,185,129,.22); }}
  .steps.fail .stepbar {{ background:#ef4444; }}
  .ver {{ color:#717784; font-size:13px; font-weight:700; pointer-events:none; }}
  .title {{ margin-top:42px; transition:transform .52s cubic-bezier(.2,.9,.18,1), opacity .24s ease; }}
  .title.installing {{ transform:translateY(116px); }}
  .title.done {{ transform:translateY(128px); }}
  .title h2 {{ margin:0; color:var(--ink); font-size:38px; line-height:1.08; letter-spacing:-.07em; font-weight:950; transition:transform .28s cubic-bezier(.16,1,.3,1), opacity .18s ease, font-size .28s ease, text-align .28s ease; }}
  .title.installing h2,.title.done h2 {{ text-align:center; font-size:46px; letter-spacing:-.075em; }}
  .title h2.pulse {{ animation:titlePulse .42s cubic-bezier(.16,1,.3,1); }}
  .title h2.drop {{ animation:titleDrop .62s cubic-bezier(.2,1.18,.26,1) both; }}
  @keyframes titlePulse {{ 0%{{ opacity:.48; transform:translateY(10px); }} 100%{{ opacity:1; transform:translateY(0); }} }}
  @keyframes titleDrop {{ 0%{{ opacity:0; transform:translateY(-92px) scale(1.06); }} 62%{{ opacity:1; transform:translateY(14px) scale(.985); }} 82%{{ transform:translateY(-5px) scale(1.006); }} 100%{{ opacity:1; transform:translateY(0) scale(1); }} }}
  .dots {{ display:inline-flex; width:34px; justify-content:space-between; margin-left:6px; vertical-align:baseline; }}
  .dots i {{ width:6px; height:6px; border-radius:50%; background:var(--rose); animation:dotBounce .9s ease-in-out infinite; }}
  .dots i:nth-child(2){{ animation-delay:.15s; }} .dots i:nth-child(3){{ animation-delay:.3s; }}
  @keyframes dotBounce {{ 0%,80%,100%{{ transform:translateY(0); opacity:.45; }} 38%{{ transform:translateY(-7px); opacity:1; }} }}
  .title p {{ display:none; }}
  .card {{ margin-top:28px; width:532px; border-radius:24px; background:rgba(255,255,255,.82); border:1px solid rgba(228,231,238,.92); box-shadow:0 16px 40px rgba(35,40,50,.07); padding:18px; transition:border-color .24s ease, box-shadow .24s ease, transform .58s cubic-bezier(.22,1,.36,1), opacity .38s ease, filter .38s ease; }}
  .card.flyout {{ transform:translateX(610px) rotate(2.5deg) scale(.96); opacity:0; filter:blur(4px); pointer-events:none; }}
  .card.is-working {{ border-color:rgba(251,91,123,.24); box-shadow:0 24px 64px rgba(244,73,117,.12); }}
  .card.is-done {{ border-color:rgba(52,211,153,.24); box-shadow:0 24px 64px rgba(16,185,129,.10); }}
  .path-row {{ display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:0; padding:15px 16px; border-radius:18px; background:#f7f8fb; border:1px solid rgba(230,233,240,.92); transition:border-color .24s ease; }}
  .card.is-working .path-row {{ border-bottom-color:#ffd4dd; }}
  .card.is-done .path-row {{ border-bottom-color:#bbf7d0; }}
  .home {{ display:none; }}
  .path-copy {{ flex:1; min-width:0; }}
  .path-copy small {{ display:block; color:#8b919c; font-size:12px; font-weight:800; }}
  .path-copy strong {{ display:block; margin-top:4px; color:var(--ink); font-size:14px; line-height:1.35; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }}
  .change {{ border:0; border-radius:999px; padding:10px 14px; background:white; color:#c72e55; font-size:13px; font-weight:850; cursor:pointer; display:inline-flex; align-items:center; box-shadow:0 8px 20px rgba(34,39,48,.08); }}
  .flow {{ display:grid; grid-template-columns:repeat(3,1fr); gap:12px; padding-top:0; margin-top:14px; }}
  .flow-item {{ min-height:104px; border-radius:18px; padding:14px; background:#fff; border:1px solid rgba(230,233,240,.86); transition:.2s ease; }}
  .flow-item.active {{ background:#fff; border-color:rgba(230,233,240,.86); box-shadow:none; }}
  .card.is-working .flow-item.active {{ border-color:#ffc3d0; background:#fff7fa; box-shadow:0 10px 24px rgba(244,73,117,.08); }}
  .flow-item.done {{ background:#fff; border-color:rgba(230,233,240,.86); }}
  .card.is-done .flow-item.done {{ border-color:#bbf7d0; background:#f0fdf6; }}
  .flow-item.fail {{ background:#fff1f2; border-color:#fecdd3; }}
  .num {{ width:28px; height:28px; border-radius:10px; display:grid; place-items:center; margin-bottom:12px; color:#c72e55; font-size:14px; font-weight:900; background:linear-gradient(135deg,rgba(251,91,123,.13),rgba(255,138,76,.15)); }}
  .flow-item b {{ display:block; margin-top:0; color:var(--ink); font-size:14px; line-height:1.25; }}
  .flow-item span {{ display:block; margin-top:5px; color:#6b7382; font-size:12px; line-height:1.35; }}
  .options {{ display:flex; gap:18px; margin-top:18px; padding-top:16px; border-top:1px solid #edf0f6; }}
  .check {{ display:flex; align-items:center; gap:8px; color:#384050; font-size:13px; font-weight:800; }}
  .check input {{ accent-color:#f44975; }}
  .bottom {{ position:absolute; left:38px; right:34px; bottom:76px; display:flex; align-items:center; justify-content:space-between; }}
  .status-wrap {{ min-width:288px; }}
  .state {{ display:none; color:#687184; font-size:13px; font-weight:800; }}
  .state.active {{ display:block; }}
  .progress {{ display:none; margin-top:10px; width:288px; height:8px; border-radius:999px; overflow:hidden; background:#e8ecf3; }}
  .progress.active {{ display:block; }}
  .bar {{ width:1%; height:100%; border-radius:999px; background:linear-gradient(90deg,var(--rose),var(--orange)); box-shadow:0 0 18px rgba(251,91,123,.38); transition:width .24s ease; }}
  .actions {{ display:flex; gap:12px; }}
  .btn {{ height:46px; border-radius:16px; border:1px solid #d9dee8; background:linear-gradient(180deg,#fff,#f8f9fd); padding:0 24px; color:#3f4654; font-size:15px; font-weight:900; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; box-shadow:inset 0 1px 0 rgba(255,255,255,.92); }}
  .btn.disabled,.change.disabled,.close.disabled {{ opacity:.55; pointer-events:none; cursor:not-allowed; }}
  .primary {{ min-width:118px; border:0; color:white; background:linear-gradient(180deg,#ff7d99,#f44975 58%,#e83266); box-shadow:0 14px 28px rgba(244,73,117,.30), inset 0 1px 0 rgba(255,255,255,.34); }}
  .primary.launch {{ min-width:178px; background:linear-gradient(180deg,#ff8ca3,#f44975 54%,#ff8356); }}
</style>
</head>
<body>
  <div class="shell" data-drag="true">
    <aside class="side drag" data-drag="true">
      <div class="orb a"></div><div class="orb b"></div>
      <div class="brand"><img src="data:image/png;base64,{icon}" alt="ChangLi"><div><div class="wordmark">ChangLi</div><div class="tag">私人影音资料库</div></div></div>
      <div class="hero"><div class="kicker">INSTALLER</div><h1>装好后<br>直接进入收藏宇宙</h1><p>本地优先，离线可用，海报、演员、标签和追番状态一起带进桌面。</p></div>
      <div class="glass-pills"><span class="pill">本地数据库</span><span class="pill">内置播放器</span><span class="pill">自动建库</span></div>
      <div class="stack"><div class="glass-card three"></div><div class="glass-card two"></div><div class="glass-card one"></div></div>
    </aside>
    <main class="main">
      <a class="close" id="close" href="changli://close" data-close="true">×</a>
      <div class="topline drag" data-drag="true"><div class="steps" id="steps"><i class="stepbar"></i><i class="stepdot one"></i><i class="stepdot two"></i></div><div class="ver">ChangLi {version}</div></div>
      <section class="title drag" id="title-block" data-drag="true"><h2 id="headline">准备安装长离</h2><p id="subtitle"></p></section>
      <section class="card" id="install-card">
        <div class="path-row" id="path-row"><div class="home">⌂</div><div class="path-copy"><small id="path-label">安装位置</small><strong id="install-dir" title="{default_label}">{default_label}</strong></div><a class="change" id="choose" href="changli://choose-dir">更改</a></div>
        <div class="flow"><div class="flow-item" id="flow-1"><div class="num">1</div><b id="flow-1-title">检测位置</b><span id="flow-1-desc">优先沿用旧版安装目录</span></div><div class="flow-item" id="flow-2"><div class="num">2</div><b id="flow-2-title">写入组件</b><span id="flow-2-desc">静默执行安装后端</span></div><div class="flow-item" id="flow-3"><div class="num">3</div><b id="flow-3-title">创建入口</b><span id="flow-3-desc">安装器创建桌面入口</span></div></div>
      </section>
      <div class="bottom"><div class="status-wrap"><div class="state" id="state"></div><div class="progress" id="progress"><div class="bar" id="progress-bar"></div></div></div><div class="actions"><a class="btn" id="cancel" href="changli://close" data-close="true">取消</a><a class="btn primary" id="install" href="changli://install">开始安装</a></div></div>
    </main>
  </div>
<script>
  const state = document.getElementById('state');
  const progress = document.getElementById('progress');
  const progressBar = document.getElementById('progress-bar');
  const headline = document.getElementById('headline');
  const titleBlock = document.getElementById('title-block');
  const subtitle = document.getElementById('subtitle');
  const installCard = document.getElementById('install-card');
  const flow1Title = document.getElementById('flow-1-title');
  const flow1Desc = document.getElementById('flow-1-desc');
  const flow2Title = document.getElementById('flow-2-title');
  const flow2Desc = document.getElementById('flow-2-desc');
  const flow3Title = document.getElementById('flow-3-title');
  const flow3Desc = document.getElementById('flow-3-desc');
  const installMode = '{install_mode}';
  let progressValue = 1;
  let progressTimer = null;
  const processCopy = () => installMode === 'update' ? '检测到已有版本，正在覆盖更新安装中' : '检测到首次安装，请稍后';
  const setHeadline = (text) => {{
    headline.innerHTML = text;
    headline.classList.remove('pulse', 'drop');
    void headline.offsetWidth;
    headline.classList.add('pulse');
  }};
  const setProgress = (value) => {{
    progressValue = Math.max(1, Math.min(100, value));
    progressBar.style.width = progressValue + '%';
    state.textContent = progressValue >= 100 ? '安装完成 100%' : processCopy() + '，' + progressValue + '%';
    state.classList.add('active');
  }};
  const install = document.getElementById('install');
  const cancel = document.getElementById('cancel');
  const closeBtn = document.getElementById('close');
  const choose = document.getElementById('choose');
  const dir = document.getElementById('install-dir');
  const steps = document.getElementById('steps');
  const flow1 = document.getElementById('flow-1');
  const flow2 = document.getElementById('flow-2');
  const flow3 = document.getElementById('flow-3');
  const setPhase = (phase) => {{
    steps.className = 'steps ' + (phase === 'ready' ? '' : phase);
    [flow1, flow2, flow3].forEach(el => el.classList.remove('active', 'done', 'fail'));
    if (phase === 'ready') flow1.classList.add('active');
    if (phase === 'install') {{ flow1.classList.add('done'); flow2.classList.add('active'); }}
    if (phase === 'done') {{ flow1.classList.add('done'); flow2.classList.add('done'); flow3.classList.add('done'); }}
    if (phase === 'fail') flow2.classList.add('fail');
  }};
  setPhase('ready');
  document.addEventListener('mousedown', e => {{
    if (e.button !== 0 || e.target.closest('a,button,input,label')) return;
    window.location.href = 'changli://drag';
  }});
  document.addEventListener('click', e => {{
    const el = e.target.closest('a');
    if (!el) return;
    const href = el.getAttribute('href') || '';
    if (el.dataset.close === 'true' || href === 'changli://launch-close') {{
      e.preventDefault();
      window.location.href = href;
    }}
  }});
  window.setInstalling = () => {{
    setPhase('install');
    installCard.classList.add('flyout');
    titleBlock.className = 'title installing drag';
    headline.innerHTML = '正在安装长离中<span class="dots"><i></i><i></i><i></i></span>';
    headline.classList.remove('pulse', 'drop');
    void headline.offsetWidth;
    headline.classList.add('drop');
    subtitle.textContent = '';
    installCard.className = 'card is-working flyout';
    flow1Title.textContent = installMode === 'update' ? '检测旧版' : '首次安装';
    flow1Desc.textContent = installMode === 'update' ? '已找到原安装目录' : '准备创建应用目录';
    flow2Title.textContent = installMode === 'update' ? '覆盖更新' : '写入组件';
    flow2Desc.textContent = installMode === 'update' ? '保留资料并写入新版' : '静默执行安装后端';
    flow3Title.textContent = '创建入口';
    flow3Desc.textContent = '完成后可直接打开应用';
    if (progressTimer) clearInterval(progressTimer);
    install.classList.add('disabled'); cancel.classList.add('disabled'); closeBtn.classList.add('disabled'); choose.classList.add('disabled');
    install.textContent = '安装中'; progress.classList.add('active'); setProgress(1);
    progressTimer = setInterval(() => {{
      if (progressValue < 92) setProgress(progressValue + 1);
      else if (progressValue < 99 && Math.random() > .55) setProgress(progressValue + 1);
    }}, 100);
  }};
  window.setInstallDir = (value) => {{ dir.textContent = value; dir.title = value; }};
  window.installDone = (ok, code) => {{
    if (progressTimer) {{ clearInterval(progressTimer); progressTimer = null; }}
    if (ok) {{
      setPhase('done'); installCard.className = 'card is-done flyout'; titleBlock.className = 'title done drag'; setHeadline('安装成功'); subtitle.textContent = ''; setProgress(100); install.textContent = '完成并启动'; install.href = 'changli://launch-close'; install.classList.add('launch'); install.classList.remove('disabled'); cancel.textContent = '完成'; cancel.classList.remove('disabled'); closeBtn.classList.remove('disabled');
    }} else {{
      progress.classList.remove('active');
      setPhase('fail'); installCard.className = 'card'; titleBlock.className = 'title drag'; setHeadline('安装失败'); subtitle.textContent = ''; state.classList.add('active'); state.textContent = '安装失败' + (code == null ? '' : '，退出码 ' + code); progressBar.style.width = '1%'; install.textContent = '重试'; install.href = 'changli://install'; install.classList.remove('disabled'); cancel.classList.remove('disabled'); closeBtn.classList.remove('disabled'); choose.classList.remove('disabled');
    }}
  }};
  requestAnimationFrame(() => requestAnimationFrame(() => {{ window.location.href = 'changli://ready'; }}));
</script>
</body>
</html>"#,
        icon = icon,
        version = version,
        default_label = default_label,
        install_mode = install_mode
    )
}

#[cfg(target_os = "windows")]
fn apply_transparent_shell_region(window: &tao::window::Window) {
    use windows::Win32::Graphics::Gdi::{CreateRoundRectRgn, SetWindowRgn};

    let hwnd = windows::Win32::Foundation::HWND(window.hwnd() as *mut core::ffi::c_void);
    unsafe {
        // Clip to the actual 980x640 shell placed at (10,10). This is a defensive layer:
        // even if WebView2 paints its transparent pixels white on a user's machine, the
        // rectangular child backing cannot leak outside the rounded shell.
        let region = CreateRoundRectRgn(10, 10, 990, 650, 68, 68);
        if !region.is_invalid() {
            let _ = SetWindowRgn(hwnd, region, true);
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn apply_transparent_shell_region(_window: &tao::window::Window) {}

fn main() -> wry::Result<()> {
    let event_loop = EventLoopBuilder::<InstallerEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let existing_dir = find_existing_install_dir();
    let is_update = existing_dir.is_some();
    let default_dir = existing_dir.unwrap_or_else(fallback_install_dir);

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
        .with_transparent(true)
        .with_visible(false)
        .with_inner_size(LogicalSize::new(W as f64, H as f64));
    if let Some(pos) = pos {
        builder = builder.with_position(pos);
    }
    let window = builder.build(&event_loop).expect("create installer window");
    apply_transparent_shell_region(&window);

    let nav_proxy = proxy.clone();
    let mut web_context = WebContext::new(Some(webview_data_dir()));
    let webview = WebViewBuilder::with_web_context(&mut web_context)
        .with_bounds(Rect {
            position: WebLogicalPosition::new(10, 10).into(),
            size: WebLogicalSize::new(980, 640).into(),
        })
        .with_transparent(true)
        .with_background_color((0, 0, 0, 0))
        .with_html(html(&default_dir, is_update))
        .with_navigation_handler(move |url| {
            if let Some(cmd) = url.strip_prefix("changli://") {
                let event = match cmd.trim_end_matches('/') {
                    "ready" => Some(InstallerEvent::Ready),
                    "drag" => Some(InstallerEvent::Drag),
                    "close" => Some(InstallerEvent::Close),
                    "choose-dir" => Some(InstallerEvent::ChooseDir),
                    "install" => Some(InstallerEvent::Install),
                    "launch-close" => Some(InstallerEvent::CloseAndLaunch),
                    _ => None,
                };
                if let Some(event) = event {
                    let _ = nav_proxy.send_event(event);
                }
                return false;
            }
            true
        })
        .build_as_child(&window)?;

    let mut install_dir = default_dir;
    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::NewEvents(StartCause::Init) => {}
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            }
            | Event::UserEvent(InstallerEvent::Close) => {
                window.set_visible(false);
                *control_flow = ControlFlow::Exit;
            }
            Event::UserEvent(InstallerEvent::Ready) => {
                window.set_visible(true);
            }
            Event::UserEvent(InstallerEvent::CloseAndLaunch) => {
                window.set_visible(false);
                launch_installed_app(&install_dir);
                *control_flow = ControlFlow::Exit;
            }
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
                let _ = webview.evaluate_script("window.setInstalling && window.setInstalling();");
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
