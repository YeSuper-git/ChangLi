use crate::{migrations, storage};
use anyhow::Result;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqlitePool, SqliteRow};
use sqlx::Row;
use std::path::Path;

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
    pub series_id: Option<i64>,
    pub episode_number: Option<i32>,
    pub file_size: Option<i64>,
    pub season: Option<i32>,
    pub subtitle: Option<String>,
    pub duration: Option<f64>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub resolution: Option<String>,
    pub source_site: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub thumbnail: Option<String>,
    pub thumbnail_base64: Option<String>,
    pub thumbnail_data_url: Option<String>,
    pub series_title: Option<String>,
    pub series_poster_data_url: Option<String>,
    pub description: Option<String>,
    pub poster_orientation: Option<String>,
    pub created_at: String,
    pub is_favorite: Option<i32>,
    pub series_has_chinese_sub: Option<i32>,
    pub series_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoSeries {
    pub id: i64,
    pub title: String,
    pub description: Option<String>,
    pub poster: Option<String>,
    pub poster_data_url: Option<String>,
    pub poster_base64: Option<String>,
    pub folder_path: Option<String>,
    pub poster_orientation: Option<String>,
    pub status: Option<String>,
    pub video_count: i64,
    pub created_at: String,
    pub updated_at: String,
    pub is_favorite: Option<i32>,
    pub is_watched: Option<i32>,
    pub last_watched_episode: Option<i32>,
    pub has_actor: bool,
    pub code: Option<String>,
    pub has_chinese_sub: Option<i32>,
    pub display_type: Option<String>,
}

// 演员
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Actor {
    pub id: i64,
    pub name: String,
    pub photo: Option<String>,
    pub photo_data_url: Option<String>,
    pub avatar_base64: Option<String>,
    pub bio: Option<String>,
    pub birthday: Option<String>,
    pub height: Option<String>,
    pub measurements: Option<String>,
    pub japanese_name: Option<String>,
    pub cup_size: Option<String>,
    pub alias: Option<String>,
    pub work_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

// 标签
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub created_at: String,
}

// 资源标签关联
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceTag {
    pub resource_id: i64,
    pub tag_id: i64,
}

// 扫描结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub added: i64,
    pub skipped: i64,
}

// 资源演员关联
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceActor {
    pub resource_id: i64,
    pub actor_id: i64,
    pub role: Option<String>,
}

// 演员时期
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActorPeriod {
    pub id: i64,
    pub actor_id: i64,
    pub name: String,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentWatchItem {
    pub video: Video,
    pub series: Option<VideoSeries>,
    pub last_position: f64,
    pub total_duration: Option<f64>,
    pub play_count: i32,
    pub last_played: String,
}

// 观看进度
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchProgress {
    pub id: i64,
    pub resource_id: i64,
    pub episode: i32,
    pub position: f64,
    pub duration: f64,
    pub updated_at: String,
}

// 初始化数据库
pub async fn init_database() -> Result<SqlitePool> {
    storage::prepare_active_data_dir()?;
    let db_path = storage::db_path();

    // 确保目录存在
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    eprintln!(
        "[ChangLi] 数据目录: {}",
        storage::active_data_dir().display()
    );
    eprintln!("[ChangLi] 数据库路径: {}", db_path.display());
    let db_url = format!("sqlite:{}?mode=rwc", db_path.display());
    let pool = SqlitePool::connect(&db_url).await?;
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&pool)
        .await?;

    migrations::run(&pool).await?;
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&pool)
        .await?;

    // 启动时回填旧数据的 Base64 缓存（一次性迁移）
    backfill_base64_cache(&pool).await?;

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
    let metadata_str = video
        .metadata
        .map(|m| serde_json::to_string(&m).unwrap_or_default());

    let result = sqlx::query(
        "INSERT OR IGNORE INTO videos (file_path, file_name, series_id, episode_number, season, file_size, duration, width, height, resolution, source_site, metadata, thumbnail, thumbnail_base64, description, subtitle) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&video.file_path)
    .bind(&video.file_name)
    .bind(video.series_id)
    .bind(video.episode_number)
    .bind(video.season.unwrap_or(0))
    .bind(video.file_size)
    .bind(video.duration)
    .bind(video.width)
    .bind(video.height)
    .bind(&video.resolution)
    .bind(&video.source_site)
    .bind(&metadata_str)
    .bind(&video.thumbnail)
    .bind(&video.thumbnail_base64)
    .bind(&video.description)
    .bind(&video.subtitle)
    .execute(pool)
    .await?;

    // If the insert was ignored (duplicate file_path), fetch the existing record
    if result.rows_affected() == 0 {
        return get_video_by_path(pool, &video.file_path)
            .await?
            .ok_or_else(|| anyhow::anyhow!("视频已存在但无法查询"));
    }

    // Otherwise, fetch the newly inserted record
    get_video_by_path(pool, &video.file_path)
        .await?
        .ok_or_else(|| anyhow::anyhow!("视频插入后无法查询"))
}

/// 批量插入视频（事务批处理，1000条视频也只提交1次事务）
pub async fn add_videos_batch(pool: &SqlitePool, videos: Vec<Video>, series_id: Option<i64>) -> Result<Vec<Video>> {
    let mut tx = pool.begin().await?;
    let mut saved_videos = Vec::new();

    for mut video in videos {
        video.series_id = series_id;
        let metadata_str = video
            .metadata
            .map(|m| serde_json::to_string(&m).unwrap_or_default());

        // INSERT OR IGNORE + RETURNING
        let row = sqlx::query(
            "INSERT OR IGNORE INTO videos (file_path, file_name, series_id, episode_number, season, file_size, duration, width, height, resolution, source_site, metadata, thumbnail, thumbnail_base64, description, subtitle) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
        )
        .bind(&video.file_path)
        .bind(&video.file_name)
        .bind(video.series_id)
        .bind(video.episode_number)
        .bind(video.season.unwrap_or(0))
        .bind(video.file_size)
        .bind(video.duration)
        .bind(video.width)
        .bind(video.height)
        .bind(&video.resolution)
        .bind(&video.source_site)
        .bind(&metadata_str)
        .bind(&video.thumbnail)
        .bind(&video.thumbnail_base64)
        .bind(&video.description)
        .bind(&video.subtitle)
        .fetch_optional(&mut *tx)
        .await?;

        if let Some(row) = row {
            // 新插入的记录
            let mut saved = video_from_row(&row);
            if let Some(sid) = series_id {
                // 更新 series_id 和 episode_number
                sqlx::query("UPDATE videos SET series_id = ?, episode_number = ?, season = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
                    .bind(sid)
                    .bind(saved.episode_number)
                    .bind(saved.season.unwrap_or(0))
                    .bind(saved.id)
                    .execute(&mut *tx)
                    .await?;
                saved.series_id = Some(sid);
            }
            saved_videos.push(saved);
        } else {
            // 重复记录，查询已有记录
            if let Some(existing) = get_video_by_path_tx(&mut tx, &video.file_path).await? {
                if let Some(sid) = series_id {
                    // 更新 series_id 和 season
                    sqlx::query("UPDATE videos SET series_id = ?, season = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
                        .bind(sid)
                        .bind(video.season.unwrap_or(0))
                        .bind(existing.id)
                        .execute(&mut *tx)
                        .await?;
                }
                saved_videos.push(existing);
            }
        }
    }

    tx.commit().await?;
    Ok(saved_videos)
}

/// 事务内查询视频（用于批量插入）
async fn get_video_by_path_tx(tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>, file_path: &str) -> Result<Option<Video>> {
    let row = sqlx::query("SELECT * FROM videos WHERE file_path = ?")
        .bind(file_path)
        .fetch_optional(&mut **tx)
        .await?;
    Ok(row.map(|row| video_from_row(&row)))
}


async fn get_video_by_path(pool: &SqlitePool, file_path: &str) -> Result<Option<Video>> {
    let row = sqlx::query("SELECT * FROM videos WHERE file_path = ?")
        .bind(file_path)
        .fetch_optional(pool)
        .await?;

    Ok(row.map(|row| video_from_row(&row)))
}

fn video_from_row(row: &SqliteRow) -> Video {
    let thumbnail: Option<String> = row.get("thumbnail");
    let resolved_thumbnail = thumbnail.map(|path| {
        storage::resolve_data_path(&path)
            .to_string_lossy()
            .to_string()
    });
    // 直接从数据库读取缓存的 Base64，不再实时生成
    let thumbnail_data_url: Option<String> = row.try_get("thumbnail_base64").ok().flatten();
    let series_poster_data_url: Option<String> = row.try_get("series_poster_base64").ok().flatten();

    Video {
        id: row.get("id"),
        file_path: row.get("file_path"),
        file_name: row.get("file_name"),
        series_id: row.get("series_id"),
        episode_number: row.get("episode_number"),
        file_size: row.get("file_size"),
        duration: row.get("duration"),
        width: row.get("width"),
        season: row.try_get("season").ok(),
        subtitle: row.try_get("subtitle").ok(),
        height: row.get("height"),
        resolution: row.get("resolution"),
        source_site: row.get("source_site"),
        metadata: row
            .get::<Option<String>, _>("metadata")
            .and_then(|s| serde_json::from_str(&s).ok()),
        thumbnail: resolved_thumbnail,
        thumbnail_base64: thumbnail_data_url.clone(),
        thumbnail_data_url,
        series_title: row.try_get("series_title").ok(),
        series_poster_data_url,
        description: row.get("description"),
        poster_orientation: row.try_get("poster_orientation").ok(),
        created_at: row.get("created_at"),
        is_favorite: row.try_get("is_favorite").ok(),
        series_has_chinese_sub: row.try_get("series_has_chinese_sub").ok().flatten(),
        series_code: row.try_get("series_code").ok().flatten(),
    }
}

pub async fn get_videos(pool: &SqlitePool) -> Result<Vec<Video>> {
    let rows = sqlx::query("SELECT * FROM videos ORDER BY created_at DESC")
        .fetch_all(pool)
        .await?;

    let videos = rows.iter().map(video_from_row).collect();

    Ok(videos)
}

pub async fn get_video(pool: &SqlitePool, id: i64) -> Result<Option<Video>> {
    let row = sqlx::query("SELECT * FROM videos WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;

    Ok(row.map(|row| video_from_row(&row)))
}

fn series_from_row(row: &SqliteRow) -> VideoSeries {
    let poster: Option<String> = row.get("poster");
    let resolved_poster = poster.clone().map(|path| {
        storage::resolve_data_path(&path)
            .to_string_lossy()
            .to_string()
    });
    // 双读兜底：优先读 poster_base64，如果为 NULL，降级使用 image_data_url
    let poster_data_url: Option<String> = row.try_get("poster_base64").ok().flatten()
        .or_else(|| {
            let p = poster?;
            let resolved = storage::resolve_data_path(&p);
            image_data_url(Path::new(&resolved))
        });
    VideoSeries {
        id: row.get("id"),
        title: row.get("title"),
        description: row.get("description"),
        poster: resolved_poster,
        poster_data_url: poster_data_url.clone(),
        poster_base64: poster_data_url,
        folder_path: row.get("folder_path"),
        video_count: row.try_get("video_count").unwrap_or(0),
        poster_orientation: row.try_get("poster_orientation").ok(),
        status: row.try_get("status").ok(),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        is_favorite: row.try_get("is_favorite").ok(),
        is_watched: row.try_get("is_watched").ok(),
        last_watched_episode: row.try_get("last_watched_episode").ok(),
        has_actor: row.try_get::<i64, _>("has_actor").unwrap_or(0) != 0,
        code: row.try_get("code").ok().flatten(),
        has_chinese_sub: row.try_get("has_chinese_sub").ok().flatten(),
        display_type: row.try_get("display_type").ok().flatten(),
    }
}

pub async fn add_video_series(
    pool: &SqlitePool,
    title: &str,
    folder_path: Option<&str>,
    poster: Option<&str>,
    poster_orientation: Option<&str>,
    status: Option<&str>,
    poster_base64: Option<&str>,
) -> Result<VideoSeries> {
    sqlx::query("INSERT OR IGNORE INTO video_series (title, folder_path, poster, poster_orientation, status, poster_base64) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(title)
        .bind(folder_path)
        .bind(poster)
        .bind(poster_orientation.unwrap_or("landscape"))
        .bind(status.unwrap_or("completed"))
        .bind(poster_base64)
        .execute(pool)
        .await?;
    if let Some(path) = folder_path {
        if let Some(series) = get_video_series_by_folder_path(pool, path).await? {
            return Ok(series);
        }
    }
    let row = sqlx::query("SELECT video_series.*, 0 AS video_count, NULL AS last_watched_episode, 0 AS has_actor FROM video_series WHERE id = last_insert_rowid()")
    .fetch_one(pool)
    .await?;
    Ok(series_from_row(&row))
}

pub async fn get_video_series_by_folder_path(
    pool: &SqlitePool,
    folder_path: &str,
) -> Result<Option<VideoSeries>> {
    let row = sqlx::query("SELECT s.*, COUNT(v.id) AS video_count, (SELECT v2.episode_number FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_episode, MAX(CASE WHEN sa.actor_id IS NOT NULL THEN 1 ELSE 0 END) AS has_actor FROM video_series s LEFT JOIN videos v ON v.series_id = s.id LEFT JOIN series_actors sa ON sa.series_id = s.id WHERE s.folder_path = ? GROUP BY s.id")
        .bind(folder_path)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|row| series_from_row(&row)))
}

pub async fn get_video_series_list(pool: &SqlitePool, sort_by: &str, sort_order: &str) -> Result<Vec<VideoSeries>> {
    let order_clause = match (sort_by, sort_order) {
        ("title", "asc") => "ORDER BY s.title COLLATE NOCASE ASC",
        ("title", "desc") => "ORDER BY s.title COLLATE NOCASE DESC",
        ("created_at", "asc") => "ORDER BY s.created_at ASC",
        _ => "ORDER BY s.created_at DESC",
    };
    let sql = format!("SELECT s.*, COUNT(v.id) AS video_count, (SELECT v2.episode_number FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_episode, MAX(CASE WHEN sa.actor_id IS NOT NULL THEN 1 ELSE 0 END) AS has_actor FROM video_series s LEFT JOIN videos v ON v.series_id = s.id LEFT JOIN series_actors sa ON sa.series_id = s.id GROUP BY s.id {}", order_clause);
    let rows = sqlx::query(&sql)
        .fetch_all(pool)
        .await?;
    Ok(rows.iter().map(series_from_row).collect())
}

pub async fn get_video_series_by_tag(pool: &SqlitePool, tag_id: i64) -> Result<Vec<VideoSeries>> {
    let rows = sqlx::query(
        "SELECT s.*, COUNT(v.id) AS video_count, (SELECT v2.episode_number FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_episode, MAX(CASE WHEN sa2.actor_id IS NOT NULL THEN 1 ELSE 0 END) AS has_actor FROM video_series s LEFT JOIN videos v ON v.series_id = s.id LEFT JOIN series_actors sa2 ON sa2.series_id = s.id JOIN series_tags st ON st.series_id = s.id WHERE st.tag_id = ? GROUP BY s.id ORDER BY s.updated_at DESC, s.created_at DESC",
    )
    .bind(tag_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(series_from_row).collect())
}

pub async fn get_video_series_by_tag_name(
    pool: &SqlitePool,
    tag_name: &str,
) -> Result<Vec<VideoSeries>> {
    let rows = sqlx::query(
        "SELECT s.*, COUNT(v.id) AS video_count, (SELECT v2.episode_number FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_episode, MAX(CASE WHEN sa2.actor_id IS NOT NULL THEN 1 ELSE 0 END) AS has_actor FROM video_series s LEFT JOIN videos v ON v.series_id = s.id LEFT JOIN series_actors sa2 ON sa2.series_id = s.id JOIN series_tags st ON st.series_id = s.id JOIN tags t ON t.id = st.tag_id WHERE t.name = ? GROUP BY s.id ORDER BY s.updated_at DESC, s.created_at DESC",
    )
    .bind(tag_name)
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(series_from_row).collect())
}

pub async fn get_video_series_by_actor(pool: &SqlitePool, actor_id: i64) -> Result<Vec<VideoSeries>> {
    let rows = sqlx::query(
        "SELECT s.*, COUNT(v.id) AS video_count, (SELECT v2.episode_number FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_episode, MAX(CASE WHEN sa.actor_id IS NOT NULL THEN 1 ELSE 0 END) AS has_actor FROM video_series s LEFT JOIN videos v ON v.series_id = s.id JOIN series_actors sa ON sa.series_id = s.id WHERE sa.actor_id = ? GROUP BY s.id ORDER BY s.updated_at DESC, s.created_at DESC",
    )
    .bind(actor_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(series_from_row).collect())
}

pub async fn get_video_series(pool: &SqlitePool, id: i64) -> Result<Option<VideoSeries>> {
    let row = sqlx::query("SELECT s.*, COUNT(v.id) AS video_count, (SELECT v2.episode_number FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_episode, MAX(CASE WHEN sa.actor_id IS NOT NULL THEN 1 ELSE 0 END) AS has_actor FROM video_series s LEFT JOIN videos v ON v.series_id = s.id LEFT JOIN series_actors sa ON sa.series_id = s.id WHERE s.id = ? GROUP BY s.id")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|row| series_from_row(&row)))
}

pub async fn get_series_videos(pool: &SqlitePool, series_id: i64) -> Result<Vec<Video>> {
    let rows = sqlx::query("SELECT * FROM videos WHERE series_id = ? ORDER BY episode_number IS NULL, episode_number, file_name")
        .bind(series_id)
        .fetch_all(pool)
        .await?;
    Ok(rows.iter().map(video_from_row).collect())
}

pub async fn update_video_series_poster(
    pool: &SqlitePool,
    id: i64,
    poster: Option<&str>,
    poster_base64: Option<&str>,
    poster_orientation: Option<&str>,
) -> Result<()> {
    sqlx::query("UPDATE video_series SET poster = ?, poster_base64 = ?, poster_orientation = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(poster)
        .bind(poster_base64)
        .bind(poster_orientation.unwrap_or("landscape"))
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_video_series(
    pool: &SqlitePool,
    id: i64,
    title: String,
    description: Option<String>,
    poster: Option<String>,
    poster_orientation: Option<String>,
    status: Option<String>,
    poster_base64: Option<String>,
    code: Option<String>,
    has_chinese_sub: Option<i32>,
) -> Result<VideoSeries> {
    sqlx::query("UPDATE video_series SET title = ?, description = ?, poster = ?, poster_orientation = ?, status = ?, poster_base64 = ?, code = ?, has_chinese_sub = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(title)
        .bind(description)
        .bind(poster)
        .bind(poster_orientation.unwrap_or_else(|| "landscape".to_string()))
        .bind(status.unwrap_or_else(|| "completed".to_string()))
        .bind(poster_base64)
        .bind(code)
        .bind(has_chinese_sub.unwrap_or(0))
        .bind(id)
        .execute(pool)
        .await?;
    get_video_series(pool, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("视频集不存在"))
}

pub async fn delete_video_series(pool: &SqlitePool, id: i64, _delete_videos: bool) -> Result<()> {
    sqlx::query("DELETE FROM video_series WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn switch_series_type(pool: &SqlitePool, series_id: i64) -> Result<()> {
    sqlx::query("UPDATE video_series SET display_type = CASE WHEN display_type = 'adult' THEN 'anime' WHEN display_type = 'anime' THEN 'adult' WHEN EXISTS (SELECT 1 FROM series_actors WHERE series_id = ?) THEN 'anime' ELSE 'adult' END WHERE id = ?")
        .bind(series_id).bind(series_id)
        .execute(pool).await?;
    Ok(())
}

pub async fn set_video_series(
    pool: &SqlitePool,
    video_id: i64,
    series_id: Option<i64>,
    episode_number: Option<i32>,
) -> Result<Video> {
    let row = sqlx::query("UPDATE videos SET series_id = ?, episode_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING *")
        .bind(series_id)
        .bind(episode_number)
        .bind(video_id)
        .fetch_one(pool)
        .await?;
    Ok(video_from_row(&row))
}

pub async fn update_video(
    pool: &SqlitePool,
    id: i64,
    file_name: Option<String>,
    description: Option<String>,
    thumbnail: Option<String>,
) -> Result<Video> {
    let mut query = String::from("UPDATE videos SET");
    let mut params = Vec::new();
    let mut bind_values = Vec::new();

    if let Some(name) = file_name {
        params.push("file_name = ?");
        bind_values.push(name);
    }
    if let Some(desc) = description {
        params.push("description = ?");
        bind_values.push(desc);
    }
    if let Some(thumb) = thumbnail {
        params.push("thumbnail = ?");
        bind_values.push(thumb);
    }

    if params.is_empty() {
        return get_video(pool, id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("视频不存在"));
    }

    query.push(' ');
    query.push_str(&params.join(", "));
    query.push_str(", updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING *");

    let mut query_builder = sqlx::query(&query);
    for value in bind_values {
        query_builder = query_builder.bind(value);
    }
    query_builder = query_builder.bind(id);

    let row = query_builder.fetch_one(pool).await?;

    Ok(video_from_row(&row))
}

pub async fn delete_video(pool: &SqlitePool, id: i64) -> Result<()> {
    sqlx::query("DELETE FROM videos WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// 演员操作
pub async fn get_actors(pool: &SqlitePool) -> Result<Vec<Actor>> {
    let rows = sqlx::query(
        "SELECT a.*, COALESCE(w.work_count, 0) AS work_count
         FROM actors a
         LEFT JOIN (
             SELECT actor_id, COUNT(*) AS work_count
             FROM (
                 SELECT va.actor_id, 'video-' || v.id AS work_key
                 FROM video_actors va
                 JOIN videos v ON v.id = va.video_id
                 WHERE v.series_id IS NULL
                 UNION
                 SELECT va.actor_id, 'series-' || v.series_id AS work_key
                 FROM video_actors va
                 JOIN videos v ON v.id = va.video_id
                 WHERE v.series_id IS NOT NULL
                 UNION
                 SELECT sa.actor_id, 'series-' || sa.series_id AS work_key
                 FROM series_actors sa
             ) actor_works
             GROUP BY actor_id
         ) w ON w.actor_id = a.id
         ORDER BY a.name",
    )
    .fetch_all(pool)
    .await?;

    let actors = rows.iter().map(actor_from_row).collect();

    Ok(actors)
}

pub async fn get_actor(pool: &SqlitePool, id: i64) -> Result<Option<Actor>> {
    let row = sqlx::query(
        "SELECT a.*, COALESCE(w.work_count, 0) AS work_count
         FROM actors a
         LEFT JOIN (
             SELECT actor_id, COUNT(*) AS work_count
             FROM (
                 SELECT va.actor_id, 'video-' || v.id AS work_key
                 FROM video_actors va
                 JOIN videos v ON v.id = va.video_id
                 WHERE v.series_id IS NULL
                 UNION
                 SELECT va.actor_id, 'series-' || v.series_id AS work_key
                 FROM video_actors va
                 JOIN videos v ON v.id = va.video_id
                 WHERE v.series_id IS NOT NULL
                 UNION
                 SELECT sa.actor_id, 'series-' || sa.series_id AS work_key
                 FROM series_actors sa
             ) actor_works
             GROUP BY actor_id
         ) w ON w.actor_id = a.id
         WHERE a.id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|row| actor_from_row(&row)))
}

pub async fn add_actor(
    pool: &SqlitePool,
    name: &str,
    photo: Option<&str>,
    bio: Option<&str>,
    birthday: Option<&str>,
    height: Option<&str>,
    measurements: Option<&str>,
    japanese_name: Option<&str>,
    cup_size: Option<&str>,
    avatar_base64: Option<&str>,
    alias: Option<&str>,
) -> Result<Actor> {
    let row = sqlx::query(
        "INSERT INTO actors (name, photo, bio, birthday, height, measurements, japanese_name, cup_size, avatar_base64, alias) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
    )
    .bind(name)
    .bind(photo)
    .bind(bio)
    .bind(birthday)
    .bind(height)
    .bind(measurements)
    .bind(japanese_name)
    .bind(cup_size)
    .bind(avatar_base64)
    .bind(alias)
    .fetch_one(pool)
    .await?;

    Ok(actor_from_row(&row))
}

pub async fn update_actor(
    pool: &SqlitePool,
    id: i64,
    name: &str,
    photo: Option<&str>,
    bio: Option<&str>,
    birthday: Option<&str>,
    height: Option<&str>,
    measurements: Option<&str>,
    japanese_name: Option<&str>,
    cup_size: Option<&str>,
    avatar_base64: Option<&str>,
    alias: Option<&str>,
) -> Result<Actor> {
    let row = sqlx::query(
        "UPDATE actors SET name = ?, photo = ?, bio = ?, birthday = ?, height = ?, measurements = ?, japanese_name = ?, cup_size = ?, avatar_base64 = ?, alias = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING *",
    )
    .bind(name)
    .bind(photo)
    .bind(bio)
    .bind(birthday)
    .bind(height)
    .bind(measurements)
    .bind(japanese_name)
    .bind(cup_size)
    .bind(avatar_base64)
    .bind(alias)
    .bind(id)
    .fetch_one(pool)
    .await?;

    Ok(actor_from_row(&row))
}

fn image_mime_from_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

fn image_data_url(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let encoded = BASE64_STANDARD.encode(bytes);
    Some(format!(
        "data:{};base64,{}",
        image_mime_from_path(path),
        encoded
    ))
}

fn actor_from_row(row: &SqliteRow) -> Actor {
    let photo: Option<String> = row.get("photo");
    let resolved_photo = photo.clone().map(|path| {
        storage::resolve_data_path(&path)
            .to_string_lossy()
            .to_string()
    });
    // 双读兜底：优先读 avatar_base64，如果为 NULL，降级使用 image_data_url
    let photo_data_url: Option<String> = row.try_get("avatar_base64").ok().flatten()
        .or_else(|| {
            let p = photo?;
            let resolved = storage::resolve_data_path(&p);
            image_data_url(Path::new(&resolved))
        });

    Actor {
        id: row.get("id"),
        name: row.get("name"),
        photo: resolved_photo,
        photo_data_url: photo_data_url.clone(),
        avatar_base64: photo_data_url,
        bio: row.get("bio"),
        birthday: row.get("birthday"),
        height: row.get("height"),
        measurements: row.get("measurements"),
        japanese_name: row.get("japanese_name"),
        cup_size: row.get("cup_size"),
        alias: row.try_get("alias").ok().flatten(),
        work_count: row.try_get("work_count").unwrap_or(0),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

pub async fn delete_actor(pool: &SqlitePool, id: i64) -> Result<()> {
    sqlx::query("DELETE FROM actors WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// 演员时期操作
pub async fn get_actor_periods(pool: &SqlitePool, actor_id: i64) -> Result<Vec<ActorPeriod>> {
    let rows = sqlx::query("SELECT * FROM actor_periods WHERE actor_id = ? ORDER BY created_at ASC")
        .bind(actor_id)
        .fetch_all(pool)
        .await?;
    let periods = rows.iter().map(|row| ActorPeriod {
        id: row.get("id"),
        actor_id: row.get("actor_id"),
        name: row.get("name"),
        created_at: row.get("created_at"),
    }).collect();
    Ok(periods)
}

pub async fn add_actor_period(pool: &SqlitePool, actor_id: i64, name: &str) -> Result<ActorPeriod> {
    let row = sqlx::query(
        "INSERT INTO actor_periods (actor_id, name) VALUES (?, ?) RETURNING *",
    )
    .bind(actor_id)
    .bind(name)
    .fetch_one(pool)
    .await?;
    Ok(ActorPeriod {
        id: row.get("id"),
        actor_id: row.get("actor_id"),
        name: row.get("name"),
        created_at: row.get("created_at"),
    })
}

pub async fn update_actor_period(pool: &SqlitePool, id: i64, name: &str) -> Result<()> {
    sqlx::query("UPDATE actor_periods SET name = ? WHERE id = ?")
        .bind(name)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_actor_period(pool: &SqlitePool, id: i64) -> Result<()> {
    sqlx::query("DELETE FROM actor_periods WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// 标签操作
pub async fn get_tags(pool: &SqlitePool) -> Result<Vec<Tag>> {
    let rows = sqlx::query("SELECT * FROM tags ORDER BY name")
        .fetch_all(pool)
        .await?;

    let tags = rows
        .iter()
        .map(|row| Tag {
            id: row.get("id"),
            name: row.get("name"),
            created_at: row.get("created_at"),
        })
        .collect();

    Ok(tags)
}

/// 按名称精确匹配演员（忽略首尾空格和大小写）
pub async fn get_actor_by_name(pool: &SqlitePool, name: &str) -> Result<Option<Actor>> {
    let row = sqlx::query("SELECT * FROM actors WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))")
        .bind(name)
        .fetch_optional(pool)
        .await?;
    match row {
        Some(row) => Ok(Some(actor_from_row(&row))),
        None => Ok(None),
    }
}

/// 按名称精确匹配标签（忽略首尾空格和大小写）
pub async fn get_tag_by_name(pool: &SqlitePool, name: &str) -> Result<Option<Tag>> {
    let row = sqlx::query("SELECT * FROM tags WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))")
        .bind(name)
        .fetch_optional(pool)
        .await?;
    match row {
        Some(row) => Ok(Some(Tag {
            id: row.get("id"),
            name: row.get("name"),
            created_at: row.get("created_at"),
        })),
        None => Ok(None),
    }
}

pub async fn add_tag(pool: &SqlitePool, name: &str) -> Result<Tag> {
    let row = sqlx::query("INSERT INTO tags (name) VALUES (?) RETURNING *")
        .bind(name)
        .fetch_one(pool)
        .await?;

    Ok(Tag {
        id: row.get("id"),
        name: row.get("name"),
        created_at: row.get("created_at"),
    })
}

pub async fn delete_tag(pool: &SqlitePool, id: i64) -> Result<()> {
    sqlx::query("DELETE FROM tags WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// 资源标签关联
// 视频标签关联（单视频打标签用）
pub async fn add_video_tag(pool: &SqlitePool, video_id: i64, tag_id: i64) -> Result<()> {
    sqlx::query("INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES (?, ?)")
        .bind(video_id)
        .bind(tag_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn add_resource_tag(pool: &SqlitePool, resource_id: i64, tag_id: i64) -> Result<()> {
    sqlx::query("INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES (?, ?)")
        .bind(resource_id)
        .bind(tag_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn remove_resource_tag(pool: &SqlitePool, resource_id: i64, tag_id: i64) -> Result<()> {
    sqlx::query("DELETE FROM video_tags WHERE video_id = ? AND tag_id = ?")
        .bind(resource_id)
        .bind(tag_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_resource_tags(pool: &SqlitePool, resource_id: i64) -> Result<Vec<Tag>> {
    let rows = sqlx::query(
        "SELECT t.* FROM tags t JOIN video_tags vt ON t.id = vt.tag_id WHERE vt.video_id = ? ORDER BY t.name",
    )
    .bind(resource_id)
    .fetch_all(pool)
    .await?;

    let tags = rows
        .iter()
        .map(|row| Tag {
            id: row.get("id"),
            name: row.get("name"),
            created_at: row.get("created_at"),
        })
        .collect();

    Ok(tags)
}

// 资源演员关联
pub async fn add_resource_actor(
    pool: &SqlitePool,
    resource_id: i64,
    actor_id: i64,
    role: Option<&str>,
    period_id: Option<i64>,
) -> Result<()> {
    sqlx::query("INSERT OR IGNORE INTO video_actors (video_id, actor_id, role, period_id) VALUES (?, ?, ?, ?)")
        .bind(resource_id)
        .bind(actor_id)
        .bind(role)
        .bind(period_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn remove_resource_actor(
    pool: &SqlitePool,
    resource_id: i64,
    actor_id: i64,
) -> Result<()> {
    sqlx::query("DELETE FROM video_actors WHERE video_id = ? AND actor_id = ?")
        .bind(resource_id)
        .bind(actor_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_resource_actors(pool: &SqlitePool, resource_id: i64) -> Result<Vec<Actor>> {
    let rows = sqlx::query(
        "SELECT a.* FROM actors a JOIN video_actors va ON a.id = va.actor_id WHERE va.video_id = ? ORDER BY a.name",
    )
    .bind(resource_id)
    .fetch_all(pool)
    .await?;

    let actors = rows.iter().map(actor_from_row).collect();

    Ok(actors)
}

pub async fn get_actor_resources(pool: &SqlitePool, actor_id: i64) -> Result<Vec<Video>> {
    let rows = sqlx::query(
        "SELECT DISTINCT v.*, s.title AS series_title, s.poster AS series_poster, s.poster_base64 AS series_poster_base64, s.has_chinese_sub AS series_has_chinese_sub, s.code AS series_code
         FROM videos v
         LEFT JOIN video_series s ON s.id = v.series_id
         LEFT JOIN video_actors va ON va.video_id = v.id
         LEFT JOIN series_actors sa ON sa.series_id = v.series_id
         WHERE va.actor_id = ? OR sa.actor_id = ?
         ORDER BY COALESCE(s.updated_at, v.created_at) DESC, COALESCE(v.episode_number, 999999), v.file_name",
    )
    .bind(actor_id)
    .bind(actor_id)
    .fetch_all(pool)
    .await?;

    Ok(rows.iter().map(video_from_row).collect())
}

/// 返回演员参演作品的时期映射：work_key -> period_id
/// work_key 格式: "series-{id}" 或 "video-{id}"
pub async fn get_actor_work_period_map(pool: &SqlitePool, actor_id: i64) -> Result<std::collections::HashMap<String, i64>> {
    let mut map = std::collections::HashMap::new();

    // 从 video_actors 获取独立视频的 period_id
    let rows = sqlx::query(
        "SELECT va.video_id, va.period_id FROM video_actors va
         JOIN videos v ON v.id = va.video_id
         WHERE va.actor_id = ? AND va.period_id IS NOT NULL AND v.series_id IS NULL"
    )
    .bind(actor_id)
    .fetch_all(pool)
    .await?;
    for row in rows {
        if let Ok(Some(period_id)) = row.try_get::<Option<i64>, _>("period_id") {
            let video_id: i64 = row.get("video_id");
            map.insert(format!("video-{}", video_id), period_id);
        }
    }

    // 从 video_actors 获取系列视频的 period_id（取第一个视频的 period_id）
    let rows = sqlx::query(
        "SELECT v.series_id, va.period_id FROM video_actors va
         JOIN videos v ON v.id = va.video_id
         WHERE va.actor_id = ? AND va.period_id IS NOT NULL AND v.series_id IS NOT NULL
         GROUP BY v.series_id"
    )
    .bind(actor_id)
    .fetch_all(pool)
    .await?;
    for row in rows {
        if let Ok(Some(period_id)) = row.try_get::<Option<i64>, _>("period_id") {
            if let Ok(Some(series_id)) = row.try_get::<Option<i64>, _>("series_id") {
                map.entry(format!("series-{}", series_id)).or_insert(period_id);
            }
        }
    }

    // 从 series_actors 获取系列的 period_id（优先级更高，覆盖 video_actors 的值）
    let rows = sqlx::query(
        "SELECT sa.series_id, sa.period_id FROM series_actors sa
         WHERE sa.actor_id = ? AND sa.period_id IS NOT NULL"
    )
    .bind(actor_id)
    .fetch_all(pool)
    .await?;
    for row in rows {
        if let Ok(Some(period_id)) = row.try_get::<Option<i64>, _>("period_id") {
            let series_id: i64 = row.get("series_id");
            map.insert(format!("series-{}", series_id), period_id);
        }
    }

    Ok(map)
}

pub async fn add_series_tag(pool: &SqlitePool, series_id: i64, tag_id: i64) -> Result<()> {
    sqlx::query("INSERT OR IGNORE INTO series_tags (series_id, tag_id) VALUES (?, ?)")
        .bind(series_id)
        .bind(tag_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn remove_series_tag(pool: &SqlitePool, series_id: i64, tag_id: i64) -> Result<()> {
    sqlx::query("DELETE FROM series_tags WHERE series_id = ? AND tag_id = ?")
        .bind(series_id)
        .bind(tag_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_series_tags(pool: &SqlitePool, series_id: i64) -> Result<Vec<Tag>> {
    let rows = sqlx::query(
        "SELECT t.* FROM tags t JOIN series_tags st ON t.id = st.tag_id WHERE st.series_id = ? ORDER BY t.name",
    )
    .bind(series_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .iter()
        .map(|row| Tag {
            id: row.get("id"),
            name: row.get("name"),
            created_at: row.get("created_at"),
        })
        .collect())
}

pub async fn add_series_actor(
    pool: &SqlitePool,
    series_id: i64,
    actor_id: i64,
    role: Option<&str>,
    period_id: Option<i64>,
) -> Result<()> {
    sqlx::query("INSERT OR IGNORE INTO series_actors (series_id, actor_id, role, period_id) VALUES (?, ?, ?, ?)")
        .bind(series_id)
        .bind(actor_id)
        .bind(role)
        .bind(period_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn remove_series_actor(pool: &SqlitePool, series_id: i64, actor_id: i64) -> Result<()> {
    sqlx::query("DELETE FROM series_actors WHERE series_id = ? AND actor_id = ?")
        .bind(series_id)
        .bind(actor_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_series_actors(pool: &SqlitePool, series_id: i64) -> Result<Vec<Actor>> {
    let rows = sqlx::query(
        "SELECT a.* FROM actors a JOIN series_actors sa ON a.id = sa.actor_id WHERE sa.series_id = ? ORDER BY a.name",
    )
    .bind(series_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(actor_from_row).collect())
}

// 播放记录操作
pub async fn record_play_history(
    pool: &SqlitePool,
    video_id: i64,
    last_position: f64,
    total_duration: Option<f64>,
) -> Result<()> {
    let result = sqlx::query(
        "UPDATE play_history
         SET last_position = ?, total_duration = ?, play_count = play_count + 1, last_played = CURRENT_TIMESTAMP
         WHERE video_id = ?",
    )
    .bind(last_position)
    .bind(total_duration)
    .bind(video_id)
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        sqlx::query(
            "INSERT INTO play_history (video_id, last_position, total_duration, play_count, last_played)
             VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)",
        )
        .bind(video_id)
        .bind(last_position)
        .bind(total_duration)
        .execute(pool)
        .await?;
    }

    Ok(())
}

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

pub async fn get_recent_watch_items(pool: &SqlitePool, limit: i64) -> Result<Vec<RecentWatchItem>> {
    let rows = sqlx::query(
        "SELECT ph.id AS history_id, ph.last_position, ph.total_duration, ph.play_count, ph.last_played,
                v.*, s.id AS s_id, s.title AS s_title, s.description AS s_description, s.poster AS s_poster,
                s.folder_path AS s_folder_path, s.poster_base64 AS s_poster_base64, s.created_at AS s_created_at, s.updated_at AS s_updated_at,
                (SELECT COUNT(*) FROM videos sv WHERE sv.series_id = s.id) AS s_video_count
         FROM play_history ph
         JOIN videos v ON v.id = ph.video_id
         LEFT JOIN video_series s ON s.id = v.series_id
         ORDER BY ph.last_played DESC
         LIMIT ?",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let mut items = Vec::new();
    for row in rows {
        let video = video_from_row(&row);
        let series = row.try_get::<i64, _>("s_id").ok().map(|_| {
            let poster: Option<String> = row.get("s_poster");
            let resolved_poster = poster.map(|path| {
                storage::resolve_data_path(&path)
                    .to_string_lossy()
                    .to_string()
            });
            let poster_data_url: Option<String> = row.try_get("s_poster_base64").ok().flatten();
            VideoSeries {
                id: row.get("s_id"),
                title: row.get("s_title"),
                description: row.get("s_description"),
                poster: resolved_poster,
                poster_data_url: poster_data_url.clone(),
                poster_base64: poster_data_url,
                folder_path: row.get("s_folder_path"),
                video_count: row.get("s_video_count"),
                poster_orientation: row.try_get("s_poster_orientation").ok(),
                status: row.try_get("s_status").ok(),
                created_at: row.get("s_created_at"),
                updated_at: row.get("s_updated_at"),
                is_favorite: None,
                is_watched: None,
                last_watched_episode: None,
                has_actor: false,
                code: None,
                has_chinese_sub: None,
                display_type: None,
            }
        });
        items.push(RecentWatchItem {
            video,
            series,
            last_position: row.get("last_position"),
            total_duration: row.get("total_duration"),
            play_count: row.get("play_count"),
            last_played: row.get("last_played"),
        });
    }

    Ok(items)
}

pub async fn get_series_playback_video(pool: &SqlitePool, series_id: i64) -> Result<Option<Video>> {
    let row = sqlx::query(
        "SELECT v.* FROM videos v
         LEFT JOIN play_history ph ON ph.video_id = v.id
         WHERE v.series_id = ?
         ORDER BY ph.last_played IS NULL, ph.last_played DESC, v.episode_number IS NULL, v.episode_number, v.file_name
         LIMIT 1",
    )
    .bind(series_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|row| video_from_row(&row)))
}

// 观看进度操作
pub async fn update_watch_progress(
    pool: &SqlitePool,
    resource_id: i64,
    episode: i32,
    position: f64,
    duration: f64,
) -> Result<()> {
    sqlx::query(
        "INSERT OR REPLACE INTO watch_progress (resource_id, episode, position, duration, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
    )
    .bind(resource_id)
    .bind(episode)
    .bind(position)
    .bind(duration)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_watch_progress(
    pool: &SqlitePool,
    resource_id: i64,
    episode: i32,
) -> Result<Option<WatchProgress>> {
    let row = sqlx::query("SELECT * FROM watch_progress WHERE resource_id = ? AND episode = ?")
        .bind(resource_id)
        .bind(episode)
        .fetch_optional(pool)
        .await?;

    Ok(row.map(|row| WatchProgress {
        id: row.get("id"),
        resource_id: row.get("resource_id"),
        episode: row.get("episode"),
        position: row.get("position"),
        duration: row.get("duration"),
        updated_at: row.get("updated_at"),
    }))
}

pub async fn get_resource_watch_progress(
    pool: &SqlitePool,
    resource_id: i64,
) -> Result<Vec<WatchProgress>> {
    let rows = sqlx::query("SELECT * FROM watch_progress WHERE resource_id = ? ORDER BY episode")
        .bind(resource_id)
        .fetch_all(pool)
        .await?;

    let progress = rows
        .iter()
        .map(|row| WatchProgress {
            id: row.get("id"),
            resource_id: row.get("resource_id"),
            episode: row.get("episode"),
            position: row.get("position"),
            duration: row.get("duration"),
            updated_at: row.get("updated_at"),
        })
        .collect();

    Ok(progress)
}

// 资源操作
pub async fn get_resources(pool: &SqlitePool) -> Result<Vec<Resource>> {
    let rows = sqlx::query("SELECT * FROM resources ORDER BY created_at DESC")
        .fetch_all(pool)
        .await?;

    let resources = rows
        .iter()
        .map(|row| Resource {
            id: row.get("id"),
            site_id: row.get("site_id"),
            title: row.get("title"),
            url: row.get("url"),
            magnet: row.get("magnet"),
            info: row.get("info"),
            created_at: row.get("created_at"),
        })
        .collect();

    Ok(resources)
}

pub async fn get_resources_by_category(pool: &SqlitePool, category: &str) -> Result<Vec<Resource>> {
    let rows = sqlx::query("SELECT r.* FROM resources r LEFT JOIN resource_tags rt ON r.id = rt.resource_id LEFT JOIN tags t ON rt.tag_id = t.id WHERE t.name = ? ORDER BY r.created_at DESC")
        .bind(category)
        .fetch_all(pool)
        .await?;

    let resources = rows
        .iter()
        .map(|row| Resource {
            id: row.get("id"),
            site_id: row.get("site_id"),
            title: row.get("title"),
            url: row.get("url"),
            magnet: row.get("magnet"),
            info: row.get("info"),
            created_at: row.get("created_at"),
        })
        .collect();

    Ok(resources)
}

pub async fn get_recent_resources(pool: &SqlitePool, limit: i64) -> Result<Vec<Resource>> {
    let rows = sqlx::query("SELECT * FROM resources ORDER BY created_at DESC LIMIT ?")
        .bind(limit)
        .fetch_all(pool)
        .await?;

    let resources = rows
        .iter()
        .map(|row| Resource {
            id: row.get("id"),
            site_id: row.get("site_id"),
            title: row.get("title"),
            url: row.get("url"),
            magnet: row.get("magnet"),
            info: row.get("info"),
            created_at: row.get("created_at"),
        })
        .collect();

    Ok(resources)
}

/// 一次性迁移：回填 poster_base64 / avatar_base64 缓存
/// 为旧数据（poster_base64/avatar_base64 为 NULL）生成 Base64 缓存
pub async fn backfill_base64_cache(pool: &SqlitePool) -> Result<()> {
    // 回填 video_series 的 poster_base64
    let series_rows = sqlx::query(
        "SELECT id, poster FROM video_series WHERE poster_base64 IS NULL AND poster IS NOT NULL"
    )
    .fetch_all(pool)
    .await?;

    eprintln!("[ChangLi] 回填海报缓存: 发现 {} 条 video_series 记录需要处理", series_rows.len());
    let mut series_filled = 0;
    for row in &series_rows {
        let id: i64 = row.get("id");
        let poster: String = row.get("poster");
        let resolved = storage::resolve_data_path(&poster);
        if let Some(data_url) = image_data_url(Path::new(&resolved)) {
            sqlx::query("UPDATE video_series SET poster_base64 = ? WHERE id = ?")
                .bind(&data_url)
                .bind(id)
                .execute(pool)
                .await?;
            series_filled += 1;
        }
    }
    if series_filled > 0 {
        eprintln!("[ChangLi] 回填海报缓存: 成功回填 {} 条 video_series", series_filled);
    }

    // 回填 actors 的 avatar_base64
    let actor_rows = sqlx::query(
        "SELECT id, photo FROM actors WHERE avatar_base64 IS NULL AND photo IS NOT NULL"
    )
    .fetch_all(pool)
    .await?;

    eprintln!("[ChangLi] 回填头像缓存: 发现 {} 条 actors 记录需要处理", actor_rows.len());
    let mut actors_filled = 0;
    for row in &actor_rows {
        let id: i64 = row.get("id");
        let photo: String = row.get("photo");
        let resolved = storage::resolve_data_path(&photo);
        if let Some(data_url) = image_data_url(Path::new(&resolved)) {
            sqlx::query("UPDATE actors SET avatar_base64 = ? WHERE id = ?")
                .bind(&data_url)
                .bind(id)
                .execute(pool)
                .await?;
            actors_filled += 1;
        }
    }
    if actors_filled > 0 {
        eprintln!("[ChangLi] 回填头像缓存: 成功回填 {} 条 actors", actors_filled);
    }

    // 回填 video_series 的 poster_orientation
    let series_orientation_rows = sqlx::query(
        "SELECT id, poster FROM video_series WHERE poster_orientation IS NULL AND poster IS NOT NULL"
    )
    .fetch_all(pool)
    .await?;

    if !series_orientation_rows.is_empty() {
        eprintln!("[ChangLi] 回填海报方向: 发现 {} 条 video_series 记录需要处理", series_orientation_rows.len());
        let mut orientation_filled = 0;
        for row in &series_orientation_rows {
            let id: i64 = row.get("id");
            let poster: String = row.get("poster");
            let resolved = storage::resolve_data_path(&poster);
            if let Some(orientation) = crate::scanner::get_image_orientation(Path::new(&resolved)) {
                sqlx::query("UPDATE video_series SET poster_orientation = ? WHERE id = ?")
                    .bind(&orientation)
                    .bind(id)
                    .execute(pool)
                    .await?;
                orientation_filled += 1;
            }
        }
        if orientation_filled > 0 {
            eprintln!("[ChangLi] 回填海报方向: 成功回填 {} 条 video_series", orientation_filled);
        }
    }

    // 回填 videos 的 poster_orientation
    let video_orientation_rows = sqlx::query(
        "SELECT id, thumbnail FROM videos WHERE poster_orientation IS NULL AND thumbnail IS NOT NULL"
    )
    .fetch_all(pool)
    .await?;

    if !video_orientation_rows.is_empty() {
        eprintln!("[ChangLi] 回填海报方向: 发现 {} 条 videos 记录需要处理", video_orientation_rows.len());
        let mut orientation_filled = 0;
        for row in &video_orientation_rows {
            let id: i64 = row.get("id");
            let thumbnail: String = row.get("thumbnail");
            let resolved = storage::resolve_data_path(&thumbnail);
            if let Some(orientation) = crate::scanner::get_image_orientation(Path::new(&resolved)) {
                sqlx::query("UPDATE videos SET poster_orientation = ? WHERE id = ?")
                    .bind(&orientation)
                    .bind(id)
                    .execute(pool)
                    .await?;
                orientation_filled += 1;
            }
        }
        if orientation_filled > 0 {
            eprintln!("[ChangLi] 回填海报方向: 成功回填 {} 条 videos", orientation_filled);
        }
    }

    Ok(())
}

pub async fn toggle_favorite_video(pool: &SqlitePool, id: i64) -> Result<()> {
    sqlx::query("UPDATE videos SET is_favorite = CASE WHEN is_favorite = 1 THEN 0 ELSE 1 END WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn toggle_favorite_series(pool: &SqlitePool, id: i64) -> Result<()> {
    sqlx::query("UPDATE video_series SET is_favorite = CASE WHEN is_favorite = 1 THEN 0 ELSE 1 END WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn toggle_chinese_sub_series(pool: &SqlitePool, id: i64) -> Result<()> {
    sqlx::query("UPDATE video_series SET has_chinese_sub = CASE WHEN has_chinese_sub = 1 THEN 0 ELSE 1 END WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn toggle_watched_series(pool: &SqlitePool, id: i64) -> Result<()> {
    sqlx::query("UPDATE video_series SET is_watched = CASE WHEN is_watched = 1 THEN 0 ELSE 1 END WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_favorite_videos(pool: &SqlitePool) -> Result<Vec<Video>> {
    let rows = sqlx::query("SELECT * FROM videos WHERE is_favorite = 1 ORDER BY created_at DESC")
        .fetch_all(pool)
        .await?;
    Ok(rows.iter().map(video_from_row).collect())
}

pub async fn get_favorite_series(pool: &SqlitePool) -> Result<Vec<VideoSeries>> {
    let rows = sqlx::query("SELECT s.*, COUNT(v.id) AS video_count, (SELECT v2.episode_number FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_episode, MAX(CASE WHEN sa.actor_id IS NOT NULL THEN 1 ELSE 0 END) AS has_actor FROM video_series s LEFT JOIN videos v ON v.series_id = s.id LEFT JOIN series_actors sa ON sa.series_id = s.id WHERE s.is_favorite = 1 GROUP BY s.id ORDER BY s.created_at DESC")
        .fetch_all(pool)
        .await?;
    Ok(rows.iter().map(series_from_row).collect())
}

/// 删除所有视频数据（不删除本地源文件，保留 actors 和 tags）
/// 返回 (删除的视频数, 删除的视频集数)
pub async fn delete_all_videos(pool: &SqlitePool) -> Result<(i64, i64)> {
    let video_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM videos")
        .fetch_one(pool)
        .await?;
    let series_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM video_series")
        .fetch_one(pool)
        .await?;
    sqlx::query("DELETE FROM play_history").execute(pool).await?;
    sqlx::query("DELETE FROM watch_progress").execute(pool).await?;
    sqlx::query("DELETE FROM videos").execute(pool).await?;
    sqlx::query("DELETE FROM series_tags").execute(pool).await?;
    sqlx::query("DELETE FROM series_actors").execute(pool).await?;
    sqlx::query("DELETE FROM video_series").execute(pool).await?;
    Ok((video_count.0, series_count.0))
}
/// 删除所有动漫（has_actor=0 且 display_type!='adult' 的视频集及其视频，但不删除占位视频）
pub async fn delete_all_anime(pool: &SqlitePool) -> Result<(i64, i64)> {
    let video_count: (i64,) = sqlx::query_as(&format!(
        "SELECT COUNT(*) FROM videos v WHERE v.series_id IN (SELECT id FROM video_series WHERE (has_actor = 0 OR has_actor IS NULL) AND (display_type IS NULL OR display_type != 'adult'))"
    ))
    .fetch_one(pool)
    .await?;

    let series_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM video_series WHERE (has_actor = 0 OR has_actor IS NULL) AND (display_type IS NULL OR display_type != 'adult')"
    )
    .fetch_one(pool)
    .await?;

    let anime_sub = "SELECT id FROM video_series WHERE (has_actor = 0 OR has_actor IS NULL) AND (display_type IS NULL OR display_type != 'adult')";

    sqlx::query(&format!("DELETE FROM play_history WHERE video_id IN (SELECT id FROM videos WHERE series_id IN ({}))", anime_sub))
        .execute(pool).await?;
    sqlx::query(&format!("DELETE FROM watch_progress WHERE resource_id IN (SELECT id FROM videos WHERE series_id IN ({}))", anime_sub))
        .execute(pool).await?;
    sqlx::query(&format!("DELETE FROM videos WHERE series_id IN ({})", anime_sub))
        .execute(pool).await?;
    sqlx::query(&format!("DELETE FROM series_tags WHERE series_id IN ({})", anime_sub))
        .execute(pool).await?;
    sqlx::query(&format!("DELETE FROM series_actors WHERE series_id IN ({})", anime_sub))
        .execute(pool).await?;
    sqlx::query(&format!("DELETE FROM video_series WHERE id IN ({})", anime_sub))
        .execute(pool).await?;

    Ok((video_count.0, series_count.0))
}

/// 删除所有影视（has_actor=1 或 display_type='adult' 的视频集及其视频，但不删除占位视频）
pub async fn delete_all_adult(pool: &SqlitePool) -> Result<(i64, i64)> {
    let adult_sub = "SELECT id FROM video_series WHERE has_actor = 1 OR display_type = 'adult'";

    let video_count: (i64,) = sqlx::query_as(&format!(
        "SELECT COUNT(*) FROM videos WHERE series_id IN ({})", adult_sub
    ))
    .fetch_one(pool)
    .await?;

    let series_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM video_series WHERE has_actor = 1 OR display_type = 'adult'"
    )
    .fetch_one(pool)
    .await?;

    sqlx::query(&format!("DELETE FROM play_history WHERE video_id IN (SELECT id FROM videos WHERE series_id IN ({}))", adult_sub))
        .execute(pool).await?;
    sqlx::query(&format!("DELETE FROM watch_progress WHERE resource_id IN (SELECT id FROM videos WHERE series_id IN ({}))", adult_sub))
        .execute(pool).await?;
    sqlx::query(&format!("DELETE FROM videos WHERE series_id IN ({})", adult_sub))
        .execute(pool).await?;
    sqlx::query(&format!("DELETE FROM series_tags WHERE series_id IN ({})", adult_sub))
        .execute(pool).await?;
    sqlx::query(&format!("DELETE FROM series_actors WHERE series_id IN ({})", adult_sub))
        .execute(pool).await?;
    sqlx::query(&format!("DELETE FROM video_series WHERE id IN ({})", adult_sub))
        .execute(pool).await?;

    Ok((video_count.0, series_count.0))
}


/// 重新扫描所有 video_series 的元数据（code、has_chinese_sub）
/// 重新扫描单个视频集的元数据（车牌、中字、标题、海报）
pub async fn rescan_single_series_metadata(pool: &SqlitePool, series_id: i64) -> Result<bool> {
    let row = sqlx::query_as::<_, (i64, String, Option<String>)>(
        "SELECT id, title, folder_path FROM video_series WHERE id = ?"
    )
    .bind(series_id)
    .fetch_optional(pool)
    .await?;

    let (id, title, folder_path) = match row {
        Some(r) => r,
        None => return Ok(false),
    };

    let source = folder_path.as_deref().unwrap_or(&title);
    let folder_name = std::path::Path::new(source)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| title.clone());

    if let Some(info) = crate::scanner::parse_adult_filename(&folder_name) {
        let code = info.code;
        let has_chinese_sub: i32 = if info.has_chinese_sub { 1 } else { 0 };
        let new_title = info.title.unwrap_or_else(|| folder_name.clone());

        // 重新生成海报
        let folder_path_std = std::path::Path::new(source);
        let poster = crate::scanner::find_folder_poster(folder_path_std);
        let poster_base64 = poster
            .as_deref()
            .and_then(|p| crate::scanner::generate_thumbnail_base64(std::path::Path::new(p)));

        sqlx::query(
            "UPDATE video_series SET code = ?, has_chinese_sub = ?, title = ?, poster = ?, poster_base64 = ? WHERE id = ?"
        )
        .bind(&code)
        .bind(has_chinese_sub)
        .bind(&new_title)
        .bind(poster)
        .bind(poster_base64)
        .bind(id)
        .execute(pool)
        .await?;

        Ok(true)
    } else {
        Ok(false)
    }
}

pub async fn rescan_all_series_metadata(pool: &SqlitePool) -> Result<(i64, i64)> {
    let series_list = sqlx::query_as::<_, (i64, String, Option<String>)>(
        "SELECT id, title, folder_path FROM video_series"
    )
    .fetch_all(pool)
    .await?;

    let mut updated: i64 = 0;
    let mut skipped: i64 = 0;

    for (id, title, folder_path) in series_list {
        let source = folder_path.as_deref().unwrap_or(&title);
        let folder_name = std::path::Path::new(source)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| title.clone());
        if let Some(info) = crate::scanner::parse_adult_filename(&folder_name) {
            let code = info.code;
            let has_chinese_sub: i32 = if info.has_chinese_sub { 1 } else { 0 };
            let new_title = info.title.unwrap_or_else(|| folder_name.clone());
            // 重新生成海报
            let folder_path_std = std::path::Path::new(source);
            let poster = crate::scanner::find_folder_poster(folder_path_std);
            let poster_base64 = poster
                .as_deref()
                .and_then(|p| crate::scanner::generate_thumbnail_base64(std::path::Path::new(p)));
            sqlx::query(
                "UPDATE video_series SET code = ?, has_chinese_sub = ?, title = ?, poster = ?, poster_base64 = ? WHERE id = ? AND (code IS NULL OR code = '')"
            )
            .bind(&code)
            .bind(has_chinese_sub)
            .bind(&new_title)
            .bind(&poster)
            .bind(&poster_base64)
            .bind(id)
            .execute(pool)
            .await?;
            updated += 1;
            } else {
            skipped += 1;
            }
    }

    Ok((updated, skipped))
}
/// 重新扫描动漫元数据（has_actor=0 的视频集）
pub async fn rescan_anime_metadata(pool: &SqlitePool) -> Result<(i64, i64)> {
    let series_list = sqlx::query_as::<_, (i64, String, Option<String>)>(
        "SELECT id, title, folder_path FROM video_series WHERE (has_actor = 0 OR has_actor IS NULL) AND (display_type IS NULL OR display_type != 'adult')"
    )
    .fetch_all(pool)
    .await?;

    let mut updated: i64 = 0;
    let mut skipped: i64 = 0;

    for (id, title, folder_path) in series_list {
        let source = folder_path.as_deref().unwrap_or(&title);
        let folder_name = std::path::Path::new(source)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| title.clone());
        if let Some(info) = crate::scanner::parse_adult_filename(&folder_name) {
            let code = info.code;
            let has_chinese_sub: i32 = if info.has_chinese_sub { 1 } else { 0 };
            let new_title = info.title.unwrap_or_else(|| folder_name.clone());
            let folder_path_std = std::path::Path::new(source);
            let poster = crate::scanner::find_folder_poster(folder_path_std);
            let poster_base64 = poster
                .as_deref()
                .and_then(|p| crate::scanner::generate_thumbnail_base64(std::path::Path::new(p)));
            sqlx::query(
                "UPDATE video_series SET code = ?, has_chinese_sub = ?, title = ?, poster = ?, poster_base64 = ? WHERE id = ? AND (code IS NULL OR code = '')"
            )
            .bind(&code)
            .bind(has_chinese_sub)
            .bind(&new_title)
            .bind(&poster)
            .bind(&poster_base64)
            .bind(id)
            .execute(pool)
            .await?;
            updated += 1;
        } else {
            skipped += 1;
        }
    }

    Ok((updated, skipped))
}

/// 重新扫描影视元数据（has_actor=1 的视频集，无条件覆盖）
pub async fn rescan_adult_metadata(pool: &SqlitePool) -> Result<(i64, i64)> {
    let series_list = sqlx::query_as::<_, (i64, String, Option<String>)>(
        "SELECT id, title, folder_path FROM video_series WHERE has_actor = 1 OR display_type = 'adult'"
    )
    .fetch_all(pool)
    .await?;

    let mut updated: i64 = 0;
    let mut skipped: i64 = 0;

    for (id, title, folder_path) in series_list {
        let source = folder_path.as_deref().unwrap_or(&title);
        let folder_name = std::path::Path::new(source)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| title.clone());
        if let Some(info) = crate::scanner::parse_adult_filename(&folder_name) {
            let code = info.code;
            let has_chinese_sub: i32 = if info.has_chinese_sub { 1 } else { 0 };
            let new_title = info.title.unwrap_or_else(|| folder_name.clone());
            let folder_path_std = std::path::Path::new(source);
            let poster = crate::scanner::find_folder_poster(folder_path_std);
            let poster_base64 = poster
                .as_deref()
                .and_then(|p| crate::scanner::generate_thumbnail_base64(std::path::Path::new(p)));
            // 影视模式：无条件覆盖（不加 code IS NULL 条件）
            sqlx::query(
                "UPDATE video_series SET code = ?, has_chinese_sub = ?, title = ?, poster = ?, poster_base64 = ? WHERE id = ?"
            )
            .bind(&code)
            .bind(has_chinese_sub)
            .bind(&new_title)
            .bind(&poster)
            .bind(&poster_base64)
            .bind(id)
            .execute(pool)
            .await?;
            updated += 1;
        } else {
            skipped += 1;
        }
    }

    Ok((updated, skipped))
}


// 季管理
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeasonInfo {
    pub season: i32,
    pub subtitle: Option<String>,
    pub video_count: i64,
}

pub async fn get_series_seasons(pool: &SqlitePool, series_id: i64) -> Result<Vec<SeasonInfo>> {
    let rows = sqlx::query(
        "SELECT season, subtitle, COUNT(*) as video_count FROM videos WHERE series_id = ? GROUP BY season, subtitle ORDER BY season"
    )
    .bind(series_id)
    .fetch_all(pool)
    .await?;

    Ok(rows.iter().map(|row| SeasonInfo {
        season: row.get("season"),
        subtitle: row.try_get("subtitle").ok(),
        video_count: row.get("video_count"),
    }).collect())
}

pub async fn delete_season(pool: &SqlitePool, series_id: i64, season: i32) -> Result<()> {
    sqlx::query("DELETE FROM videos WHERE series_id = ? AND season = ?")
        .bind(series_id)
        .bind(season)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn create_season(pool: &SqlitePool, series_id: i64, season: i32, subtitle: Option<&str>) -> Result<()> {
    // 获取当前最大 season 编号（排除 999）
    // 如果 season 参数传 0，自动分配下一个季号
    // 如果 season 参数传 999，创建剧场版
    let target_season = if season == 0 {
        let max_season: i32 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(season), 0) FROM videos WHERE series_id = ? AND season < 999"
        )
        .bind(series_id)
        .fetch_one(pool)
        .await?;
        max_season + 1
    } else {
        season
    };

    // 插入一个占位视频记录，season 字段标记季号
    // 使用一个特殊的占位路径，后续可被真实视频覆盖
    sqlx::query(
        "INSERT INTO videos (file_path, file_name, series_id, season, subtitle) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(format!("__placeholder__/series_{}/season_{}", series_id, target_season))
    .bind(format!("占位-第{}季", target_season))
    .bind(series_id)
    .bind(target_season)
    .bind(subtitle)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn update_video_subtitle(pool: &SqlitePool, video_id: i64, subtitle: Option<String>) -> Result<()> {
    sqlx::query("UPDATE videos SET subtitle = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(subtitle)
        .bind(video_id)
        .execute(pool)
        .await?;
    Ok(())
}
