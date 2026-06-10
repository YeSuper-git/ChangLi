use anyhow::Result;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use std::collections::HashMap;

use crate::db::Video;

// 支持的视频格式
const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mkv", "avi", "flv", "mov", "wmv", "webm", "m4v", "mpg", "mpeg", "3gp",
    "ts", "rmvb", "rm", "vob", "asf", "f4v",
];

// 支持的图片格式
const IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "bmp", "gif",
];

// 扫描结果
#[derive(Debug)]
pub struct ScanResult {
    pub videos: Vec<Video>,
    pub posters: HashMap<String, String>, // file_path -> poster_path
}

// 扫描目录（支持子文件夹，最小文件夹为一部作品）
pub async fn scan_directory(path: &str) -> Result<ScanResult> {
    let path = Path::new(path);
    if !path.exists() {
        return Err(anyhow::anyhow!("目录不存在: {}", path.display()));
    }
    
    let mut videos = Vec::new();
    let mut posters = HashMap::new();
    
    // 收集所有视频文件和图片文件
    let mut video_files: Vec<PathBuf> = Vec::new();
    let mut image_files: Vec<PathBuf> = Vec::new();
    
    for entry in WalkDir::new(path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let file_path = entry.path();
        
        if let Some(ext) = file_path.extension() {
            let ext = ext.to_string_lossy().to_lowercase();
            
            if VIDEO_EXTENSIONS.contains(&ext.as_str()) {
                video_files.push(file_path.to_path_buf());
            } else if IMAGE_EXTENSIONS.contains(&ext.as_str()) {
                image_files.push(file_path.to_path_buf());
            }
        }
    }
    
    // 按文件夹分组视频文件
    let mut folder_videos: HashMap<PathBuf, Vec<PathBuf>> = HashMap::new();
    
    for video_path in &video_files {
        if let Some(parent) = video_path.parent() {
            folder_videos
                .entry(parent.to_path_buf())
                .or_insert_with(Vec::new)
                .push(video_path.clone());
        }
    }
    
    // 处理每个文件夹
    for (folder, videos_in_folder) in &folder_videos {
        let folder_name = folder
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        
        // 查找该文件夹的海报图片
        let poster_path = find_poster_for_folder(folder, &folder_name, &image_files);
        
        // 为每个视频文件创建记录
        for video_path in videos_in_folder {
            match scan_video_file(video_path, poster_path.as_deref()).await {
                Ok(video) => {
                    // 记录海报映射
                    if let Some(ref poster) = poster_path {
                        posters.insert(video.file_path.clone(), poster.clone());
                    }
                    videos.push(video);
                }
                Err(e) => eprintln!("扫描文件失败 {}: {}", video_path.display(), e),
            }
        }
    }
    
    Ok(ScanResult { videos, posters })
}

// 查找文件夹的海报图片
fn find_poster_for_folder(
    folder: &Path,
    folder_name: &str,
    image_files: &[PathBuf],
) -> Option<String> {
    // 策略1：查找与文件夹同名的图片
    for image_path in image_files {
        if let Some(image_parent) = image_path.parent() {
            if image_parent == folder {
                let image_stem = image_path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_lowercase();
                
                if image_stem == folder_name.to_lowercase() {
                    return Some(image_path.to_string_lossy().to_string());
                }
            }
        }
    }
    
    // 策略2：查找文件夹内的第一张图片
    for image_path in image_files {
        if let Some(image_parent) = image_path.parent() {
            if image_parent == folder {
                return Some(image_path.to_string_lossy().to_string());
            }
        }
    }
    
    None
}

// 扫描单个视频文件
async fn scan_video_file(path: &Path, poster: Option<&str>) -> Result<Video> {
    let file_name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    
    let file_size = std::fs::metadata(path)?.len() as i64;
    
    // 从文件名提取集数信息
    let episode = extract_episode_from_filename(&file_name);
    
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
        metadata: episode.map(|ep| serde_json::json!({"episode": ep})),
        thumbnail: poster.map(|p| p.to_string()),
        description: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

// 从文件名提取集数
fn extract_episode_from_filename(filename: &str) -> Option<i32> {
    let filename_lower = filename.to_lowercase();
    
    // 常见的集数格式
    let patterns = [
        r"(?i)ep?\.?\s*(\d+)",           // EP01, E01, ep01
        r"(?i)第\s*(\d+)\s*[集话]",       // 第01集, 第01话
        r"(?i)\[(\d+)\]",                // [01]
        r"(?i)_(\d+)_",                  // _01_
        r"(?i)\s(\d{2,})\s",             // 空格包围的数字
        r"(?i)\.(\d{2,})\.",             // 点包围的数字
    ];
    
    for pattern in &patterns {
        if let Ok(re) = regex::Regex::new(pattern) {
            if let Some(caps) = re.captures(&filename_lower) {
                if let Some(m) = caps.get(1) {
                    if let Ok(ep) = m.as_str().parse::<i32>() {
                        return Some(ep);
                    }
                }
            }
        }
    }
    
    None
}

// 获取文件夹结构（用于前端展示）
pub async fn get_folder_structure(path: &str) -> Result<Vec<FolderInfo>> {
    let path = Path::new(path);
    if !path.exists() {
        return Err(anyhow::anyhow!("目录不存在: {}", path.display()));
    }
    
    let mut folders = Vec::new();
    
    for entry in WalkDir::new(path)
        .min_depth(1)
        .max_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_dir())
    {
        let folder_path = entry.path();
        let folder_name = folder_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        
        // 统计该文件夹下的视频数量
        let video_count = count_videos_in_folder(folder_path);
        
        folders.push(FolderInfo {
            name: folder_name,
            path: folder_path.to_string_lossy().to_string(),
            video_count,
        });
    }
    
    Ok(folders)
}

// 统计文件夹下的视频数量
fn count_videos_in_folder(path: &Path) -> usize {
    let mut count = 0;
    
    for entry in WalkDir::new(path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        if let Some(ext) = entry.path().extension() {
            let ext = ext.to_string_lossy().to_lowercase();
            if VIDEO_EXTENSIONS.contains(&ext.as_str()) {
                count += 1;
            }
        }
    }
    
    count
}

// 文件夹信息
#[derive(Debug, serde::Serialize)]
pub struct FolderInfo {
    pub name: String,
    pub path: String,
    pub video_count: usize,
}
