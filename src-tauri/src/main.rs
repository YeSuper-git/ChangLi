// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod downloader;
mod migrations;
mod parser;
mod player;
mod scanner;
mod site_config;
mod storage;

use image::ImageReader;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{Manager, State};
use tokio::sync::Mutex;

#[derive(Clone, serde::Serialize)]
struct PosterRepairStatus {
    status: String,
    scanned_series: i64,
    updated_series: i64,
    scanned_videos: i64,
    updated_videos: i64,
    skipped: i64,
    error: Option<String>,
}

impl Default for PosterRepairStatus {
    fn default() -> Self {
        Self {
            status: "idle".to_string(),
            scanned_series: 0,
            updated_series: 0,
            scanned_videos: 0,
            updated_videos: 0,
            skipped: 0,
            error: None,
        }
    }
}

// 应用状态
struct AppState {
    db: Mutex<Option<sqlx::SqlitePool>>,
    poster_repair_status: Arc<Mutex<PosterRepairStatus>>,
}

// 初始化数据库（如果已在 setup 中初始化则直接返回）
#[tauri::command]
async fn init_db(state: State<'_, AppState>) -> Result<(), String> {
    // 检查是否已经初始化完成
    {
        let guard = state.db.lock().await;
        if guard.is_some() {
            eprintln!("[ChangLi] 数据库已在后台初始化完成，跳过重复初始化");
            return Ok(());
        }
    }
    // 如果后台尚未完成，等待并执行初始化
    let db = db::init_database().await.map_err(|e| e.to_string())?;
    let mut guard = state.db.lock().await;
    if guard.is_none() {
        *guard = Some(db);
    }
    Ok(())
}

// 网站相关命令
#[tauri::command]
async fn get_sites(state: State<'_, AppState>) -> Result<Vec<db::Site>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_sites(&pool).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_site(state: State<'_, AppState>, site: db::NewSite) -> Result<db::Site, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::add_site(&pool, site).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_site(
    state: State<'_, AppState>,
    id: i64,
    site: db::NewSite,
) -> Result<db::Site, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::update_site(&pool, id, site)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_site(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::delete_site(&pool, id).await.map_err(|e| e.to_string())
}

// 网站配置模板
#[tauri::command]
async fn get_site_templates() -> Result<Vec<site_config::SiteTemplate>, String> {
    Ok(site_config::get_site_templates())
}

#[tauri::command]
async fn validate_site_config(config: site_config::SiteConfig) -> Result<(), String> {
    site_config::validate_site_config(&config).map_err(|e| e.to_string())
}

#[tauri::command]
async fn test_site_config(config: site_config::SiteConfig) -> Result<bool, String> {
    site_config::test_site_config(&config)
        .await
        .map_err(|e| e.to_string())
}

// 资源相关命令
#[tauri::command]
async fn search_resources(
    state: State<'_, AppState>,
    keyword: String,
    site_ids: Option<Vec<i64>>,
) -> Result<Vec<db::Resource>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };

    // 获取网站列表
    let sites = if let Some(ids) = site_ids {
        let all_sites = db::get_sites(&pool).await.map_err(|e| e.to_string())?;
        all_sites
            .into_iter()
            .filter(|s| ids.contains(&s.id))
            .collect()
    } else {
        db::get_sites(&pool).await.map_err(|e| e.to_string())?
    };

    // 搜索资源
    let mut all_resources = Vec::new();
    for site in sites {
        let config: parser::SiteConfig =
            serde_json::from_value(site.config.clone()).map_err(|e| e.to_string())?;
        let site_info = parser::Site {
            id: site.id,
            config,
        };

        match parser::search_resources(&site_info, &keyword).await {
            Ok(resources) => {
                // 转换 parser::Resource 到 db::Resource
                let db_resources: Vec<db::Resource> = resources
                    .into_iter()
                    .map(|r| db::Resource {
                        id: 0,
                        site_id: r.site_id,
                        title: r.title,
                        url: r.url,
                        magnet: r.magnet,
                        info: r.info,
                        created_at: chrono::Utc::now().to_rfc3339(),
                    })
                    .collect();
                all_resources.extend(db_resources);
            }
            Err(e) => eprintln!("搜索 {} 失败: {}", site.name, e),
        }
    }

    Ok(all_resources)
}

// 下载相关命令
#[tauri::command]
async fn add_download(state: State<'_, AppState>, magnet: String) -> Result<db::Download, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };

    // 尝试调用 aria2 添加下载，如果失败则创建本地记录
    let gid = match downloader::add_magnet(&magnet).await {
        Ok(gid) => {
            eprintln!("[ChangLi] aria2 添加下载成功, gid: {}", gid);
            gid
        }
        Err(e) => {
            eprintln!("[ChangLi] aria2 不可用，创建本地下载记录: {}", e);
            // 生成一个本地 GID
            format!("local_{}", uuid::Uuid::new_v4())
        }
    };

    // 保存到数据库
    let download = db::add_download(&pool, &gid, &magnet)
        .await
        .map_err(|e| e.to_string())?;

    Ok(download)
}

#[tauri::command]
async fn get_downloads(state: State<'_, AppState>) -> Result<Vec<db::Download>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_downloads(&pool).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn pause_download(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };

    let download = db::get_download(&pool, id)
        .await
        .map_err(|e| e.to_string())?;
    if let Some(gid) = download.aria2_gid {
        downloader::pause(&gid).await.map_err(|e| e.to_string())?;
        db::update_download_status(&pool, id, "paused")
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
async fn resume_download(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };

    let download = db::get_download(&pool, id)
        .await
        .map_err(|e| e.to_string())?;
    if let Some(gid) = download.aria2_gid {
        downloader::resume(&gid).await.map_err(|e| e.to_string())?;
        db::update_download_status(&pool, id, "downloading")
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
async fn remove_download(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };

    let download = db::get_download(&pool, id)
        .await
        .map_err(|e| e.to_string())?;
    if let Some(gid) = download.aria2_gid {
        downloader::remove(&gid).await.map_err(|e| e.to_string())?;
    }
    db::delete_download(&pool, id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// 从文件名提取成人视频元数据（标题、车牌、中文字幕）
fn extract_adult_metadata(name: &str) -> (String, Option<String>, i32) {
    if let Some(info) = scanner::parse_adult_filename(name) {
        let title = info.title.unwrap_or_else(|| name.to_string());
        (
            title,
            Some(info.code),
            if info.has_chinese_sub { 1 } else { 0 },
        )
    } else {
        (name.to_string(), None, 0)
    }
}

// 视频相关命令
#[derive(serde::Serialize)]
struct ScanResult {
    added: i64,
    updated: i64,
}

#[tauri::command]
async fn scan_videos(state: State<'_, AppState>, path: String) -> Result<ScanResult, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };

    let import_path = Path::new(&path);
    if import_path.is_file() {
        if !scanner::is_video_file(import_path) {
            return Err("选择的文件不是支持的视频格式".to_string());
        }
        let video = scanner::scan_video_file(import_path, None)
            .await
            .map_err(|e| e.to_string())?;
        let file_stem = import_path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "未命名视频".to_string());
        let parent_dir = import_path
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "/".to_string());
        let thumb = video
            .thumbnail
            .as_deref()
            .and_then(|t| scanner::generate_thumbnail_base64(std::path::Path::new(t)));
        let (series_title, code, has_chinese_sub) = extract_adult_metadata(&file_stem);
        let series = db::add_video_series(
            &pool,
            &series_title,
            Some(&parent_dir),
            video.thumbnail.as_deref(),
            Some("landscape"),
            Some("ongoing"),
            thumb.as_deref(),
            None,
        )
        .await
        .map_err(|e| e.to_string())?;
        if let Some(c) = code {
            let _ =
                sqlx::query("UPDATE video_series SET code = ?, has_chinese_sub = ? WHERE id = ?")
                    .bind(&c)
                    .bind(has_chinese_sub)
                    .bind(series.id)
                    .execute(&pool)
                    .await;
        }
        db::add_videos_batch(&pool, vec![video], Some(series.id))
            .await
            .map_err(|e| e.to_string())?;
        return Ok(ScanResult {
            added: 1,
            updated: 0,
        });
    }

    let folder_name = import_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("未命名视频集")
        .to_string();

    // 如果文件夹名匹配已有标签，自动拆子文件夹为视频集并关联标签
    if let Ok(Some(tag)) = db::get_tag_by_name(&pool, folder_name.trim()).await {
        eprintln!(
            "[ChangLi] 文件夹名 '{}' 匹配标签 '{}'，自动拆分子文件夹",
            folder_name, tag.name
        );
        let mut added: i64 = 0;
        let mut updated: i64 = 0;

        let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let entry_path = entry.path();
            let entry_name = entry.file_name().to_string_lossy().to_string();

            if entry_path.is_dir() {
                // 子文件夹当视频集
                let sub_result = scanner::scan_directory(&entry_path.to_string_lossy())
                    .await
                    .map_err(|e| e.to_string())?;
                let sub_poster = crate::scanner::find_folder_poster(&entry_path);
                let sub_poster_base64 = sub_poster
                    .as_deref()
                    .and_then(|p| scanner::generate_thumbnail_base64(std::path::Path::new(p)));
                let folder_path_str = entry_path.to_string_lossy().to_string();
                if let Some(existing) = db::get_video_series_by_folder_path(&pool, &folder_path_str)
                    .await
                    .map_err(|e| e.to_string())?
                {
                    // 已存在：更新海报
                    db::update_video_series_poster(
                        &pool,
                        existing.id,
                        sub_poster.as_deref(),
                        sub_poster_base64.as_deref(),
                        Some("landscape"),
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                    db::add_videos_batch(&pool, sub_result.videos, Some(existing.id))
                        .await
                        .map_err(|e| e.to_string())?;
                    updated += 1;
                } else {
                    let series = db::add_video_series(
                        &pool,
                        &entry_name,
                        Some(&folder_path_str),
                        sub_poster.as_deref(),
                        Some("landscape"),
                        Some("ongoing"),
                        sub_poster_base64.as_deref(),
                                None,
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                    db::add_videos_batch(&pool, sub_result.videos, Some(series.id))
                        .await
                        .map_err(|e| e.to_string())?;
                    if let Err(e) = db::add_series_tag(&pool, series.id, tag.id).await {
                        eprintln!("[ChangLi] 关联标签失败: {}", e);
                    }
                    added += 1;
                }
            } else if entry_path.is_file() && scanner::is_video_file(&entry_path) {
                // 根目录下的视频也创建视频集
                let video = scanner::scan_video_file(&entry_path, None)
                    .await
                    .map_err(|e| e.to_string())?;
                let file_stem = entry_path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| entry_name.clone());
                let thumb = video
                    .thumbnail
                    .as_deref()
                    .and_then(|t| scanner::generate_thumbnail_base64(std::path::Path::new(t)));
                let file_path_str = entry_path.to_string_lossy().to_string();
                if let Some(existing) = db::get_video_series_by_folder_path(&pool, &file_path_str)
                    .await
                    .map_err(|e| e.to_string())?
                {
                    db::update_video_series_poster(
                        &pool,
                        existing.id,
                        video.thumbnail.as_deref(),
                        thumb.as_deref(),
                        Some("landscape"),
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                    db::add_videos_batch(&pool, vec![video], Some(existing.id))
                        .await
                        .map_err(|e| e.to_string())?;
                    updated += 1;
                } else {
                    let series = db::add_video_series(
                        &pool,
                        &file_stem,
                        Some(&file_path_str),
                        video.thumbnail.as_deref(),
                        Some("landscape"),
                        Some("ongoing"),
                        thumb.as_deref(),
                                None,
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                    db::add_videos_batch(&pool, vec![video], Some(series.id))
                        .await
                        .map_err(|e| e.to_string())?;
                    if let Err(e) = db::add_series_tag(&pool, series.id, tag.id).await {
                        eprintln!("[ChangLi] 关联标签失败: {}", e);
                    }
                    added += 1;
                }
            }
        }

        return Ok(ScanResult { added, updated });
    }

    // 如果文件夹名匹配已有演员，自动拆子文件夹为视频集并关联演员
    if let Ok(Some(actor)) = db::get_actor_by_name(&pool, folder_name.trim()).await {
        eprintln!(
            "[ChangLi] 文件夹名 '{}' 匹配演员 '{}'，自动拆分子文件夹并关联演员",
            folder_name, actor.name
        );
        let mut added: i64 = 0;
        let mut updated: i64 = 0;

        let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let entry_path = entry.path();
            let entry_name = entry.file_name().to_string_lossy().to_string();

            if entry_path.is_dir() {
                // 子文件夹
                let sub_result = scanner::scan_directory(&entry_path.to_string_lossy())
                    .await
                    .map_err(|e| e.to_string())?;
                let sub_poster = crate::scanner::find_folder_poster(&entry_path);
                let sub_poster_base64 = sub_poster
                    .as_deref()
                    .and_then(|p| scanner::generate_thumbnail_base64(std::path::Path::new(p)));

                let folder_path_str = entry_path.to_string_lossy().to_string();
                if let Some(existing) = db::get_video_series_by_folder_path(&pool, &folder_path_str)
                    .await
                    .map_err(|e| e.to_string())?
                {
                    db::update_video_series_poster(
                        &pool,
                        existing.id,
                        sub_poster.as_deref(),
                        sub_poster_base64.as_deref(),
                        Some("landscape"),
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                    db::add_videos_batch(&pool, sub_result.videos, Some(existing.id))
                        .await
                        .map_err(|e| e.to_string())?;
                    updated += 1;
                } else {
                    let (series_title, code, has_chinese_sub) = extract_adult_metadata(&entry_name);
                    let series = db::add_video_series(
                        &pool,
                        &series_title,
                        Some(&folder_path_str),
                        sub_poster.as_deref(),
                        Some("landscape"),
                        Some("ongoing"),
                        sub_poster_base64.as_deref(),
                                None,
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                    // 设置 code 和 has_chinese_sub
                    if let Some(c) = code {
                        let _ = sqlx::query(
                            "UPDATE video_series SET code = ?, has_chinese_sub = ? WHERE id = ?",
                        )
                        .bind(&c)
                        .bind(has_chinese_sub)
                        .bind(series.id)
                        .execute(&pool)
                        .await;
                    }
                    db::add_videos_batch(&pool, sub_result.videos, Some(series.id))
                        .await
                        .map_err(|e| e.to_string())?;
                    if let Err(e) =
                        db::add_series_actor(&pool, series.id, actor.id, None, None).await
                    {
                        eprintln!("[ChangLi] 关联演员到视频集失败: {}", e);
                    }
                    // 设置 display_type = 'adult'
                    let _ = db::update_video_series_display_type(&pool, series.id, "adult").await;
                    added += 1;
                }
            } else if entry_path.is_file() && scanner::is_video_file(&entry_path) {
                // 根目录下的视频也创建视频集并关联演员
                let video = scanner::scan_video_file(&entry_path, None)
                    .await
                    .map_err(|e| e.to_string())?;
                let file_stem = entry_path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| entry_name.clone());
                let thumb = video
                    .thumbnail
                    .as_deref()
                    .and_then(|t| scanner::generate_thumbnail_base64(std::path::Path::new(t)));
                let file_path_str = entry_path.to_string_lossy().to_string();
                if let Some(existing) = db::get_video_series_by_folder_path(&pool, &file_path_str)
                    .await
                    .map_err(|e| e.to_string())?
                {
                    db::update_video_series_poster(
                        &pool,
                        existing.id,
                        video.thumbnail.as_deref(),
                        thumb.as_deref(),
                        Some("landscape"),
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                    db::add_videos_batch(&pool, vec![video], Some(existing.id))
                        .await
                        .map_err(|e| e.to_string())?;
                    updated += 1;
                } else {
                    let (series_title, code, has_chinese_sub) = extract_adult_metadata(&file_stem);
                    let series = db::add_video_series(
                        &pool,
                        &series_title,
                        Some(&file_path_str),
                        video.thumbnail.as_deref(),
                        Some("landscape"),
                        Some("ongoing"),
                        thumb.as_deref(),
                                None,
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                    // 设置 code 和 has_chinese_sub
                    if let Some(c) = code {
                        let _ = sqlx::query(
                            "UPDATE video_series SET code = ?, has_chinese_sub = ? WHERE id = ?",
                        )
                        .bind(&c)
                        .bind(has_chinese_sub)
                        .bind(series.id)
                        .execute(&pool)
                        .await;
                    }
                    db::add_videos_batch(&pool, vec![video], Some(series.id))
                        .await
                        .map_err(|e| e.to_string())?;
                    if let Err(e) =
                        db::add_series_actor(&pool, series.id, actor.id, None, None).await
                    {
                        eprintln!("[ChangLi] 关联演员到视频集失败: {}", e);
                    }
                    // 设置 display_type = 'adult'
                    let _ = db::update_video_series_display_type(&pool, series.id, "adult").await;
                    added += 1;
                }
            }
        }

        return Ok(ScanResult { added, updated });
    }

    let result = scanner::scan_directory(&path)
        .await
        .map_err(|e| e.to_string())?;

    let mut series_poster = crate::scanner::find_folder_poster(&std::path::Path::new(&path));
    // 空文件夹：尝试从文件夹内找图片作为海报
    if series_poster.is_none() {
        if let Ok(entries) = std::fs::read_dir(&path) {
            for entry in entries.filter_map(|e| e.ok()) {
                let p = entry.path();
                if p.is_file() {
                    if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                        if scanner::IMAGE_EXTENSIONS.contains(&ext.to_lowercase().as_str()) {
                            series_poster = Some(p.to_string_lossy().to_string());
                            break;
                        }
                    }
                }
            }
        }
    }
    let series_poster_base64 = series_poster
        .as_deref()
        .and_then(|p| scanner::generate_thumbnail_base64(std::path::Path::new(p)));

    if let Some(existing) = db::get_video_series_by_folder_path(&pool, &path)
        .await
        .map_err(|e| e.to_string())?
    {
        // 已存在：更新海报
        db::update_video_series_poster(
            &pool,
            existing.id,
            series_poster.as_deref(),
            series_poster_base64.as_deref(),
            Some("landscape"),
        )
        .await
        .map_err(|e| e.to_string())?;
        // 自动更新元数据（code、has_chinese_sub）
        if existing.code.is_none() || existing.code.as_deref() == Some("") {
            let (new_title, code, has_chinese_sub) = extract_adult_metadata(&folder_name);
            if let Some(c) = code {
                let _ = sqlx::query("UPDATE video_series SET code = ?, has_chinese_sub = ?, title = ? WHERE id = ? AND (code IS NULL OR code = '')")
                    .bind(&c)
                    .bind(has_chinese_sub)
                    .bind(&new_title)
                    .bind(existing.id)
                    .execute(&pool).await;
            }
        }
        db::add_videos_batch(&pool, result.videos, Some(existing.id))
            .await
            .map_err(|e| e.to_string())?;
        Ok(ScanResult {
            added: 0,
            updated: 1,
        })
    } else {
        let (series_title, code, has_chinese_sub) = extract_adult_metadata(&folder_name);
        let series = db::add_video_series(
            &pool,
            &series_title,
            Some(&path),
            series_poster.as_deref(),
            Some("landscape"),
            Some("ongoing"),
            series_poster_base64.as_deref(),
            None,
        )
        .await
        .map_err(|e| e.to_string())?;
        // 设置 code 和 has_chinese_sub
        if let Some(c) = code {
            let _ =
                sqlx::query("UPDATE video_series SET code = ?, has_chinese_sub = ? WHERE id = ?")
                    .bind(&c)
                    .bind(has_chinese_sub)
                    .bind(series.id)
                    .execute(&pool)
                    .await;
        }
        db::add_videos_batch(&pool, result.videos, Some(series.id))
            .await
            .map_err(|e| e.to_string())?;
        // 路径6：如果父目录名匹配演员名，自动关联演员并设置 display_type='adult'
        if let Some(parent) = import_path.parent() {
            let parent_name = parent
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            if !parent_name.is_empty() {
                if let Ok(Some(actor)) =
                    db::get_actor_by_name_or_jp(&pool, parent_name.trim()).await
                {
                    eprintln!(
                        "[ChangLi] 父目录 '{}' 匹配演员 '{}'，自动关联",
                        parent_name, actor.name,
                    );
                    let _ = db::add_series_actor(&pool, series.id, actor.id, None, None).await;
                    let _ = db::update_video_series_display_type(&pool, series.id, "adult").await;
                }
            }
        }
        Ok(ScanResult {
            added: 1,
            updated: 0,
        })
    }
}

#[tauri::command]
async fn scan_videos_for_actor(
    state: State<'_, AppState>,
    path: String,
    actor_id: i64,
    period_id: Option<i64>,
) -> Result<ScanResult, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };

    // 校验文件夹名
    // 如果指定了时期，用时期名校验；否则用演员名校验
    // 也支持番号格式的文件夹名（如 STARS-667C[标题]）
    let actor = db::get_actor(&pool, actor_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("演员不存在")?;
    let folder_name = Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let folder_trimmed = folder_name.trim();

    // 如果指定了时期，用时期名校验
    let period_name = if let Some(pid) = period_id {
        db::get_actor_periods(&pool, actor_id)
            .await
            .ok()
            .and_then(|periods| periods.into_iter().find(|p| p.id == pid).map(|p| p.name))
    } else {
        None
    };

    let name_matches = if let Some(ref pname) = period_name {
        folder_trimmed.eq_ignore_ascii_case(pname.trim())
    } else {
        folder_trimmed.eq_ignore_ascii_case(actor.name.trim())
            || actor
                .japanese_name
                .as_deref()
                .map(|jp| folder_trimmed.eq_ignore_ascii_case(jp.trim()))
                .unwrap_or(false)
    };

    // 如果名称不匹配，检查是否是番号格式的文件夹
    let is_video_folder = !name_matches
        && scanner::parse_adult_filename(folder_trimmed).is_some();

    if !name_matches && !is_video_folder {
        let expected = period_name
            .as_deref()
            .unwrap_or(&actor.name);
        return Err(format!(
            "文件夹名 '{}' 不匹配 '{}' 或番号格式",
            folder_name, expected
        ));
    }

    let mut added: i64 = 0;
    let mut updated: i64 = 0;

    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();
        let entry_name = entry.file_name().to_string_lossy().to_string();

        if !entry_path.is_dir() {
            continue;
        }

        let sub_result = scanner::scan_directory(&entry_path.to_string_lossy())
            .await
            .map_err(|e| e.to_string())?;
        let sub_poster = crate::scanner::find_folder_poster(&entry_path);
        let sub_poster_base64 = sub_poster
            .as_deref()
            .and_then(|p| scanner::generate_thumbnail_base64(std::path::Path::new(p)));
        let folder_path_str = entry_path.to_string_lossy().to_string();
        if let Some(existing) = db::get_video_series_by_folder_path(&pool, &folder_path_str)
            .await
            .map_err(|e| e.to_string())?
        {
            db::update_video_series_poster(
                &pool,
                existing.id,
                sub_poster.as_deref(),
                sub_poster_base64.as_deref(),
                Some("landscape"),
            )
            .await
            .map_err(|e| e.to_string())?;
            db::add_videos_batch(&pool, sub_result.videos, Some(existing.id))
                .await
                .map_err(|e| e.to_string())?;
            let _ = db::add_series_actor(&pool, existing.id, actor_id, None, period_id).await;
            let _ = db::update_video_series_display_type(&pool, existing.id, "adult").await;
            updated += 1;
        } else {
            let (series_title, code, has_chinese_sub) = extract_adult_metadata(&entry_name);
            let series = db::add_video_series(
                &pool,
                &series_title,
                Some(&folder_path_str),
                sub_poster.as_deref(),
                Some("landscape"),
                Some("ongoing"),
                sub_poster_base64.as_deref(),
                None,
            )
            .await
            .map_err(|e| e.to_string())?;
            if let Some(c) = code {
                let _ = sqlx::query(
                    "UPDATE video_series SET code = ?, has_chinese_sub = ? WHERE id = ?",
                )
                .bind(&c)
                .bind(has_chinese_sub)
                .bind(series.id)
                .execute(&pool)
                .await;
            }
            db::add_videos_batch(&pool, sub_result.videos, Some(series.id))
                .await
                .map_err(|e| e.to_string())?;
            let _ = db::add_series_actor(&pool, series.id, actor_id, None, period_id).await;
            let _ = db::update_video_series_display_type(&pool, series.id, "adult").await;
            added += 1;
        }
    }

    if added == 0 && updated == 0 {
        return Err("文件夹中没有找到视频".to_string());
    }

    Ok(ScanResult { added, updated })
}

#[tauri::command]
async fn get_videos(state: State<'_, AppState>) -> Result<Vec<db::Video>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_videos(&pool).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_video(state: State<'_, AppState>, id: i64) -> Result<Option<db::Video>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_video(&pool, id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_video(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::delete_video(&pool, id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_video_series_list(
    state: State<'_, AppState>,
    sort_by: Option<String>,
    sort_order: Option<String>,
) -> Result<Vec<db::VideoSeries>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    let sort_by = sort_by.as_deref().unwrap_or("created_at");
    let sort_order = sort_order.as_deref().unwrap_or("desc");
    db::get_video_series_list(&pool, sort_by, sort_order)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_video_series_by_tag(
    state: State<'_, AppState>,
    tag_id: i64,
) -> Result<Vec<db::VideoSeries>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_video_series_by_tag(&pool, tag_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_video_series_by_tag_name(
    state: State<'_, AppState>,
    tag_name: String,
) -> Result<Vec<db::VideoSeries>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_video_series_by_tag_name(&pool, &tag_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_video_series_by_actor(
    state: State<'_, AppState>,
    actor_id: i64,
) -> Result<Vec<db::VideoSeries>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_video_series_by_actor(&pool, actor_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_series_playback_video(
    state: State<'_, AppState>,
    series_id: i64,
) -> Result<Option<db::Video>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_series_playback_video(&pool, series_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_video_series_detail(
    state: State<'_, AppState>,
    id: i64,
) -> Result<(Option<db::VideoSeries>, Vec<db::Video>), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    let series = db::get_video_series(&pool, id)
        .await
        .map_err(|e| e.to_string())?;
    let videos = db::get_series_videos(&pool, id)
        .await
        .map_err(|e| e.to_string())?;
    Ok((series, videos))
}

#[tauri::command]
async fn update_video_series(
    state: State<'_, AppState>,
    id: i64,
    title: String,
    description: Option<String>,
    poster: Option<String>,
    poster_orientation: Option<String>,
    status: Option<String>,
    code: Option<String>,
    has_chinese_sub: Option<i32>,
) -> Result<db::VideoSeries, String> {
    eprintln!(
        "[update_video_series] id={}, has_chinese_sub={:?}",
        id, has_chinese_sub
    );
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    let stored_poster = poster.as_deref().map(normalize_photo_path_for_storage);
    let poster_base64 = stored_poster
        .as_deref()
        .and_then(|p| scanner::generate_thumbnail_base64(std::path::Path::new(p)));
    db::update_video_series(
        &pool,
        id,
        title,
        description,
        stored_poster,
        poster_orientation,
        status,
        poster_base64,
        code,
        has_chinese_sub,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_video_series(
    state: State<'_, AppState>,
    id: i64,
    delete_videos: bool,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::delete_video_series(&pool, id, delete_videos)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_video_series_batch(
    state: State<'_, AppState>,
    ids: Vec<i64>,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    for id in ids {
        db::delete_video_series(&pool, id, true)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn delete_videos_batch(
    state: State<'_, AppState>,
    ids: Vec<i64>,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for id in ids {
        sqlx::query("DELETE FROM videos WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn switch_series_type(state: State<'_, AppState>, series_id: i64) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::switch_series_type(&pool, series_id)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn switch_series_type_to(state: State<'_, AppState>, series_id: i64, category_key: String) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::update_video_series_display_type(&pool, series_id, &category_key)
        .await
        .map_err(|e| e.to_string())
}


#[tauri::command]
async fn add_video_to_series(
    state: State<'_, AppState>,
    series_id: i64,
    path: String,
) -> Result<db::Video, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    let video_path = Path::new(&path);
    if !video_path.is_file() || !scanner::is_video_file(video_path) {
        return Err("请选择支持的视频文件".to_string());
    }
    let mut video = scanner::scan_video_file(video_path, None)
        .await
        .map_err(|e| e.to_string())?;
    video.series_id = Some(series_id);
    let saved = db::add_video(&pool, video)
        .await
        .map_err(|e| e.to_string())?;
    db::set_video_series(&pool, saved.id, Some(series_id), saved.episode_number)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_videos_to_series(
    state: State<'_, AppState>,
    series_id: i64,
    paths: Vec<String>,
) -> Result<Vec<db::Video>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    let mut videos = Vec::new();
    for path in paths {
        let video_path = Path::new(&path);
        if !video_path.is_file() || !scanner::is_video_file(video_path) {
            continue;
        }
        let mut video = scanner::scan_video_file(video_path, None)
            .await
            .map_err(|e| e.to_string())?;
        video.series_id = Some(series_id);
        videos.push(video);
    }
    if videos.is_empty() {
        return Ok(Vec::new());
    }
    db::add_videos_batch(&pool, videos, Some(series_id))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_category_series_by_paths(
    state: State<'_, AppState>,
    category_key: String,
    paths: Vec<String>,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };

    for folder in paths {
        let folder_path = Path::new(&folder);
        if !folder_path.is_dir() {
            continue;
        }
        let folder_name = folder_path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        if folder_name.is_empty() {
            continue;
        }
        let scan_result = scanner::scan_directory(&folder)
            .await
            .map_err(|e| e.to_string())?;
        let poster = scanner::find_folder_poster(folder_path);
        let poster_base64 = poster
            .as_deref()
            .and_then(|p| scanner::generate_thumbnail_base64(Path::new(p)));

        let series = if let Some(existing) = db::get_video_series_by_folder_path(&pool, &folder)
            .await
            .map_err(|e| e.to_string())?
        {
            existing
        } else {
            let (series_title, code, has_chinese_sub) = extract_adult_metadata(&folder_name);
            let series = db::add_video_series(
                &pool,
                &series_title,
                Some(&folder),
                poster.as_deref(),
                Some("landscape"),
                Some("ongoing"),
                poster_base64.as_deref(),
                Some(&category_key),
            )
            .await
            .map_err(|e| e.to_string())?;
            if let Some(c) = code {
                let _ = sqlx::query("UPDATE video_series SET code = ?, has_chinese_sub = ? WHERE id = ?")
                    .bind(&c)
                    .bind(has_chinese_sub)
                    .bind(series.id)
                    .execute(&pool)
                    .await;
            }
            series
        };

        db::add_videos_batch(&pool, scan_result.videos, Some(series.id))
            .await
            .map_err(|e| e.to_string())?;
        let _ = db::update_video_series_display_type(&pool, series.id, &category_key).await;

        if let Some(parent) = folder_path.parent() {
            if let Some(parent_name) = parent.file_name().map(|s| s.to_string_lossy().to_string()) {
                if let Ok(Some(tag)) = db::get_tag_by_name(&pool, parent_name.trim()).await {
                    let _ = db::add_series_tag(&pool, series.id, tag.id).await;
                }
                if let Ok(Some(actor)) = db::get_actor_by_name_or_jp(&pool, parent_name.trim()).await {
                    let _ = db::add_series_actor(&pool, series.id, actor.id, None, None).await;
                } else if let Some(grand) = parent.parent() {
                    if let Some(actor_name) = grand.file_name().map(|s| s.to_string_lossy().to_string()) {
                        if let Ok(Some(actor)) = db::get_actor_by_name_or_jp(&pool, actor_name.trim()).await {
                            let periods = db::get_actor_periods(&pool, actor.id).await.unwrap_or_default();
                            let period_id = periods.into_iter().find(|p| p.name == parent_name).map(|p| p.id);
                            let _ = db::add_series_actor(&pool, series.id, actor.id, None, period_id).await;
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn remove_video_from_series(
    state: State<'_, AppState>,
    video_id: i64,
) -> Result<db::Video, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::set_video_series(&pool, video_id, None, None)
        .await
        .map_err(|e| e.to_string())
}

// 演员相关命令
#[tauri::command]
async fn get_actors(state: State<'_, AppState>) -> Result<Vec<db::Actor>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_actors(&pool).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_actors_by_category(state: State<'_, AppState>, category_key: String) -> Result<Vec<db::Actor>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_actors_by_category(&pool, &category_key).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn increment_actor_view(state: State<'_, AppState>, actor_id: i64) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::increment_actor_view_count(&pool, actor_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_actor(state: State<'_, AppState>, id: i64) -> Result<Option<db::Actor>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_actor(&pool, id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_actor(
    state: State<'_, AppState>,
    name: String,
    photo: Option<String>,
    bio: Option<String>,
    birthday: Option<String>,
    height: Option<String>,
    measurements: Option<String>,
    japanese_name: Option<String>,
    cup_size: Option<String>,
    alias: Option<String>,
) -> Result<db::Actor, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    let stored_photo = photo.as_deref().map(normalize_photo_path_for_storage);
    let avatar_base64 = stored_photo
        .as_deref()
        .and_then(|p| scanner::generate_thumbnail_base64(std::path::Path::new(p)));
    db::add_actor(
        &pool,
        &name,
        stored_photo.as_deref(),
        bio.as_deref(),
        birthday.as_deref(),
        height.as_deref(),
        measurements.as_deref(),
        japanese_name.as_deref(),
        cup_size.as_deref(),
        avatar_base64.as_deref(),
        alias.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_actor(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    photo: Option<String>,
    bio: Option<String>,
    birthday: Option<String>,
    height: Option<String>,
    measurements: Option<String>,
    japanese_name: Option<String>,
    cup_size: Option<String>,
    alias: Option<String>,
    weight: Option<String>,
) -> Result<db::Actor, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    let stored_photo = photo.as_deref().map(normalize_photo_path_for_storage);
    let avatar_base64 = stored_photo
        .as_deref()
        .and_then(|p| scanner::generate_thumbnail_base64(std::path::Path::new(p)));
    db::update_actor(
        &pool,
        id,
        &name,
        stored_photo.as_deref(),
        bio.as_deref(),
        birthday.as_deref(),
        height.as_deref(),
        measurements.as_deref(),
        japanese_name.as_deref(),
        cup_size.as_deref(),
        avatar_base64.as_deref(),
        alias.as_deref(),
        weight.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

fn normalize_photo_path_for_storage(path: &str) -> String {
    storage::path_relative_to_data_dir(&storage::resolve_data_path(path))
}

#[tauri::command]
async fn save_actor_photo(source_path: String) -> Result<String, String> {
    save_image_asset(&source_path, &storage::actor_photos_dir(), "actor")
}

#[tauri::command]
async fn save_video_thumbnail(source_path: String) -> Result<String, String> {
    save_image_asset(
        &source_path,
        &storage::video_thumbnails_dir(),
        "video-thumbnail",
    )
}

fn save_image_asset(source_path: &str, data_dir: &Path, prefix: &str) -> Result<String, String> {
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;

    let source = Path::new(source_path);
    if !source.exists() || !source.is_file() {
        return Err("选择的海报文件不存在".to_string());
    }

    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let copy_directly = ["jpg", "jpeg", "png", "webp", "gif", "svg", "avif"];
    let convert_to_png = ["bmp", "tif", "tiff", "ico"];

    let dest = if copy_directly.contains(&ext.as_str()) {
        let filename = format!("{}-{}.{}", prefix, uuid::Uuid::new_v4(), ext);
        let dest = data_dir.join(filename);
        std::fs::copy(source, &dest).map_err(|e| e.to_string())?;
        dest
    } else if convert_to_png.contains(&ext.as_str()) {
        let filename = format!("{}-{}.png", prefix, uuid::Uuid::new_v4());
        let dest = data_dir.join(filename);
        let image = ImageReader::open(source)
            .map_err(|e| format!("读取图片失败: {}", e))?
            .decode()
            .map_err(|e| format!("解析图片失败: {}", e))?;
        image
            .save_with_format(&dest, image::ImageFormat::Png)
            .map_err(|e| format!("转换图片失败: {}", e))?;
        dest
    } else if ext == "heic" || ext == "heif" {
        return Err("HEIC/HEIF 需要 Windows 系统已安装 HEIF 图像扩展；当前内置转换器暂不支持。请先另存为 JPG/PNG/WebP 后再导入。".to_string());
    } else {
        return Err(format!("不支持的图片格式: {}", ext));
    };

    let relative_path = storage::path_relative_to_data_dir(&dest);
    eprintln!(
        "[ChangLi] 图片资产已保存: {} -> {}",
        dest.display(),
        relative_path
    );
    Ok(relative_path)
}

#[tauri::command]
async fn get_storage_info() -> Result<storage::StorageInfo, String> {
    storage::storage_info().map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_data_dir() -> Result<(), String> {
    let data_dir = storage::active_data_dir();
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    open::that(&data_dir).map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_series_in_file_manager(state: State<'_, AppState>, series_id: i64) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };

    let folder_path = sqlx::query_scalar::<_, Option<String>>("SELECT folder_path FROM video_series WHERE id = ?")
        .bind(series_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| e.to_string())?
        .flatten()
        .ok_or_else(|| "该视频集没有源文件路径".to_string())?;

    let source = std::path::PathBuf::from(&folder_path);
    let target = if source.is_file() {
        source
            .parent()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| "无法定位源文件所在位置".to_string())?
    } else {
        source
    };

    if !target.exists() {
        return Err("源文件路径不存在".to_string());
    }

    open::that(&target).map_err(|e| e.to_string())
}

#[tauri::command]
async fn repair_missing_posters_silent(state: State<'_, AppState>) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };

    let status = state.poster_repair_status.clone();
    {
        let mut current = status.lock().await;
        if current.status == "running" {
            return Ok(());
        }
        *current = PosterRepairStatus {
            status: "running".to_string(),
            ..PosterRepairStatus::default()
        };
    }

    tauri::async_runtime::spawn(async move {
        let progress_status = status.clone();
        match db::repair_missing_posters_with_progress(&pool, move |result| {
            let progress_status = progress_status.clone();
            let result = result.clone();
            tauri::async_runtime::spawn(async move {
                let mut current = progress_status.lock().await;
                if current.status == "running" {
                    current.scanned_series = result.scanned_series;
                    current.updated_series = result.updated_series;
                    current.scanned_videos = result.scanned_videos;
                    current.updated_videos = result.updated_videos;
                    current.skipped = result.skipped;
                }
            });
        }).await {
            Ok(result) => {
                eprintln!(
                    "[ChangLi] 批量修复海报完成: scanned_series={}, updated_series={}, scanned_videos={}, updated_videos={}, skipped={}",
                    result.scanned_series,
                    result.updated_series,
                    result.scanned_videos,
                    result.updated_videos,
                    result.skipped,
                );
                let mut current = status.lock().await;
                *current = PosterRepairStatus {
                    status: "success".to_string(),
                    scanned_series: result.scanned_series,
                    updated_series: result.updated_series,
                    scanned_videos: result.scanned_videos,
                    updated_videos: result.updated_videos,
                    skipped: result.skipped,
                    error: None,
                };
            }
            Err(error) => {
                eprintln!("[ChangLi] 批量修复海报失败: {error}");
                let mut current = status.lock().await;
                *current = PosterRepairStatus {
                    status: "error".to_string(),
                    error: Some(error.to_string()),
                    ..current.clone()
                };
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn get_poster_repair_status(state: State<'_, AppState>) -> Result<PosterRepairStatus, String> {
    Ok(state.poster_repair_status.lock().await.clone())
}

fn preview_temp_dir() -> PathBuf {
    std::env::temp_dir().join("changli-preview")
}

#[tauri::command]
async fn create_preview_file_path(seq: u64) -> Result<String, String> {
    let dir = preview_temp_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let filename = format!("preview-{}-{seq}.jpg", uuid::Uuid::new_v4());
    Ok(dir.join(filename).to_string_lossy().to_string())
}

#[tauri::command]
async fn delete_preview_file(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let preview_dir = preview_temp_dir();
    let canonical_dir = preview_dir.canonicalize().map_err(|e| e.to_string())?;

    if target.exists() {
        let canonical_target = target.canonicalize().map_err(|e| e.to_string())?;
        if !canonical_target.starts_with(&canonical_dir) {
            return Err("拒绝删除非 ChangLi 预览临时文件".to_string());
        }
        std::fs::remove_file(canonical_target).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
async fn delete_actor(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::delete_actor(&pool, id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_actor_resources(
    state: State<'_, AppState>,
    actor_id: i64,
) -> Result<Vec<db::Video>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_actor_resources(&pool, actor_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_actor_periods(
    state: State<'_, AppState>,
    actor_id: i64,
) -> Result<Vec<db::ActorPeriod>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_actor_periods(&pool, actor_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_actor_period(
    state: State<'_, AppState>,
    actor_id: i64,
    name: String,
) -> Result<db::ActorPeriod, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::add_actor_period(&pool, actor_id, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_actor_period(
    state: State<'_, AppState>,
    id: i64,
    name: String,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::update_actor_period(&pool, id, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_actor_period(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::delete_actor_period(&pool, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn reorder_actor_periods_cmd(
    state: State<'_, AppState>,
    period_ids: Vec<i64>,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::reorder_actor_periods(&pool, period_ids)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_actor_work_period_map(
    state: State<'_, AppState>,
    actor_id: i64,
) -> Result<std::collections::HashMap<String, i64>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_actor_work_period_map(&pool, actor_id)
        .await
        .map_err(|e| e.to_string())
}

// 标签相关命令
#[tauri::command]
async fn get_tags(state: State<'_, AppState>) -> Result<Vec<db::Tag>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_tags(&pool).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_tags_by_category(state: State<'_, AppState>, category_key: String) -> Result<Vec<db::Tag>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_tags_by_category(&pool, &category_key).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_tag(state: State<'_, AppState>, name: String) -> Result<db::Tag, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::add_tag(&pool, &name).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_tag(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::delete_tag(&pool, id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_resource_tags(
    state: State<'_, AppState>,
    resource_id: i64,
) -> Result<Vec<db::Tag>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_resource_tags(&pool, resource_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_resource_tag(
    state: State<'_, AppState>,
    resource_id: i64,
    tag_id: i64,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::add_resource_tag(&pool, resource_id, tag_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn remove_resource_tag(
    state: State<'_, AppState>,
    resource_id: i64,
    tag_id: i64,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::remove_resource_tag(&pool, resource_id, tag_id)
        .await
        .map_err(|e| e.to_string())
}

// 资源演员关联命令
#[tauri::command]
async fn get_resource_actors(
    state: State<'_, AppState>,
    resource_id: i64,
) -> Result<Vec<db::Actor>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_resource_actors(&pool, resource_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_resource_actor(
    state: State<'_, AppState>,
    resource_id: i64,
    actor_id: i64,
    role: Option<String>,
    period_id: Option<i64>,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::add_resource_actor(&pool, resource_id, actor_id, role.as_deref(), period_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn remove_resource_actor(
    state: State<'_, AppState>,
    resource_id: i64,
    actor_id: i64,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::remove_resource_actor(&pool, resource_id, actor_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_series_tags(
    state: State<'_, AppState>,
    series_id: i64,
) -> Result<Vec<db::Tag>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_series_tags(&pool, series_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_series_tag(
    state: State<'_, AppState>,
    series_id: i64,
    tag_id: i64,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::add_series_tag(&pool, series_id, tag_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn remove_series_tag(
    state: State<'_, AppState>,
    series_id: i64,
    tag_id: i64,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::remove_series_tag(&pool, series_id, tag_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_series_actors(
    state: State<'_, AppState>,
    series_id: i64,
) -> Result<Vec<db::Actor>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_series_actors(&pool, series_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_series_actor(
    state: State<'_, AppState>,
    series_id: i64,
    actor_id: i64,
    role: Option<String>,
    period_id: Option<i64>,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::add_series_actor(&pool, series_id, actor_id, role.as_deref(), period_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn remove_series_actor(
    state: State<'_, AppState>,
    series_id: i64,
    actor_id: i64,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::remove_series_actor(&pool, series_id, actor_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_actor_work_period(
    state: State<'_, AppState>,
    actor_id: i64,
    work_type: String,
    work_id: i64,
    period_id: Option<i64>,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::update_actor_work_period(&pool, actor_id, &work_type, work_id, period_id)
        .await
        .map_err(|e| e.to_string())
}

// 播放器相关命令
#[tauri::command]
async fn play_video(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: i64,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };

    let video = db::get_video(&pool, id).await.map_err(|e| e.to_string())?;
    if let Some(video) = video {
        player::play(&app, &video.file_path).map_err(|e| e.to_string())?;
        db::record_play_history(&pool, video.id, 0.0, video.duration)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}


#[tauri::command]
async fn open_player_window(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: i64,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };

    let video = db::get_video(&pool, id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "视频不存在".to_string())?;
    let mut target_w = 1280.0;
    let mut target_h = 720.0;
    if let Some(main) = app.get_webview_window("main") {
        let main_size = main.outer_size().map_err(|e| e.to_string())?;
        let scale = main.scale_factor().unwrap_or(1.0);
        target_w = (main_size.width as f64 / scale * 0.90).max(960.0);
        target_h = (main_size.height as f64 / scale * 0.88).max(540.0);
    } else if let Some(monitor) = app.primary_monitor().map_err(|e| e.to_string())? {
        let scale = monitor.scale_factor();
        target_w = (monitor.size().width as f64 / scale * 0.78).max(960.0);
        target_h = (monitor.size().height as f64 / scale * 0.78).max(540.0);
    }

    // 播放窗口按视频比例贴近主程序窗口大小：高分辨率会被限制，低分辨率也会自动放大。
    let aspect = match (video.width, video.height) {
        (Some(w), Some(h)) if w > 0 && h > 0 => (w as f64 / h as f64).clamp(0.45, 3.20),
        _ => 16.0 / 9.0,
    };
    let mut player_w = target_w;
    let mut player_h = (player_w / aspect).round();
    if player_h > target_h {
        player_h = target_h;
        player_w = (player_h * aspect).round();
    }
    player_w = player_w.max(640.0).min(target_w);
    player_h = player_h.max(360.0).min(target_h);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let label = format!("player-{}-{}", video.id, now);
    let url = tauri::WebviewUrl::App(format!("index.html?window=player&videoId={}", video.id).into());
    let mut builder = tauri::WebviewWindowBuilder::new(&app, label, url)
        .title(format!("ChangLi Player - {}", video.file_name))
        .inner_size(player_w, player_h)
        .min_inner_size(520.0, 292.0)
        // 禁用系统级自由拉伸，只允许前端右下角等比拉伸
        .resizable(false)
        .decorations(false)
        .visible(false);

    // libmpv 在 WebView 窗口下方渲染视频层；Windows 上如果 WebView 不透明，
    // 会出现"有声音但白屏"的遮挡。播放窗口必须保持透明，控制栏自身再绘制深色背景。
    builder = builder.transparent(true);

    let window = builder
        .build()
        .map_err(|e| e.to_string())?;

    if let Some(main) = app.get_webview_window("main") {
        let main_pos = main.outer_position().map_err(|e| e.to_string())?;
        let main_size = main.outer_size().map_err(|e| e.to_string())?;
        let scale = main.scale_factor().unwrap_or(1.0);
        let x = main_pos.x as f64 / scale + (main_size.width as f64 / scale - player_w) / 2.0;
        let y = main_pos.y as f64 / scale + (main_size.height as f64 / scale - player_h) / 2.0;
        window
            .set_position(tauri::LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    } else {
        window.center().map_err(|e| e.to_string())?;
    }
    // 先立即显示并聚焦，避免 mpv 已在后台播放但窗口因 dwidth/dheight 事件未触发而一直隐藏。
    // 前端收到视频尺寸后仍会按比例做小幅微调。
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

/// 一键切换游戏覆盖禁用状态
#[tauri::command]
fn set_game_overlay_disabled(disabled: bool) -> Result<String, String> {
    player::set_game_overlay_disabled(disabled)
}

/// 读取游戏覆盖当前禁用状态
#[tauri::command]
fn get_game_overlay_disabled() -> Result<bool, String> {
    player::read_game_overlay_disabled()
}

#[tauri::command]
async fn get_missing_series_videos(
    state: State<'_, AppState>,
    series_id: i64,
) -> Result<Vec<db::Video>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };

    let videos = db::get_series_videos(&pool, series_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(videos
        .into_iter()
        .filter(|video| !std::path::Path::new(&video.file_path).is_file())
        .collect())
}

#[tauri::command]
async fn update_play_history(
    state: State<'_, AppState>,
    video_id: i64,
    last_position: f64,
    total_duration: Option<f64>,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::record_play_history(&pool, video_id, last_position, total_duration)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_play_history(state: State<'_, AppState>) -> Result<Vec<db::PlayHistory>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_play_history(&pool).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_recent_watch_items(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> Result<Vec<db::RecentWatchItem>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_recent_watch_items(&pool, limit.unwrap_or(6))
        .await
        .map_err(|e| e.to_string())
}

// 观看进度相关命令
#[tauri::command]
async fn update_watch_progress(
    state: State<'_, AppState>,
    resource_id: i64,
    episode: i32,
    position: f64,
    duration: f64,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::update_watch_progress(&pool, resource_id, episode, position, duration)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_watch_progress(
    state: State<'_, AppState>,
    resource_id: i64,
    episode: i32,
) -> Result<Option<db::WatchProgress>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_watch_progress(&pool, resource_id, episode)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_resource_watch_progress(
    state: State<'_, AppState>,
    resource_id: i64,
) -> Result<Vec<db::WatchProgress>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_resource_watch_progress(&pool, resource_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_series_seasons(
    state: State<'_, AppState>,
    series_id: i64,
) -> Result<Vec<db::SeasonInfo>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_series_seasons(&pool, series_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_season(
    state: State<'_, AppState>,
    series_id: i64,
    season: i32,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::delete_season(&pool, series_id, season)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_season(
    state: State<'_, AppState>,
    series_id: i64,
    season: i32,
    subtitle: Option<String>,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::create_season(&pool, series_id, season, subtitle.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_video_subtitle(
    state: State<'_, AppState>,
    video_id: i64,
    subtitle: Option<String>,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::update_video_subtitle(&pool, video_id, subtitle)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn rescan_all_series_metadata(state: State<'_, AppState>) -> Result<(i64, i64), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::rescan_all_series_metadata(&pool)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn rescan_anime_metadata(state: State<'_, AppState>) -> Result<(i64, i64), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::rescan_anime_metadata(&pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn rescan_adult_metadata(state: State<'_, AppState>) -> Result<(i64, i64), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::rescan_adult_metadata(&pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn rescan_single_series_metadata(
    state: State<'_, AppState>,
    series_id: i64,
) -> Result<bool, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::rescan_single_series_metadata(&pool, series_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn check_series_updates(
    state: State<'_, AppState>,
    series_id: i64,
) -> Result<db::SeriesUpdateResult, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::check_series_updates(&pool, series_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn check_category_updates(
    state: State<'_, AppState>,
    category_key: String,
) -> Result<db::CategoryUpdateResult, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::check_category_updates(&pool, &category_key)
        .await
        .map_err(|e| e.to_string())
}

// 演员多海报命令
#[tauri::command]
async fn get_actor_photos(
    state: State<'_, AppState>,
    actor_id: i64,
) -> Result<Vec<db::ActorPhoto>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_actor_photos(&pool, actor_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_actor_photo_cmd(
    state: State<'_, AppState>,
    actor_id: i64,
    photo: Option<String>,
    photo_base64: Option<String>,
    is_primary: Option<i32>,
) -> Result<db::ActorPhoto, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    let stored_photo = photo.as_deref().map(normalize_photo_path_for_storage);
    // 如果没传 base64，从文件路径读取生成
    let effective_base64 = if photo_base64.is_some() {
        photo_base64
    } else if let Some(ref path) = stored_photo {
        let resolved = storage::resolve_data_path(path);
        db::image_data_url(&resolved)
    } else {
        None
    };
    db::add_actor_photo(
        &pool,
        actor_id,
        stored_photo.as_deref(),
        effective_base64.as_deref(),
        is_primary.unwrap_or(0),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_actor_photo_cmd(state: State<'_, AppState>, photo_id: i64) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::delete_actor_photo(&pool, photo_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_primary_photo_cmd(
    state: State<'_, AppState>,
    actor_id: i64,
    photo_id: i64,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::set_primary_photo(&pool, actor_id, photo_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn reorder_actor_photos_cmd(
    state: State<'_, AppState>,
    actor_id: i64,
    photo_ids: Vec<i64>,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::reorder_actor_photos(&pool, actor_id, photo_ids)
        .await
        .map_err(|e| e.to_string())
}


#[derive(serde::Serialize)]
struct ReleaseAssetInfo {
    name: String,
    browser_download_url: String,
}

#[derive(serde::Serialize)]
struct LatestReleaseInfo {
    tag_name: String,
    html_url: String,
    assets: Vec<ReleaseAssetInfo>,
}

#[derive(serde::Deserialize)]
struct GitHubReleaseAsset {
    name: String,
    browser_download_url: String,
}

#[derive(serde::Deserialize)]
struct GitHubLatestRelease {
    tag_name: String,
    html_url: String,
    assets: Vec<GitHubReleaseAsset>,
}

#[tauri::command]
async fn check_latest_release() -> Result<LatestReleaseInfo, String> {
    const REPO: &str = "YeSuper-git/ChangLi";
    const API_URL: &str = "https://api.github.com/repos/YeSuper-git/ChangLi/releases/latest";
    const LATEST_URL: &str = "https://github.com/YeSuper-git/ChangLi/releases/latest";
    const UA: &str = "ChangLi-App/1.0 (+https://github.com/YeSuper-git/ChangLi)";

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let api_result = client
        .get(API_URL)
        .header(reqwest::header::USER_AGENT, UA)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await;

    match api_result {
        Ok(response) if response.status().is_success() => {
            let release = response
                .json::<GitHubLatestRelease>()
                .await
                .map_err(|e| format!("解析 GitHub Release 响应失败: {e}"))?;
            return Ok(LatestReleaseInfo {
                tag_name: release.tag_name,
                html_url: release.html_url,
                assets: release
                    .assets
                    .into_iter()
                    .map(|asset| ReleaseAssetInfo {
                        name: asset.name,
                        browser_download_url: asset.browser_download_url,
                    })
                    .collect(),
            });
        }
        Ok(response) => {
            eprintln!("[ChangLi] GitHub Release API 返回 {}，尝试 releases/latest fallback", response.status());
        }
        Err(error) => {
            eprintln!("[ChangLi] GitHub Release API 请求失败: {error}，尝试 releases/latest fallback");
        }
    }

    let response = client
        .get(LATEST_URL)
        .header(reqwest::header::USER_AGENT, UA)
        .send()
        .await
        .map_err(|e| format!("检查更新失败: {e}"))?;
    let final_url = response.url().clone();
    let tag = final_url
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .filter(|segment| segment.starts_with('v'))
        .ok_or_else(|| format!("无法解析最新版本地址: {final_url}"))?
        .to_string();
    let version = tag.trim_start_matches('v');
    let installer_name = format!("ChangLi_{version}_x64-setup.exe");
    let html_url = format!("https://github.com/{REPO}/releases/tag/{tag}");
    let download_url = format!("https://github.com/{REPO}/releases/download/{tag}/{installer_name}");

    Ok(LatestReleaseInfo {
        tag_name: tag,
        html_url,
        assets: vec![ReleaseAssetInfo {
            name: installer_name,
            browser_download_url: download_url,
        }],
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_libmpv::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            db: Mutex::new(None),
            poster_repair_status: Arc::new(Mutex::new(PosterRepairStatus::default())),
        })
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.center()?;
                // 启动时短暂置顶一次用于拉到最前方，随后立即取消，避免程序长期始终置顶。
                window.set_always_on_top(true)?;
                window.set_focus()?;
                window.set_always_on_top(false)?;
            }
            // 禁用 Windows Game DVR，防止 NVIDIA/游戏加加把播放器识别为游戏
            player::disable_game_dvr();
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                player::handle_main_window_event(&window.app_handle(), event);
            }
        })
        .invoke_handler(tauri::generate_handler![
            init_db,
            check_latest_release,
            get_sites,
            add_site,
            update_site,
            delete_site,
            get_site_templates,
            validate_site_config,
            test_site_config,
            search_resources,
            get_resources,
            get_resources_by_category,
            get_recent_resources,
            add_download,
            get_downloads,
            pause_download,
            resume_download,
            remove_download,
            scan_videos,
            scan_videos_for_actor,
            get_videos,
            get_video,
            delete_video,
            get_video_series_list,
            get_video_series_by_tag,
            get_video_series_by_tag_name,
            get_video_series_by_actor,
            get_series_playback_video,
            get_video_series_detail,
            update_video_series,
            delete_video_series,
            delete_video_series_batch,
            delete_videos_batch,
            switch_series_type,
            switch_series_type_to,
            add_video_to_series,
            add_videos_to_series,
            add_category_series_by_paths,
            remove_video_from_series,
            get_actors,
            get_actors_by_category,
            increment_actor_view,
            get_actor,
            add_actor,
            update_actor,
            delete_actor,
            get_actor_resources,
            get_tags,
            get_tags_by_category,
            add_tag,
            delete_tag,
            get_resource_tags,
            add_resource_tag,
            remove_resource_tag,
            get_resource_actors,
            add_resource_actor,
            remove_resource_actor,
            get_series_tags,
            add_series_tag,
            remove_series_tag,
            get_series_actors,
            add_series_actor,
            remove_series_actor,
            update_actor_work_period,
            play_video,
            open_player_window,
            get_missing_series_videos,
            check_series_updates,
            check_category_updates,
            update_play_history,
            get_play_history,
            get_recent_watch_items,
            update_watch_progress,
            get_watch_progress,
            get_resource_watch_progress,
            update_video,
            save_actor_photo,
            save_video_thumbnail,
            create_preview_file_path,
            delete_preview_file,
            get_storage_info,
            open_data_dir,
            open_series_in_file_manager,
            repair_missing_posters_silent,
            get_poster_repair_status,
            toggle_favorite,
            toggle_chinese_sub,
            toggle_watched,
            get_favorite_videos_cmd,
            get_favorite_series_cmd,
            rescan_all_series_metadata,
            rescan_single_series_metadata,
            delete_all_videos,
            delete_all_anime,
            delete_all_adult,
            delete_videos_by_category,
            rescan_anime_metadata,
            rescan_adult_metadata,
            rescan_category_metadata,
            get_series_seasons,
            delete_season,
            create_season,
            update_video_subtitle,
            get_actor_periods,
            add_actor_period,
            update_actor_period,
            delete_actor_period,
            reorder_actor_periods_cmd,
            get_actor_work_period_map,
            get_actor_photos,
            add_actor_photo_cmd,
            delete_actor_photo_cmd,
            set_primary_photo_cmd,
            reorder_actor_photos_cmd,
            get_all_categories,
            create_category_cmd,
            update_category_cmd,
            delete_category_cmd,
            reorder_categories_cmd,
            scan_category,
            get_all_actor_fields,
            update_actor_field_cmd,
            create_actor_field_cmd,
            delete_actor_field_cmd,
            reorder_actor_fields_cmd,
            get_preset_templates_cmd,
            get_extension_preset_templates_cmd,
            is_preset_template_enabled_cmd,
            enable_preset_template_cmd,
            disable_preset_template_cmd,
            set_game_overlay_disabled,
            get_game_overlay_disabled,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn get_resources(state: State<'_, AppState>) -> Result<Vec<db::Resource>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_resources(&pool).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_resources_by_category(
    state: State<'_, AppState>,
    category: String,
) -> Result<Vec<db::Resource>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_resources_by_category(&pool, &category)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_recent_resources(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> Result<Vec<db::Resource>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    let limit = limit.unwrap_or(10);
    db::get_recent_resources(&pool, limit)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_video(
    state: State<'_, AppState>,
    id: i64,
    file_name: Option<String>,
    description: Option<String>,
    thumbnail: Option<String>,
) -> Result<db::Video, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    let stored_thumbnail = thumbnail.as_deref().map(normalize_photo_path_for_storage);
    db::update_video(&pool, id, file_name, description, stored_thumbnail)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn toggle_favorite(
    state: State<'_, AppState>,
    id: i64,
    fav_type: String,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    match fav_type.as_str() {
        "video" => db::toggle_favorite_video(&pool, id)
            .await
            .map_err(|e| e.to_string()),
        "series" => db::toggle_favorite_series(&pool, id)
            .await
            .map_err(|e| e.to_string()),
        _ => Err("无效类型".to_string()),
    }
}

#[tauri::command]
async fn toggle_chinese_sub(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::toggle_chinese_sub_series(&pool, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn toggle_watched(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::toggle_watched_series(&pool, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_favorite_videos_cmd(state: State<'_, AppState>) -> Result<Vec<db::Video>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_favorite_videos(&pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_favorite_series_cmd(
    state: State<'_, AppState>,
) -> Result<Vec<db::VideoSeries>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_favorite_series(&pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_all_videos(state: State<'_, AppState>) -> Result<(i64, i64), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::delete_all_videos(&pool)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn delete_all_anime(state: State<'_, AppState>) -> Result<(i64, i64), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::delete_all_anime(&pool).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_all_adult(state: State<'_, AppState>) -> Result<(i64, i64), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::delete_all_adult(&pool).await.map_err(|e| e.to_string())
}
#[tauri::command]
async fn delete_videos_by_category(state: State<'_, AppState>, category_key: String) -> Result<(i64, i64), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::delete_videos_by_category(&pool, &category_key).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn rescan_category_metadata(state: State<'_, AppState>, category_key: String) -> Result<(i64, i64, i64, i64), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::rescan_category_metadata(&pool, &category_key).await.map_err(|e| e.to_string())
}

// ==================== 大类配置 Commands ====================

#[tauri::command]
async fn get_all_categories(state: State<'_, AppState>) -> Result<Vec<db::Category>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_all_categories(&pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_category_cmd(
    state: State<'_, AppState>,
    key: String,
    name: String,
    card_layout: String,
    features: String,
    scan_path: Option<String>,
) -> Result<db::Category, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::create_category(&pool, &key, &name, &card_layout, &features, scan_path.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_category_cmd(
    state: State<'_, AppState>,
    key: String,
    name: String,
    card_layout: String,
    features: String,
    scan_path: Option<String>,
) -> Result<db::Category, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::update_category(&pool, &key, &name, &card_layout, &features, scan_path.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_category_cmd(state: State<'_, AppState>, key: String) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::delete_category(&pool, &key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn reorder_categories_cmd(state: State<'_, AppState>, category_keys: Vec<String>) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::reorder_categories(&pool, &category_keys)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn scan_category(state: State<'_, AppState>, category_key: String) -> Result<ScanResult, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };

    // 1. 读取大类配置
    let category = db::get_category_by_key(&pool, &category_key)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("大类 '{}' 不存在", category_key))?;

    let scan_path = category.scan_path.ok_or_else(|| {
        format!("大类 '{}' 未设置扫描路径", category.name)
    })?;

    let path = Path::new(&scan_path);
    if !path.exists() {
        return Err(format!("扫描路径不存在: {}", scan_path));
    }

    // 解析 features
    let features: serde_json::Value = serde_json::from_str(&category.features).unwrap_or_default();
    let actors_enabled = features.get("actors").and_then(|v| v.as_bool()).unwrap_or(false);
    let tags_enabled = features.get("tags").and_then(|v| v.as_bool()).unwrap_or(false);

    let mut added: i64 = 0;
    let mut updated: i64 = 0;

    // 2. 检查 scan_path 下是否有子文件夹
    let mut has_subdirs = false;
    let mut has_videos = false;
    if let Ok(check_entries) = std::fs::read_dir(&scan_path) {
        for e in check_entries.filter_map(|e| e.ok()) {
            if e.path().is_dir() { has_subdirs = true; }
            if e.path().is_file() && scanner::is_video_file(&e.path()) { has_videos = true; }
        }
    }
    let root_poster = crate::scanner::find_folder_poster(std::path::Path::new(&scan_path));

    // 如果没有子文件夹，把 scan_path 本身当一个视频集；动漫暂无资源视频集可能只有海报、没有视频文件。
    if !has_subdirs && (has_videos || root_poster.is_some()) {
        let folder_name = std::path::Path::new(&scan_path)
            .file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let (series_title, code, has_chinese_sub) = extract_adult_metadata(&folder_name);
        let scan_result = scanner::scan_directory(&scan_path).await.map_err(|e| e.to_string())?;
        let poster = root_poster;
        let poster_base64 = poster.as_deref().and_then(|p| scanner::generate_thumbnail_base64(std::path::Path::new(p)));
        if let Some(existing) = db::get_video_series_by_folder_path(&pool, &scan_path).await.map_err(|e| e.to_string())? {
            // 全量检查更新只同步视频增删与分类关联，不改已有视频集海报。
            db::add_videos_batch(&pool, scan_result.videos, Some(existing.id)).await.map_err(|e| e.to_string())?;
            updated += 1;
        } else {
            let series = db::add_video_series(&pool, &series_title, Some(&scan_path), poster.as_deref(), Some("landscape"), Some("ongoing"), poster_base64.as_deref(), Some(&category_key)).await.map_err(|e| e.to_string())?;
            if let Some(c) = code {
                let _ = sqlx::query("UPDATE video_series SET code = ?, has_chinese_sub = ? WHERE id = ?").bind(&c).bind(has_chinese_sub).bind(series.id).execute(&pool).await;
            }
            db::add_videos_batch(&pool, scan_result.videos, Some(series.id)).await.map_err(|e| e.to_string())?;
            let _ = db::update_video_series_display_type(&pool, series.id, &category_key).await;
            added += 1;
        }
        return Ok(ScanResult { added, updated });
    }

    // 3. 遍历子文件夹
    let entries = std::fs::read_dir(&scan_path).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();
        let entry_name = entry.file_name().to_string_lossy().to_string();

        if !entry_path.is_dir() {
            continue;
        }

        // 分类未勾选演员/标签时，分类下一层直接就是视频集
        if !actors_enabled && !tags_enabled {
            let scan_result = scanner::scan_directory(&entry_path.to_string_lossy())
                .await
                .map_err(|e| e.to_string())?;
            let poster = crate::scanner::find_folder_poster(&entry_path);
            let poster_base64 = poster.as_deref().and_then(|p| {
                scanner::generate_thumbnail_base64(std::path::Path::new(p))
            });
            let folder_path_str = entry_path.to_string_lossy().to_string();

            if let Some(existing) = db::get_video_series_by_folder_path(&pool, &folder_path_str)
                .await
                .map_err(|e| e.to_string())?
            {
                // 全量检查更新只同步视频增删与分类关联，不改已有视频集海报。
                db::add_videos_batch(&pool, scan_result.videos, Some(existing.id))
                    .await.map_err(|e| e.to_string())?;
                let _ = db::update_video_series_display_type(&pool, existing.id, &category_key).await;
                updated += 1;
            } else {
                let (series_title, code, has_chinese_sub) = extract_adult_metadata(&entry_name);
                let series = db::add_video_series(
                    &pool,
                    &series_title,
                    Some(&folder_path_str),
                    poster.as_deref(),
                    Some("landscape"),
                    Some("ongoing"),
                    poster_base64.as_deref(),
                    Some(&category_key),
                ).await.map_err(|e| e.to_string())?;
                if let Some(c) = code {
                    let _ = sqlx::query("UPDATE video_series SET code = ?, has_chinese_sub = ? WHERE id = ?")
                        .bind(&c).bind(has_chinese_sub).bind(series.id).execute(&pool).await;
                }
                db::add_videos_batch(&pool, scan_result.videos, Some(series.id))
                    .await.map_err(|e| e.to_string())?;
                let _ = db::update_video_series_display_type(&pool, series.id, &category_key).await;
                added += 1;
            }
            continue;
        }

        // 3. 根据 features 决定匹配方式
        let matched_actor: Option<i64> = if actors_enabled {
            match db::get_actor_by_name_or_jp(&pool, entry_name.trim()).await {
                Ok(Some(actor)) => Some(actor.id),
                _ => None,
            }
        } else {
            None
        };

        let matched_tag: Option<i64> = if tags_enabled && matched_actor.is_none() {
            match db::get_tag_by_name(&pool, entry_name.trim()).await {
                Ok(Some(tag)) => Some(tag.id),
                _ => None,
            }
        } else {
            None
        };

        // 都没匹配到但启用了标签/演员：跳过
        if (actors_enabled || tags_enabled) && matched_actor.is_none() && matched_tag.is_none() {
            eprintln!("[ChangLi] scan_category: 子文件夹 '{}' 未匹配到演员或标签，跳过", entry_name);
            continue;
        }

        // 4. 处理子文件夹下的子文件夹/视频
        // 如果匹配到演员，预加载时期列表用于时期文件夹匹配
        let actor_periods: Vec<db::ActorPeriod> = if let Some(aid) = matched_actor {
            db::get_actor_periods(&pool, aid).await.unwrap_or_default()
        } else {
            vec![]
        };
        // 演员时期名 → period_id 的映射
        let period_map: std::collections::HashMap<String, i64> = actor_periods
            .iter()
            .map(|p| (p.name.clone(), p.id))
            .collect();

        let sub_entries = std::fs::read_dir(&entry_path).map_err(|e| e.to_string())?;
        for sub_entry in sub_entries {
            let sub_entry = sub_entry.map_err(|e| e.to_string())?;
            let sub_entry_path = sub_entry.path();
            let sub_entry_name = sub_entry.file_name().to_string_lossy().to_string();

            // 如果子文件夹名匹配演员时期名，递归进时期文件夹扫描
            let matched_period_id = period_map.get(&sub_entry_name).copied();
            if sub_entry_path.is_dir() && matched_period_id.is_some() {
                let period_path = &sub_entry_path;
                let period_entries = std::fs::read_dir(period_path).map_err(|e| e.to_string())?;
                for period_entry in period_entries {
                    let period_entry = period_entry.map_err(|e| e.to_string())?;
                    let pe_path = period_entry.path();
                    if !pe_path.is_dir() { continue; }
                    let pe_name = period_entry.file_name().to_string_lossy().to_string();
                    let pe_result = scanner::scan_directory(&pe_path.to_string_lossy())
                        .await.map_err(|e| e.to_string())?;
                    // 时期文件夹下每个视频集必须只取自己的海报，不能取时期父目录海报，
                    // 否则同一时期下的多个无季视频集会被批量替换成同一张图。
                    let pe_poster = crate::scanner::find_folder_poster(&pe_path);
                    let pe_poster_base64 = pe_poster.as_deref().and_then(|p| {
                        scanner::generate_thumbnail_base64(std::path::Path::new(p))
                    });
                    let pe_folder = pe_path.to_string_lossy().to_string();

                    if let Some(existing) = db::get_video_series_by_folder_path(&pool, &pe_folder)
                        .await.map_err(|e| e.to_string())?
                    {
                        // 全量检查更新只同步视频增删与分类关联，不改已有视频集海报。
                        db::add_videos_batch(&pool, pe_result.videos, Some(existing.id))
                            .await.map_err(|e| e.to_string())?;
                        if let Some(aid) = matched_actor {
                            let _ = db::add_series_actor(&pool, existing.id, aid, None, matched_period_id).await;
                            let _ = db::update_video_series_display_type(&pool, existing.id, &category_key).await;
                        }
                        updated += 1;
                    } else {
                        let (series_title, code, has_chinese_sub) = extract_adult_metadata(&pe_name);
                        let series = db::add_video_series(
                            &pool, &series_title, Some(&pe_folder),
                            pe_poster.as_deref(), Some("landscape"), Some("ongoing"),
                            pe_poster_base64.as_deref(), Some(&category_key),
                        ).await.map_err(|e| e.to_string())?;
                        if let Some(c) = code {
                            let _ = sqlx::query("UPDATE video_series SET code = ?, has_chinese_sub = ? WHERE id = ?")
                                .bind(&c).bind(has_chinese_sub).bind(series.id).execute(&pool).await;
                        }
                        db::add_videos_batch(&pool, pe_result.videos, Some(series.id))
                            .await.map_err(|e| e.to_string())?;
                        if let Some(aid) = matched_actor {
                            let _ = db::add_series_actor(&pool, series.id, aid, None, matched_period_id).await;
                        }
                        let _ = db::update_video_series_display_type(&pool, series.id, &category_key).await;
                        added += 1;
                    }
                }
                continue; // 时期文件夹已处理，跳过下面的直接视频集逻辑
            }

            if sub_entry_path.is_dir() {
                let sub_result = scanner::scan_directory(&sub_entry_path.to_string_lossy())
                    .await
                    .map_err(|e| e.to_string())?;
                // 演员/标签目录下每个视频集必须只取自己的海报，不能取演员/标签父目录海报，
                // 否则同一演员/标签下多个无季视频集会被批量替换成同一张图。
                let sub_poster = crate::scanner::find_folder_poster(&sub_entry_path);
                let sub_poster_base64 = sub_poster.as_deref().and_then(|p| {
                    scanner::generate_thumbnail_base64(std::path::Path::new(p))
                });
                let folder_path_str = sub_entry_path.to_string_lossy().to_string();

                if let Some(existing) = db::get_video_series_by_folder_path(&pool, &folder_path_str)
                    .await
                    .map_err(|e| e.to_string())?
                {
                    // 全量检查更新只同步视频增删与分类关联，不改已有视频集海报。
                    db::add_videos_batch(&pool, sub_result.videos, Some(existing.id))
                        .await.map_err(|e| e.to_string())?;
                    if let Some(aid) = matched_actor {
                        let _ = db::add_series_actor(&pool, existing.id, aid, None, None).await;
                        let _ = db::update_video_series_display_type(&pool, existing.id, &category_key).await;
                    }
                    if let Some(tid) = matched_tag {
                        let _ = db::add_series_tag(&pool, existing.id, tid).await;
                        let _ = db::update_video_series_display_type(&pool, existing.id, &category_key).await;
                    }
                    updated += 1;
                } else {
                    let (series_title, code, has_chinese_sub) = extract_adult_metadata(&sub_entry_name);
                    let series = db::add_video_series(
                        &pool, &series_title, Some(&folder_path_str),
                        sub_poster.as_deref(), Some("landscape"), Some("ongoing"),
                        sub_poster_base64.as_deref(), Some(&category_key),
                    ).await.map_err(|e| e.to_string())?;
                    if let Some(c) = code {
                        let _ = sqlx::query("UPDATE video_series SET code = ?, has_chinese_sub = ? WHERE id = ?")
                            .bind(&c).bind(has_chinese_sub).bind(series.id).execute(&pool).await;
                    }
                    db::add_videos_batch(&pool, sub_result.videos, Some(series.id))
                        .await.map_err(|e| e.to_string())?;
                    if let Some(aid) = matched_actor {
                        let _ = db::add_series_actor(&pool, series.id, aid, None, None).await;
                    }
                    if let Some(tid) = matched_tag {
                        let _ = db::add_series_tag(&pool, series.id, tid).await;
                    }
                    let _ = db::update_video_series_display_type(&pool, series.id, &category_key).await;
                    added += 1;
                }
            } else if sub_entry_path.is_file() && scanner::is_video_file(&sub_entry_path) {
                let video = scanner::scan_video_file(&sub_entry_path, None)
                    .await.map_err(|e| e.to_string())?;
                let file_stem = sub_entry_path.file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| sub_entry_name.clone());
                let thumb = video.thumbnail.as_deref().and_then(|t| {
                    scanner::generate_thumbnail_base64(std::path::Path::new(t))
                });
                let file_path_str = sub_entry_path.to_string_lossy().to_string();

                if let Some(existing) = db::get_video_series_by_folder_path(&pool, &file_path_str)
                    .await.map_err(|e| e.to_string())?
                {
                    // 全量检查更新只同步视频增删与分类关联，不改已有视频集海报。
                    db::add_videos_batch(&pool, vec![video], Some(existing.id))
                        .await.map_err(|e| e.to_string())?;
                    if let Some(aid) = matched_actor {
                        let _ = db::add_series_actor(&pool, existing.id, aid, None, None).await;
                        let _ = db::update_video_series_display_type(&pool, existing.id, &category_key).await;
                    }
                    if let Some(tid) = matched_tag {
                        let _ = db::add_series_tag(&pool, existing.id, tid).await;
                        let _ = db::update_video_series_display_type(&pool, existing.id, &category_key).await;
                    }
                    updated += 1;
                } else {
                    let (series_title, code, has_chinese_sub) = extract_adult_metadata(&file_stem);
                    let series = db::add_video_series(
                        &pool, &series_title, Some(&file_path_str),
                        video.thumbnail.as_deref(), Some("landscape"), Some("ongoing"),
                        thumb.as_deref(),
                                None,
                    ).await.map_err(|e| e.to_string())?;
                    if let Some(c) = code {
                        let _ = sqlx::query("UPDATE video_series SET code = ?, has_chinese_sub = ? WHERE id = ?")
                            .bind(&c).bind(has_chinese_sub).bind(series.id).execute(&pool).await;
                    }
                    db::add_videos_batch(&pool, vec![video], Some(series.id))
                        .await.map_err(|e| e.to_string())?;
                    if let Some(aid) = matched_actor {
                        let _ = db::add_series_actor(&pool, series.id, aid, None, None).await;
                    }
                    if let Some(tid) = matched_tag {
                        let _ = db::add_series_tag(&pool, series.id, tid).await;
                    }
                    let _ = db::update_video_series_display_type(&pool, series.id, &category_key).await;
                    added += 1;
                }
            }
        }
    }

    Ok(ScanResult { added, updated })
}

// ==================== 演员字段配置 Commands ====================

#[tauri::command]
async fn get_all_actor_fields(
    state: State<'_, AppState>,
) -> Result<Vec<db::ActorField>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_all_actor_fields(&pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_actor_field_cmd(
    state: State<'_, AppState>,
    field_key: String,
    field_label: String,
    field_type: String,
    options: Option<String>,
    format: Option<String>,
    enabled: bool,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::update_actor_field(&pool, &field_key, &field_label, &field_type, options.as_deref(), format.as_deref(), enabled)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_actor_field_cmd(
    state: State<'_, AppState>,
    field_key: String,
    field_label: String,
    field_type: String,
    options: Option<String>,
    format: Option<String>,
) -> Result<db::ActorField, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::create_actor_field(&pool, &field_key, &field_label, &field_type, options.as_deref(), format.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_actor_field_cmd(
    state: State<'_, AppState>,
    field_key: String,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::delete_actor_field(&pool, &field_key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn reorder_actor_fields_cmd(
    state: State<'_, AppState>,
    field_keys: Vec<String>,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::reorder_actor_fields(&pool, &field_keys)
        .await
        .map_err(|e| e.to_string())
}

// ==================== 预设模板 Commands ====================

#[tauri::command]
async fn get_preset_templates_cmd(
    state: State<'_, AppState>,
) -> Result<Vec<db::PresetTemplate>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_preset_templates(&pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_extension_preset_templates_cmd(
    state: State<'_, AppState>,
) -> Result<Vec<db::PresetTemplate>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_extension_preset_templates(&pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn is_preset_template_enabled_cmd(
    state: State<'_, AppState>,
    key: String,
) -> Result<bool, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::is_preset_template_enabled(&pool, &key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn enable_preset_template_cmd(
    state: State<'_, AppState>,
    key: String,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::enable_preset_template(&pool, &key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn disable_preset_template_cmd(
    state: State<'_, AppState>,
    key: String,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::disable_preset_template(&pool, &key)
        .await
        .map_err(|e| e.to_string())
}
