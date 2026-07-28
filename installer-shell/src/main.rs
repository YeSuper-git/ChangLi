#![cfg_attr(windows, windows_subsystem = "windows")]

use std::{
    env, fs,
    io::Write,
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
use wry::{
    dpi::{LogicalPosition as WebLogicalPosition, LogicalSize as WebLogicalSize},
    Rect, WebContext, WebViewBuilder,
};

#[cfg(target_os = "windows")]
use tao::platform::windows::WindowExtWindows;
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
    InstallDone {
        success: bool,
        code: Option<i32>,
        message: String,
    },
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

fn installer_log_path() -> PathBuf {
    env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| env::var_os("APPDATA").map(PathBuf::from))
        .unwrap_or_else(env::temp_dir)
        .join("ChangLi")
        .join("installer.log")
}

fn write_installer_log(message: &str) {
    let log_path = installer_log_path();
    if let Some(parent) = log_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        let _ = writeln!(file, "{}", message);
    }
}

fn write_embedded(name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let mut p = env::temp_dir();
    p.push(name);
    fs::write(&p, bytes).map_err(|err| format!("释放安装组件失败：{}", err))?;
    Ok(p)
}

fn start_install(install_dir: PathBuf, proxy: EventLoopProxy<InstallerEvent>) {
    thread::spawn(move || {
        write_installer_log(&format!("start install: {}", install_dir.display()));
        let result = (|| -> Result<(bool, Option<i32>, String), String> {
            fs::create_dir_all(&install_dir)
                .map_err(|err| format!("创建安装目录失败：{}", err))?;
            let setup = write_embedded("ChangLi-inner-setup.exe", SETUP_BYTES)?;
            write_installer_log(&format!("inner setup: {}", setup.display()));
            let status = Command::new(&setup)
                .arg("/S")
                .arg(format!("/D={}", install_dir.display()))
                .status()
                .map_err(|err| format!("启动安装后端失败：{}", err))?;
            let code = status.code();
            if status.success() {
                Ok((true, code, "安装完成".to_string()))
            } else {
                Ok((
                    false,
                    code,
                    format!(
                        "安装后端返回失败{}。如安装在系统目录，请在管理员授权后重试。日志：{}",
                        code.map(|c| format!("，退出码 {}", c)).unwrap_or_default(),
                        installer_log_path().display()
                    ),
                ))
            }
        })();

        let (success, code, message) = match result {
            Ok(value) => value,
            Err(message) => (false, None, message),
        };
        write_installer_log(&format!(
            "finish install: success={} code={:?} message={}",
            success, code, message
        ));
        let _ = proxy.send_event(InstallerEvent::InstallDone {
            success,
            code,
            message,
        });
    });
}

fn launch_installed_app(install_dir: &Path) {
    let exe = install_dir.join("ChangLi.exe");
    if exe.exists() {
        let _ = Command::new(exe).current_dir(install_dir).spawn();
    }
}

fn js_call(name: &str, value: &str) -> String {
    format!("window.{}({});", name, serde_json::to_string(value).unwrap())
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
  @keyframes fadeSlideIn {{
    0%   {{ opacity: 0; transform: translateY(12px); }}
    100% {{ opacity: 1; transform: translateY(0); }}
  }}
  @keyframes shimmer {{
    0%   {{ background-position: -200% center; }}
    100% {{ background-position: 200% center; }}
  }}
  @keyframes progressGlow {{
    0%, 100% {{ box-shadow: 0 0 14px rgba(232,64,100,.28), 0 0 4px rgba(232,64,100,.18); }}
    50%      {{ box-shadow: 0 0 22px rgba(232,64,100,.38), 0 0 8px rgba(232,64,100,.22); }}
  }}
  @keyframes spinnerRotate {{
    100% {{ transform: rotate(360deg); }}
  }}
  @keyframes pulseRing {{
    0%   {{ transform: scale(.88); opacity: .6; }}
    50%  {{ transform: scale(1.04); opacity: 1; }}
    100% {{ transform: scale(.88); opacity: .6; }}
  }}
  @keyframes dotBounce {{
    0%, 80%, 100% {{ transform: translateY(0); opacity: .35; }}
    40%           {{ transform: translateY(-8px); opacity: 1; }}
  }}
  @keyframes titlePulse {{
    0%   {{ opacity: .4; transform: translateY(8px); }}
    100% {{ opacity: 1; transform: translateY(0); }}
  }}
  @keyframes titleDrop {{
    0%   {{ opacity: 0; transform: translateY(-80px) scale(1.05); }}
    60%  {{ opacity: 1; transform: translateY(10px) scale(.99); }}
    80%  {{ transform: translateY(-4px) scale(1.004); }}
    100% {{ opacity: 1; transform: translateY(0) scale(1); }}
  }}
  @keyframes successBounce {{
    0%   {{ transform: scale(0); opacity: 0; }}
    50%  {{ transform: scale(1.15); opacity: 1; }}
    70%  {{ transform: scale(.96); }}
    100% {{ transform: scale(1); opacity: 1; }}
  }}
  @keyframes checkDraw {{
    0%   {{ stroke-dashoffset: 24; }}
    100% {{ stroke-dashoffset: 0; }}
  }}
  @keyframes fadeOut {{
    0%   {{ opacity: 1; }}
    100% {{ opacity: 0; }}
  }}
  @keyframes cardFlyIn {{
    0%   {{ opacity: 0; transform: translateX(40px) scale(.97); }}
    100% {{ opacity: 1; transform: translateX(0) scale(1); }}
  }}
  :root {{
    --ink:#12151e;
    --ink2:#394050;
    --muted:#6b7280;
    --soft-bg:#f8f9fc;
    --line:#e5e8ef;
    --rose:#e84064;
    --rose-dim:#e8406418;
    --rose-mid:#e8406430;
    --orange:#ef6c32;
    --green:#10b981;
    --green-dim:#10b98118;
    --font: "Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, -apple-system, sans-serif;
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  a {{ text-decoration: none; }}
  html, body {{ width: 100%; height: 100%; margin: 0; overflow: hidden; background: #f0f2f7; }}
  body {{ user-select: none; -webkit-user-select: none; }}

  /* ── Shell ─────────────────────────────────────── */
  .shell {{
    position: relative;
    width: 100%; height: 100%;
    display: grid; grid-template-columns: 340px 1fr;
    overflow: hidden;
    border-radius: 18px;
    background: #f0f2f7;
    box-shadow:
      0 1px 0 rgba(255,255,255,.6) inset,
      0 2px 0 rgba(0,0,0,.018),
      0 8px 24px rgba(16,18,28,.07),
      0 24px 68px rgba(16,18,28,.12);
    animation: fadeSlideIn .5s cubic-bezier(.16,1,.3,1) both;
  }}
  .shell::before {{
    content: ""; position: absolute; inset: 0; z-index: 6; pointer-events: none;
    border-radius: 18px;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,.55);
  }}

  /* ── Drag region ───────────────────────────────── */
  .drag {{ -webkit-app-region: drag; cursor: default; }}
  .no-drag {{ -webkit-app-region: no-drag; }}
  a, button, input, label, .no-drag {{ -webkit-app-region: no-drag; }}

  /* ── Side panel ────────────────────────────────── */
  .side {{
    position: relative; overflow: hidden;
    padding: 36px 32px 32px; color: #fff;
    background:
      radial-gradient(ellipse 90% 60% at 15% 8%, rgba(255,255,255,.30), transparent 50%),
      radial-gradient(ellipse 80% 50% at 90% 100%, rgba(239,108,50,.35), transparent 45%),
      linear-gradient(160deg, #dc2f52 0%, #e84064 38%, #ef6c32 100%);
  }}
  .side::before {{
    content: ""; position: absolute; inset: 0; z-index: 0; opacity: .06;
    background-image:
      repeating-linear-gradient(90deg, #fff 0 1px, transparent 1px 40px),
      repeating-linear-gradient(0deg, #fff 0 1px, transparent 1px 40px);
    mask-image: linear-gradient(180deg, #000 0, transparent 60%);
    -webkit-mask-image: linear-gradient(180deg, #000 0, transparent 60%);
  }}
  .side::after {{
    content: ""; position: absolute; inset: 0; z-index: 0;
    background: linear-gradient(170deg, rgba(255,255,255,.10), transparent 50%, rgba(0,0,0,.12));
    pointer-events: none;
  }}
  .side > * {{ position: relative; z-index: 1; }}

  /* ── Brand ─────────────────────────────────────── */
  .brand {{ display: flex; gap: 14px; align-items: center; }}
  .brand img {{
    width: 52px; height: 52px; border-radius: 14px; display: block;
    object-fit: cover; background: rgba(255,255,255,.15);
    border: 1px solid rgba(255,255,255,.28);
    box-shadow: 0 4px 12px rgba(0,0,0,.18);
  }}
  .wordmark {{
    font-size: 24px; font-weight: 800; letter-spacing: -.03em; line-height: 1;
    text-shadow: 0 1px 2px rgba(0,0,0,.12);
  }}
  .tag {{
    margin-top: 3px; font-size: 12px; font-weight: 500; letter-spacing: .02em;
    color: rgba(255,255,255,.70);
  }}

  /* ── Hero ──────────────────────────────────────── */
  .hero {{ margin-top: 56px; }}
  .kicker {{
    font-size: 11px; font-weight: 700; letter-spacing: .22em;
    color: rgba(255,255,255,.55); margin-bottom: 16px;
    text-transform: uppercase;
  }}
  .hero h1 {{
    margin: 0 0 14px; font-size: 36px; line-height: 1.12;
    font-weight: 800; letter-spacing: -.05em;
    text-shadow: 0 1px 3px rgba(0,0,0,.10);
  }}
  .hero p {{
    display: block; width: 240px; margin: 0;
    line-height: 1.75; font-size: 13px; color: rgba(255,255,255,.72);
  }}

  /* ── Pills ─────────────────────────────────────── */
  .glass-pills {{ margin-top: 32px; display: flex; flex-wrap: wrap; gap: 8px; }}
  .pill {{
    padding: 7px 13px; border-radius: 999px; color: #fff; font-size: 11px; font-weight: 600;
    background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.16);
    letter-spacing: .01em;
  }}

  /* ── Decorative orbs ──────────────────────────── */
  .orb {{ position: absolute; border-radius: 50%; filter: blur(1px); }}
  .orb.a {{ left: -30px; bottom: 120px; width: 140px; height: 90px; border-radius: 44px; background: rgba(239,108,50,.20); }}
  .orb.b {{ left: -50px; bottom: -20px; width: 120px; height: 120px; background: rgba(255,200,150,.18); }}

  /* ── Glass card stack (decorative) ─────────────── */
  .stack {{ position: absolute; z-index: 1; left: 44px; bottom: -60px; width: 220px; height: 190px; opacity: .55; }}
  .glass-card {{
    position: absolute; width: 84px; height: 120px; border-radius: 14px;
    background: linear-gradient(150deg, rgba(255,255,255,.30), rgba(255,255,255,.12));
    border: 1px solid rgba(255,255,255,.35);
    box-shadow: 0 12px 32px rgba(0,0,0,.10);
    backdrop-filter: blur(8px) saturate(130%);
  }}
  .glass-card.one  {{ left: 0;   top: 20px; transform: rotate(-10deg); }}
  .glass-card.two  {{ left: 64px; top: 0;   transform: rotate(4deg); background: linear-gradient(150deg, rgba(255,255,255,.38), rgba(255,255,255,.16)); }}
  .glass-card.three {{ left: 128px; top: 28px; transform: rotate(12deg); }}

  /* ── Main panel ────────────────────────────────── */
  .main {{
    position: relative; overflow: hidden;
    padding: 44px 36px 28px 40px;
    background: linear-gradient(180deg, #fafbff 0%, #f3f5fa 100%);
  }}
  .main::before {{
    content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 1px;
    background: linear-gradient(180deg, rgba(0,0,0,.04), rgba(0,0,0,.02), rgba(0,0,0,.04));
    pointer-events: none;
  }}
  .main > * {{ position: relative; z-index: 1; }}

  /* ── Close button ──────────────────────────────── */
  .close-btn {{
    position: absolute; right: 16px; top: 16px;
    width: 32px; height: 32px; border: 0; border-radius: 8px;
    background: transparent; color: #9ca3af;
    font-size: 20px; cursor: pointer;
    display: grid; place-items: center; line-height: 1;
    transition: background .15s, color .15s;
  }}
  .close-btn:hover {{ background: #f0f1f4; color: #374151; }}
  .close-btn.disabled {{ opacity: .35; pointer-events: none; cursor: not-allowed; }}

  /* ── Top bar ───────────────────────────────────── */
  .topline {{ display: flex; align-items: center; justify-content: space-between; margin-right: 48px; }}
  .ver {{ color: #9ca3af; font-size: 12px; font-weight: 600; letter-spacing: .02em; }}

  /* ── Step indicator ────────────────────────────── */
  .steps {{ display: flex; gap: 8px; align-items: center; }}
  .stepbar {{
    width: 28px; height: 6px; border-radius: 99px;
    background: linear-gradient(90deg, var(--rose), var(--orange));
    transition: width .35s cubic-bezier(.16,1,.3,1), background .35s, box-shadow .35s;
  }}
  .stepdot {{
    width: 6px; height: 6px; border-radius: 50%;
    background: #d9dde6;
    transition: width .35s cubic-bezier(.16,1,.3,1), background .35s, box-shadow .35s, border-radius .35s;
  }}
  .steps.install .stepbar {{ width: 6px; background: #d9dde6; box-shadow: none; }}
  .steps.install .stepdot.one {{ width: 28px; border-radius: 99px; background: linear-gradient(90deg, var(--rose), var(--orange)); box-shadow: 0 4px 12px rgba(232,64,100,.18); }}
  .steps.done .stepbar, .steps.done .stepdot.one {{ width: 6px; background: #bbf0d2; box-shadow: none; }}
  .steps.done .stepdot.two {{
    width: 28px; border-radius: 99px;
    background: linear-gradient(90deg, #34d399, var(--green));
    box-shadow: 0 4px 12px rgba(16,185,129,.18);
  }}
  .steps.fail .stepbar {{ background: #ef4444; box-shadow: 0 4px 12px rgba(239,68,68,.18); }}

  /* ── Title block ───────────────────────────────── */
  .title-block {{
    margin-top: 36px;
    transition: transform .5s cubic-bezier(.22,1,.36,1), opacity .22s ease;
  }}
  .title-block.installing {{ transform: translateY(100px); }}
  .title-block.done {{ transform: translateY(110px); }}
  .title-block h2 {{
    margin: 0; color: var(--ink); font-size: 34px; line-height: 1.1;
    letter-spacing: -.05em; font-weight: 800;
    transition: transform .28s cubic-bezier(.16,1,.3,1), opacity .18s, font-size .28s, text-align .28s;
  }}
  .title-block.installing h2, .title-block.done h2 {{ text-align: center; font-size: 40px; letter-spacing: -.055em; }}
  .title-block h2.pulse {{ animation: titlePulse .4s cubic-bezier(.16,1,.3,1); }}
  .title-block h2.drop {{ animation: titleDrop .55s cubic-bezier(.2,1.18,.26,1) both; }}
  .title-block p {{ display: none; margin-top: 6px; color: var(--muted); font-size: 13px; font-weight: 500; }}

  /* ── Animated dots (installing) ────────────────── */
  .dots {{ display: inline-flex; width: 30px; justify-content: space-between; margin-left: 6px; vertical-align: baseline; }}
  .dots i {{ width: 5px; height: 5px; border-radius: 50%; background: var(--rose); animation: dotBounce .85s ease-in-out infinite; }}
  .dots i:nth-child(2) {{ animation-delay: .12s; }}
  .dots i:nth-child(3) {{ animation-delay: .24s; }}

  /* ── Success checkmark ─────────────────────────── */
  .success-icon {{
    display: none; width: 56px; height: 56px; margin: 0 auto 16px;
    border-radius: 50%; background: linear-gradient(135deg, #34d399, #10b981);
    box-shadow: 0 8px 24px rgba(16,185,129,.22);
    animation: successBounce .5s cubic-bezier(.16,1,.3,1) both;
    place-items: center;
  }}
  .success-icon svg {{ width: 28px; height: 28px; }}
  .success-icon path {{ stroke: #fff; stroke-width: 3; fill: none; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 24; stroke-dashoffset: 24; animation: checkDraw .35s .25s ease forwards; }}
  .title-block.done .success-icon {{ display: grid; }}

  /* ── Install card ──────────────────────────────── */
  .card {{
    margin-top: 24px; width: 100%;
    border-radius: 14px;
    background: rgba(255,255,255,.88);
    border: 1px solid rgba(229,232,239,.90);
    box-shadow: 0 2px 8px rgba(16,18,28,.03), 0 8px 24px rgba(16,18,28,.04);
    padding: 18px;
    transition: border-color .22s, box-shadow .22s, transform .5s cubic-bezier(.22,1,.36,1), opacity .3s, filter .3s;
    animation: cardFlyIn .4s cubic-bezier(.16,1,.3,1) both;
  }}
  .card.flyout {{ transform: translateX(500px) rotate(1.5deg) scale(.97); opacity: 0; filter: blur(3px); pointer-events: none; }}
  .card.is-working {{ border-color: rgba(232,64,100,.15); box-shadow: 0 2px 8px rgba(16,18,28,.03), 0 12px 36px rgba(232,64,100,.08); }}
  .card.is-done {{ border-color: rgba(16,185,129,.15); box-shadow: 0 2px 8px rgba(16,18,28,.03), 0 12px 36px rgba(16,185,129,.08); }}

  /* ── Path row ──────────────────────────────────── */
  .path-row {{
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 14px 16px; border-radius: 12px;
    background: #f6f7fa; border: 1px solid var(--line);
    transition: border-color .22s;
  }}
  .path-copy {{ flex: 1; min-width: 0; }}
  .path-copy small {{ display: block; color: #9ca3af; font-size: 11px; font-weight: 600; letter-spacing: .02em; text-transform: uppercase; }}
  .path-copy strong {{ display: block; margin-top: 4px; color: var(--ink); font-size: 13px; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }}
  .change-btn {{
    border: 0; border-radius: 999px; padding: 9px 14px;
    background: #fff; color: var(--rose); font-size: 12px; font-weight: 700;
    cursor: pointer; display: inline-flex; align-items: center;
    box-shadow: 0 1px 4px rgba(0,0,0,.06);
    transition: background .15s, box-shadow .15s;
  }}
  .change-btn:hover {{ background: #fdf2f5; box-shadow: 0 2px 8px rgba(232,64,100,.10); }}
  .change-btn.disabled {{ opacity: .35; pointer-events: none; cursor: not-allowed; }}

  /* ── Flow steps ────────────────────────────────── */
  .flow {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 14px; }}
  .flow-item {{
    min-height: 96px; border-radius: 12px; padding: 14px;
    background: #fff; border: 1px solid var(--line);
    transition: border-color .22s, background .22s, box-shadow .22s, transform .22s;
  }}
  .flow-item.active {{ border-color: var(--line); background: #fff; }}
  .card.is-working .flow-item.active {{
    border-color: rgba(232,64,100,.18); background: #fdf6f8;
    box-shadow: 0 4px 12px rgba(232,64,100,.06);
  }}
  .flow-item.done {{ border-color: var(--line); background: #fff; }}
  .card.is-done .flow-item.done {{
    border-color: rgba(16,185,129,.18); background: #f0fdf6;
  }}
  .flow-item.fail {{ background: #fef2f2; border-color: #fecaca; }}
  .num {{
    width: 26px; height: 26px; border-radius: 8px;
    display: grid; place-items: center; margin-bottom: 10px;
    color: var(--rose); font-size: 12px; font-weight: 800;
    background: var(--rose-dim);
  }}
  .flow-item b {{ display: block; color: var(--ink); font-size: 13px; line-height: 1.3; font-weight: 700; }}
  .flow-item span {{ display: block; margin-top: 4px; color: #9ca3af; font-size: 11px; line-height: 1.4; }}

  /* ── Bottom bar ────────────────────────────────── */
  .bottom {{
    position: absolute; left: 40px; right: 36px; bottom: 60px;
    display: flex; align-items: center; justify-content: space-between;
  }}
  .status-wrap {{ min-width: 260px; }}
  .state {{ display: none; color: #6b7280; font-size: 12px; font-weight: 600; }}
  .state.active {{ display: block; }}

  /* ── Progress bar ──────────────────────────────── */
  .progress {{
    display: none; margin-top: 8px; width: 260px; height: 6px;
    border-radius: 999px; overflow: hidden;
    background: #eaedf3;
  }}
  .progress.active {{ display: block; }}
  .bar {{
    width: 1%; height: 100%; border-radius: 999px;
    background: linear-gradient(90deg, var(--rose), var(--orange));
    transition: width .22s ease;
    animation: progressGlow 2s ease-in-out infinite;
    position: relative;
  }}
  .bar::after {{
    content: ""; position: absolute; inset: 0;
    border-radius: 999px;
    background: linear-gradient(90deg, transparent 30%, rgba(255,255,255,.35) 50%, transparent 70%);
    background-size: 200% 100%;
    animation: shimmer 2.2s ease-in-out infinite;
  }}

  /* ── Buttons ───────────────────────────────────── */
  .actions {{ display: flex; gap: 10px; }}
  .btn {{
    height: 42px; border-radius: 10px; border: 1px solid var(--line);
    background: #fff; color: var(--ink2); font-size: 13px; font-weight: 700;
    cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
    padding: 0 22px;
    box-shadow: 0 1px 3px rgba(0,0,0,.04);
    transition: background .15s, border-color .15s, box-shadow .15s, color .15s, transform .1s;
  }}
  .btn:hover {{ background: #f7f8fa; border-color: #d1d5de; }}
  .btn:active {{ transform: scale(.98); }}
  .btn.disabled {{ opacity: .35; pointer-events: none; cursor: not-allowed; }}
  .primary {{
    min-width: 110px; border: 0; color: #fff;
    background: linear-gradient(180deg, #f05276, var(--rose) 50%, #d63456);
    box-shadow: 0 2px 8px rgba(232,64,100,.22), inset 0 1px 0 rgba(255,255,255,.20);
  }}
  .primary:hover {{ background: linear-gradient(180deg, #f46080, #e84064 50%, #d93a5a); box-shadow: 0 4px 14px rgba(232,64,100,.28); }}
  .primary:active {{ transform: scale(.97); }}
  .primary.launch {{ min-width: 160px; background: linear-gradient(180deg, #34d399, #10b981 50%, #059669); box-shadow: 0 2px 8px rgba(16,185,129,.22), inset 0 1px 0 rgba(255,255,255,.20); }}
  .primary.launch:hover {{ box-shadow: 0 4px 14px rgba(16,185,129,.28); }}
</style>
</head>
<body>
  <div class="shell" data-drag="true">
    <aside class="side drag" data-drag="true">
      <div class="orb a"></div><div class="orb b"></div>
      <div class="brand">
        <img src="data:image/png;base64,{icon}" alt="ChangLi">
        <div>
          <div class="wordmark">ChangLi</div>
          <div class="tag">私人影音资料库</div>
        </div>
      </div>
      <div class="hero">
        <div class="kicker">Installer</div>
        <h1>装好后<br>直接进入收藏宇宙</h1>
        <p>本地优先，离线可用，海报、演员、标签和追番状态一起带进桌面。</p>
      </div>
      <div class="glass-pills">
        <span class="pill">本地数据库</span>
        <span class="pill">内置播放器</span>
        <span class="pill">自动建库</span>
      </div>
      <div class="stack">
        <div class="glass-card three"></div>
        <div class="glass-card two"></div>
        <div class="glass-card one"></div>
      </div>
    </aside>
    <main class="main">
      <button class="close-btn" id="close" aria-label="关闭">×</button>
      <div class="topline drag" data-drag="true">
        <div class="steps" id="steps">
          <i class="stepbar"></i>
          <i class="stepdot one"></i>
          <i class="stepdot two"></i>
        </div>
        <div class="ver">ChangLi {version}</div>
      </div>
      <section class="title-block drag" id="title-block" data-drag="true">
        <div class="success-icon">
          <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
        </div>
        <h2 id="headline">准备安装长离</h2>
        <p id="subtitle"></p>
      </section>
      <section class="card" id="install-card">
        <div class="path-row" id="path-row">
          <div class="path-copy">
            <small id="path-label">安装位置</small>
            <strong id="install-dir" title="{default_label}">{default_label}</strong>
          </div>
          <button class="change-btn" id="choose">更改</button>
        </div>
        <div class="flow">
          <div class="flow-item" id="flow-1">
            <div class="num">1</div>
            <b id="flow-1-title">检测位置</b>
            <span id="flow-1-desc">优先沿用旧版安装目录</span>
          </div>
          <div class="flow-item" id="flow-2">
            <div class="num">2</div>
            <b id="flow-2-title">写入组件</b>
            <span id="flow-2-desc">静默执行安装后端</span>
          </div>
          <div class="flow-item" id="flow-3">
            <div class="num">3</div>
            <b id="flow-3-title">创建入口</b>
            <span id="flow-3-desc">安装器创建桌面入口</span>
          </div>
        </div>
      </section>
      <div class="bottom">
        <div class="status-wrap">
          <div class="state" id="state"></div>
          <div class="progress" id="progress"><div class="bar" id="progress-bar"></div></div>
        </div>
        <div class="actions">
          <button class="btn" id="cancel">取消</button>
          <button class="btn primary" id="install">开始安装</button>
        </div>
      </div>
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

  const processCopy = () => installMode === 'update'
    ? '检测到已有版本，正在覆盖更新安装中'
    : '检测到首次安装，请稍后';

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

  /* Close via button */
  closeBtn.addEventListener('click', (e) => {{ e.preventDefault(); window.location.href = 'changli://close'; }});

  /* Cancel button */
  cancel.addEventListener('click', (e) => {{ e.preventDefault(); window.location.href = 'changli://close'; }});

  /* Choose directory */
  choose.addEventListener('click', (e) => {{ e.preventDefault(); window.location.href = 'changli://choose-dir'; }});

  /* Install button */
  install.addEventListener('click', (e) => {{ e.preventDefault(); window.location.href = install.classList.contains('launch') ? 'changli://launch-close' : 'changli://install'; }});

  /* Dragging on main area */
  document.addEventListener('mousedown', (e) => {{
    if (e.button !== 0) return;
    if (e.target.closest('button, input, label, .change-btn, .close-btn')) return;
    window.location.href = 'changli://drag';
  }});

  window.setInstalling = () => {{
    setPhase('install');
    titleBlock.className = 'title-block installing drag';
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
    install.classList.add('disabled');
    cancel.classList.add('disabled');
    closeBtn.classList.add('disabled');
    choose.classList.add('disabled');
    install.textContent = '安装中…';
    progress.classList.add('active');
    setProgress(1);

    progressTimer = setInterval(() => {{
      if (progressValue < 92) setProgress(progressValue + 1);
      else if (progressValue < 99 && Math.random() > .55) setProgress(progressValue + 1);
    }}, 90);
  }};

  window.setInstallDir = (value) => {{ dir.textContent = value; dir.title = value; }};

  window.installDone = (ok, code, message) => {{
    if (progressTimer) {{ clearInterval(progressTimer); progressTimer = null; }}
    if (ok) {{
      setPhase('done');
      installCard.className = 'card is-done flyout';
      titleBlock.className = 'title-block done drag';
      headline.innerHTML = '安装成功';
      subtitle.textContent = '';
      setProgress(100);
      install.textContent = '完成并启动';
      install.classList.add('launch');
      install.classList.remove('disabled');
      cancel.textContent = '完成';
      cancel.classList.remove('disabled');
      closeBtn.classList.remove('disabled');
    }} else {{
      progress.classList.remove('active');
      setPhase('fail');
      installCard.className = 'card';
      titleBlock.className = 'title-block drag';
      headline.innerHTML = '安装失败';
      subtitle.textContent = '';
      state.classList.add('active');
      state.textContent = message || ('安装失败' + (code == null ? '' : '，退出码 ' + code));
      progressBar.style.width = '1%';
      install.textContent = '重试';
      install.classList.remove('disabled');
      cancel.classList.remove('disabled');
      closeBtn.classList.remove('disabled');
      choose.classList.remove('disabled');
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
fn apply_true_transparent_window(_window: &tao::window::Window) {
    // 透明窗口方案不可靠，改用 CSS border-radius 实现圆角
    // 窗口背景色与 .shell 一致，圆角纯 CSS 实现
}

#[cfg(not(target_os = "windows"))]
fn apply_true_transparent_window(_window: &tao::window::Window) {}

fn main() -> wry::Result<()> {
    let event_loop = EventLoopBuilder::<InstallerEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let existing_dir = find_existing_install_dir();
    let is_update = existing_dir.is_some();
    let default_dir = existing_dir.unwrap_or_else(fallback_install_dir);

    let pos = event_loop.primary_monitor().map(|m| {
        let mp = m.position();
        let ms = m.size();
        let sf = m.scale_factor();
        let pw = (W as f64 * sf) as i32;
        let ph = (H as f64 * sf) as i32;
        PhysicalPosition::new(
            mp.x + (ms.width as i32 - pw) / 2,
            mp.y + (ms.height as i32 - ph) / 2,
        )
    });

    let mut builder = WindowBuilder::new()
        .with_title("ChangLi Installer")
        .with_decorations(false)
        .with_resizable(false)
        .with_visible(false)
        .with_inner_size(LogicalSize::new(W as f64, H as f64));
    if let Some(pos) = pos {
        builder = builder.with_position(pos);
    }
    let window = builder.build(&event_loop).expect("create installer window");
    apply_true_transparent_window(&window);

    let nav_proxy = proxy.clone();
    let mut web_context = WebContext::new(Some(webview_data_dir()));
    let webview = WebViewBuilder::with_web_context(&mut web_context)
        .with_bounds(Rect {
            position: WebLogicalPosition::new(0, 0).into(),
            size: WebLogicalSize::new(W, H).into(),
        })
        .with_background_color((240, 242, 247, 255))
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
            Event::UserEvent(InstallerEvent::InstallDone {
                success,
                code,
                message,
            }) => {
                let script = format!(
                    "window.installDone({}, {}, {});",
                    success,
                    code.map(|c| c.to_string()).unwrap_or_else(|| "null".into()),
                    serde_json::to_string(&message).unwrap_or_else(|_| "\"安装失败\"".into())
                );
                let _ = webview.evaluate_script(&script);
            }
            _ => {}
        }
    });
}
