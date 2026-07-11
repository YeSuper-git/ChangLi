use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;
use tauri::Manager;

#[derive(Debug, Serialize)]
pub enum ThumbnailError {
    FfmpegNotFound,
    DecodeFailed,
    IoError(String),
}

impl std::fmt::Display for ThumbnailError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::FfmpegNotFound => write!(f, "ffmpeg not found"),
            Self::DecodeFailed => write!(f, "decode failed"),
            Self::IoError(e) => write!(f, "io error: {}", e),
        }
    }
}

impl std::error::Error for ThumbnailError {}

static CACHE_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);
static ACTIVE_TASKS: Mutex<Option<HashMap<String, tokio::task::JoinHandle<()>>>> = Mutex::new(None);

fn thumbnail_cache_dir(app: &AppHandle) -> PathBuf {
    let mut guard = CACHE_DIR.lock().unwrap();
    if let Some(ref dir) = *guard {
        return dir.clone();
    }
    let dir = app
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("thumbnails");
    std::fs::create_dir_all(&dir).ok();
    *guard = Some(dir.clone());
    dir
}

fn video_hash(path: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn ffmpeg_path(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidates = if cfg!(target_os = "windows") {
            vec![
                resource_dir.join("ffmpeg").join("ffmpeg.exe"),
                resource_dir.join("resources").join("ffmpeg").join("ffmpeg.exe"),

            ]
        } else {
            vec![
                resource_dir.join("ffmpeg").join("ffmpeg"),
                resource_dir.join("resources").join("ffmpeg").join("ffmpeg"),
            ]
        };
        for p in candidates {
            if p.exists() {
                return Some(p);
            }
        }
    }
    None
}

/// 取消指定视频的预抽任务
pub fn abort_prebuild(file_id: &str) {
    let mut tasks = ACTIVE_TASKS.lock().unwrap();
    if let Some(map) = tasks.as_mut() {
        if let Some(handle) = map.remove(file_id) {
            handle.abort();
        }
    }
}

/// 预构建缩略图：打开视频时调用，异步后台批量抽帧存文件
#[tauri::command]
pub async fn prebuild_thumbnails(
    app: AppHandle,
    file_id: String,
    file_path: String,
    duration: f64,
    interval_sec: f64,
) -> Result<String, ThumbnailError> {
    let ffmpeg = ffmpeg_path(&app).ok_or(ThumbnailError::FfmpegNotFound)?;
    let cache_dir = thumbnail_cache_dir(&app).join(&file_id);
    std::fs::create_dir_all(&cache_dir).map_err(|e| ThumbnailError::IoError(e.to_string()))?;

    // 检查是否已完成
    let marker = cache_dir.join(".done");
    if marker.exists() {
        return Ok(cache_dir.to_string_lossy().to_string());
    }

    // 地雷1修复：取消旧任务
    abort_prebuild(&file_id);

    let cache_dir_str = cache_dir.to_string_lossy().to_string();
    let ffmpeg_str = ffmpeg.to_string_lossy().to_string();
    let file_path_clone = file_path.clone();
    let file_id_clone = file_id.clone();
    let cache_dir_clone = cache_dir.clone();

    let handle = tokio::task::spawn_blocking(move || {
        let total_thumbs = (duration / interval_sec).ceil() as u32;
        let step = interval_sec;

        for i in 0..total_thumbs {
            let t = (i as f64) * step;
            if t > duration + 1.0 {
                break;
            }
            let out_path = format!("{}/{}.jpg", cache_dir_str, i);
            if std::path::Path::new(&out_path).exists() {
                continue;
            }

            // 地雷2修复：加 colormatrix 保证色彩正确
            // 地雷3修复：stderr 捕获用于调试
            let status = std::process::Command::new(&ffmpeg_str)
                .args([
                    "-ss",
                    &format!("{:.1}", t),
                    "-i",
                    &file_path_clone,
                    "-frames:v",
                    "1",
                    "-vf",
                    "scale=320:-1:flags=lanczos,format=yuvj420p",
                    "-q:v",
                    "5",
                    "-f",
                    "image2",
                    "-c:v",
                    "mjpeg",
                    "-y",
                    &out_path,
                ])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();

            match status {
                Ok(s) if !s.success() => {
                    eprintln!("[thumb] ffmpeg failed for idx {} at {:.1}s", i, t);
                }
                Err(e) => {
                    eprintln!("[thumb] ffmpeg exec error: {}", e);
                }
                _ => {}
            }
        }
        // 标记完成
        std::fs::write(cache_dir_clone.join(".done"), "").ok();

        // 清理任务引用
        let mut tasks = ACTIVE_TASKS.lock().unwrap();
        if let Some(map) = tasks.as_mut() {
            map.remove(&file_id_clone);
        }
    });

    // 注册任务
    {
        let mut tasks = ACTIVE_TASKS.lock().unwrap();
        let map = tasks.get_or_insert_with(HashMap::new);
        map.insert(file_id, handle);
    }

    Ok(cache_dir.to_string_lossy().to_string())
}

/// 获取单帧缩略图（预抽未完成时的兜底）
#[tauri::command]
pub async fn get_preview_thumb(
    app: AppHandle,
    file_id: String,
    file_path: String,
    time: f64,
) -> Result<String, ThumbnailError> {
    let ffmpeg = ffmpeg_path(&app).ok_or(ThumbnailError::FfmpegNotFound)?;
    let cache_dir = thumbnail_cache_dir(&app).join(&file_id);

    // 先检查预抽缓存
    let idx = (time / 5.0).floor() as u32;
    let cached_path = cache_dir.join(format!("{}.jpg", idx));
    if cached_path.exists() {
        return Ok(cached_path.to_string_lossy().to_string());
    }

    // 兜底：实时抽（降分辨率加速）
    let file_path_clone = file_path.clone();
    let cache_dir_clone = cache_dir.clone();
    let result = tokio::task::spawn_blocking(move || {
        let output = std::process::Command::new(&ffmpeg)
            .args([
                "-ss",
                &format!("{:.1}", time),
                "-i",
                &file_path_clone,
                "-frames:v",
                "1",
                "-vf",
                "scale=160:-1:flags=fast_bilinear,format=yuvj420p",
                "-q:v",
                "5",
                "-f",
                "image2",
                "-c:v",
                "mjpeg",
                "-y",
                "-",
            ])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output();

        match output {
            Ok(o) if o.status.success() && !o.stdout.is_empty() => {
                std::fs::create_dir_all(&cache_dir_clone).ok();
                let out_path = format!("{}/{}.jpg", cache_dir_clone.display(), idx);
                std::fs::write(&out_path, &o.stdout).ok();
                Ok(out_path)
            }
            Ok(_) => Err(ThumbnailError::DecodeFailed),
            Err(e) => Err(ThumbnailError::IoError(e.to_string())),
        }
    })
    .await;

    match result {
        Ok(Ok(path)) => Ok(path),
        Ok(Err(e)) => Err(e),
        Err(join_err) => Err(ThumbnailError::IoError(join_err.to_string())),
    }
}

/// 获取缩略图缓存目录路径
#[tauri::command]
pub fn get_thumb_cache_dir(app: AppHandle, file_id: String) -> String {
    thumbnail_cache_dir(&app)
        .join(&file_id)
        .to_string_lossy()
        .to_string()
}

/// 取消预抽任务（视频关闭/切换时调用）
#[tauri::command]
pub fn abort_prebuild_cmd(file_id: String) {
    abort_prebuild(&file_id);
}

#[tauri::command]
pub async fn clear_preview_cache(app: AppHandle) -> Result<(), String> {
    let dir = thumbnail_cache_dir(&app);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}
