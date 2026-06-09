// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod downloader;
mod parser;
mod player;
mod scanner;

use std::sync::Mutex;
use tauri::State;

// 应用状态
struct AppState {
    db: Mutex<Option<sqlx::SqlitePool>>,
}

// 初始化数据库
#[tauri::command]
async fn init_db(state: State<'_, AppState>) -> Result<(), String> {
    let db = db::init_database().await.map_err(|e| e.to_string())?;
    *state.db.lock().unwrap() = Some(db);
    Ok(())
}

// 网站相关命令
#[tauri::command]
async fn get_sites(state: State<'_, AppState>) -> Result<Vec<db::Site>, String> {
    let db = state.db.lock().unwrap();
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::get_sites(db).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_site(state: State<'_, AppState>, site: db::NewSite) -> Result<db::Site, String> {
    let db = state.db.lock().unwrap();
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::add_site(db, site).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_site(state: State<'_, AppState>, id: i64, site: db::NewSite) -> Result<db::Site, String> {
    let db = state.db.lock().unwrap();
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::update_site(db, id, site).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_site(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::delete_site(db, id).await.map_err(|e| e.to_string())
}

// 资源相关命令
#[tauri::command]
async fn search_resources(
    state: State<'_, AppState>,
    keyword: String,
    site_ids: Option<Vec<i64>>,
) -> Result<Vec<db::Resource>, String> {
    let db = state.db.lock().unwrap();
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
            Ok(resources) => all_resources.extend(resources),
            Err(e) => eprintln!("搜索 {} 失败: {}", site.name, e),
        }
    }
    
    Ok(all_resources)
}

// 下载相关命令
#[tauri::command]
async fn add_download(state: State<'_, AppState>, magnet: String) -> Result<db::Download, String> {
    let db = state.db.lock().unwrap();
    let db = db.as_ref().ok_or("数据库未初始化")?;
    
    // 调用 aria2 添加下载
    let gid = downloader::add_magnet(&magnet).await.map_err(|e| e.to_string())?;
    
    // 保存到数据库
    let download = db::add_download(db, &gid, &magnet).await.map_err(|e| e.to_string())?;
    
    Ok(download)
}

#[tauri::command]
async fn get_downloads(state: State<'_, AppState>) -> Result<Vec<db::Download>, String> {
    let db = state.db.lock().unwrap();
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::get_downloads(db).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn pause_download(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().unwrap();
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
    let db = state.db.lock().unwrap();
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
    let db = state.db.lock().unwrap();
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
    let db = state.db.lock().unwrap();
    let db = db.as_ref().ok_or("数据库未初始化")?;
    
    let videos = scanner::scan_directory(&path).await.map_err(|e| e.to_string())?;
    
    for video in videos {
        db::add_video(db, video).await.map_err(|e| e.to_string())?;
    }
    
    db::get_videos(db).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_videos(state: State<'_, AppState>) -> Result<Vec<db::Video>, String> {
    let db = state.db.lock().unwrap();
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::get_videos(db).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_video(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::delete_video(db, id).await.map_err(|e| e.to_string())
}

// 播放器相关命令
#[tauri::command]
async fn play_video(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    let db = db.as_ref().ok_or("数据库未初始化")?;
    
    let video = db::get_video(db, id).await.map_err(|e| e.to_string())?;
    if let Some(video) = video {
        player::play(&video.file_path).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
async fn get_play_history(state: State<'_, AppState>) -> Result<Vec<db::PlayHistory>, String> {
    let db = state.db.lock().unwrap();
    let db = db.as_ref().ok_or("数据库未初始化")?;
    db::get_play_history(db).await.map_err(|e| e.to_string())
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
            search_resources,
            add_download,
            get_downloads,
            pause_download,
            resume_download,
            remove_download,
            scan_videos,
            get_videos,
            delete_video,
            play_video,
            get_play_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
