#![cfg_attr(windows, windows_subsystem = "windows")]

use std::{env, fs, path::PathBuf, process::Command, thread};

use base64::{engine::general_purpose, Engine as _};
use tao::{
    dpi::LogicalSize,
    event::{Event, StartCause, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    window::WindowBuilder,
};
use wry::WebViewBuilder;

const SETUP_BYTES: &[u8] = include_bytes!(env!("CHANGLI_NSIS_SETUP"));
const ICON_BYTES: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../src-tauri/icons/icon.png"
));

fn write_embedded(name: &str, bytes: &[u8]) -> PathBuf {
    let mut p = env::temp_dir();
    p.push(name);
    let _ = fs::write(&p, bytes);
    p
}

fn start_install() {
    thread::spawn(|| {
        let setup = write_embedded("ChangLi-inner-setup.exe", SETUP_BYTES);
        let _ = Command::new(&setup).arg("/S").status();
    });
}

fn html() -> String {
    let version = option_env!("CHANGLI_APP_VERSION").unwrap_or("dev");
    let icon = general_purpose::STANDARD.encode(ICON_BYTES);
    format!(
        r#"<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ChangLi Installer</title>
<style>
  :root {{
    --rose: #f44975;
    --rose-2: #ff6d8a;
    --orange: #ff844a;
    --ink: #10121b;
    --muted: #626b7c;
    --line: #e8ebf2;
    font-family: "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif;
  }}
  * {{ box-sizing: border-box; }}
  html, body {{
    width: 100%; height: 100%; margin: 0; overflow: hidden;
    background: transparent;
  }}
  body {{
    display: grid; place-items: center;
    user-select: none;
  }}
  .shell {{
    width: 980px; height: 640px; display: grid; grid-template-columns: 318px 1fr;
    overflow: hidden; border-radius: 26px;
    background: #f7f8fc;
    box-shadow: 0 24px 80px rgba(22, 24, 35, .18);
  }}
  .side {{
    position: relative; overflow: hidden; padding: 32px 32px 28px;
    color: white;
    background:
      radial-gradient(circle at -12% 74%, rgba(255, 153, 101, .96) 0 23%, transparent 24%),
      radial-gradient(circle at 82% -4%, rgba(255, 132, 103, .96) 0 24%, transparent 25%),
      linear-gradient(154deg, #f44975 0%, #fb586b 48%, #ff844a 100%);
  }}
  .side::before {{
    content: ""; position: absolute; left: 36px; bottom: 156px; width: 154px; height: 90px;
    border-radius: 30px; background: rgba(255, 113, 100, .62);
  }}
  .brand {{ position: relative; display: flex; gap: 18px; align-items: center; z-index: 1; }}
  .icon-wrap {{
    width: 64px; height: 64px; display: grid; place-items: center;
    border-radius: 16px; background: rgba(255, 246, 248, .98);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.7);
  }}
  .icon-wrap img {{ width: 50px; height: 50px; border-radius: 12px; }}
  .wordmark {{ font-size: 29px; font-weight: 850; letter-spacing: -.02em; line-height: 1; }}
  .tag {{ margin-top: 8px; font-size: 11px; font-weight: 800; letter-spacing: .06em; color: #fff0f4; }}
  .poster {{ position: relative; z-index: 1; margin-top: 54px; }}
  .poster h1 {{ margin: 0; font-size: 42px; line-height: 1.24; letter-spacing: -.055em; font-weight: 950; }}
  .poster p {{ margin: 22px 0 0; width: 244px; font-size: 13px; line-height: 1.75; color: #fff6f8; }}
  .pills {{ position: relative; z-index: 1; margin-top: 42px; display: flex; flex-wrap: wrap; gap: 10px; }}
  .pill {{
    padding: 8px 18px; border-radius: 999px; background: #ffe6ec;
    color: #e04060; font-size: 13px; font-weight: 850;
  }}
  .main {{ position: relative; padding: 30px 34px 20px 28px; }}
  .close {{
    position: absolute; right: 18px; top: 18px; width: 36px; height: 36px; border: 0;
    border-radius: 12px; background: transparent; color: #7d8493; font-size: 24px;
    cursor: pointer;
  }}
  .close:hover {{ background: #eef1f7; color: #10121b; }}
  .panel {{
    width: 508px; min-height: 404px; padding: 32px 24px 24px;
    border-radius: 30px; background: white; border: 1px solid #f3f4f8;
    box-shadow: 0 20px 60px rgba(50, 56, 77, .045);
  }}
  .dots {{ display: flex; gap: 14px; margin-bottom: 22px; }}
  .dot {{ width: 8px; height: 8px; border-radius: 99px; background: #ffcbd3; }}
  .dot.active {{ background: var(--rose); }}
  .version {{ color: var(--rose); font-size: 15px; font-weight: 850; }}
  h2 {{ margin: 22px 0 8px; color: var(--ink); font-size: 34px; line-height: 1.08; letter-spacing: -.065em; font-weight: 950; }}
  .desc {{ margin: 0; color: var(--muted); font-size: 15px; line-height: 1.7; }}
  .path {{
    margin-top: 22px; height: 70px; display: flex; align-items: center; gap: 14px; padding: 0 18px;
    border: 1px solid #e4e8f0; border-radius: 18px; background: #fafbfd;
  }}
  .home {{ width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: #ffe8ee; color: var(--rose); font-weight: 900; }}
  .path small {{ display: block; color: var(--muted); font-size: 13px; font-weight: 850; }}
  .path strong {{ display: block; margin-top: 5px; color: var(--ink); font-size: 17px; }}
  .change {{ margin-left: auto; border: 0; border-radius: 999px; padding: 8px 15px; background: #ffebf0; color: #d53f64; font-weight: 850; }}
  .cards {{ margin-top: 22px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }}
  .card {{
    height: 74px; border: 1px solid #eaedf4; border-radius: 18px; padding: 15px 14px;
    display: grid; grid-template-columns: 24px 1fr; gap: 8px; align-items: start;
  }}
  .card:nth-child(1) {{ background: #fff6f8; }}
  .card:nth-child(2) {{ background: #fff9f4; }}
  .card:nth-child(3) {{ background: #fafbfd; }}
  .badge {{ width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%; background: #ffe2ea; color: var(--rose); font-weight: 950; }}
  .card b {{ display: block; color: var(--ink); font-size: 15px; line-height: 1.1; }}
  .card span {{ display: block; margin-top: 7px; color: #636b7c; font-size: 12px; font-weight: 650; }}
  .bottom {{ position: absolute; left: 62px; right: 34px; bottom: 20px; display: flex; align-items: end; justify-content: space-between; }}
  .progress {{ width: 212px; height: 8px; border-radius: 99px; background: #e9ecf3; overflow: hidden; }}
  .bar {{ width: 0%; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--rose), var(--rose-2)); transition: width .45s ease; }}
  .status {{ margin-top: 12px; color: var(--muted); font-size: 13px; font-weight: 650; }}
  .actions {{ display: flex; gap: 12px; }}
  .btn {{ height: 46px; border-radius: 16px; border: 1px solid #dce0e9; padding: 0 23px; background: white; color: #484c59; font-size: 16px; font-weight: 850; cursor: pointer; }}
  .primary {{ position: relative; min-width: 114px; border: 0; color: white; background: linear-gradient(180deg, #ff6385, var(--rose)); overflow: hidden; }}
  .primary::before {{ content: ""; position: absolute; left: 12px; right: 12px; top: 6px; height: 12px; border-radius: 999px; background: rgba(255,255,255,.18); }}
  .btn:active {{ transform: translateY(1px); }}
</style>
</head>
<body>
  <div class="shell">
    <aside class="side">
      <div class="brand">
        <div class="icon-wrap"><img src="data:image/png;base64,{icon}" alt="ChangLi" /></div>
        <div><div class="wordmark">ChangLi</div><div class="tag">PRIVATE MEDIA LIBRARY</div></div>
      </div>
      <div class="poster">
        <h1>装好后<br/>直接进入<br/>收藏宇宙</h1>
        <p>本地资料、海报、播放环境和收藏路径会原样保留。</p>
      </div>
      <div class="pills"><span class="pill">本地数据库</span><span class="pill">播放器就绪</span><span class="pill">自动建库</span></div>
    </aside>
    <main class="main">
      <button class="close" onclick="window.close()">×</button>
      <section class="panel">
        <div class="dots"><i class="dot active"></i><i class="dot"></i><i class="dot"></i></div>
        <div class="version">ChangLi {version}</div>
        <h2>准备安装长离</h2>
        <p class="desc">安装完成后立即打开你的本地影音资料库。<br/>原有数据、海报和播放环境都会继续保留。</p>
        <div class="path"><div class="home">⌂</div><div><small>安装位置</small><strong>当前用户 AppData / ChangLi</strong></div><button class="change">更改</button></div>
        <div class="cards">
          <div class="card"><div class="badge">✓</div><div><b>保留本地数据</b><span>升级沿用现有资料库</span></div></div>
          <div class="card"><div class="badge">▶</div><div><b>播放器就绪</b><span>安装后直接播放</span></div></div>
          <div class="card"><div class="badge">↗</div><div><b>一键启动</b><span>完成后立即打开</span></div></div>
        </div>
      </section>
      <div class="bottom">
        <div><div class="progress"><div class="bar" id="bar"></div></div><div class="status" id="status">准备就绪，约 1 分钟完成</div></div>
        <div class="actions"><button class="btn" onclick="window.close()">取消</button><button class="btn primary" id="install">开始安装</button></div>
      </div>
    </main>
  </div>
<script>
  const btn = document.getElementById('install');
  const bar = document.getElementById('bar');
  const status = document.getElementById('status');
  let running = false;
  btn.addEventListener('click', () => {{
    if (running) return;
    running = true;
    btn.textContent = '安装中';
    status.textContent = '正在安装 ChangLi...';
    let p = 8;
    bar.style.width = p + '%';
    const timer = setInterval(() => {{
      p = Math.min(94, p + Math.floor(Math.random() * 9) + 4);
      bar.style.width = p + '%';
    }}, 420);
    window.ipc.postMessage('install');
    setTimeout(() => {{
      clearInterval(timer);
      bar.style.width = '100%';
      status.textContent = '安装完成，可以打开 ChangLi';
      btn.textContent = '完成';
      btn.onclick = () => window.close();
    }}, 5200);
  }});
</script>
</body>
</html>"#,
        icon = icon,
        version = version
    )
}

fn main() -> wry::Result<()> {
    let event_loop = EventLoopBuilder::new().build();
    let window = WindowBuilder::new()
        .with_title("ChangLi Installer")
        .with_decorations(false)
        .with_resizable(false)
        .with_transparent(true)
        .with_inner_size(LogicalSize::new(980.0, 640.0))
        .build(&event_loop)
        .expect("create installer window");

    let _webview = WebViewBuilder::new()
        .with_html(html())
        .with_ipc_handler(move |request| {
            if request.body() == "install" {
                start_install();
            }
        })
        .build(&window)?;

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::NewEvents(StartCause::Init) => {}
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => *control_flow = ControlFlow::Exit,
            _ => {}
        }
    });
}
