use base64::Engine;
use lru::LruCache;
use serde::Serialize;
use std::num::NonZeroUsize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;
use tauri::Manager;

#[derive(Debug, Serialize)]
pub enum ThumbnailError {
    FfmpegNotFound,
    DecodeFailed,
    Timeout,
    IoError(String),
}

impl std::fmt::Display for ThumbnailError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::FfmpegNotFound => write!(f, "ffmpeg not found"),
            Self::DecodeFailed => write!(f, "decode failed"),
            Self::Timeout => write!(f, "timeout"),
            Self::IoError(e) => write!(f, "io error: {}", e),
        }
    }
}

impl std::error::Error for ThumbnailError {}

type CacheKey = (String, u32); // (file_id, time_bucket)

struct ThumbnailCache {
    cache: LruCache<CacheKey, String>,
}

impl ThumbnailCache {
    fn new() -> Self {
        Self {
            cache: LruCache::new(NonZeroUsize::new(1000).unwrap()),
        }
    }

    fn get(&mut self, key: &CacheKey) -> Option<String> {
        self.cache.get(key).cloned()
    }

    fn put(&mut self, key: CacheKey, value: String) {
        self.cache.put(key, value);
    }

    fn clear(&mut self) {
        self.cache.clear();
    }
}

static CACHE: Mutex<Option<ThumbnailCache>> = Mutex::new(None);

fn get_cache() -> std::sync::MutexGuard<'static, Option<ThumbnailCache>> {
    CACHE.lock().unwrap()
}

fn time_bucket(time: f64) -> u32 {
    (time / 2.0).floor() as u32
}

fn ffmpeg_path(app: &AppHandle) -> Option<PathBuf> {
    // Try resources/ffmpeg/ffmpeg.exe first
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

#[tauri::command]
pub async fn get_preview_thumb(
    app: AppHandle,
    file_id: String,
    file_path: String,
    time: f64,
) -> Result<String, ThumbnailError> {
    let bucket = time_bucket(time);
    let key = (file_id.clone(), bucket);

    // Check cache
    {
        let mut cache_guard = get_cache();
        let cache = cache_guard.get_or_insert_with(ThumbnailCache::new);
        if let Some(cached) = cache.get(&key) {
            return Ok(cached.clone());
        }
    }

    // Find ffmpeg
    let ffmpeg = ffmpeg_path(&app).ok_or(ThumbnailError::FfmpegNotFound)?;

    // Run ffmpeg in blocking thread
    let file_path_clone = file_path.clone();
    let result = tokio::task::spawn_blocking(move || {
        let output = std::process::Command::new(&ffmpeg)
            .args([
                "-ss",
                &format!("{:.3}", time),
                "-i",
                &file_path_clone,
                "-vf",
                "scale=160:-2:flags=fast_bilinear",
                "-frames:v",
                "1",
                "-q:v",
                "3",
                "-f",
                "image2pipe:1",
                "-c:v",
                "png",
                "-y",
                "-",
            ])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output();

        match output {
            Ok(o) if o.status.success() && !o.stdout.is_empty() => Ok(o.stdout),
            Ok(o) if o.status.success() => Err(ThumbnailError::DecodeFailed),
            Ok(_) => Err(ThumbnailError::DecodeFailed),
            Err(e) => Err(ThumbnailError::IoError(e.to_string())),
        }
    })
    .await;

    match result {
        Ok(Ok(png_bytes)) => {
            let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
            // Store in cache
            {
                let mut cache_guard = get_cache();
                let cache = cache_guard.get_or_insert_with(ThumbnailCache::new);
                cache.put(key, b64.clone());
            }
            Ok(b64)
        }
        Ok(Err(ThumbnailError::DecodeFailed)) => Ok(String::new()),
        Ok(Err(e)) => Err(e),
        Err(join_err) => Err(ThumbnailError::IoError(join_err.to_string())),
    }
}

#[tauri::command]
pub async fn clear_preview_cache() -> Result<(), String> {
    let mut cache_guard = get_cache();
    if let Some(cache) = cache_guard.as_mut() {
        cache.clear();
    }
    Ok(())
}
