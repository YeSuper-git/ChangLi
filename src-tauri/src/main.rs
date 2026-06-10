// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod downloader;
mod http;
mod html_parser;
mod parser;
mod player;
mod scanner;
mod site_config;

use tokio::sync::Mutex;
use tauri::State;

// 应用状态
struct AppState {
    db: Mutex<Option<sqlx::SqlitePool>>,
}

// 初始化数据库
#[tauri::command]
async fn init_db(state: State<'_, AppState>) -> Result<(), String> {
    let db = db::init_database().await.map_err(|e| e.to_string())?;
    *state.db.lock().await = Some(db);
    Ok(())
}

// 网站相关命令
#[tauri::command]
async fn get_sites(state: State<'_, AppState>) -> Result<Vec<db::Site>, String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::get_sites(db).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_site(state: State<'_, AppState>, site: db::NewSite) -> Result<db::Site, String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::add_site(db, site).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_site(state: State<'_, AppState>, id: i64, site: db::NewSite) -> Result<db::Site, String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::update_site(db, id, site).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_site(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::delete_site(db, id).await.map_err(|e| e.to_string())
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
    site_config::test_site_config(&config).await.map_err(|e| e.to_string())
}

// 资源相关命令
#[tauri::command]
async fn search_resources(
    state: State<'_, AppState>,
    keyword: String,
    site_ids: Option<Vec<i64>>,
) -> Result<Vec<db::Resource>, String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    
    // 获取网站列表
    let sites = if let Some(ids) = site_ids {
        let all_sites = db::get_sites(db).await.map_err(|e| e.to_string())?;
        all_sites.into_iter().filter(|s| ids.contains(&s.id)).collect()
    } else {
        db::get_sites(db).await.map_err(|e| e.to_string())?
    };
    
    // 搜索资源
    let mut all_resources = Vec::new();
    for site in sites {
        let config: parser::SiteConfig = serde_json::from_value(site.config.clone())
            .map_err(|e| e.to_string())?;
        let site_info = parser::Site {
            id: site.id,
            name: site.name.clone(),
            url: site.url.clone(),
            config,
        };
        
        match parser::search_resources(&site_info, &keyword).await {
            Ok(resources) => {
                // 转换 parser::Resource 到 db::Resource
                let db_resources: Vec<db::Resource> = resources.into_iter().map(|r| db::Resource {
                    id: 0,
                    site_id: r.site_id,
                    title: r.title,
                    url: r.url,
                    magnet: r.magnet,
                    info: r.info,
                    created_at: chrono::Utc::now().to_rfc3339(),
                }).collect();
                all_resources.extend(db_resources);
            },
            Err(e) => eprintln!("搜索 {} 失败: {}", site.name, e),
        }
    }
    
    Ok(all_resources)
}

// 下载相关命令
#[tauri::command]
async fn add_download(state: State<'_, AppState>, magnet: String) -> Result<db::Download, String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    
    // 调用 aria2 添加下载
    let gid = downloader::add_magnet(&magnet).await.map_err(|e| e.to_string())?;
    
    // 保存到数据库
    let download = db::add_download(db, &gid, &magnet).await.map_err(|e| e.to_string())?;
    
    Ok(download)
}

#[tauri::command]
async fn get_downloads(state: State<'_, AppState>) -> Result<Vec<db::Download>, String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::get_downloads(db).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn pause_download(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    
    let download = db::get_download(db, id).await.map_err(|e| e.to_string())?;
    if let Some(gid) = download.aria2_gid {
        downloader::pause(&gid).await.map_err(|e| e.to_string())?;
        db::update_download_status(db, id, "paused").await.map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
async fn resume_download(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    
    let download = db::get_download(db, id).await.map_err(|e| e.to_string())?;
    if let Some(gid) = download.aria2_gid {
        downloader::resume(&gid).await.map_err(|e| e.to_string())?;
        db::update_download_status(db, id, "downloading").await.map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
async fn remove_download(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    
    let download = db::get_download(db, id).await.map_err(|e| e.to_string())?;
    if let Some(gid) = download.aria2_gid {
        downloader::remove(&gid).await.map_err(|e| e.to_string())?;
    }
    db::delete_download(db, id).await.map_err(|e| e.to_string())?;
    
    Ok(())
}

// 视频相关命令
#[tauri::command]
async fn scan_videos(state: State<'_, AppState>, path: String) -> Result<Vec<db::Video>, String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    
    let videos = scanner::scan_directory(&path).await.map_err(|e| e.to_string())?;
    
    for video in videos {
        db::add_video(db, video).await.map_err(|e| e.to_string())?;
    }
    
    db::get_videos(db).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_videos(state: State<'_, AppState>) -> Result<Vec<db::Video>, String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::get_videos(db).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_video(state: State<'_, AppState>, id: i64) -> Result<Option<db::Video>, String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::get_video(db, id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_video(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::delete_video(db, id).await.map_err(|e| e.to_string())
}

// 演员相关命令
#[tauri::command]
async fn get_actors(state: State<'_, AppState>) -> Result<Vec<db::Actor>, String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::get_actors(db).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_actor(state: State<'_, AppState>, id: i64) -> Result<Option<db::Actor>, String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::get_actor(db, id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_actor(state: State<'_, AppState>, name: String, photo: Option<String>, bio: Option<String>, debut_year: Option<i32>) -> Result<db::Actor, String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::add_actor(db, &name, photo.as_deref(), bio.as_deref(), debut_year).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_actor(state: State<'_, AppState>, id: i64, name: String, photo: Option<String>, bio: Option<String>, debut_year: Option<i32>) -> Result<db::Actor, String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::update_actor(db, id, &name, photo.as_deref(), bio.as_deref(), debut_year).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_actor(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::delete_actor(db, id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_actor_resources(state: State<'_, AppState>, actor_id: i64) -> Result<Vec<db::Resource>, String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::get_actor_resources(db, actor_id).await.map_err(|e| e.to_string())
}

// 标签相关命令
#[tauri::command]
async fn get_tags(state: State<'_, AppState>) -> Result<Vec<db::Tag>, String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::get_tags(db).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_tag(state: State<'_, AppState>, name: String) -> Result<db::Tag, String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::add_tag(db, &name).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_tag(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::delete_tag(db, id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_resource_tags(state: State<'_, AppState>, resource_id: i64) -> Result<Vec<db::Tag>, String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::get_resource_tags(db, resource_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_resource_tag(state: State<'_, AppState>, resource_id: i64, tag_id: i64) -> Result<(), String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::add_resource_tag(db, resource_id, tag_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn remove_resource_tag(state: State<'_, AppState>, resource_id: i64, tag_id: i64) -> Result<(), String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::remove_resource_tag(db, resource_id, tag_id).await.map_err(|e| e.to_string())
}

// 资源演员关联命令
#[tauri::command]
async fn get_resource_actors(state: State<'_, AppState>, resource_id: i64) -> Result<Vec<db::Actor>, String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::get_resource_actors(db, resource_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_resource_actor(state: State<'_, AppState>, resource_id: i64, actor_id: i64, role: Option<String>) -> Result<(), String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::add_resource_actor(db, resource_id, actor_id, role.as_deref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn remove_resource_actor(state: State<'_, AppState>, resource_id: i64, actor_id: i64) -> Result<(), String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::remove_resource_actor(db, resource_id, actor_id).await.map_err(|e| e.to_string())
}

// 播放器相关命令
#[tauri::command]
async fn play_video(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    
    let video = db::get_video(db, id).await.map_err(|e| e.to_string())?;
    if let Some(video) = video {
        player::play(&video.file_path).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
async fn get_play_history(state: State<'_, AppState>) -> Result<Vec<db::PlayHistory>, String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::get_play_history(db).await.map_err(|e| e.to_string())
}

// 观看进度相关命令
#[tauri::command]
async fn update_watch_progress(state: State<'_, AppState>, resource_id: i64, episode: i32, position: f64, duration: f64) -> Result<(), String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::update_watch_progress(db, resource_id, episode, position, duration).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_watch_progress(state: State<'_, AppState>, resource_id: i64, episode: i32) -> Result<Option<db::WatchProgress>, String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::get_watch_progress(db, resource_id, episode).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_resource_watch_progress(state: State<'_, AppState>, resource_id: i64) -> Result<Vec<db::WatchProgress>, String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::get_resource_watch_progress(db, resource_id).await.map_err(|e| e.to_string())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn get_resources(state: State<'_, AppState>) -> Result<Vec<db::Resource>, String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::get_resources(db).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_resources_by_category(state: State<'_, AppState>, category: String) -> Result<Vec<db::Resource>, String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::get_resources_by_category(db, &category).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_recent_resources(state: State<'_, AppState>, limit: Option<i64>) -> Result<Vec<db::Resource>, String> {
    let db = state.db.lock().await;
    let db = db.as_ref().ok_or("数据库未初始化")?;
    let limit = limit.unwrap_or(10);
    db::get_recent_resources(db, limit).await.map_err(|e| e.to_string())
}
