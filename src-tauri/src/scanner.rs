use anyhow::Result;
use base64::Engine;
use image::ImageReader;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use crate::db::Video;

fn image_mime_from_extension(path: &Path) -> &'static str {
    match path.extension().and_then(|ext| ext.to_str()).unwrap_or_default().to_lowercase().as_str() {
        "png" => "image/png",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "gif" => "image/gif",
        _ => "image/jpeg",
    }
}

fn raw_image_data_url(poster_path: &Path) -> Option<String> {
    let bytes = std::fs::read(poster_path).ok()?;
    if bytes.is_empty() {
        return None;
    }
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{};base64,{}", image_mime_from_extension(poster_path), encoded))
}

/// 生成海报缓存 Base64（最大 600px 宽）。如果图片解码失败，回退为原图 data URL，避免本地海报路径存在但缓存为空。
pub fn generate_thumbnail_base64(poster_path: &Path) -> Option<String> {
    let reader = match ImageReader::open(poster_path) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[Scanner] open failed: {} ({})", poster_path.display(), e);
            return raw_image_data_url(poster_path);
        }
    };

    let img = match reader.decode() {
        Ok(i) => i,
        Err(e) => {
            eprintln!(
                "[Decoder] Failed to decode image: {} ({:?})",
                poster_path.display(),
                e
            );
            return raw_image_data_url(poster_path);
        }
    };

    // 缩放到最大 600px 宽，兼顾详情页清晰度和保存/刷新后的 IPC 负担。
    let max_width = 600;
    let resized = if img.width() > max_width {
        img.resize(
            max_width,
            max_width * img.height() / img.width(),
            image::imageops::FilterType::Lanczos3,
        )
    } else {
        img
    };

    // 编码为 JPEG，质量控制在 50KB 以内
    let mut buf = Vec::new();
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 70);
    if resized.write_with_encoder(encoder).is_err() {
        return raw_image_data_url(poster_path);
    }

    // 如果超过 50KB，降低质量再试
    if buf.len() > 50 * 1024 {
        let mut buf2 = Vec::new();
        let encoder2 = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf2, 50);
        if resized.write_with_encoder(encoder2).is_ok() && buf2.len() <= 50 * 1024 {
            buf = buf2;
        }
    }

    let encoded = base64::engine::general_purpose::STANDARD.encode(&buf);
    Some(format!("data:image/jpeg;base64,{}", encoded))
}

/// 读取图片尺寸并判断方向：portrait / landscape / square。读取失败时给默认 landscape，避免海报方向为空导致前端展示分支异常。
pub fn get_image_orientation(poster_path: &Path) -> Option<String> {
    let reader = match ImageReader::open(poster_path) {
        Ok(r) => r,
        Err(e) => {
            eprintln!(
                "[Scanner] open failed for dimensions: {} ({})",
                poster_path.display(),
                e
            );
            return Some("landscape".to_string());
        }
    };

    let img = match reader.decode() {
        Ok(i) => i,
        Err(e) => {
            eprintln!(
                "[Decoder] Failed to decode image dimensions: {} ({:?})",
                poster_path.display(),
                e
            );
            return Some("landscape".to_string());
        }
    };

    let width = img.width();
    let height = img.height();

    if height > width {
        Some("portrait".to_string())
    } else if width > height {
        Some("landscape".to_string())
    } else {
        Some("square".to_string())
    }
}

// 支持的视频格式
pub const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mkv", "avi", "flv", "mov", "wmv", "webm", "m4v", "mpg", "mpeg", "3gp", "ts", "rmvb",
    "rm", "vob", "asf", "f4v",
];

pub fn is_video_file(path: &Path) -> bool {
    path.extension()
        .map(|ext| VIDEO_EXTENSIONS.contains(&ext.to_string_lossy().to_lowercase().as_str()))
        .unwrap_or(false)
}

// 支持的图片格式
pub const IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "bmp", "gif", "avif", "svg", "tif", "tiff", "ico",
];

/// 去除文件夹名末尾的 " 1-N" 集数标记，返回基础名称用于匹配。
/// 例如 "xxxx 1-3" → "xxxx", "xxxx 1-25" → "xxxx", "xxxx" → "xxxx"
pub fn strip_episode_suffix(name: &str) -> String {
    let trimmed = name.trim();
    // 匹配末尾 " 数字-数字季?" 或 " 数字集" 等模式（支持有空格和无空格）
    // 1) 先尝试有空格: "xxx 1-2季"
    if let Some(pos) = trimmed.rfind(' ') {
        let suffix = &trimmed[pos + 1..];
        let clean_suffix = suffix.trim_end_matches('季');
        if clean_suffix.chars().all(|c| c.is_ascii_digit() || c == '-')
            && clean_suffix.contains('-')
        {
            return trimmed[..pos].to_string();
        }
    }
    // 2) 再尝试无空格: "xxx1-2季" / "xxx1-3季"
    // 从末尾找 "数字-数字季" 模式
    let chars: Vec<char> = trimmed.chars().collect();
    let len = chars.len();
    if len >= 4 {
        // 从末尾往前找，跳过 "季"
        let mut end = len;
        if end > 0 && chars[end - 1] == '季' {
            end -= 1;
        }
        // 往前读数字和横杠
 let mut start = end;
        while start > 0 && (chars[start - 1].is_ascii_digit() || chars[start - 1] == '-') {
            start -= 1;
        }
        if start < end && start > 0 {
            let suffix: String = chars[start..end].iter().collect();
            if suffix.contains('-') && suffix.chars().all(|c| c.is_ascii_digit() || c == '-') {
                return chars[..start].iter().collect();
            }
        }
    }
    trimmed.to_string()
}

// 扫描结果
#[derive(Debug)]
pub struct ScanResult {
    pub videos: Vec<Video>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum SeriesSubfolderKind {
    Season(i32),
    Movie,
    Unknown,
}

pub fn classify_series_subfolder(name: &str) -> SeriesSubfolderKind {
    let trimmed = name.trim();
    let lower = trimmed.to_lowercase();

    // 明确剧场版/篇名优先：有些剧场版会写成 “S1 剧场版” 或 “S2 完结篇”，
    // 这种仍应按剧场版处理，不能被 S1/S2 抢走。
    if trimmed.contains("剧场版") || trimmed.contains('篇') {
        return SeriesSubfolderKind::Movie;
    }

    // 第1季 / 第二季
    if let Ok(re) = regex::Regex::new(r"第\s*([0-9一二三四五六七八九十]+)\s*季") {
        if let Some(caps) = re.captures(trimmed) {
            if let Some(season) = caps.get(1).and_then(|m| parse_season_number(m.as_str())) {
                return SeriesSubfolderKind::Season(season);
            }
        }
    }

    // Season 1 / season01
    if let Ok(re) = regex::Regex::new(r"(?i)(^|[^a-z0-9])season\s*0*([1-9][0-9]?)([^a-z0-9]|$)") {
        if let Some(caps) = re.captures(&lower) {
            if let Some(season) = caps.get(2).and_then(|m| m.as_str().parse::<i32>().ok()) {
                return SeriesSubfolderKind::Season(season);
            }
        }
    }

    // S1 / S01 / S2：必须是独立季标识，避免误伤 SSIS-123、SIS-001 等番号。
    if let Ok(re) = regex::Regex::new(r"(?i)(^|[^a-z0-9])s0*([1-9][0-9]?)([^a-z0-9]|$)") {
        if let Some(caps) = re.captures(&lower) {
            if let Some(season) = caps.get(2).and_then(|m| m.as_str().parse::<i32>().ok()) {
                return SeriesSubfolderKind::Season(season);
            }
        }
    }

    // 1-2季、1-3季 等范围格式：取最后一个数字作为总季数
    if let Ok(re) = regex::Regex::new(r"(\d+)\s*[-~]\s*(\d+)\s*季") {
        if let Some(caps) = re.captures(trimmed) {
            if let Some(end_season) = caps.get(2).and_then(|m| m.as_str().parse::<i32>().ok()) {
                return SeriesSubfolderKind::Season(end_season);
            }
        }
    }

    SeriesSubfolderKind::Unknown
}

fn parse_season_number(value: &str) -> Option<i32> {
    if let Ok(num) = value.parse::<i32>() {
        return Some(num);
    }

    let mut total = 0;
    let mut current = 0;
    for ch in value.chars() {
        match ch {
            '一' => current = 1,
            '二' => current = 2,
            '三' => current = 3,
            '四' => current = 4,
            '五' => current = 5,
            '六' => current = 6,
            '七' => current = 7,
            '八' => current = 8,
            '九' => current = 9,
            '十' => {
                total += if current == 0 { 10 } else { current * 10 };
                current = 0;
            }
            _ => return None,
        }
    }
    let result = total + current;
    if result > 0 { Some(result) } else { None }
}

// 扫描目录（支持子文件夹，最小文件夹为一部作品）
pub async fn scan_directory(path: &str) -> Result<ScanResult> {
    let path = Path::new(path);
    if !path.exists() {
        return Err(anyhow::anyhow!("目录不存在: {}", path.display()));
    }

    let mut videos = Vec::new();
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
        process_directory_videos(path, None, None, &mut videos).await?;
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

            let folder_name = subdir
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            // 明确命名优先；不明确时保留原规则：≤3 部作品 → 剧场版，多部 → 正常季。
            let (season, subtitle) = match classify_series_subfolder(&folder_name) {
                SeriesSubfolderKind::Movie => (999, Some(folder_name)),
                SeriesSubfolderKind::Season(season) => (season, None),
                SeriesSubfolderKind::Unknown if count <= 3 => (999, Some(folder_name)),
                SeriesSubfolderKind::Unknown => {
                    season_counter += 1;
                    (season_counter, None)
                }
            };
            process_directory_videos(
                subdir,
                Some(season),
                subtitle.as_deref(),
                &mut videos,
            )
            .await?;
        }
    }

    Ok(ScanResult { videos })
}

/// 轻量扫描目录更新：只收集视频文件元数据，不读取图片、不生成缩略图。
/// 全量检查更新只需要比较文件增删；避免为每个已有视频集重复压缩海报导致卡慢。
pub async fn scan_directory_video_index(path: &str) -> Result<Vec<Video>> {
    let path = Path::new(path);
    if !path.exists() {
        return Err(anyhow::anyhow!("目录不存在: {}", path.display()));
    }

    let mut videos = Vec::new();
    let mut subdirs: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.filter_map(|e| e.ok()) {
            if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                subdirs.push(entry.path());
            }
        }
    }

    if subdirs.is_empty() {
        process_directory_video_index(path, None, None, &mut videos).await?;
    } else {
        subdirs.sort_by(|a, b| {
            let a_name = a.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
            let b_name = b.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
            a_name.cmp(&b_name)
        });

        let mut season_counter = 0;
        for subdir in &subdirs {
            let count = count_videos_in_folder(subdir);
            if count == 0 {
                continue;
            }

            let folder_name = subdir.file_name().unwrap_or_default().to_string_lossy().to_string();
            let (season, subtitle) = match classify_series_subfolder(&folder_name) {
                SeriesSubfolderKind::Movie => (999, Some(folder_name)),
                SeriesSubfolderKind::Season(season) => (season, None),
                SeriesSubfolderKind::Unknown if count <= 3 => (999, Some(folder_name)),
                SeriesSubfolderKind::Unknown => {
                    season_counter += 1;
                    (season_counter, None)
                }
            };
            process_directory_video_index(subdir, Some(season), subtitle.as_deref(), &mut videos).await?;
        }
    }

    Ok(videos)
}

async fn process_directory_video_index(
    dir: &Path,
    season: Option<i32>,
    subtitle: Option<&str>,
    videos: &mut Vec<Video>,
) -> Result<()> {
    let mut video_files: Vec<PathBuf> = Vec::new();

    for entry in WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let file_path = entry.path();
        if is_video_file(file_path) {
            video_files.push(file_path.to_path_buf());
        }
    }

    let mut folder_videos: HashMap<PathBuf, Vec<PathBuf>> = HashMap::new();
    for video_path in &video_files {
        if let Some(parent) = video_path.parent() {
            folder_videos.entry(parent.to_path_buf()).or_insert_with(Vec::new).push(video_path.clone());
        }
    }

    for videos_in_folder in folder_videos.values() {
        let mut sorted_videos = videos_in_folder.clone();
        sort_episode_files(&mut sorted_videos);
        let fixed_episode_names = folder_uses_fixed_episode_names(&sorted_videos);

        for (index, video_path) in sorted_videos.iter().enumerate() {
            let mut video = scan_video_file_index(video_path)?;
            video.season = season;
            video.subtitle = subtitle.map(|s| s.to_string()).or(video.subtitle);
            if fixed_episode_names {
                video.episode_number = video_path
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .and_then(|stem| stem.parse::<i32>().ok());
            } else if video.episode_number.is_none() {
                video.episode_number = Some((index + 1) as i32);
            }
            videos.push(video);
        }
    }

    Ok(())
}

fn scan_video_file_index(path: &Path) -> Result<Video> {
    let file_name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
    let file_size = std::fs::metadata(path)?.len() as i64;
    let adult_info = parse_adult_filename(&file_name);

    Ok(Video {
        id: 0,
        file_path: path.to_string_lossy().to_string(),
        file_name: file_name.clone(),
        series_id: None,
        episode_number: fixed_episode_from_path(path).or_else(|| extract_episode_from_filename(&file_name)),
        file_size: Some(file_size),
        season: None,
        subtitle: adult_info.as_ref().and_then(|info| info.title.clone()),
        duration: None,
        width: None,
        height: None,
        resolution: None,
        source_site: None,
        metadata: None,
        thumbnail: None,
        thumbnail_base64: None,
        thumbnail_data_url: None,
        series_title: None,
        series_poster_data_url: None,
        description: None,
        poster_orientation: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        is_favorite: None,
        series_has_chinese_sub: None,
        series_code: None,
    })
}

/// 处理指定目录下的所有视频，按父文件夹分组并分配集数和季数。
async fn process_directory_videos(
    dir: &Path,
    season: Option<i32>,
    subtitle: Option<&str>,
    videos: &mut Vec<Video>,
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

    // 预先计算根目录海报，用于季文件夹无海报时的回退
    let root_poster = find_folder_poster(dir);

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

        let folder_poster_path = find_poster_for_folder(
            folder,
            &folder_name,
            &image_files,
            &videos_in_folder
                .iter()
                .map(|p| p.clone())
                .collect::<Vec<_>>(),
        );
        let mut sorted_videos = videos_in_folder.clone();
        sort_episode_files(&mut sorted_videos);

        for (index, video_path) in sorted_videos.iter().enumerate() {
            let poster_path = find_poster_for_video(video_path, &image_files)
                .or_else(|| folder_poster_path.clone())
                .or_else(|| root_poster.clone());
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

fn same_dir(a: &Path, b: &Path) -> bool {
    let normalize = |p: &Path| -> String {
        p.to_string_lossy().replace('\\', "/").trim_end_matches('/').to_string()
    };
    normalize(a) == normalize(b)
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

pub fn find_poster_for_video(video_path: &Path, image_files: &[PathBuf]) -> Option<String> {
    let video_parent = video_path.parent()?;
    let video_stem = file_stem_lower(video_path);
    // 1. 找和视频同名的图片（同目录下，文件名不含扩展名相同）
    if let Some(found) = image_files.iter().find_map(|image_path| {
        let img_parent = image_path.parent()?;
        if same_dir(img_parent, video_parent) && file_stem_lower(image_path) == video_stem {
            Some(image_path.to_string_lossy().to_string())
        } else {
            None
        }
    }) {
        return Some(found);
    }
    // 2. 找文件名包含 "pl" 的图片
    image_files.iter().find_map(|image_path| {
        let img_parent = image_path.parent()?;
        if same_dir(img_parent, video_parent) {
            let name = image_path.file_stem()?.to_str()?.to_lowercase();
            if name.contains("pl") {
                Some(image_path.to_string_lossy().to_string())
            } else {
                None
            }
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
    video_files: &[PathBuf],
) -> Option<String> {
    // 策略1：查找与文件夹同名的图片
    for image_path in image_files {
        if let Some(image_parent) = image_path.parent() {
            if same_dir(image_parent, folder) {
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

    // 策略2：查找与视频文件同名的图片（如 abc.mp4 → abc.jpg）
    for video_path in video_files {
        if let Some(video_parent) = video_path.parent() {
            if same_dir(video_parent, folder) {
                let video_stem = video_path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_lowercase();
                for image_path in image_files {
                    if let Some(image_parent) = image_path.parent() {
                        if same_dir(image_parent, folder) {
                            let image_stem = image_path
                                .file_stem()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .to_lowercase();
                            if image_stem == video_stem {
                                return Some(image_path.to_string_lossy().to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    // 策略3：查找图片名称中带 "pl" 的图片
    for image_path in image_files {
        if let Some(image_parent) = image_path.parent() {
            if same_dir(image_parent, folder) {
                let image_stem = image_path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_lowercase();
                if image_stem.contains("pl") {
                    return Some(image_path.to_string_lossy().to_string());
                }
            }
        }
    }

    // 策略3.5：查找名为 poster、cover、folder 的图片
    for name in &["poster", "cover", "folder"] {
        for image_path in image_files {
            if let Some(image_parent) = image_path.parent() {
                if same_dir(image_parent, folder) {
                    let image_stem = image_path
                        .file_stem()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_lowercase();
                    if image_stem == *name {
                        return Some(image_path.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    // 策略4：查找文件名包含车牌的图片（如 START-191-C.jpg 匹配车牌 START-191）
    if let Some(info) = parse_adult_filename(folder_name) {
        let code_lower = info.code.to_lowercase();
        for image_path in image_files {
            if let Some(image_parent) = image_path.parent() {
                if same_dir(image_parent, folder) {
                    let image_stem = image_path
                        .file_stem()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_lowercase();
                    if image_stem.contains(&code_lower) {
                        return Some(image_path.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    // 策略5：查找文件夹内的第一张图片
    for image_path in image_files {
        if let Some(image_parent) = image_path.parent() {
            if same_dir(image_parent, folder) {
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

    // 解析成人视频文件名（车牌、中文字幕、标题）
    let adult_info = parse_adult_filename(&file_name);

    // 如果解析到成人视频标题，用作 subtitle
    let subtitle = adult_info.as_ref().and_then(|info| info.title.clone());

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
        subtitle,
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
        series_has_chinese_sub: None,
        series_code: None,
    })
}

// 从文件名提取集数
pub fn extract_episode_from_filename(filename: &str) -> Option<i32> {
    let filename_lower = filename.to_lowercase();

    // 常见的集数格式
    let patterns = [
        r"(?i)s\d+e(\d+)",        // S01E01, S1E01（标准季集格式，优先匹配）
        r"(?i)ep?\s*(\d+)",       // EP01, E01, ep01
        r"(?i)第\s*(\d+)\s*[集话]", // 第01集, 第01话
        r"(?i)\[(\d+)\]",           // [01]
        r"(?i)_(\d+)_",             // _01_
        r"(?i)_(\d+)$",             // _136（下划线后跟数字到末尾）
        r"(?i)\s(\d{2,})\s",        // 空格包围的数字
        r"(?i)\s(\d{2,})$",         // 空格后跟数字到末尾（如 xxx 01）
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

/// 成人视频文件名解析结果
/// 查找文件夹的海报图片（公开版本，自动收集文件夹内的图片文件）
pub fn find_folder_poster(folder: &Path) -> Option<String> {
    let folder_name = folder
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let mut image_files: Vec<PathBuf> = Vec::new();
    let mut video_files: Vec<PathBuf> = Vec::new();
    let mut child_dirs: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(folder) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    let ext = ext.to_string_lossy().to_lowercase();
                    if IMAGE_EXTENSIONS.contains(&ext.as_str()) {
                        image_files.push(path);
                    } else if VIDEO_EXTENSIONS.contains(&ext.as_str()) {
                        video_files.push(path);
                    }
                }
            } else if path.is_dir() {
                child_dirs.push(path);
            }
        }
    }
    find_poster_for_folder(folder, &folder_name, &image_files, &video_files).or_else(|| {
        // 多季视频集常把海报放在 S1/S2/第1季 等季文件夹里。
        // 视频集根目录没海报时，按季文件夹名称排序后读取第一张可用海报。
        child_dirs.sort_by_key(|path| {
            path.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase()
        });
        for child in child_dirs {
            let child_name = child
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let (child_images, child_videos) = collect_direct_media_files(&child);
            if let Some(poster) = find_poster_for_folder(&child, &child_name, &child_images, &child_videos) {
                return Some(poster);
            }
        }
        None
    })
}

fn collect_direct_media_files(folder: &Path) -> (Vec<PathBuf>, Vec<PathBuf>) {
    let mut image_files = Vec::new();
    let mut video_files = Vec::new();

    if let Ok(entries) = std::fs::read_dir(folder) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if let Some(ext) = path.extension() {
                let ext = ext.to_string_lossy().to_lowercase();
                if IMAGE_EXTENSIONS.contains(&ext.as_str()) {
                    image_files.push(path);
                } else if VIDEO_EXTENSIONS.contains(&ext.as_str()) {
                    video_files.push(path);
                }
            }
        }
    }

    image_files.sort_by_key(|path| file_stem_lower(path));
    video_files.sort_by_key(|path| file_stem_lower(path));
    (image_files, video_files)
}

/// 成人视频文件名解析结果
#[derive(Debug, Clone)]
pub struct AdultFileInfo {
    /// 车牌号（大写），如 "ABC-123"
    pub code: String,
    /// 是否有中文字幕
    pub has_chinese_sub: bool,
    /// 方括号中的标题（如果有）
    pub title: Option<String>,
}

/// 从文件名解析成人视频信息
/// 支持格式：
///   xxx-000c[标题]  xxx-000[标题]  xxx-000-c[标题]  xxx-000ch[标题]
pub fn parse_adult_filename(filename: &str) -> Option<AdultFileInfo> {
    let re = regex::Regex::new(r"(?i)([A-Za-z]+-\d+)").ok()?;
    let caps = re.captures(filename)?;
    let code_match = caps.get(1)?;
    let code_raw = code_match.as_str();
    let after_code = &filename[code_match.end()..];

    // 检查车牌后的中文字幕标记：支持 JUR-472-C、JUR-472-CH、JUR-472C、JUR-472ch，
    // 也支持 JUR-472-AI-C / JUR-472-AI-CH 这种中间带版本标记的命名。
    let marker_part = after_code.split('[').next().unwrap_or(after_code);
    let has_c_marker = marker_part
        .split(|ch: char| ch == '-' || ch == '_' || ch.is_whitespace())
        .any(|token| token.eq_ignore_ascii_case("c") || token.eq_ignore_ascii_case("ch"));

    // 检查方括号中是否包含 [中文]、[字幕] 等中文字幕标记
    let has_bracket_sub = after_code.to_lowercase().contains("[中文]")
        || after_code.to_lowercase().contains("[字幕]");

    let has_chinese_sub = has_c_marker || has_bracket_sub;

    // 提取 [] 中的标题
    let rest = after_code;
    let title = regex::Regex::new(r"\[([^\]]*)\]")
        .ok()
        .and_then(|re| re.captures(rest))
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().to_string());

    Some(AdultFileInfo {
        code: code_raw.to_uppercase(),
        has_chinese_sub,
        title,
    })
}

/// 成人文件重命名匹配键：忽略中文字幕标记变化，用于把
/// JUR-472[标题] / JUR-472-C[标题] / JUR-472-AI-C[标题] 识别为同一个视频。
pub fn adult_rename_identity(filename: &str) -> Option<String> {
    let info = parse_adult_filename(filename)?;
    let title = info
        .title
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    Some(format!("{}|{}", info.code.to_uppercase(), title))
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

    #[test]
    fn classifies_series_subfolder_names_before_legacy_count_rule() {
        assert_eq!(classify_series_subfolder("S1"), SeriesSubfolderKind::Season(1));
        assert_eq!(classify_series_subfolder("S02"), SeriesSubfolderKind::Season(2));
        assert_eq!(classify_series_subfolder("第十二季"), SeriesSubfolderKind::Season(12));
        assert_eq!(classify_series_subfolder("Season 3"), SeriesSubfolderKind::Season(3));
        assert_eq!(classify_series_subfolder("完结篇"), SeriesSubfolderKind::Movie);
        assert_eq!(classify_series_subfolder("S2 剧场版"), SeriesSubfolderKind::Movie);
        assert_eq!(classify_series_subfolder("SSIS-123"), SeriesSubfolderKind::Unknown);
    }

    #[tokio::test]
    async fn named_short_season_is_not_treated_as_movie() -> Result<()> {
        let dir = temp_dir("short-season");
        let season = dir.join("S2");
        fs::create_dir_all(&season)?;
        fs::write(season.join("01.mp4"), b"one")?;

        let result = scan_directory(dir.to_str().unwrap()).await?;
        assert_eq!(result.videos.len(), 1);
        assert_eq!(result.videos[0].season, Some(2));
        assert_eq!(result.videos[0].subtitle, None);

        fs::remove_dir_all(dir).ok();
        Ok(())
    }

    #[tokio::test]
    async fn movie_keyword_wins_over_s_marker() -> Result<()> {
        let dir = temp_dir("movie-season-marker");
        let movie = dir.join("S1 剧场版");
        fs::create_dir_all(&movie)?;
        fs::write(movie.join("movie.mp4"), b"movie")?;

        let result = scan_directory(dir.to_str().unwrap()).await?;
        assert_eq!(result.videos.len(), 1);
        assert_eq!(result.videos[0].season, Some(999));
        assert_eq!(result.videos[0].subtitle.as_deref(), Some("S1 剧场版"));

        fs::remove_dir_all(dir).ok();
        Ok(())
    }

    #[test]
    fn adult_filename_identity_ignores_chinese_sub_marker_changes() {
        let plain = parse_adult_filename("JUR-472[学校风波].mp4").unwrap();
        let sub = parse_adult_filename("JUR-472-C[学校风波].mp4").unwrap();
        let ai_sub = parse_adult_filename("JUR-472-AI-C[学校风波].mp4").unwrap();

        assert!(!plain.has_chinese_sub);
        assert!(sub.has_chinese_sub);
        assert!(ai_sub.has_chinese_sub);
        assert_eq!(adult_rename_identity("JUR-472[学校风波].mp4"), adult_rename_identity("JUR-472-C[学校风波].mp4"));
        assert_eq!(adult_rename_identity("JUR-472-AI[学校风波].mp4"), adult_rename_identity("JUR-472-AI-C[学校风波].mp4"));
    }

    #[test]
    fn finds_series_poster_inside_season_folder_when_root_has_no_poster() -> Result<()> {
        let dir = temp_dir("season-poster");
        let season = dir.join("S1");
        fs::create_dir_all(&season)?;
        let poster = season.join("cover.jpg");
        fs::write(&poster, b"poster")?;
        fs::write(season.join("01.mp4"), b"video")?;

        assert_eq!(find_folder_poster(&dir).as_deref(), Some(poster.to_str().unwrap()));

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
        assert_eq!(
            video.thumbnail.as_deref(),
            Some(same_stem.to_str().unwrap())
        );

        fs::remove_dir_all(dir).ok();
        Ok(())
    }
}
#[test]
fn test_parse_adult_filename_chinese_sub() {
    // 无横杠 C
    let r = parse_adult_filename("STARS-667C[标题]").unwrap();
    assert!(r.has_chinese_sub, "STARS-667C should be chinese sub");
    assert_eq!(r.code, "STARS-667");

    // 有横杠 -C
    let r = parse_adult_filename("JUR-472-C[标题]").unwrap();
    assert!(r.has_chinese_sub, "JUR-472-C should be chinese sub");
    assert_eq!(r.code, "JUR-472");

    // 无横杠 ch
    let r = parse_adult_filename("SONE-672ch[标题]").unwrap();
    assert!(r.has_chinese_sub, "SONE-672ch should be chinese sub");
    assert_eq!(r.code, "SONE-672");

    // 有横杠 -CH
    let r = parse_adult_filename("SONE-519-CH[标题]").unwrap();
    assert!(r.has_chinese_sub, "SONE-519-CH should be chinese sub");
    assert_eq!(r.code, "SONE-519");

    // 无 C
    let r = parse_adult_filename("STARS-667[标题]").unwrap();
    assert!(!r.has_chinese_sub, "STARS-667 should NOT be chinese sub");

    println!("All chinese sub tests passed!");
}

#[cfg(test)]
mod classify_test {
    use super::*;

    #[test]
    fn s3_in_chinese_name_is_season_3() {
        let name = "超超超超超喜欢你的100个女朋友 S3[01-12]";
        assert_eq!(classify_series_subfolder(name), SeriesSubfolderKind::Season(3));
    }

    #[test]
    fn s3_with_no_brackets() {
        let name = "超超超超超喜欢你的100个女朋友 S3";
        assert_eq!(classify_series_subfolder(name), SeriesSubfolderKind::Season(3));
    }
}
