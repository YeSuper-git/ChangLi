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
    pub last_watched_season: Option<i32>,
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
    pub weight: Option<String>,
    pub work_count: i64,
    pub view_count: i64,
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
    pub sort_order: i64,
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

    // 启动时迁移旧数据海报到 actor_photos 表（一次性迁移）

    Ok(pool)
}

/// 一次性迁移：将 actors 表中有 photo 但 actor_photos 表无记录的演员海报写入 actor_photos

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
pub async fn add_videos_batch(
    pool: &SqlitePool,
    videos: Vec<Video>,
    series_id: Option<i64>,
) -> Result<Vec<Video>> {
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
async fn get_video_by_path_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    file_path: &str,
) -> Result<Option<Video>> {
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
    // 双读兜底：优先读 series_poster_base64，如果为 NULL，降级使用 series_poster 字段
    let series_poster_data_url: Option<String> = row
        .try_get("series_poster_base64")
        .ok()
        .flatten()
        .or_else(|| {
            let poster: Option<String> = row.try_get("series_poster").ok().flatten();
            poster.and_then(|p| {
                let resolved = storage::resolve_data_path(&p);
                image_data_url(Path::new(&resolved))
            })
        });

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
    let poster_data_url: Option<String> =
        row.try_get("poster_base64").ok().flatten().or_else(|| {
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
        last_watched_season: row.try_get("last_watched_season").ok(),
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
    display_type: Option<&str>,
) -> Result<VideoSeries> {
    sqlx::query("INSERT OR IGNORE INTO video_series (title, folder_path, poster, poster_orientation, status, poster_base64, display_type) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, ''))")
        .bind(title)
        .bind(folder_path)
        .bind(poster)
        .bind(poster_orientation.unwrap_or("landscape"))
        .bind(status.unwrap_or("ongoing"))
        .bind(poster_base64)
        .bind(display_type)
        .execute(pool)
        .await?;
    if let Some(path) = folder_path {
        if let Some(series) = get_video_series_by_folder_path(pool, path).await? {
            return Ok(series);
        }
    }
    let row = sqlx::query("SELECT video_series.*, 0 AS video_count, NULL AS last_watched_episode, NULL AS last_watched_season, 0 AS has_actor FROM video_series WHERE id = last_insert_rowid()")
    .fetch_one(pool)
    .await?;
    Ok(series_from_row(&row))
}

pub async fn get_video_series_by_folder_path(
    pool: &SqlitePool,
    folder_path: &str,
) -> Result<Option<VideoSeries>> {
    let row = sqlx::query("SELECT s.*, COUNT(v.id) AS video_count, (SELECT v2.episode_number FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_episode, (SELECT v2.season FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_season, MAX(CASE WHEN sa.actor_id IS NOT NULL THEN 1 ELSE 0 END) AS has_actor FROM video_series s LEFT JOIN videos v ON v.series_id = s.id LEFT JOIN series_actors sa ON sa.series_id = s.id WHERE s.folder_path = ? GROUP BY s.id")
        .bind(folder_path)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|row| series_from_row(&row)))
}

pub async fn get_video_series_list(
    pool: &SqlitePool,
    sort_by: &str,
    sort_order: &str,
) -> Result<Vec<VideoSeries>> {
    let order_clause = match (sort_by, sort_order) {
        ("title", "asc") => "ORDER BY s.title COLLATE NOCASE ASC",
        ("title", "desc") => "ORDER BY s.title COLLATE NOCASE DESC",
        ("created_at", "asc") => "ORDER BY s.created_at ASC",
        _ => "ORDER BY s.created_at DESC",
    };
    let sql = format!("SELECT s.*, COUNT(v.id) AS video_count, (SELECT v2.episode_number FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_episode, (SELECT v2.season FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_season, MAX(CASE WHEN sa.actor_id IS NOT NULL THEN 1 ELSE 0 END) AS has_actor FROM video_series s LEFT JOIN videos v ON v.series_id = s.id LEFT JOIN series_actors sa ON sa.series_id = s.id GROUP BY s.id {}", order_clause);
    let rows = sqlx::query(&sql).fetch_all(pool).await?;
    Ok(rows.iter().map(series_from_row).collect())
}

pub async fn get_video_series_by_tag(pool: &SqlitePool, tag_id: i64) -> Result<Vec<VideoSeries>> {
    let rows = sqlx::query(
        "SELECT s.*, COUNT(v.id) AS video_count, (SELECT v2.episode_number FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_episode, (SELECT v2.season FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_season, MAX(CASE WHEN sa2.actor_id IS NOT NULL THEN 1 ELSE 0 END) AS has_actor FROM video_series s LEFT JOIN videos v ON v.series_id = s.id LEFT JOIN series_actors sa2 ON sa2.series_id = s.id JOIN series_tags st ON st.series_id = s.id WHERE st.tag_id = ? GROUP BY s.id ORDER BY s.updated_at DESC, s.created_at DESC",
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
        "SELECT s.*, COUNT(v.id) AS video_count, (SELECT v2.episode_number FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_episode, (SELECT v2.season FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_season, MAX(CASE WHEN sa2.actor_id IS NOT NULL THEN 1 ELSE 0 END) AS has_actor FROM video_series s LEFT JOIN videos v ON v.series_id = s.id LEFT JOIN series_actors sa2 ON sa2.series_id = s.id JOIN series_tags st ON st.series_id = s.id JOIN tags t ON t.id = st.tag_id WHERE t.name = ? GROUP BY s.id ORDER BY s.updated_at DESC, s.created_at DESC",
    )
    .bind(tag_name)
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(series_from_row).collect())
}

pub async fn get_video_series_by_actor(
    pool: &SqlitePool,
    actor_id: i64,
) -> Result<Vec<VideoSeries>> {
    let rows = sqlx::query(
        "SELECT s.*, COUNT(v.id) AS video_count, (SELECT v2.episode_number FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_episode, (SELECT v2.season FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_season, MAX(CASE WHEN sa.actor_id IS NOT NULL THEN 1 ELSE 0 END) AS has_actor FROM video_series s LEFT JOIN videos v ON v.series_id = s.id JOIN series_actors sa ON sa.series_id = s.id WHERE sa.actor_id = ? GROUP BY s.id ORDER BY s.updated_at DESC, s.created_at DESC",
    )
    .bind(actor_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(series_from_row).collect())
}

pub async fn get_video_series(pool: &SqlitePool, id: i64) -> Result<Option<VideoSeries>> {
    let row = sqlx::query("SELECT s.*, COUNT(v.id) AS video_count, (SELECT v2.episode_number FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_episode, (SELECT v2.season FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_season, MAX(CASE WHEN sa.actor_id IS NOT NULL THEN 1 ELSE 0 END) AS has_actor FROM video_series s LEFT JOIN videos v ON v.series_id = s.id LEFT JOIN series_actors sa ON sa.series_id = s.id WHERE s.id = ? GROUP BY s.id")
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
        .bind(status.unwrap_or_else(|| "ongoing".to_string()))
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
         ORDER BY a.view_count DESC, a.updated_at DESC, a.name",
    )
    .fetch_all(pool)
    .await?;

    let actors = rows.iter().map(actor_from_row).collect();

    Ok(actors)
}

pub async fn get_actors_by_category(pool: &SqlitePool, category_key: &str) -> Result<Vec<Actor>> {
    let rows = sqlx::query(
        "SELECT DISTINCT a.*, COALESCE(w.work_count, 0) AS work_count
         FROM actors a
         JOIN series_actors sa ON sa.actor_id = a.id
         JOIN video_series vs ON vs.id = sa.series_id
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
                 SELECT sa2.actor_id, 'series-' || sa2.series_id AS work_key
                 FROM series_actors sa2
             ) actor_works
             GROUP BY actor_id
         ) w ON w.actor_id = a.id
         WHERE (vs.display_type = ? OR (vs.display_type IS NULL AND ? = 'anime'))
         ORDER BY a.view_count DESC, a.updated_at DESC, a.name",
    )
    .bind(category_key)
    .bind(category_key)
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

pub async fn increment_actor_view_count(pool: &SqlitePool, actor_id: i64) -> Result<()> {
    sqlx::query("UPDATE actors SET view_count = view_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(actor_id)
        .execute(pool)
        .await?;
    Ok(())
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
    weight: Option<&str>,
) -> Result<Actor> {
    let row = sqlx::query(
        "UPDATE actors SET name = ?, photo = ?, bio = ?, birthday = ?, height = ?, measurements = ?, japanese_name = ?, cup_size = ?, avatar_base64 = ?, alias = ?, weight = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING *",
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
    .bind(weight)
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

pub fn image_data_url(path: &Path) -> Option<String> {
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
    let photo_data_url: Option<String> =
        row.try_get("avatar_base64").ok().flatten().or_else(|| {
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
        weight: row.try_get("weight").ok().flatten(),
        work_count: row.try_get("work_count").unwrap_or(0),
        view_count: row.try_get("view_count").unwrap_or(0),
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
    let rows = sqlx::query(
        "SELECT * FROM actor_periods WHERE actor_id = ? ORDER BY sort_order ASC, created_at ASC",
    )
    .bind(actor_id)
    .fetch_all(pool)
    .await?;
    let periods = rows
        .iter()
        .map(|row| ActorPeriod {
            id: row.get("id"),
            actor_id: row.get("actor_id"),
            name: row.get("name"),
            sort_order: row.get("sort_order"),
            created_at: row.get("created_at"),
        })
        .collect();
    Ok(periods)
}

pub async fn add_actor_period(pool: &SqlitePool, actor_id: i64, name: &str) -> Result<ActorPeriod> {
    // Get max sort_order for this actor
    let max_order: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(sort_order), 0) FROM actor_periods WHERE actor_id = ?",
    )
    .bind(actor_id)
    .fetch_one(pool)
    .await?;
    let row = sqlx::query(
        "INSERT INTO actor_periods (actor_id, name, sort_order) VALUES (?, ?, ?) RETURNING *",
    )
    .bind(actor_id)
    .bind(name)
    .bind(max_order + 1)
    .fetch_one(pool)
    .await?;
    Ok(ActorPeriod {
        id: row.get("id"),
        actor_id: row.get("actor_id"),
        name: row.get("name"),
        sort_order: row.get("sort_order"),
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
    // Set period_id to NULL for all associated works (归入演员名时期).
    // Resource actors are stored in video_actors in the current schema; do not touch
    // legacy resource_actors because existing databases may have that table without period_id.
    sqlx::query("UPDATE video_actors SET period_id = NULL WHERE period_id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    sqlx::query("UPDATE series_actors SET period_id = NULL WHERE period_id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM actor_periods WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn reorder_actor_periods(pool: &SqlitePool, period_ids: Vec<i64>) -> Result<()> {
    for (i, pid) in period_ids.iter().enumerate() {
        sqlx::query("UPDATE actor_periods SET sort_order = ? WHERE id = ?")
            .bind(i as i64)
            .bind(pid)
            .execute(pool)
            .await?;
    }
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

pub async fn get_tags_by_category(pool: &SqlitePool, category_key: &str) -> Result<Vec<Tag>> {
    let rows = sqlx::query(
        "SELECT DISTINCT t.* FROM tags t
         JOIN series_tags st ON st.tag_id = t.id
         JOIN video_series vs ON vs.id = st.series_id
         WHERE (vs.display_type = ? OR ((vs.display_type IS NULL OR vs.display_type = '') AND ? = 'anime'))
         ORDER BY t.name",
    )
    .bind(category_key)
    .bind(category_key)
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

/// 按名称或日文名匹配演员（忽略首尾空格和大小写）
pub async fn get_actor_by_name_or_jp(pool: &SqlitePool, name: &str) -> Result<Option<Actor>> {
    let row = sqlx::query("SELECT * FROM actors WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) OR (japanese_name IS NOT NULL AND LOWER(TRIM(japanese_name)) = LOWER(TRIM(?)))")
        .bind(name)
        .bind(name)
        .fetch_optional(pool)
        .await?;
    match row {
        Some(row) => Ok(Some(actor_from_row(&row))),
        None => Ok(None),
    }
}

/// 更新视频集的 display_type
pub async fn update_video_series_display_type(
    pool: &SqlitePool,
    series_id: i64,
    display_type: &str,
) -> Result<()> {
    sqlx::query("UPDATE video_series SET display_type = ? WHERE id = ?")
        .bind(display_type)
        .bind(series_id)
        .execute(pool)
        .await?;
    Ok(())
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
    sqlx::query(
        "INSERT INTO video_actors (video_id, actor_id, role, period_id) VALUES (?, ?, ?, ?)
         ON CONFLICT(video_id, actor_id) DO UPDATE SET
           role = COALESCE(excluded.role, video_actors.role),
           period_id = excluded.period_id",
    )
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
pub async fn get_actor_work_period_map(
    pool: &SqlitePool,
    actor_id: i64,
) -> Result<std::collections::HashMap<String, i64>> {
    let mut map = std::collections::HashMap::new();

    // 从 video_actors 获取独立视频的 period_id
    let rows = sqlx::query(
        "SELECT va.video_id, va.period_id FROM video_actors va
         JOIN videos v ON v.id = va.video_id
         WHERE va.actor_id = ? AND va.period_id IS NOT NULL AND v.series_id IS NULL",
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
         GROUP BY v.series_id",
    )
    .bind(actor_id)
    .fetch_all(pool)
    .await?;
    for row in rows {
        if let Ok(Some(period_id)) = row.try_get::<Option<i64>, _>("period_id") {
            if let Ok(Some(series_id)) = row.try_get::<Option<i64>, _>("series_id") {
                map.entry(format!("series-{}", series_id))
                    .or_insert(period_id);
            }
        }
    }

    // 从 series_actors 获取系列的 period_id（优先级更高，覆盖 video_actors 的值）
    let rows = sqlx::query(
        "SELECT sa.series_id, sa.period_id FROM series_actors sa
         WHERE sa.actor_id = ? AND sa.period_id IS NOT NULL",
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
    sqlx::query(
        "INSERT INTO series_actors (series_id, actor_id, role, period_id) VALUES (?, ?, ?, ?)
         ON CONFLICT(series_id, actor_id) DO UPDATE SET
           role = COALESCE(excluded.role, series_actors.role),
           period_id = excluded.period_id",
    )
    .bind(series_id)
    .bind(actor_id)
    .bind(role)
    .bind(period_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn update_actor_work_period(
    pool: &SqlitePool,
    actor_id: i64,
    work_type: &str,
    work_id: i64,
    period_id: Option<i64>,
) -> Result<()> {
    match work_type {
        "series" => {
            sqlx::query(
                "INSERT INTO series_actors (series_id, actor_id, period_id) VALUES (?, ?, ?)
                 ON CONFLICT(series_id, actor_id) DO UPDATE SET period_id = excluded.period_id",
            )
            .bind(work_id)
            .bind(actor_id)
            .bind(period_id)
            .execute(pool)
            .await?;
        }
        "video" => {
            sqlx::query(
                "INSERT INTO video_actors (video_id, actor_id, period_id) VALUES (?, ?, ?)
                 ON CONFLICT(video_id, actor_id) DO UPDATE SET period_id = excluded.period_id",
            )
            .bind(work_id)
            .bind(actor_id)
            .bind(period_id)
            .execute(pool)
            .await?;
        }
        _ => anyhow::bail!("不支持的作品类型: {}", work_type),
    }

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

// 演员多海报
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActorPhoto {
    pub id: i64,
    pub actor_id: i64,
    pub photo: Option<String>,
    pub photo_data_url: Option<String>,
    pub is_primary: i32,
    pub sort_order: i32,
    pub created_at: String,
}

fn actor_photo_from_row(row: &SqliteRow) -> ActorPhoto {
    let photo: Option<String> = row.get("photo");
    let resolved_photo = photo.clone().map(|path| {
        storage::resolve_data_path(&path)
            .to_string_lossy()
            .to_string()
    });
    let photo_data_url: Option<String> = row.try_get("photo_base64").ok().flatten().or_else(|| {
        let p = photo?;
        let resolved = storage::resolve_data_path(&p);
        image_data_url(Path::new(&resolved))
    });
    ActorPhoto {
        id: row.get("id"),
        actor_id: row.get("actor_id"),
        photo: resolved_photo,
        photo_data_url,
        is_primary: row.try_get("is_primary").unwrap_or(0),
        sort_order: row.try_get("sort_order").unwrap_or(0),
        created_at: row.get("created_at"),
    }
}

pub async fn get_actor_photos(pool: &SqlitePool, actor_id: i64) -> Result<Vec<ActorPhoto>> {
    let rows = sqlx::query(
        "SELECT * FROM actor_photos WHERE actor_id = ? ORDER BY is_primary DESC, sort_order ASC, created_at ASC"
    )
    .bind(actor_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(actor_photo_from_row).collect())
}

pub async fn add_actor_photo(
    pool: &SqlitePool,
    actor_id: i64,
    photo: Option<&str>,
    photo_base64: Option<&str>,
    is_primary: i32,
) -> Result<ActorPhoto> {
    // 如果是第一张照片，自动设为 is_primary=1
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM actor_photos WHERE actor_id = ?")
        .bind(actor_id)
        .fetch_one(pool)
        .await?;
    let actual_is_primary = if count == 0 { 1 } else { is_primary };

    // 获取当前最大 sort_order
    let max_order: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(sort_order), -1) FROM actor_photos WHERE actor_id = ?",
    )
    .bind(actor_id)
    .fetch_one(pool)
    .await?;

    let row = sqlx::query(
        "INSERT INTO actor_photos (actor_id, photo, photo_base64, is_primary, sort_order) VALUES (?, ?, ?, ?, ?) RETURNING *"
    )
    .bind(actor_id)
    .bind(photo)
    .bind(photo_base64)
    .bind(actual_is_primary)
    .bind(max_order + 1)
    .fetch_one(pool)
    .await?;

    if actual_is_primary == 1 {
        sqlx::query("UPDATE actors SET photo = ?, avatar_base64 = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .bind(photo)
            .bind(photo_base64)
            .bind(actor_id)
            .execute(pool)
            .await?;
    }

    Ok(actor_photo_from_row(&row))
}

pub async fn delete_actor_photo(pool: &SqlitePool, photo_id: i64) -> Result<()> {
    let deleted = sqlx::query("SELECT actor_id, is_primary FROM actor_photos WHERE id = ?")
        .bind(photo_id)
        .fetch_optional(pool)
        .await?;

    sqlx::query("DELETE FROM actor_photos WHERE id = ?")
        .bind(photo_id)
        .execute(pool)
        .await?;

    if let Some(row) = deleted {
        let actor_id: i64 = row.get("actor_id");
        let was_primary: i32 = row.get("is_primary");
        if was_primary == 1 {
            if let Some(next) = sqlx::query(
                "SELECT id, photo, photo_base64 FROM actor_photos WHERE actor_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 1",
            )
            .bind(actor_id)
            .fetch_optional(pool)
            .await?
            {
                let next_id: i64 = next.get("id");
                let photo: Option<String> = next.try_get("photo").ok().flatten();
                let photo_base64: Option<String> = next.try_get("photo_base64").ok().flatten();
                sqlx::query("UPDATE actor_photos SET is_primary = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE actor_id = ?")
                    .bind(next_id)
                    .bind(actor_id)
                    .execute(pool)
                    .await?;
                sqlx::query("UPDATE actors SET photo = ?, avatar_base64 = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
                    .bind(&photo)
                    .bind(&photo_base64)
                    .bind(actor_id)
                    .execute(pool)
                    .await?;
            } else {
                sqlx::query("UPDATE actors SET photo = NULL, avatar_base64 = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
                    .bind(actor_id)
                    .execute(pool)
                    .await?;
            }
        }
    }

    Ok(())
}

pub async fn set_primary_photo(pool: &SqlitePool, actor_id: i64, photo_id: i64) -> Result<()> {
    // 先把所有 is_primary 设为 0
    sqlx::query("UPDATE actor_photos SET is_primary = 0 WHERE actor_id = ?")
        .bind(actor_id)
        .execute(pool)
        .await?;
    // 再把指定的设为 1
    sqlx::query("UPDATE actor_photos SET is_primary = 1 WHERE id = ? AND actor_id = ?")
        .bind(photo_id)
        .bind(actor_id)
        .execute(pool)
        .await?;
    // 同步新主海报到 actors 表
    if let Some(row) =
        sqlx::query("SELECT photo, photo_base64 FROM actor_photos WHERE id = ? AND actor_id = ?")
            .bind(photo_id)
            .bind(actor_id)
            .fetch_optional(pool)
            .await?
    {
        let photo: Option<String> = row.try_get("photo").ok().flatten();
        let photo_base64: Option<String> = row.try_get("photo_base64").ok().flatten();
        sqlx::query("UPDATE actors SET photo = ?, avatar_base64 = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .bind(&photo)
            .bind(&photo_base64)
            .bind(actor_id)
            .execute(pool)
            .await?;
    }
    Ok(())
}

pub async fn reorder_actor_photos(
    pool: &SqlitePool,
    actor_id: i64,
    photo_ids: Vec<i64>,
) -> Result<()> {
    for (index, photo_id) in photo_ids.iter().enumerate() {
        sqlx::query("UPDATE actor_photos SET sort_order = ? WHERE id = ? AND actor_id = ?")
            .bind(index as i32)
            .bind(photo_id)
            .bind(actor_id)
            .execute(pool)
            .await?;
    }
    Ok(())
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
                last_watched_season: None,
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
        "SELECT id, poster FROM video_series WHERE poster_base64 IS NULL AND poster IS NOT NULL",
    )
    .fetch_all(pool)
    .await?;

    eprintln!(
        "[ChangLi] 回填海报缓存: 发现 {} 条 video_series 记录需要处理",
        series_rows.len()
    );
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
        eprintln!(
            "[ChangLi] 回填海报缓存: 成功回填 {} 条 video_series",
            series_filled
        );
    }

    // 回填 actors 的 avatar_base64
    let actor_rows = sqlx::query(
        "SELECT id, photo FROM actors WHERE avatar_base64 IS NULL AND photo IS NOT NULL",
    )
    .fetch_all(pool)
    .await?;

    eprintln!(
        "[ChangLi] 回填头像缓存: 发现 {} 条 actors 记录需要处理",
        actor_rows.len()
    );
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
        eprintln!(
            "[ChangLi] 回填头像缓存: 成功回填 {} 条 actors",
            actors_filled
        );
    }

    // 回填 video_series 的 poster_orientation
    let series_orientation_rows = sqlx::query(
        "SELECT id, poster FROM video_series WHERE poster_orientation IS NULL AND poster IS NOT NULL"
    )
    .fetch_all(pool)
    .await?;

    if !series_orientation_rows.is_empty() {
        eprintln!(
            "[ChangLi] 回填海报方向: 发现 {} 条 video_series 记录需要处理",
            series_orientation_rows.len()
        );
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
            eprintln!(
                "[ChangLi] 回填海报方向: 成功回填 {} 条 video_series",
                orientation_filled
            );
        }
    }

    // 回填 videos 的 poster_orientation
    let video_orientation_rows = sqlx::query(
        "SELECT id, thumbnail FROM videos WHERE poster_orientation IS NULL AND thumbnail IS NOT NULL"
    )
    .fetch_all(pool)
    .await?;

    if !video_orientation_rows.is_empty() {
        eprintln!(
            "[ChangLi] 回填海报方向: 发现 {} 条 videos 记录需要处理",
            video_orientation_rows.len()
        );
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
            eprintln!(
                "[ChangLi] 回填海报方向: 成功回填 {} 条 videos",
                orientation_filled
            );
        }
    }

    Ok(())
}

pub async fn toggle_favorite_video(pool: &SqlitePool, id: i64) -> Result<()> {
    sqlx::query(
        "UPDATE videos SET is_favorite = CASE WHEN is_favorite = 1 THEN 0 ELSE 1 END WHERE id = ?",
    )
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
    let rows = sqlx::query("SELECT s.*, COUNT(v.id) AS video_count, (SELECT v2.episode_number FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_episode, (SELECT v2.season FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_season, MAX(CASE WHEN sa.actor_id IS NOT NULL THEN 1 ELSE 0 END) AS has_actor FROM video_series s LEFT JOIN videos v ON v.series_id = s.id LEFT JOIN series_actors sa ON sa.series_id = s.id WHERE s.is_favorite = 1 GROUP BY s.id ORDER BY s.created_at DESC")
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
    sqlx::query("DELETE FROM play_history")
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM watch_progress")
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM videos").execute(pool).await?;
    sqlx::query("DELETE FROM series_tags").execute(pool).await?;
    sqlx::query("DELETE FROM series_actors")
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM video_series")
        .execute(pool)
        .await?;
    Ok((video_count.0, series_count.0))
}
/// 删除所有动漫（display_type!='adult' 的视频集及其视频，但不删除占位视频）
pub async fn delete_all_anime(pool: &SqlitePool) -> Result<(i64, i64)> {
    let anime_cond = "(display_type IS NULL OR display_type != 'adult')";
    let video_count: (i64,) = sqlx::query_as(&format!(
        "SELECT COUNT(*) FROM videos v WHERE v.series_id IN (SELECT id FROM video_series WHERE {})",
        anime_cond
    ))
    .fetch_one(pool)
    .await?;

    let series_count: (i64,) = sqlx::query_as(&format!(
        "SELECT COUNT(*) FROM video_series WHERE {}",
        anime_cond
    ))
    .fetch_one(pool)
    .await?;

    let anime_sub = &format!("SELECT id FROM video_series WHERE {}", anime_cond);

    sqlx::query(&format!("DELETE FROM play_history WHERE video_id IN (SELECT id FROM videos WHERE series_id IN ({}))", anime_sub))
        .execute(pool).await?;
    sqlx::query(&format!("DELETE FROM watch_progress WHERE resource_id IN (SELECT id FROM videos WHERE series_id IN ({}))", anime_sub))
        .execute(pool).await?;
    sqlx::query(&format!(
        "DELETE FROM videos WHERE series_id IN ({})",
        anime_sub
    ))
    .execute(pool)
    .await?;
    sqlx::query(&format!(
        "DELETE FROM series_tags WHERE series_id IN ({})",
        anime_sub
    ))
    .execute(pool)
    .await?;
    // 先删 video_series（不依赖 series_actors），再删 series_actors
    sqlx::query(&format!(
        "DELETE FROM video_series WHERE id IN ({})",
        anime_sub
    ))
    .execute(pool)
    .await?;
    sqlx::query(&format!(
        "DELETE FROM series_actors WHERE series_id IN ({})",
        anime_sub
    ))
    .execute(pool)
    .await?;

    Ok((video_count.0, series_count.0))
}

/// 删除所有影视（display_type='adult' 的视频集及其视频，但不删除占位视频）
pub async fn delete_all_adult(pool: &SqlitePool) -> Result<(i64, i64)> {
    let adult_sub = "SELECT id FROM video_series WHERE display_type = 'adult'";

    let video_count: (i64,) = sqlx::query_as(&format!(
        "SELECT COUNT(*) FROM videos WHERE series_id IN ({})",
        adult_sub
    ))
    .fetch_one(pool)
    .await?;

    let series_count: (i64,) = sqlx::query_as(&format!(
        "SELECT COUNT(*) FROM video_series WHERE display_type = 'adult'"
    ))
    .fetch_one(pool)
    .await?;

    sqlx::query(&format!("DELETE FROM play_history WHERE video_id IN (SELECT id FROM videos WHERE series_id IN ({}))", adult_sub))
        .execute(pool).await?;
    sqlx::query(&format!("DELETE FROM watch_progress WHERE resource_id IN (SELECT id FROM videos WHERE series_id IN ({}))", adult_sub))
        .execute(pool).await?;
    sqlx::query(&format!(
        "DELETE FROM videos WHERE series_id IN ({})",
        adult_sub
    ))
    .execute(pool)
    .await?;
    sqlx::query(&format!(
        "DELETE FROM series_tags WHERE series_id IN ({})",
        adult_sub
    ))
    .execute(pool)
    .await?;
    // 先删 video_series（不依赖 series_actors），再删 series_actors
    sqlx::query(&format!(
        "DELETE FROM video_series WHERE id IN ({})",
        adult_sub
    ))
    .execute(pool)
    .await?;
    sqlx::query(&format!(
        "DELETE FROM series_actors WHERE series_id IN ({})",
        adult_sub
    ))
    .execute(pool)
    .await?;

    Ok((video_count.0, series_count.0))
}

/// 重新扫描所有 video_series 的元数据（code、has_chinese_sub）
/// 重新扫描单个视频集的元数据（车牌、中字、标题、海报）
pub async fn rescan_single_series_metadata(pool: &SqlitePool, series_id: i64) -> Result<bool> {
    let row = sqlx::query_as::<_, (i64, String, Option<String>, Option<String>)>(
        "SELECT id, title, folder_path, display_type FROM video_series WHERE id = ?",
    )
    .bind(series_id)
    .fetch_optional(pool)
    .await?;

    let (id, title, folder_path, display_type) = match row {
        Some(r) => r,
        None => return Ok(false),
    };

    let source = folder_path.as_deref().unwrap_or(&title);
    let folder_name = std::path::Path::new(source)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| title.clone());
    let folder_path_std = std::path::Path::new(source);
    let scan_result = if folder_path_std.is_dir() {
        Some(crate::scanner::scan_directory(source).await?)
    } else {
        None
    };
    let poster = scan_result
        .as_ref()
        .and_then(|result| crate::scanner::find_folder_poster(folder_path_std))
        .or_else(|| crate::scanner::find_folder_poster(folder_path_std));
    let poster_base64 = poster
        .as_deref()
        .and_then(|p| crate::scanner::generate_thumbnail_base64(std::path::Path::new(p)));

    let mut found_video_files = false;
    if let Some(result) = scan_result {
        found_video_files = !result.videos.is_empty();
        if found_video_files {
            add_videos_batch(pool, result.videos, Some(id)).await?;
        }
    }

    if display_type.as_deref() == Some("adult") {
        if let Some(info) = crate::scanner::parse_adult_filename(&folder_name) {
            let code = info.code;
            let has_chinese_sub: i32 = if info.has_chinese_sub { 1 } else { 0 };
            let new_title = info.title.unwrap_or_else(|| folder_name.clone());

            sqlx::query(
                "UPDATE video_series SET code = ?, has_chinese_sub = ?, title = ?, poster = COALESCE(?, poster), poster_base64 = COALESCE(?, poster_base64) WHERE id = ? AND (code IS NULL OR code = '')"
            )
            .bind(&code)
            .bind(has_chinese_sub)
            .bind(&new_title)
            .bind(&poster)
            .bind(&poster_base64)
            .bind(id)
            .execute(pool)
            .await?;

            Ok(true)
        } else {
            Ok(found_video_files)
        }
    } else {
        sqlx::query(
            "UPDATE video_series SET title = ?, code = NULL, has_chinese_sub = 0, poster = COALESCE(?, poster), poster_base64 = COALESCE(?, poster_base64) WHERE id = ?"
        )
        .bind(&folder_name)
        .bind(&poster)
        .bind(&poster_base64)
        .bind(id)
        .execute(pool)
        .await?;

        Ok(true)
    }
}

pub async fn rescan_all_series_metadata(pool: &SqlitePool) -> Result<(i64, i64)> {
    let series_list = sqlx::query_as::<_, (i64, String, Option<String>)>(
        "SELECT id, title, folder_path FROM video_series",
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
/// 重新扫描动漫元数据（display_type!='adult' 的视频集）
pub async fn rescan_anime_metadata(pool: &SqlitePool) -> Result<(i64, i64)> {
    let series_list = sqlx::query_as::<_, (i64, String, Option<String>)>(
        "SELECT id, title, folder_path FROM video_series WHERE display_type IS NULL OR display_type != 'adult'"
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
                "UPDATE video_series SET code = ?, has_chinese_sub = ?, title = ?, poster = COALESCE(?, poster), poster_base64 = COALESCE(?, poster_base64) WHERE id = ? AND (code IS NULL OR code = '')"
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

/// 重新扫描影视元数据（display_type='adult' 的视频集，无条件覆盖）
pub async fn rescan_adult_metadata(pool: &SqlitePool) -> Result<(i64, i64)> {
    let series_list = sqlx::query_as::<_, (i64, String, Option<String>)>(
        "SELECT id, title, folder_path FROM video_series WHERE display_type = 'adult'",
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
                "UPDATE video_series SET code = ?, has_chinese_sub = ?, title = ?, poster = COALESCE(?, poster), poster_base64 = COALESCE(?, poster_base64) WHERE id = ?"
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

    Ok(rows
        .iter()
        .map(|row| SeasonInfo {
            season: row.get("season"),
            subtitle: row.try_get("subtitle").ok(),
            video_count: row.get("video_count"),
        })
        .collect())
}

pub async fn delete_season(pool: &SqlitePool, series_id: i64, season: i32) -> Result<()> {
    sqlx::query("DELETE FROM videos WHERE series_id = ? AND season = ?")
        .bind(series_id)
        .bind(season)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn create_season(
    pool: &SqlitePool,
    series_id: i64,
    season: i32,
    subtitle: Option<&str>,
) -> Result<()> {
    // 获取当前最大 season 编号（排除 999）
    // 如果 season 参数传 0，自动分配下一个季号
    // 如果 season 参数传 999，创建剧场版
    let target_season = if season == 0 {
        let max_season: i32 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(season), 0) FROM videos WHERE series_id = ? AND season < 999",
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

pub async fn update_video_subtitle(
    pool: &SqlitePool,
    video_id: i64,
    subtitle: Option<String>,
) -> Result<()> {
    sqlx::query("UPDATE videos SET subtitle = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(subtitle)
        .bind(video_id)
        .execute(pool)
        .await?;
    Ok(())
}

// ==================== 大类配置 CRUD ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Category {
    pub id: i64,
    pub key: String,
    pub name: String,
    pub card_layout: String,
    pub features: String, // JSON string
    pub sort_order: i32,
    pub scan_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub async fn get_all_categories(pool: &SqlitePool) -> Result<Vec<Category>> {
    let rows = sqlx::query("SELECT * FROM categories ORDER BY sort_order ASC, id ASC")
        .fetch_all(pool)
        .await?;

    let categories = rows
        .iter()
        .map(|row| Category {
            id: row.get("id"),
            key: row.get("key"),
            name: row.get("name"),
            card_layout: row.get("card_layout"),
            features: row.get("features"),
            sort_order: row.get("sort_order"),
            scan_path: row.try_get("scan_path").ok().flatten(),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
        .collect();

    Ok(categories)
}

pub async fn create_category(
    pool: &SqlitePool,
    key: &str,
    name: &str,
    card_layout: &str,
    features: &str,
    scan_path: Option<&str>,
) -> Result<Category> {
    let row = sqlx::query(
        "INSERT INTO categories (key, name, card_layout, features, scan_path, sort_order) VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM categories)) RETURNING *",
    )
    .bind(key)
    .bind(name)
    .bind(card_layout)
    .bind(features)
    .bind(scan_path)
    .fetch_one(pool)
    .await?;

    Ok(Category {
        id: row.get("id"),
        key: row.get("key"),
        name: row.get("name"),
        card_layout: row.get("card_layout"),
        features: row.get("features"),
        sort_order: row.get("sort_order"),
        scan_path: row.try_get("scan_path").ok().flatten(),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

pub async fn update_category(
    pool: &SqlitePool,
    key: &str,
    name: &str,
    card_layout: &str,
    features: &str,
    scan_path: Option<&str>,
) -> Result<Category> {
    let row = sqlx::query(
        "UPDATE categories SET name = ?, card_layout = ?, features = ?, scan_path = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ? RETURNING *",
    )
    .bind(name)
    .bind(card_layout)
    .bind(features)
    .bind(scan_path)
    .bind(key)
    .fetch_one(pool)
    .await?;

    Ok(Category {
        id: row.get("id"),
        key: row.get("key"),
        name: row.get("name"),
        card_layout: row.get("card_layout"),
        features: row.get("features"),
        sort_order: row.get("sort_order"),
        scan_path: row.try_get("scan_path").ok().flatten(),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

pub async fn delete_category(pool: &SqlitePool, key: &str) -> Result<()> {
    sqlx::query("DELETE FROM categories WHERE key = ?")
        .bind(key)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn reorder_categories(pool: &SqlitePool, category_keys: &[String]) -> Result<()> {
    for (i, key) in category_keys.iter().enumerate() {
        sqlx::query("UPDATE categories SET sort_order = ? WHERE key = ?")
            .bind(i as i64)
            .bind(key)
            .execute(pool)
            .await?;
    }
    Ok(())
}
/// 删除某个大类下所有视频数据（不删除本地源文件）
pub async fn delete_videos_by_category(
    pool: &SqlitePool,
    category_key: &str,
) -> Result<(i64, i64)> {
    let video_count: (i64,) = sqlx::query_as(&format!(
        "SELECT COUNT(*) FROM videos WHERE series_id IN (SELECT id FROM video_series WHERE display_type = '{}' OR (display_type IS NULL AND '{}' = 'anime'))",
        category_key, category_key
    ))
    .fetch_one(pool)
    .await?;

    let series_count: (i64,) = sqlx::query_as(&format!(
        "SELECT COUNT(*) FROM video_series WHERE display_type = '{}' OR (display_type IS NULL AND '{}' = 'anime')",
        category_key, category_key
    ))
    .fetch_one(pool)
    .await?;

    let sub = &format!(
        "SELECT id FROM video_series WHERE display_type = '{}' OR (display_type IS NULL AND '{}' = 'anime')",
        category_key, category_key
    );

    sqlx::query(&format!("DELETE FROM play_history WHERE video_id IN (SELECT id FROM videos WHERE series_id IN ({}))", sub))
        .execute(pool).await?;
    sqlx::query(&format!("DELETE FROM watch_progress WHERE resource_id IN (SELECT id FROM videos WHERE series_id IN ({}))", sub))
        .execute(pool).await?;
    sqlx::query(&format!("DELETE FROM videos WHERE series_id IN ({})", sub))
        .execute(pool)
        .await?;
    sqlx::query(&format!(
        "DELETE FROM series_tags WHERE series_id IN ({})",
        sub
    ))
    .execute(pool)
    .await?;
    sqlx::query(&format!("DELETE FROM video_series WHERE id IN ({})", sub))
        .execute(pool)
        .await?;
    sqlx::query(&format!(
        "DELETE FROM series_actors WHERE series_id IN ({})",
        sub
    ))
    .execute(pool)
    .await?;

    Ok((video_count.0, series_count.0))
}

/// 重新扫描某个大类下所有视频集的元数据，同时检测缺失的视频集文件夹和分集文件
/// 返回 (updated, skipped, missing_series_count, missing_videos_count)
pub async fn rescan_category_metadata(pool: &SqlitePool, category_key: &str) -> Result<(i64, i64, i64, i64)> {
    let series_list = sqlx::query_as::<_, (i64, String, Option<String>)>(&format!(
        "SELECT id, title, folder_path FROM video_series WHERE display_type = '{}' OR (display_type IS NULL AND '{}' = 'anime')",
        category_key, category_key
    ))
    .fetch_all(pool)
    .await?;

    let mut updated: i64 = 0;
    let mut skipped: i64 = 0;
    let mut missing_series_count: i64 = 0;
    let mut missing_videos_count: i64 = 0;

    for (id, title, folder_path) in series_list {
        // 检测视频集文件夹是否缺失
        let series_missing = if let Some(ref fp) = folder_path {
            !std::path::Path::new(fp).is_dir()
        } else {
            // 没有 folder_path 的视频集，用 title 作为路径检测
            !std::path::Path::new(&title).is_dir()
        };

        if series_missing {
            missing_series_count += 1;
            continue; // 文件夹缺失，跳过元数据更新
        }

        // 检测该视频集下缺失的分集文件
        let videos = sqlx::query_as::<_, (String,)>("SELECT file_path FROM videos WHERE series_id = ?")
            .bind(id)
            .fetch_all(pool)
            .await?;
        for (file_path,) in &videos {
            if !std::path::Path::new(file_path).is_file() {
                missing_videos_count += 1;
            }
        }

        // 原有的元数据更新逻辑
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
                "UPDATE video_series SET code = ?, has_chinese_sub = ?, title = ?, poster = COALESCE(?, poster), poster_base64 = COALESCE(?, poster_base64) WHERE id = ? AND (code IS NULL OR code = '')"
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

    Ok((updated, skipped, missing_series_count, missing_videos_count))
}

pub async fn get_category_by_key(pool: &SqlitePool, key: &str) -> Result<Option<Category>> {
    let row = sqlx::query("SELECT * FROM categories WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|row| Category {
        id: row.get("id"),
        key: row.get("key"),
        name: row.get("name"),
        card_layout: row.get("card_layout"),
        features: row.get("features"),
        sort_order: row.get("sort_order"),
        scan_path: row.try_get("scan_path").ok().flatten(),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }))
}

// ==================== 演员字段配置 CRUD ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActorField {
    pub id: i64,
    pub field_key: String,
    pub field_label: String,
    pub field_type: String,
    pub options: Option<String>,
    pub format: Option<String>,
    pub sort_order: i32,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

pub async fn get_all_actor_fields(pool: &SqlitePool) -> Result<Vec<ActorField>> {
    let rows = sqlx::query("SELECT * FROM actor_fields ORDER BY sort_order")
        .fetch_all(pool)
        .await?;

    let fields = rows
        .iter()
        .map(|row| ActorField {
            id: row.get("id"),
            field_key: row.get("field_key"),
            field_label: row.get("field_label"),
            field_type: row.get("field_type"),
            options: row.get("options"),
            format: row.get("format"),
            sort_order: row.get("sort_order"),
            enabled: row.get::<i32, _>("enabled") != 0,
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
        .collect();

    Ok(fields)
}

pub async fn update_actor_field(
    pool: &SqlitePool,
    field_key: &str,
    field_label: &str,
    field_type: &str,
    options: Option<&str>,
    format: Option<&str>,
    enabled: bool,
) -> Result<()> {
    sqlx::query(
        "UPDATE actor_fields SET field_label = ?, field_type = ?, options = ?, format = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE field_key = ?",
    )
    .bind(field_label)
    .bind(field_type)
    .bind(options)
    .bind(format)
    .bind(if enabled { 1 } else { 0 })
    .bind(field_key)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn create_actor_field(
    pool: &SqlitePool,
    field_key: &str,
    field_label: &str,
    field_type: &str,
    options: Option<&str>,
    format: Option<&str>,
) -> Result<ActorField> {
    let max_order: i32 =
        sqlx::query_scalar("SELECT COALESCE(MAX(sort_order), 0) FROM actor_fields")
            .fetch_one(pool)
            .await?;

    let row = sqlx::query(
        "INSERT INTO actor_fields (field_key, field_label, field_type, options, format, sort_order) VALUES (?, ?, ?, ?, ?, ?) RETURNING *",
    )
    .bind(field_key)
    .bind(field_label)
    .bind(field_type)
    .bind(options)
    .bind(format)
    .bind(max_order + 1)
    .fetch_one(pool)
    .await?;

    Ok(ActorField {
        id: row.get("id"),
        field_key: row.get("field_key"),
        field_label: row.get("field_label"),
        field_type: row.get("field_type"),
        options: row.get("options"),
        format: row.get("format"),
        sort_order: row.get("sort_order"),
        enabled: row.get::<i32, _>("enabled") != 0,
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

pub async fn delete_actor_field(pool: &SqlitePool, field_key: &str) -> Result<()> {
    sqlx::query("DELETE FROM actor_fields WHERE field_key = ?")
        .bind(field_key)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn reorder_actor_fields(pool: &SqlitePool, field_keys: &[String]) -> Result<()> {
    for (i, key) in field_keys.iter().enumerate() {
        sqlx::query(
            "UPDATE actor_fields SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE field_key = ?",
        )
        .bind((i + 1) as i32)
        .bind(key)
        .execute(pool)
        .await?;
    }
    Ok(())
}

// ==================== 预设模板 CRUD ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresetTemplate {
    pub id: i64,
    pub key: String,
    pub name: String,
    pub field_type: String,
    pub sub_fields: String,
    pub rules: String,
    pub is_extension: bool,
    pub sort_order: i32,
    pub created_at: String,
}

pub async fn get_preset_templates(pool: &SqlitePool) -> Result<Vec<PresetTemplate>> {
    let rows = sqlx::query("SELECT * FROM preset_templates ORDER BY sort_order")
        .fetch_all(pool)
        .await?;
    Ok(rows.iter().map(|row| preset_from_row(row)).collect())
}

pub async fn get_extension_preset_templates(pool: &SqlitePool) -> Result<Vec<PresetTemplate>> {
    let rows =
        sqlx::query("SELECT * FROM preset_templates WHERE is_extension = 1 ORDER BY sort_order")
            .fetch_all(pool)
            .await?;
    Ok(rows.iter().map(|row| preset_from_row(row)).collect())
}

fn preset_from_row(row: &SqliteRow) -> PresetTemplate {
    PresetTemplate {
        id: row.get("id"),
        key: row.get("key"),
        name: row.get("name"),
        field_type: row.get("field_type"),
        sub_fields: row.get("sub_fields"),
        rules: row.get("rules"),
        is_extension: row.get::<i32, _>("is_extension") != 0,
        sort_order: row.get("sort_order"),
        created_at: row.get("created_at"),
    }
}

pub async fn is_preset_template_enabled(pool: &SqlitePool, key: &str) -> Result<bool> {
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM actor_fields WHERE field_key = ? AND enabled = 1")
            .bind(key)
            .fetch_one(pool)
            .await?;
    Ok(count > 0)
}

pub async fn enable_preset_template(pool: &SqlitePool, key: &str) -> Result<()> {
    // Check if record already exists in actor_fields (possibly disabled)
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM actor_fields WHERE field_key = ?")
        .bind(key)
        .fetch_one(pool)
        .await?;

    if exists > 0 {
        // Record exists (possibly disabled), just enable it — preserving user-modified name
        sqlx::query("UPDATE actor_fields SET enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE field_key = ?")
            .bind(key)
            .execute(pool)
            .await?;
    } else {
        // Insert new record from preset template
        let row = sqlx::query("SELECT * FROM preset_templates WHERE key = ?")
            .bind(key)
            .fetch_optional(pool)
            .await?;

        let row = row.ok_or_else(|| anyhow::anyhow!("预设模板不存在: {}", key))?;

        let name: String = row.get("name");
        let field_type: String = row.get("field_type");
        let sub_fields: String = row.get("sub_fields");
        let rules: String = row.get("rules");

        let options_json = serde_json::json!({
            "sub_fields": serde_json::from_str::<serde_json::Value>(&sub_fields).unwrap_or_default(),
            "rules": serde_json::from_str::<serde_json::Value>(&rules).unwrap_or_default(),
        });
        let options_str = serde_json::to_string(&options_json).ok();

        let max_order: i32 =
            sqlx::query_scalar("SELECT COALESCE(MAX(sort_order), 0) FROM actor_fields")
                .fetch_one(pool)
                .await?;

        let actual_field_type = if field_type == "compound" {
            "compound"
        } else {
            &field_type
        };

        sqlx::query(
            "INSERT INTO actor_fields (field_key, field_label, field_type, options, sort_order, enabled) VALUES (?, ?, ?, ?, ?, 1)",
        )
        .bind(key)
        .bind(&name)
        .bind(actual_field_type)
        .bind(options_str.as_deref())
        .bind(max_order + 1)
        .execute(pool)
        .await?;
    }

    Ok(())
}

pub async fn disable_preset_template(pool: &SqlitePool, key: &str) -> Result<()> {
    sqlx::query(
        "UPDATE actor_fields SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE field_key = ?",
    )
    .bind(key)
    .execute(pool)
    .await?;
    Ok(())
}

// ==================== 检查更新 ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeriesUpdateResult {
    pub new_videos: Vec<Video>,
    pub missing_videos: Vec<Video>,
}

/// 检测单个视频集的更新：新增分集 + 丢失分集（仅检测，不修改数据库）
pub async fn check_series_updates(pool: &SqlitePool, series_id: i64) -> Result<SeriesUpdateResult> {
    let row = sqlx::query_as::<_, (i64, String, Option<String>)>(
        "SELECT id, title, folder_path FROM video_series WHERE id = ?",
    )
    .bind(series_id)
    .fetch_optional(pool)
    .await?;

    let (_id, title, folder_path) = match row {
        Some(r) => r,
        None => return Ok(SeriesUpdateResult { new_videos: vec![], missing_videos: vec![] }),
    };

    let source = folder_path.as_deref().unwrap_or(&title);
    let folder_path_std = std::path::Path::new(source);

    // 获取数据库中现有的视频
    let existing_videos = get_series_videos(pool, series_id).await?;
    let existing_paths: std::collections::HashSet<String> = existing_videos
        .iter()
        .map(|v| v.file_path.clone())
        .collect();

    // 检测丢失的视频（数据库中有记录但文件不存在）
    let missing_videos: Vec<Video> = existing_videos
        .into_iter()
        .filter(|v| !std::path::Path::new(&v.file_path).is_file())
        .collect();

    // 扫描文件夹获取当前视频
    let (new_videos, poster_map) = if folder_path_std.is_dir() {
        let scan_result = crate::scanner::scan_directory(source).await?;
        let new: Vec<Video> = scan_result
            .videos
            .into_iter()
            .filter(|v| !existing_paths.contains(&v.file_path))
            .collect();
        (new, scan_result.posters)
    } else {
        (vec![], std::collections::HashMap::new())
    };

    // 为没有海报的现有视频更新海报和缩略图
    let existing_no_poster = sqlx::query_as::<_, (i64, String)>(
        "SELECT id, file_path FROM videos WHERE series_id = ? AND (thumbnail IS NULL OR thumbnail = '')",
    )
    .bind(series_id)
    .fetch_all(pool)
    .await?;

    if !existing_no_poster.is_empty() {
        // 收集目录下所有图片文件用于海报匹配
        let mut image_files = Vec::new();
        if let Ok(entries) = std::fs::read_dir(folder_path_std) {
            for entry in entries.filter_map(|e| e.ok()) {
                let p = entry.path();
                if p.is_file() {
                    if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                        if crate::scanner::IMAGE_EXTENSIONS.contains(&ext.to_lowercase().as_str()) {
                            image_files.push(p);
                        }
                    }
                }
            }
        }
        

        for (vid, vpath) in &existing_no_poster {
            let video_path = std::path::Path::new(vpath);
            let poster_path = poster_map.get(vpath)
                .cloned()
                .or_else(|| crate::scanner::find_poster_for_video(video_path, &image_files));
            if let Some(poster_path) = poster_path {
                let base64 = crate::scanner::generate_thumbnail_base64(std::path::Path::new(&poster_path));
                sqlx::query("UPDATE videos SET thumbnail = ?, thumbnail_base64 = ? WHERE id = ?")
                    .bind(&poster_path)
                    .bind(&base64)
                    .bind(vid)
                    .execute(pool)
                    .await?;
            }
        }
    }

    Ok(SeriesUpdateResult { new_videos, missing_videos })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeriesUpdateSummary {
    pub series_id: i64,
    pub series_title: String,
    pub new_videos: Vec<Video>,
    pub missing_videos: Vec<Video>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryUpdateResult {
    pub new_series: Vec<String>,               // 新发现的文件夹名（尚未入库）
    pub missing_series: Vec<String>,           // 数据库中有但文件夹已删除的视频集标题
    pub series_updates: Vec<SeriesUpdateSummary>, // 每个视频集的新增/丢失分集
}

/// 检测整个分类的更新：新增视频集 + 丢失视频集 + 每个视频集的新增/丢失分集
pub async fn check_category_updates(pool: &SqlitePool, category_key: &str) -> Result<CategoryUpdateResult> {
    // 获取分类下的所有视频集（空字符串 display_type 归入默认分类）
    let series_list = sqlx::query_as::<_, (i64, String, Option<String>)>(&format!(
        "SELECT id, title, folder_path FROM video_series WHERE display_type = '{}' OR display_type = '' OR (display_type IS NULL AND '{}' = 'anime')",
        category_key, category_key
    ))
    .fetch_all(pool)
    .await?;

    let mut missing_series = Vec::new();
    let mut series_updates = Vec::new();

    // 建立 folder_path 到 series 的映射，用于后续匹配新文件夹
    // 同时建立基础名称集合，用于匹配 "xxxx 1-3" → "xxxx" 这种改名场景
    let mut existing_folder_paths: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut existing_base_names: std::collections::HashSet<String> = std::collections::HashSet::new();

    for (id, title, folder_path) in &series_list {
        let source = folder_path.as_deref().unwrap_or(title);
        existing_folder_paths.insert(source.to_string());
        // 提取文件夹名，去掉集数后缀，用于匹配
        let folder_name = std::path::Path::new(source)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| title.clone());
        existing_base_names.insert(crate::scanner::strip_episode_suffix(&folder_name));

        let folder_path_std = std::path::Path::new(source);

        // 检测视频集文件夹是否缺失
        let series_missing = if folder_path.is_some() {
            !folder_path_std.is_dir()
        } else {
            !std::path::Path::new(title).is_dir()
        };

        if series_missing {
            missing_series.push(title.clone());
            continue;
        }

        // 检测该视频集下新增和丢失的分集
        let update_result = check_series_updates(pool, *id).await?;
        if !update_result.new_videos.is_empty() || !update_result.missing_videos.is_empty() {
            series_updates.push(SeriesUpdateSummary {
                series_id: *id,
                series_title: title.clone(),
                new_videos: update_result.new_videos,
                missing_videos: update_result.missing_videos,
            });
        }
    }

    // 检测 scan_path 下的新视频集文件夹
    // 自动判断文件夹层级：
    //   匹配分类 → 按分类逻辑处理
    //   匹配标签/演员 → 递归进去找视频集
    //   含视频文件 → 视频集
    //   都不匹配 → 跳过
    let category = get_category_by_key(pool, category_key).await?;

    let new_series = if let Some(ref scan_path) = category.and_then(|c| c.scan_path) {
        let path = std::path::Path::new(scan_path);
        if path.is_dir() {
            let mut new_folders = Vec::new();

            // 检测目录下是否直接包含视频文件
            let has_video_files = |dir: &std::path::Path| -> bool {
                if let Ok(entries) = std::fs::read_dir(dir) {
                    for entry in entries.filter_map(|e| e.ok()) {
                        let p = entry.path();
                        if p.is_file() {
                            if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                                let ext_lower = ext.to_lowercase();
                                if crate::scanner::VIDEO_EXTENSIONS.contains(&ext_lower.as_str()) {
                                    return true;
                                }
                            }
                        }
                    }
                }
                false
            };

            // 预加载所有标签名、演员名、分类名用于匹配
            let tag_names: std::collections::HashSet<String> =
                sqlx::query_scalar::<_, String>("SELECT name FROM tags")
                    .fetch_all(pool).await.unwrap_or_default().into_iter().collect();
            let actor_names: std::collections::HashSet<String> =
                sqlx::query_scalar::<_, String>("SELECT name FROM actors")
                    .fetch_all(pool).await.unwrap_or_default().into_iter().collect();
            let actor_labels: std::collections::HashSet<String> =
                sqlx::query_scalar::<_, String>("SELECT COALESCE(label, name) FROM actors")
                    .fetch_all(pool).await.unwrap_or_default().into_iter().collect();
            let cat_names: std::collections::HashSet<String> =
                sqlx::query_scalar::<_, String>("SELECT name FROM categories")
                    .fetch_all(pool).await.unwrap_or_default().into_iter().collect();
            let cat_keys: std::collections::HashSet<String> =
                sqlx::query_scalar::<_, String>("SELECT key FROM categories")
                    .fetch_all(pool).await.unwrap_or_default().into_iter().collect();

            /// 收集目录下不在 existing_base_names 中的子文件夹名
            // 路径规范化：统一斜杠方向和大小写
            let normalize = |s: &str| -> String {
                s.replace("\\", "/").to_lowercase()
            };
            let normalized_db_paths: std::collections::HashSet<String> =
                existing_folder_paths.iter().map(|p| normalize(p)).collect();

            let collect_new = |parent: &std::path::Path| -> Vec<String> {
                let mut result = Vec::new();
                if let Ok(entries) = std::fs::read_dir(parent) {
                    for entry in entries.filter_map(|e| e.ok()) {
                        let p = entry.path();
                        if !p.is_dir() { continue; }
                        let fps = p.to_string_lossy().to_string();
                        // 1) 规范化路径比较
                        if normalized_db_paths.contains(&normalize(&fps)) { continue; }
                        let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                        // 2) 文件夹名直接匹配
                        if existing_base_names.contains(&name) { continue; }
                        // 3) 去掉集数后缀再匹配
                        let base = crate::scanner::strip_episode_suffix(&name);
                        if !existing_base_names.contains(&base) {
                            result.push(name);
                        }
                    }
                }
                result
            };

            if let Ok(top_entries) = std::fs::read_dir(path) {
                for entry in top_entries.filter_map(|e| e.ok()) {
                    let sub_path = entry.path();
                    if !sub_path.is_dir() { continue; }
                    let name = sub_path.file_name()
                        .map(|n| n.to_string_lossy().to_string()).unwrap_or_default();

                    if cat_names.contains(&name) || cat_keys.contains(&name) {
                        // 1) 匹配分类 → 递归进入分类目录（同级）
                        // 分类文件夹本身不是视频集，递归进去按同样逻辑处理
                        if let Ok(sub_entries) = std::fs::read_dir(&sub_path) {
                            for sub_entry in sub_entries.filter_map(|e| e.ok()) {
                                let sub_sub = sub_entry.path();
                                if !sub_sub.is_dir() { continue; }
                                let sub_name = sub_sub.file_name()
                                    .map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                                if tag_names.contains(&sub_name)
                                    || actor_names.contains(&sub_name)
                                    || actor_labels.contains(&sub_name)
                                {
                                    // 标签/演员文件夹 → 递归找视频集
                                    new_folders.extend(collect_new(&sub_sub));
                                } else {
                                    // 可能是视频集文件夹
                                    new_folders.extend(collect_new(&sub_path));
                                }
                            }
                        }
                    } else if tag_names.contains(&name)
                        || actor_names.contains(&name)
                        || actor_labels.contains(&name)
                    {
                        // 2) 匹配标签/演员 → 递归进去找视频集
                        new_folders.extend(collect_new(&sub_path));
                    } else if has_video_files(&sub_path) {
                        // 3) 含视频文件 → 视频集
                        let folder_path_str = sub_path.to_string_lossy().to_string();
                        if !existing_folder_paths.contains(&folder_path_str) {
                            let base = crate::scanner::strip_episode_suffix(&name);
                            if !existing_base_names.contains(&base) {
                                new_folders.push(name);
                            }
                        }
                    }
                    // 4) 都不匹配 → 跳过
                }
            }
            new_folders
        } else {
            vec![]
        }
    } else {
        vec![]
    };

    Ok(CategoryUpdateResult {
        new_series,
        missing_series,
        series_updates,
    })
}
