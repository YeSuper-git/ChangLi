// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod downloader;
mod html_parser;
mod http;
mod parser;
mod player;
mod scanner;
mod site_config;
mod storage;

use image::ImageReader;
use std::path::Path;
use tauri::State;
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
#[tauri::command]
async fn scan_videos(state: State<'_, AppState>, path: String) -> Result<Vec<db::Video>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };

    let result = scanner::scan_directory(&path)
        .await
        .map_err(|e| e.to_string())?;

    for video in result.videos {
        db::add_video(&pool, video)
            .await
            .map_err(|e| e.to_string())?;
    }

    db::get_videos(&pool).await.map_err(|e| e.to_string())
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
) -> Result<db::Actor, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    let stored_photo = photo.as_deref().map(normalize_photo_path_for_storage);
    db::add_actor(
        &pool,
        &name,
        stored_photo.as_deref(),
        bio.as_deref(),
        birthday.as_deref(),
        height.as_deref(),
        measurements.as_deref(),
        japanese_name.as_deref(),
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
) -> Result<db::Actor, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    let stored_photo = photo.as_deref().map(normalize_photo_path_for_storage);
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
) -> Result<Vec<db::Resource>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_actor_resources(&pool, actor_id)
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
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::add_resource_actor(&pool, resource_id, actor_id, role.as_deref())
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

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            db: Mutex::new(None),
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
            play_video,
            get_play_history,
            update_watch_progress,
            get_watch_progress,
            get_resource_watch_progress,
            update_video,
            save_actor_photo,
            save_video_thumbnail,
            get_storage_info,
            open_data_dir,
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
