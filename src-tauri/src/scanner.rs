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
    
    Ok(Video {
        id: 0,
        file_path: path.to_string_lossy().to_string(),
        file_name,
        file_size: Some(file_size),
        duration: None,
        width: None,
        height: None,
        resolution: None,
        source_site: None,
        metadata: None,
        thumbnail: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}
