// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod downloader;
mod html_parser;
mod http;
mod migrations;
mod parser;
mod player;
mod scanner;
mod site_config;
mod storage;

use image::ImageReader;
use std::path::Path;
use tauri::{Manager, State};
use tokio::sync::Mutex;

// 应用状态
struct AppState {
    db: Mutex<Option<sqlx::SqlitePool>>,
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
            name: site.name.clone(),
            url: site.url.clone(),
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
        db::add_video(&pool, video)
            .await
            .map_err(|e| e.to_string())?;
        return Ok(ScanResult { added: 1, updated: 0 });
    }

    let folder_name = import_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("未命名视频集")
        .to_string();

    // 如果文件夹名匹配已有标签，自动拆子文件夹为视频集并关联标签
    if let Ok(Some(tag)) = db::get_tag_by_name(&pool, folder_name.trim()).await {
        eprintln!("[ChangLi] 文件夹名 '{}' 匹配标签 '{}'，自动拆分子文件夹", folder_name, tag.name);
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
                if sub_result.videos.is_empty() {
                    continue;
                }
                let sub_poster = sub_result.posters.values().next().cloned();
                let sub_poster_base64 = sub_poster.as_deref()
                    .and_then(|p| scanner::generate_thumbnail_base64(std::path::Path::new(p)));
                let folder_path_str = entry_path.to_string_lossy().to_string();
                if let Some(existing) = db::get_video_series_by_folder_path(&pool, &folder_path_str).await.map_err(|e| e.to_string())? {
                    // 已存在：更新海报
                    db::update_video_series_poster(&pool, existing.id, sub_poster.as_deref(), sub_poster_base64.as_deref(), Some("landscape")).await.map_err(|e| e.to_string())?;
                    db::add_videos_batch(&pool, sub_result.videos, Some(existing.id)).await.map_err(|e| e.to_string())?;
                    updated += 1;
                } else {
                    let series = db::add_video_series(&pool, &entry_name, Some(&folder_path_str), sub_poster.as_deref(), Some("landscape"), Some("completed"), sub_poster_base64.as_deref()).await.map_err(|e| e.to_string())?;
                    db::add_videos_batch(&pool, sub_result.videos, Some(series.id)).await.map_err(|e| e.to_string())?;
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
                let file_stem = entry_path.file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| entry_name.clone());
                let thumb = video.thumbnail.as_deref()
                    .and_then(|t| scanner::generate_thumbnail_base64(std::path::Path::new(t)));
                let file_path_str = entry_path.to_string_lossy().to_string();
                if let Some(existing) = db::get_video_series_by_folder_path(&pool, &file_path_str).await.map_err(|e| e.to_string())? {
                    db::update_video_series_poster(&pool, existing.id, video.thumbnail.as_deref(), thumb.as_deref(), Some("landscape")).await.map_err(|e| e.to_string())?;
                    db::add_videos_batch(&pool, vec![video], Some(existing.id)).await.map_err(|e| e.to_string())?;
                    updated += 1;
                } else {
                    let series = db::add_video_series(&pool, &file_stem, Some(&file_path_str), video.thumbnail.as_deref(), Some("landscape"), Some("completed"), thumb.as_deref()).await.map_err(|e| e.to_string())?;
                    db::add_videos_batch(&pool, vec![video], Some(series.id)).await.map_err(|e| e.to_string())?;
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
        eprintln!("[ChangLi] 文件夹名 '{}' 匹配演员 '{}'，自动拆分子文件夹并关联演员", folder_name, actor.name);
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
                if sub_result.videos.is_empty() {
                    continue;
                }
                let sub_poster = sub_result.posters.values().next().cloned();
                let sub_poster_base64 = sub_poster.as_deref()
                    .and_then(|p| scanner::generate_thumbnail_base64(std::path::Path::new(p)));

                let folder_path_str = entry_path.to_string_lossy().to_string();
                if let Some(existing) = db::get_video_series_by_folder_path(&pool, &folder_path_str).await.map_err(|e| e.to_string())? {
                    db::update_video_series_poster(&pool, existing.id, sub_poster.as_deref(), sub_poster_base64.as_deref(), Some("landscape")).await.map_err(|e| e.to_string())?;
                    db::add_videos_batch(&pool, sub_result.videos, Some(existing.id)).await.map_err(|e| e.to_string())?;
                    updated += 1;
                } else {
                    let series = db::add_video_series(&pool, &entry_name, Some(&folder_path_str), sub_poster.as_deref(), Some("landscape"), Some("completed"), sub_poster_base64.as_deref()).await.map_err(|e| e.to_string())?;
                    db::add_videos_batch(&pool, sub_result.videos, Some(series.id)).await.map_err(|e| e.to_string())?;
                    if let Err(e) = db::add_series_actor(&pool, series.id, actor.id, None, None).await {
                        eprintln!("[ChangLi] 关联演员到视频集失败: {}", e);
                    }
                    added += 1;
                }
            } else if entry_path.is_file() && scanner::is_video_file(&entry_path) {
                // 根目录下的视频也创建视频集并关联演员
                let video = scanner::scan_video_file(&entry_path, None)
                    .await
                    .map_err(|e| e.to_string())?;
                let file_stem = entry_path.file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| entry_name.clone());
                let thumb = video.thumbnail.as_deref()
                    .and_then(|t| scanner::generate_thumbnail_base64(std::path::Path::new(t)));
                let file_path_str = entry_path.to_string_lossy().to_string();
                if let Some(existing) = db::get_video_series_by_folder_path(&pool, &file_path_str).await.map_err(|e| e.to_string())? {
                    db::update_video_series_poster(&pool, existing.id, video.thumbnail.as_deref(), thumb.as_deref(), Some("landscape")).await.map_err(|e| e.to_string())?;
                    db::add_videos_batch(&pool, vec![video], Some(existing.id)).await.map_err(|e| e.to_string())?;
                    updated += 1;
                } else {
                    let series = db::add_video_series(&pool, &file_stem, Some(&file_path_str), video.thumbnail.as_deref(), Some("landscape"), Some("completed"), thumb.as_deref()).await.map_err(|e| e.to_string())?;
                    db::add_videos_batch(&pool, vec![video], Some(series.id)).await.map_err(|e| e.to_string())?;
                    if let Err(e) = db::add_series_actor(&pool, series.id, actor.id, None, None).await {
                        eprintln!("[ChangLi] 关联演员到视频集失败: {}", e);
                    }
                    added += 1;
                }
            }
        }

        return Ok(ScanResult { added, updated });
    }

    let result = scanner::scan_directory(&path)
        .await
        .map_err(|e| e.to_string())?;

    let series_poster = result.posters.values().next().cloned();
    let series_poster_base64 = series_poster.as_deref()
        .and_then(|p| scanner::generate_thumbnail_base64(std::path::Path::new(p)));

    if let Some(existing) = db::get_video_series_by_folder_path(&pool, &path).await.map_err(|e| e.to_string())? {
        // 已存在：更新海报
        db::update_video_series_poster(&pool, existing.id, series_poster.as_deref(), series_poster_base64.as_deref(), Some("landscape")).await.map_err(|e| e.to_string())?;
        // 自动更新元数据（code、has_chinese_sub）
        if existing.code.is_none() || existing.code.as_deref() == Some("") {
            if let Some(info) = scanner::parse_adult_filename(&folder_name) {
                let has_chinese_sub: i32 = if info.has_chinese_sub { 1 } else { 0 };
                let _ = sqlx::query("UPDATE video_series SET code = ?, has_chinese_sub = ? WHERE id = ? AND (code IS NULL OR code = '')")
                    .bind(&info.code)
                    .bind(has_chinese_sub)
                    .bind(existing.id)
                    .execute(&pool).await;
            }
        }
        db::add_videos_batch(&pool, result.videos, Some(existing.id)).await.map_err(|e| e.to_string())?;
        Ok(ScanResult { added: 0, updated: 1 })
    } else {
        let series = db::add_video_series(&pool, &folder_name, Some(&path), series_poster.as_deref(), Some("landscape"), Some("completed"), series_poster_base64.as_deref()).await.map_err(|e| e.to_string())?;
        db::add_videos_batch(&pool, result.videos, Some(series.id)).await.map_err(|e| e.to_string())?;
        Ok(ScanResult { added: 1, updated: 0 })
    }
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
async fn get_video_series_list(state: State<'_, AppState>, sort_by: Option<String>, sort_order: Option<String>) -> Result<Vec<db::VideoSeries>, String> {
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
async fn get_standalone_videos(state: State<'_, AppState>, sort_by: Option<String>, sort_order: Option<String>) -> Result<Vec<db::Video>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    let sort_by = sort_by.as_deref().unwrap_or("created_at");
    let sort_order = sort_order.as_deref().unwrap_or("desc");
    db::get_standalone_videos(&pool, sort_by, sort_order)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_standalone_videos_by_tag(
    state: State<'_, AppState>,
    tag_id: i64,
) -> Result<Vec<db::Video>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_standalone_videos_by_tag(&pool, tag_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_standalone_videos_by_tag_name(
    state: State<'_, AppState>,
    tag_name: String,
) -> Result<Vec<db::Video>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_standalone_videos_by_tag_name(&pool, &tag_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_standalone_videos_by_actor(
    state: State<'_, AppState>,
    actor_id: i64,
) -> Result<Vec<db::Video>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_standalone_videos_by_actor(&pool, actor_id)
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
    eprintln!("[update_video_series] id={}, has_chinese_sub={:?}", id, has_chinese_sub);
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    let stored_poster = poster.as_deref().map(normalize_photo_path_for_storage);
    let poster_base64 = stored_poster.as_deref()
        .and_then(|p| scanner::generate_thumbnail_base64(std::path::Path::new(p)));
    db::update_video_series(&pool, id, title, description, stored_poster, poster_orientation, status, poster_base64, code, has_chinese_sub)
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
) -> Result<db::Actor, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    let stored_photo = photo.as_deref().map(normalize_photo_path_for_storage);
    let avatar_base64 = stored_photo.as_deref()
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
) -> Result<db::Actor, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    let stored_photo = photo.as_deref().map(normalize_photo_path_for_storage);
    let avatar_base64 = stored_photo.as_deref()
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
async fn get_series_seasons(state: State<'_, AppState>, series_id: i64) -> Result<Vec<db::SeasonInfo>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_series_seasons(&pool, series_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_season(state: State<'_, AppState>, series_id: i64, season: i32) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::delete_season(&pool, series_id, season)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_season(state: State<'_, AppState>, series_id: i64, season: i32, subtitle: Option<String>) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::create_season(&pool, series_id, season, subtitle.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_video_subtitle(state: State<'_, AppState>, video_id: i64, subtitle: Option<String>) -> Result<(), String> {
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
    db::rescan_all_series_metadata(&pool).await.map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            db: Mutex::new(None),
        })
        .setup(|app| {
            if let Err(error) = player::register_shortcuts(&app.handle()) {
                eprintln!("[ChangLi] 注册播放窗口快捷键失败: {error:#}");
            }
            Ok(())
        })
        .on_window_event(|event| {
            if event.window().label() == "main" {
                player::handle_main_window_event(&event.window().app_handle(), event.event());
            }
        })
        .invoke_handler(tauri::generate_handler![
            init_db,
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
            get_videos,
            get_video,
            delete_video,
            get_video_series_list,
            get_standalone_videos,
            get_standalone_videos_by_tag,
            get_standalone_videos_by_tag_name,
            get_standalone_videos_by_actor,
            get_video_series_by_tag,
            get_video_series_by_tag_name,
            get_video_series_by_actor,
            get_series_playback_video,
            get_video_series_detail,
            update_video_series,
            delete_video_series,
            switch_series_type,
            add_video_to_series,
            remove_video_from_series,
            get_actors,
            get_actor,
            add_actor,
            update_actor,
            delete_actor,
            get_actor_resources,
            get_tags,
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
            play_video,
            get_play_history,
            get_recent_watch_items,
            update_watch_progress,
            get_watch_progress,
            get_resource_watch_progress,
            update_video,
            save_actor_photo,
            save_video_thumbnail,
            get_storage_info,
            open_data_dir,
            toggle_favorite,
            toggle_chinese_sub,
            toggle_watched,
            get_favorite_videos_cmd,
            get_favorite_series_cmd,
            rescan_all_series_metadata,
            delete_all_videos,
            get_series_seasons,
            delete_season,
            create_season,
            update_video_subtitle,
            get_actor_periods,
            add_actor_period,
            update_actor_period,
            delete_actor_period,
            get_actor_work_period_map,
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
async fn toggle_favorite(state: State<'_, AppState>, id: i64, fav_type: String) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    match fav_type.as_str() {
        "video" => db::toggle_favorite_video(&pool, id).await.map_err(|e| e.to_string()),
        "series" => db::toggle_favorite_series(&pool, id).await.map_err(|e| e.to_string()),
        _ => Err("无效类型".to_string()),
    }
}

#[tauri::command]
async fn toggle_chinese_sub(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::toggle_chinese_sub_series(&pool, id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn toggle_watched(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::toggle_watched_series(&pool, id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_favorite_videos_cmd(state: State<'_, AppState>) -> Result<Vec<db::Video>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_favorite_videos(&pool).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_favorite_series_cmd(state: State<'_, AppState>) -> Result<Vec<db::VideoSeries>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_favorite_series(&pool).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_all_videos(state: State<'_, AppState>) -> Result<(i64, i64), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::delete_all_videos(&pool).await.map_err(|e| e.to_string())
}
