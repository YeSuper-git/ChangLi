use anyhow::Result;
use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqlitePool;
use sqlx::Row;

// 网站配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Site {
    pub id: i64,
    pub name: String,
    pub url: String,
    pub parser_type: String,
    pub config: serde_json::Value,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewSite {
    pub name: String,
    pub url: String,
    pub parser_type: String,
    pub config: serde_json::Value,
    pub enabled: Option<bool>,
}

// 资源
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resource {
    pub id: i64,
    pub site_id: i64,
    pub title: String,
    pub url: Option<String>,
    pub magnet: Option<String>,
    pub info: Option<serde_json::Value>,
    pub created_at: String,
}

// 下载
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Download {
    pub id: i64,
    pub resource_id: Option<i64>,
    pub aria2_gid: Option<String>,
    pub status: String,
    pub progress: f64,
    pub download_speed: i64,
    pub file_path: Option<String>,
    pub file_name: Option<String>,
    pub file_size: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

// 视频
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Video {
    pub id: i64,
    pub file_path: String,
    pub file_name: String,
    pub file_size: Option<i64>,
    pub duration: Option<f64>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub resolution: Option<String>,
    pub source_site: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub thumbnail: Option<String>,
    pub created_at: String,
}

// 播放记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayHistory {
    pub id: i64,
    pub video_id: i64,
    pub last_position: f64,
    pub total_duration: Option<f64>,
    pub play_count: i32,
    pub last_played: String,
}

// 初始化数据库
pub async fn init_database() -> Result<SqlitePool> {
    let db_path = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("changli")
        .join("changli.db");
    
    // 确保目录存在
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    
    let db_url = format!("sqlite:{}?mode=rwc", db_path.display());
    let pool = SqlitePool::connect(&db_url).await?;
    
    // 创建表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS sites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            parser_type TEXT NOT NULL DEFAULT 'css',
            config TEXT NOT NULL,
            enabled BOOLEAN DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        "#,
    )
    .execute(&pool)
    .await?;
    
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS resources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            url TEXT,
            magnet TEXT,
            info TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        "#,
    )
    .execute(&pool)
    .await?;
    
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS downloads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            resource_id INTEGER REFERENCES resources(id) ON DELETE SET NULL,
            aria2_gid TEXT UNIQUE,
            status TEXT DEFAULT 'waiting',
            progress REAL DEFAULT 0,
            download_speed INTEGER DEFAULT 0,
            file_path TEXT,
            file_name TEXT,
            file_size INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        "#,
    )
    .execute(&pool)
    .await?;
    
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT NOT NULL UNIQUE,
            file_name TEXT NOT NULL,
            file_size INTEGER,
            duration REAL,
            width INTEGER,
            height INTEGER,
            resolution TEXT,
            source_site TEXT,
            metadata TEXT,
            thumbnail TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        "#,
    )
    .execute(&pool)
    .await?;
    
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS play_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
            last_position REAL DEFAULT 0,
            total_duration REAL,
            play_count INTEGER DEFAULT 1,
            last_played TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        "#,
    )
    .execute(&pool)
    .await?;
    
    Ok(pool)
}

// 网站操作
pub async fn get_sites(pool: &SqlitePool) -> Result<Vec<Site>> {
    let rows = sqlx::query("SELECT * FROM sites ORDER BY id")
        .fetch_all(pool)
        .await?;
    
    let sites = rows
        .iter()
        .map(|row| Site {
            id: row.get("id"),
            name: row.get("name"),
            url: row.get("url"),
            parser_type: row.get("parser_type"),
            config: serde_json::from_str(row.get("config")).unwrap_or_default(),
            enabled: row.get("enabled"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
        .collect();
    
    Ok(sites)
}

pub async fn add_site(pool: &SqlitePool, site: NewSite) -> Result<Site> {
    let config_str = serde_json::to_string(&site.config)?;
    let enabled = site.enabled.unwrap_or(true);
    
    let row = sqlx::query(
        "INSERT INTO sites (name, url, parser_type, config, enabled) VALUES (?, ?, ?, ?, ?) RETURNING *",
    )
    .bind(&site.name)
    .bind(&site.url)
    .bind(&site.parser_type)
    .bind(&config_str)
    .bind(enabled)
    .fetch_one(pool)
    .await?;
    
    Ok(Site {
        id: row.get("id"),
        name: row.get("name"),
        url: row.get("url"),
        parser_type: row.get("parser_type"),
        config: serde_json::from_str(row.get("config")).unwrap_or_default(),
        enabled: row.get("enabled"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

pub async fn update_site(pool: &SqlitePool, id: i64, site: NewSite) -> Result<Site> {
    let config_str = serde_json::to_string(&site.config)?;
    let enabled = site.enabled.unwrap_or(true);
    
    let row = sqlx::query(
        "UPDATE sites SET name = ?, url = ?, parser_type = ?, config = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING *",
    )
    .bind(&site.name)
    .bind(&site.url)
    .bind(&site.parser_type)
    .bind(&config_str)
    .bind(enabled)
    .bind(id)
    .fetch_one(pool)
    .await?;
    
    Ok(Site {
        id: row.get("id"),
        name: row.get("name"),
        url: row.get("url"),
        parser_type: row.get("parser_type"),
        config: serde_json::from_str(row.get("config")).unwrap_or_default(),
        enabled: row.get("enabled"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

pub async fn delete_site(pool: &SqlitePool, id: i64) -> Result<()> {
    sqlx::query("DELETE FROM sites WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// 下载操作
pub async fn add_download(pool: &SqlitePool, gid: &str, magnet: &str) -> Result<Download> {
    let row = sqlx::query(
        "INSERT INTO downloads (aria2_gid, status, file_name) VALUES (?, 'waiting', ?) RETURNING *",
    )
    .bind(gid)
    .bind(magnet)
    .fetch_one(pool)
    .await?;
    
    Ok(Download {
        id: row.get("id"),
        resource_id: row.get("resource_id"),
        aria2_gid: row.get("aria2_gid"),
        status: row.get("status"),
        progress: row.get("progress"),
        download_speed: row.get("download_speed"),
        file_path: row.get("file_path"),
        file_name: row.get("file_name"),
        file_size: row.get("file_size"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

pub async fn get_downloads(pool: &SqlitePool) -> Result<Vec<Download>> {
    let rows = sqlx::query("SELECT * FROM downloads ORDER BY created_at DESC")
        .fetch_all(pool)
        .await?;
    
    let downloads = rows
        .iter()
        .map(|row| Download {
            id: row.get("id"),
            resource_id: row.get("resource_id"),
            aria2_gid: row.get("aria2_gid"),
            status: row.get("status"),
            progress: row.get("progress"),
            download_speed: row.get("download_speed"),
            file_path: row.get("file_path"),
            file_name: row.get("file_name"),
            file_size: row.get("file_size"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
        .collect();
    
    Ok(downloads)
}

pub async fn get_download(pool: &SqlitePool, id: i64) -> Result<Download> {
    let row = sqlx::query("SELECT * FROM downloads WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await?;
    
    Ok(Download {
        id: row.get("id"),
        resource_id: row.get("resource_id"),
        aria2_gid: row.get("aria2_gid"),
        status: row.get("status"),
        progress: row.get("progress"),
        download_speed: row.get("download_speed"),
        file_path: row.get("file_path"),
        file_name: row.get("file_name"),
        file_size: row.get("file_size"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

pub async fn update_download_status(pool: &SqlitePool, id: i64, status: &str) -> Result<()> {
    sqlx::query("UPDATE downloads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(status)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_download(pool: &SqlitePool, id: i64) -> Result<()> {
    sqlx::query("DELETE FROM downloads WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// 视频操作
pub async fn add_video(pool: &SqlitePool, video: Video) -> Result<Video> {
    let metadata_str = video.metadata.map(|m| serde_json::to_string(&m).unwrap_or_default());
    
    let row = sqlx::query(
        "INSERT OR IGNORE INTO videos (file_path, file_name, file_size, duration, width, height, resolution, source_site, metadata, thumbnail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
    )
    .bind(&video.file_path)
    .bind(&video.file_name)
    .bind(video.file_size)
    .bind(video.duration)
    .bind(video.width)
    .bind(video.height)
    .bind(&video.resolution)
    .bind(&video.source_site)
    .bind(&metadata_str)
    .bind(&video.thumbnail)
    .fetch_one(pool)
    .await?;
    
    Ok(Video {
        id: row.get("id"),
        file_path: row.get("file_path"),
        file_name: row.get("file_name"),
        file_size: row.get("file_size"),
        duration: row.get("duration"),
        width: row.get("width"),
        height: row.get("height"),
        resolution: row.get("resolution"),
        source_site: row.get("source_site"),
        metadata: row.get::<Option<String>, _>("metadata").and_then(|s| serde_json::from_str(&s).ok()),
        thumbnail: row.get("thumbnail"),
        created_at: row.get("created_at"),
    })
}

pub async fn get_videos(pool: &SqlitePool) -> Result<Vec<Video>> {
    let rows = sqlx::query("SELECT * FROM videos ORDER BY created_at DESC")
        .fetch_all(pool)
        .await?;
    
    let videos = rows
        .iter()
        .map(|row| Video {
            id: row.get("id"),
            file_path: row.get("file_path"),
            file_name: row.get("file_name"),
            file_size: row.get("file_size"),
            duration: row.get("duration"),
            width: row.get("width"),
            height: row.get("height"),
            resolution: row.get("resolution"),
            source_site: row.get("source_site"),
            metadata: row.get::<Option<String>, _>("metadata").and_then(|s| serde_json::from_str(&s).ok()),
            thumbnail: row.get("thumbnail"),
            created_at: row.get("created_at"),
        })
        .collect();
    
    Ok(videos)
}

pub async fn get_video(pool: &SqlitePool, id: i64) -> Result<Option<Video>> {
    let row = sqlx::query("SELECT * FROM videos WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    
    Ok(row.map(|row| Video {
        id: row.get("id"),
        file_path: row.get("file_path"),
        file_name: row.get("file_name"),
        file_size: row.get("file_size"),
        duration: row.get("duration"),
        width: row.get("width"),
        height: row.get("height"),
        resolution: row.get("resolution"),
        source_site: row.get("source_site"),
        metadata: row.get::<Option<String>, _>("metadata").and_then(|s| serde_json::from_str(&s).ok()),
        thumbnail: row.get("thumbnail"),
        created_at: row.get("created_at"),
    }))
}

pub async fn delete_video(pool: &SqlitePool, id: i64) -> Result<()> {
    sqlx::query("DELETE FROM videos WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// 播放记录操作
pub async fn get_play_history(pool: &SqlitePool) -> Result<Vec<PlayHistory>> {
    let rows = sqlx::query("SELECT * FROM play_history ORDER BY last_played DESC")
        .fetch_all(pool)
        .await?;
    
    let history = rows
        .iter()
        .map(|row| PlayHistory {
            id: row.get("id"),
            video_id: row.get("video_id"),
            last_position: row.get("last_position"),
            total_duration: row.get("total_duration"),
            play_count: row.get("play_count"),
            last_played: row.get("last_played"),
        })
        .collect();
    
    Ok(history)
}
