use anyhow::{anyhow, Context, Result};
use std::path::PathBuf;
use std::process::Command;

fn candidate_mpv_paths(app: &tauri::AppHandle) -> Vec<PathBuf> {
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

pub fn play(app: &tauri::AppHandle, path: &str) -> Result<()> {
    let video_path = PathBuf::from(path);
    if !video_path.exists() || !video_path.is_file() {
        return Err(anyhow!("视频文件不存在: {}", path));
    }

    let mut last_error: Option<anyhow::Error> = None;
    for mpv_path in candidate_mpv_paths(app) {
        if !mpv_path.exists() || !mpv_path.is_file() {
            continue;
        }

        match spawn_mpv(&mpv_path, &video_path) {
            Ok(()) => return Ok(()),
            Err(error) => last_error = Some(error),
        }
    }

    // 开发环境兜底：允许使用 PATH 中的 mpv，正式 Windows 构建会随安装包内置 mpv。
    match spawn_mpv(&PathBuf::from("mpv"), &video_path) {
        Ok(()) => Ok(()),
        Err(error) => Err(last_error.unwrap_or(error)).context(
            "无法启动 mpv。请确认安装包已内置 mpv，或本机 PATH 中存在 mpv；也可以设置 CHANGLI_MPV_PATH 指向 mpv.exe。",
        ),
    }
}

fn spawn_mpv(mpv_path: &PathBuf, video_path: &PathBuf) -> Result<()> {
    Command::new(mpv_path)
        .arg(video_path)
        .arg("--force-window=yes")
        .arg("--hwdec=auto-safe")
        .arg("--osc=yes")
        .arg("--input-default-bindings=yes")
        .arg("--keep-open=no")
        .arg("--title=ChangLi - ${media-title}")
        .spawn()
        .with_context(|| format!("启动 mpv 失败: {}", mpv_path.display()))?;
    Ok(())
}
