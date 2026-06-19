use anyhow::Result;
use base64::Engine;
use image::ImageReader;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use crate::db::Video;

/// 生成缩略图 Base64（最大 300px 宽，≤50KB）
pub fn generate_thumbnail_base64(poster_path: &Path) -> Option<String> {
    let reader = match ImageReader::open(poster_path) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[Scanner] open failed: {} ({})", poster_path.display(), e);
            return None;
        }
    };

    let img = match reader.decode() {
        Ok(i) => i,
        Err(e) => {
            eprintln!("[Decoder] Failed to decode image: {} ({:?})", poster_path.display(), e);
            return None;
        }
    };

    // 缩放到最大 300px 宽
    let max_width = 300;
    let resized = if img.width() > max_width {
        img.resize(max_width, max_width * img.height() / img.width(), image::imageops::FilterType::Lanczos3)
    } else {
        img
    };

    // 编码为 JPEG，质量控制在 50KB 以内
    let mut buf = Vec::new();
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 70);
    resized.write_with_encoder(encoder).ok()?;

    // 如果超过 50KB，降低质量再试
    if buf.len() > 50 * 1024 {
        let mut buf2 = Vec::new();
        let encoder2 = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf2, 50);
        resized.write_with_encoder(encoder2).ok()?;
        if buf2.len() <= 50 * 1024 {
            buf = buf2;
        }
    }

    let encoded = base64::engine::general_purpose::STANDARD.encode(&buf);
    Some(format!("data:image/jpeg;base64,{}", encoded))
}

/// 读取图片尺寸并判断方向：portrait / landscape / square
pub fn get_image_orientation(poster_path: &Path) -> Option<String> {
    let reader = match ImageReader::open(poster_path) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[Scanner] open failed for dimensions: {} ({})", poster_path.display(), e);
            return None;
        }
    };

    let (w, h) = match reader.into_dimensions() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[Decoder] Failed to read dimensions: {} ({:?})", poster_path.display(), e);
            return None;
        }
    };

    let orientation = if h as f64 > w as f64 * 1.15 {
        "portrait"
    } else if w as f64 > h as f64 * 1.15 {
        "landscape"
    } else {
        "square"
    };
    Some(orientation.to_string())
}

// 支持的视频格式
const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mkv", "avi", "flv", "mov", "wmv", "webm", "m4v", "mpg", "mpeg", "3gp", "ts", "rmvb",
    "rm", "vob", "asf", "f4v",
];

pub fn is_video_file(path: &Path) -> bool {
    path.extension()
        .map(|ext| VIDEO_EXTENSIONS.contains(&ext.to_string_lossy().to_lowercase().as_str()))
        .unwrap_or(false)
}

// 支持的图片格式
const IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "bmp", "gif", "avif", "svg", "tif", "tiff", "ico",
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

    // 检测是否有多季结构：根目录下存在包含视频的子文件夹
    let mut subdirs: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.filter_map(|e| e.ok()) {
            if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                subdirs.push(entry.path());
            }
        }
    }

    if subdirs.is_empty() {
        // 扁平模式：没有子文件夹，直接扫描根目录
        process_directory_videos(path, None, None, &mut videos, &mut posters).await?;
    } else {
        // 多季模式：每个子文件夹为一季或剧场版
        // 按文件夹名称排序，保证季数顺序一致
        subdirs.sort_by(|a, b| {
            let a_name = a
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase();
            let b_name = b
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase();
            a_name.cmp(&b_name)
        });

        let mut season_counter = 0;
        for subdir in &subdirs {
            let count = count_videos_in_folder(subdir);
            if count == 0 {
                continue;
            }

            // ≤3 部作品 → 剧场版（season = 999），多部 → 正常季
            let (season, subtitle) = if count <= 3 {
                let movie_title = subdir.file_name().unwrap_or_default().to_string_lossy().to_string();
                (999, Some(movie_title))
            } else {
                season_counter += 1;
                (season_counter, None)
            };
            process_directory_videos(subdir, Some(season), subtitle.as_deref(), &mut videos, &mut posters).await?;
        }
    }

    Ok(ScanResult { videos, posters })
}

/// 处理指定目录下的所有视频，按父文件夹分组并分配集数和季数。
async fn process_directory_videos(
    dir: &Path,
    season: Option<i32>,
    subtitle: Option<&str>,
    videos: &mut Vec<Video>,
    posters: &mut HashMap<String, String>,
) -> Result<()> {
    // 收集该目录下所有视频和图片文件
    let mut video_files: Vec<PathBuf> = Vec::new();
    let mut image_files: Vec<PathBuf> = Vec::new();

    for entry in WalkDir::new(dir)
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

    // 按父文件夹分组
    let mut folder_videos: HashMap<PathBuf, Vec<PathBuf>> = HashMap::new();
    for video_path in &video_files {
        if let Some(parent) = video_path.parent() {
            folder_videos
                .entry(parent.to_path_buf())
                .or_insert_with(Vec::new)
                .push(video_path.clone());
        }
    }

    // 处理每个文件夹。排序规则：如果同一文件夹下所有视频文件名（不含扩展名）都是
    // 固定两位数字 01、02、03，则按数字集数排序；否则按文件名自然排序。
    for (folder, videos_in_folder) in &folder_videos {
        let folder_name = folder
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        let folder_poster_path = find_poster_for_folder(folder, &folder_name, &image_files);
        let mut sorted_videos = videos_in_folder.clone();
        sort_episode_files(&mut sorted_videos);

        for (index, video_path) in sorted_videos.iter().enumerate() {
            let poster_path = find_poster_for_video(video_path, &image_files)
                .or_else(|| folder_poster_path.clone());
            match scan_video_file(video_path, poster_path.as_deref()).await {
                Ok(mut video) => {
                    video.season = season;
                    video.subtitle = subtitle.map(|s| s.to_string());
                    if folder_uses_fixed_episode_names(&sorted_videos) {
                        video.episode_number = video_path
                            .file_stem()
                            .and_then(|stem| stem.to_str())
                            .and_then(|stem| stem.parse::<i32>().ok());
                    } else if video.episode_number.is_none() {
                        video.episode_number = Some((index + 1) as i32);
                    }
                    if let Some(ref poster) = poster_path {
                        posters.insert(video.file_path.clone(), poster.clone());
                    }
                    videos.push(video);
                }
                Err(e) => eprintln!("扫描文件失败 {}: {}", video_path.display(), e),
            }
        }
    }

    Ok(())
}

fn file_stem_lower(path: &Path) -> String {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or_default()
        .to_lowercase()
}

fn fixed_episode_from_path(path: &Path) -> Option<i32> {
    let stem = path.file_stem()?.to_str()?;
    if !stem.is_empty() && stem.chars().all(|c| c.is_ascii_digit()) {
        stem.parse::<i32>().ok()
    } else {
        None
    }
}

fn folder_uses_fixed_episode_names(files: &[PathBuf]) -> bool {
    !files.is_empty()
        && files
            .iter()
            .all(|path| fixed_episode_from_path(path).is_some())
}

fn sort_episode_files(files: &mut Vec<PathBuf>) {
    if folder_uses_fixed_episode_names(files) {
        files.sort_by_key(|path| fixed_episode_from_path(path).unwrap_or(i32::MAX));
    } else {
        files.sort_by_key(|path| file_stem_lower(path));
    }
}

fn find_poster_for_video(video_path: &Path, image_files: &[PathBuf]) -> Option<String> {
    let video_parent = video_path.parent()?;
    let video_stem = file_stem_lower(video_path);
    image_files.iter().find_map(|image_path| {
        if image_path.parent() == Some(video_parent) && file_stem_lower(image_path) == video_stem {
            Some(image_path.to_string_lossy().to_string())
        } else {
            None
        }
    })
}

fn find_poster_next_to_video(video_path: &Path) -> Option<String> {
    let parent = video_path.parent()?;
    let stem = video_path.file_stem()?.to_str()?;
    for ext in IMAGE_EXTENSIONS {
        let candidate = parent.join(format!("{stem}.{ext}"));
        if candidate.exists() && candidate.is_file() {
            return Some(candidate.to_string_lossy().to_string());
        }
        let upper = parent.join(format!("{stem}.{}", ext.to_uppercase()));
        if upper.exists() && upper.is_file() {
            return Some(upper.to_string_lossy().to_string());
        }
    }
    None
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
pub async fn scan_video_file(path: &Path, poster: Option<&str>) -> Result<Video> {
    let file_name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let file_size = std::fs::metadata(path)?.len() as i64;

    // 从文件名提取集数信息。固定两位数字文件名 01/02/03 直接作为集数。
    let episode =
        fixed_episode_from_path(path).or_else(|| extract_episode_from_filename(&file_name));
    let poster = poster
        .map(|p| p.to_string())
        .or_else(|| find_poster_next_to_video(path));

    // 生成缩略图 Base64（入库时生成一次，后续读取直接返回）
    let thumbnail_base64 = poster
        .as_ref()
        .and_then(|p| generate_thumbnail_base64(Path::new(p)));

    // 根据海报图片尺寸判断方向
    let poster_orientation = poster
        .as_ref()
        .and_then(|p| get_image_orientation(Path::new(p)));

    Ok(Video {
        id: 0,
        file_path: path.to_string_lossy().to_string(),
        file_name,
        series_id: None,
        episode_number: episode,
        file_size: Some(file_size),
        season: None,
        subtitle: None,
        duration: None,
        width: None,
        height: None,
        resolution: None,
        source_site: None,
        metadata: None,
        thumbnail: poster,
        thumbnail_base64,
        thumbnail_data_url: None,
        series_title: None,
        series_poster_data_url: None,
        description: None,
        poster_orientation,
        created_at: chrono::Utc::now().to_rfc3339(),
        is_favorite: None,
    })
}

// 从文件名提取集数
pub fn extract_episode_from_filename(filename: &str) -> Option<i32> {
    let filename_lower = filename.to_lowercase();

    // 常见的集数格式
    let patterns = [
        r"(?i)ep?\.?\s*(\d+)",      // EP01, E01, ep01
        r"(?i)第\s*(\d+)\s*[集话]", // 第01集, 第01话
        r"(?i)\[(\d+)\]",           // [01]
        r"(?i)_(\d+)_",             // _01_
        r"(?i)_(\d+)$",             // _136（下划线后跟数字到末尾）
        r"(?i)\s(\d{2,})\s",        // 空格包围的数字
        r"(?i)\.(\d{2,})\.",        // 点包围的数字
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("changli-scanner-{name}-{suffix}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[tokio::test]
    async fn fixed_two_digit_filenames_define_episode_order() -> Result<()> {
        let dir = temp_dir("episodes");
        fs::write(dir.join("02.mp4"), b"two")?;
        fs::write(dir.join("01.mp4"), b"one")?;

        let result = scan_directory(dir.to_str().unwrap()).await?;
        let episodes: Vec<_> = result
            .videos
            .iter()
            .map(|video| (video.file_name.clone(), video.episode_number))
            .collect();

        assert_eq!(episodes[0], ("01.mp4".to_string(), Some(1)));
        assert_eq!(episodes[1], ("02.mp4".to_string(), Some(2)));

        fs::remove_dir_all(dir).ok();
        Ok(())
    }

    #[tokio::test]
    async fn same_stem_image_is_selected_before_folder_poster() -> Result<()> {
        let dir = temp_dir("poster");
        let video_path = dir.join("movie.mp4");
        let same_stem = dir.join("movie.jpg");
        let folder_poster = dir.join(
            dir.file_name()
                .and_then(|name| name.to_str())
                .unwrap()
                .to_string()
                + ".jpg",
        );
        fs::write(&video_path, b"video")?;
        fs::write(&same_stem, b"same")?;
        fs::write(&folder_poster, b"folder")?;

        let video = scan_video_file(&video_path, None).await?;
        assert_eq!(video.thumbnail.as_deref(), Some(same_stem.to_str().unwrap()));

        fs::remove_dir_all(dir).ok();
        Ok(())
    }
}
