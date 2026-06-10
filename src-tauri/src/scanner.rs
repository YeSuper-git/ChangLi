use anyhow::Result;
use std::path::Path;
use walkdir::WalkDir;

use crate::db::Video;

// 支持的视频格式
const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mkv", "avi", "flv", "mov", "wmv", "webm", "m4v", "mpg", "mpeg", "3gp",
    "ts", "rmvb", "rm", "vob", "asf", "f4v",
];

// 扫描目录
pub async fn scan_directory(path: &str) -> Result<Vec<Video>> {
    let path = Path::new(path);
    if !path.exists() {
        return Err(anyhow::anyhow!("目录不存在: {}", path.display()));
    }
    
    let mut videos = Vec::new();
    
    for entry in WalkDir::new(path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let file_path = entry.path();
        
        // 检查文件扩展名
        if let Some(ext) = file_path.extension() {
            let ext = ext.to_string_lossy().to_lowercase();
            if VIDEO_EXTENSIONS.contains(&ext.as_str()) {
                match scan_video_file(file_path).await {
                    Ok(video) => videos.push(video),
                    Err(e) => eprintln!("扫描文件失败 {}: {}", file_path.display(), e),
                }
            }
        }
    }
    
    Ok(videos)
}

// 扫描单个视频文件
async fn scan_video_file(path: &Path) -> Result<Video> {
    let file_name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    
    let file_size = std::fs::metadata(path)?.len() as i64;
    
    // 获取视频元数据
    let metadata = get_video_metadata(path).await.unwrap_or_default();
    
    Ok(Video {
        id: 0,
        file_path: path.to_string_lossy().to_string(),
        file_name,
        file_size: Some(file_size),
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
        resolution: metadata.resolution,
        source_site: None,
        metadata: None,
        thumbnail: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

// 视频元数据
#[derive(Default)]
struct VideoMetadata {
    duration: Option<f64>,
    width: Option<i32>,
    height: Option<i32>,
    resolution: Option<String>,
}

// 获取视频元数据
async fn get_video_metadata(path: &Path) -> Result<VideoMetadata> {
    let mut metadata = VideoMetadata::default();
    
    // 使用 mpv 获取元数据
    let mpv = libmpv::Mpv::new()?;
    mpv.command("loadfile", &[path.to_string_lossy().as_ref()])?;
    
    // 等待加载
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    
    // 获取时长
    if let Ok(duration) = mpv.get_property::<f64>("duration") {
        metadata.duration = Some(duration);
    }
    
    // 获取视频宽高
    if let Ok(width) = mpv.get_property::<i32>("width") {
        metadata.width = Some(width);
    }
    if let Ok(height) = mpv.get_property::<i32>("height") {
        metadata.height = Some(height);
    }
    
    // 生成分辨率字符串
    if let (Some(w), Some(h)) = (metadata.width, metadata.height) {
        metadata.resolution = Some(format!("{}x{}", w, h));
    }
    
    Ok(metadata)
}

// 生成缩略图
pub async fn generate_thumbnail(video_path: &str, output_path: &str) -> Result<()> {
    let path = Path::new(video_path);
    if !path.exists() {
        return Err(anyhow::anyhow!("视频文件不存在: {}", path.display()));
    }
    
    // 使用 mpv 生成缩略图
    let mpv = libmpv::Mpv::new()?;
    mpv.command("loadfile", &[video_path])?;
    
    // 等待加载
    tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
    
    // 跳转到视频中间位置
    if let Ok(duration) = mpv.get_property::<f64>("duration") {
        let seek_pos = duration / 2.0;
        mpv.command("seek", &[&seek_pos.to_string(), "absolute"])?;
    }
    
    // 等待seek完成
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    
    // 截图
    mpv.command("screenshot-to-file", &[output_path])?;
    
    // 等待截图完成
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    
    Ok(())
}

// 扫描并生成缩略图
pub async fn scan_and_generate_thumbnails(path: &str, thumbnail_dir: &str) -> Result<Vec<Video>> {
    let videos = scan_directory(path).await?;
    
    // 确保缩略图目录存在
    std::fs::create_dir_all(thumbnail_dir)?;
    
    for video in &videos {
        let thumbnail_name = format!("{}.jpg", video.id);
        let thumbnail_path = Path::new(thumbnail_dir).join(&thumbnail_name);
        
        match generate_thumbnail(&video.file_path, &thumbnail_path.to_string_lossy()).await {
            Ok(_) => {
                // 更新视频的缩略图路径
                // 注意：这里需要更新数据库，但我们在外部处理
            }
            Err(e) => {
                eprintln!("生成缩略图失败 {}: {}", video.file_name, e);
            }
        }
    }
    
    Ok(videos)
}
