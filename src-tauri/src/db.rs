use crate::{migrations, storage};
use anyhow::Result;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqlitePool, SqliteRow};
use sqlx::Row;
use std::path::{Path, PathBuf};

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
// 番组订阅
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct BangumiSubscription {
    pub id: i64,
    pub series_id: Option<i64>,
    pub site_id: Option<i64>,
    pub bangumi_url: String,
    pub rss_url: String,
    pub title: String,
    pub enabled: bool,
    pub check_interval_minutes: i64,
    pub last_check_at: Option<String>,
    pub auto_download: bool,
    pub download_mode: String,
    pub download_dir: Option<String>,
    pub preferences: String,
    pub created_at: String,
    pub updated_at: String,
    #[sqlx(default)]
    pub series_title: Option<String>,
}

// 订阅下载记录
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct SubscriptionDownload {
    pub id: i64,
    pub subscription_id: i64,
    pub guid: String,
    pub title: String,
    pub torrent_url: Option<String>,
    pub magnet_link: Option<String>,
    pub file_size: Option<i64>,
    pub pub_date: Option<String>,
    pub status: String,
    pub aria2_gid: Option<String>,
    pub file_path: Option<String>,
    pub notified: bool,
    pub created_at: String,
    pub updated_at: String,
}

// 订阅关键词
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct SubscriptionKeyword {
    pub id: i64,
    pub subscription_id: i64,
    pub keyword_category: String,
    pub keyword_value: String,
    pub is_selected: bool,
    pub created_at: String,
}

/// 更新订阅的 series_id 和 preferences
pub async fn update_subscription(
    pool: &SqlitePool,
    subscription_id: i64,
    series_id: Option<i64>,
    preferences: Option<String>,
) -> Result<(), sqlx::Error> {
    let mut sets = Vec::new();
    if series_id.is_some() {
        sets.push("series_id = ?");
    }
    if preferences.is_some() {
        sets.push("preferences = ?");
    }
    if sets.is_empty() {
        return Ok(());
    }
    sets.push("updated_at = CURRENT_TIMESTAMP");
    let sql = format!(
        "UPDATE bangumi_subscriptions SET {} WHERE id = ?",
        sets.join(", ")
    );
    let mut query = sqlx::query(&sql);
    if let Some(sid) = series_id {
        query = query.bind(sid);
    }
    if let Some(prefs) = &preferences {
        query = query.bind(prefs);
    }
    query = query.bind(subscription_id);
    query.execute(pool).await?;
    Ok(())
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
    pub scope: String,
    pub created_at: String,
}

// 标签-分类关联
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagCategory {
    pub id: i64,
    pub tag_id: i64,
    pub category_key: String,
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
pub struct CompletionRecordInput {
    pub series_id: i64,
    pub rating: Option<f64>,
    pub review: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeriesCompletionRecord {
    pub id: Option<i64>,
    pub series_id: i64,
    pub title: String,
    pub description: Option<String>,
    pub poster: Option<String>,
    pub poster_data_url: Option<String>,
    pub poster_orientation: Option<String>,
    pub video_count: i64,
    pub display_type: Option<String>,
    pub status: Option<String>,
    pub rating: Option<f64>,
    pub review: Option<String>,
    pub completed_at: Option<String>,
    pub last_played: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
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
    // 海报：和 series_from_row 一致，优先 poster_base64，fallback 原图路径
    let series_poster_data_url: Option<String> = row
        .try_get("series_poster_base64")
        .ok()
        .flatten()
        .or_else(|| {
            let poster: Option<String> = row.try_get("series_poster").ok().flatten();
            poster.and_then(|p| {
                let resolved = storage::resolve_data_path(&p);
                if resolved.exists() {
                    image_data_url(Path::new(&resolved))
                } else {
                    None
                }
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
        if let Some(mut series) = get_video_series_by_folder_path(pool, path).await? {
            // 如果已存在但分类已不同，更新到新分类
            if let Some(dt) = display_type {
                if series.display_type.as_deref() != Some(dt) {
                    sqlx::query("UPDATE video_series SET display_type = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
                        .bind(dt).bind(series.id).execute(pool).await?;
                    series.display_type = Some(dt.to_string());
                }
            }
            return Ok(series);
        }
    }
    let row = sqlx::query("SELECT video_series.*, 0 AS video_count, NULL AS last_watched_episode, NULL AS last_watched_season, 0 AS has_actor FROM video_series WHERE id = last_insert_rowid()")
    .fetch_one(pool)
    .await?;
    Ok(series_from_row(&row))
}

/// Create an empty video series with no folder_path (user-created, unaffected by scan).
pub async fn create_empty_video_series(
    pool: &SqlitePool,
    title: &str,
    display_type: Option<&str>,
) -> Result<VideoSeries> {
    sqlx::query(
        "INSERT INTO video_series (title, folder_path, poster_orientation, status, display_type) VALUES (?, NULL, 'landscape', 'ongoing', COALESCE(?, ''))"
    )
    .bind(title)
    .bind(display_type)
    .execute(pool)
    .await?;
    let row = sqlx::query(
        "SELECT video_series.*, 0 AS video_count, NULL AS last_watched_episode, NULL AS last_watched_season, 0 AS has_actor FROM video_series WHERE id = last_insert_rowid()"
    )
    .fetch_one(pool)
    .await?;
    Ok(series_from_row(&row))
}

/// Batch update episode numbers for videos (used for drag-and-drop reorder).
pub async fn update_video_episode_numbers(
    pool: &SqlitePool,
    updates: &[(i64, i32)],
) -> Result<()> {
    let mut tx = pool.begin().await?;
    for (video_id, episode_number) in updates {
        sqlx::query("UPDATE videos SET episode_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .bind(episode_number)
            .bind(video_id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
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

/// 轻量级查询：只返回 id, title, display_type（用于订阅弹窗搜索）
pub async fn get_video_series_list_lite(
    pool: &SqlitePool,
) -> Result<Vec<(i64, String, Option<String>)>> {
    let rows = sqlx::query_as::<_, (i64, String, Option<String>)>(
        "SELECT id, title, display_type FROM video_series ORDER BY created_at DESC, id DESC"
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get_video_series_poster_data_url(pool: &SqlitePool, id: i64) -> Result<Option<String>> {
    let row = sqlx::query("SELECT poster, poster_base64 FROM video_series WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    let Some(row) = row else { return Ok(None); };

    if let Some(data_url) = row.try_get::<Option<String>, _>("poster_base64").ok().flatten() {
        if !data_url.trim().is_empty() {
            return Ok(Some(data_url));
        }
    }

    let poster = row.try_get::<Option<String>, _>("poster").ok().flatten();
    let Some(poster) = poster else { return Ok(None); };
    let resolved = storage::resolve_data_path(&poster);
    let data_url = image_data_url(Path::new(&resolved));
    if let Some(ref value) = data_url {
        let _ = sqlx::query("UPDATE video_series SET poster_base64 = ? WHERE id = ?")
            .bind(value)
            .bind(id)
            .execute(pool)
            .await;
    }
    Ok(data_url)
}

pub async fn get_video_series_list(
    pool: &SqlitePool,
    sort_by: &str,
    sort_order: &str,
) -> Result<Vec<VideoSeries>> {
    let order_clause = match (sort_by, sort_order) {
        ("title", "asc") => "ORDER BY s.title COLLATE NOCASE ASC, s.id DESC",
        ("title", "desc") => "ORDER BY s.title COLLATE NOCASE DESC, s.id DESC",
        ("created_at", "asc") => "ORDER BY s.created_at ASC, s.id ASC",
        _ => "ORDER BY s.created_at DESC, s.id DESC",
    };
    // 列表查询保持轻量：不调用 series_from_row，不批量返回 poster_base64，避免大列表 IPC 卡顿。
    // 进入视频库前由前端按 series_id 预加载海报缓存，确保页面显示时卡片已有可用海报。
    let sql = format!("SELECT s.id, s.title, s.description, s.poster, s.poster_base64 AS poster_base64, s.folder_path, s.poster_orientation, s.status, s.created_at, s.updated_at, s.is_favorite, s.is_watched, s.has_chinese_sub, s.display_type, COUNT(v.id) AS video_count, NULL AS last_watched_episode, NULL AS last_watched_season, MAX(CASE WHEN sa.actor_id IS NOT NULL THEN 1 ELSE 0 END) AS has_actor FROM video_series s LEFT JOIN videos v ON v.series_id = s.id LEFT JOIN series_actors sa ON sa.series_id = s.id GROUP BY s.id {}", order_clause);
    let rows = sqlx::query(&sql).fetch_all(pool).await?;
    // 直接构造结构体，不调用 series_from_row（避免 poster_base64 为空时读文件转 base64）。
    let result = rows.iter().map(|row| {
        VideoSeries {
            id: row.get("id"),
            title: row.get("title"),
            description: row.get("description"),
            poster: row.try_get::<Option<String>, _>("poster").ok().flatten().map(|path| storage::resolve_data_path(&path).to_string_lossy().to_string()),
            poster_data_url: None,
            poster_base64: None,
            folder_path: row.get("folder_path"),
            video_count: row.try_get("video_count").unwrap_or(0),
            poster_orientation: row.try_get("poster_orientation").ok().flatten(),
            status: row.try_get("status").ok().flatten(),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
            is_favorite: row.try_get("is_favorite").ok().flatten(),
            is_watched: row.try_get("is_watched").ok().flatten(),
            last_watched_episode: None,
            last_watched_season: None,
            has_actor: row.try_get::<Option<i64>, _>("has_actor").ok().flatten().map(|v| v > 0).unwrap_or(false),
            has_chinese_sub: row.try_get("has_chinese_sub").ok().flatten(),
            display_type: row.try_get("display_type").ok().flatten(),
            code: None,
        }
    }).collect();
    Ok(result)
}

pub async fn get_video_series_by_tag(pool: &SqlitePool, tag_id: i64) -> Result<Vec<VideoSeries>> {
    let rows = sqlx::query(
        "SELECT s.*, COUNT(v.id) AS video_count, (SELECT v2.episode_number FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_episode, (SELECT v2.season FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_season, MAX(CASE WHEN sa2.actor_id IS NOT NULL THEN 1 ELSE 0 END) AS has_actor FROM video_series s LEFT JOIN videos v ON v.series_id = s.id LEFT JOIN series_actors sa2 ON sa2.series_id = s.id JOIN series_tags st ON st.series_id = s.id WHERE st.tag_id = ? GROUP BY s.id ORDER BY s.created_at DESC, s.id DESC",
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
        "SELECT s.*, COUNT(v.id) AS video_count, (SELECT v2.episode_number FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_episode, (SELECT v2.season FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_season, MAX(CASE WHEN sa2.actor_id IS NOT NULL THEN 1 ELSE 0 END) AS has_actor FROM video_series s LEFT JOIN videos v ON v.series_id = s.id LEFT JOIN series_actors sa2 ON sa2.series_id = s.id JOIN series_tags st ON st.series_id = s.id JOIN tags t ON t.id = st.tag_id WHERE t.name = ? GROUP BY s.id ORDER BY s.created_at DESC, s.id DESC",
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
        "SELECT s.*, COUNT(v.id) AS video_count, (SELECT v2.episode_number FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_episode, (SELECT v2.season FROM videos v2 JOIN play_history ph ON ph.video_id = v2.id WHERE v2.series_id = s.id ORDER BY ph.last_played DESC LIMIT 1) AS last_watched_season, MAX(CASE WHEN sa.actor_id IS NOT NULL THEN 1 ELSE 0 END) AS has_actor FROM video_series s LEFT JOIN videos v ON v.series_id = s.id JOIN series_actors sa ON sa.series_id = s.id WHERE sa.actor_id = ? GROUP BY s.id ORDER BY s.created_at DESC, s.id DESC",
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
    sqlx::query("UPDATE video_series SET poster = COALESCE(?, poster), poster_base64 = COALESCE(?, poster_base64), poster_orientation = COALESCE(?, poster_orientation), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(poster)
        .bind(poster_base64)
        .bind(poster_orientation)
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
    if let Some(val) = has_chinese_sub {
        sqlx::query("UPDATE video_series SET title = ?, description = ?, poster = ?, poster_orientation = ?, status = ?, poster_base64 = ?, code = ?, has_chinese_sub = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .bind(title)
            .bind(description)
            .bind(poster)
            .bind(poster_orientation.unwrap_or_else(|| "landscape".to_string()))
            .bind(status.unwrap_or_else(|| "ongoing".to_string()))
            .bind(poster_base64)
            .bind(code)
            .bind(val)
            .bind(id)
            .execute(pool)
            .await?;
    } else {
        sqlx::query("UPDATE video_series SET title = ?, description = ?, poster = ?, poster_orientation = ?, status = ?, poster_base64 = ?, code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .bind(title)
            .bind(description)
            .bind(poster)
            .bind(poster_orientation.unwrap_or_else(|| "landscape".to_string()))
            .bind(status.unwrap_or_else(|| "ongoing".to_string()))
            .bind(poster_base64)
            .bind(code)
            .bind(id)
            .execute(pool)
            .await?;
    };
    get_video_series(pool, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("视频集不存在"))
}

pub async fn delete_video_series(pool: &SqlitePool, id: i64, delete_videos: bool) -> Result<()> {
    if delete_videos {
        sqlx::query("DELETE FROM videos WHERE series_id = ?")
            .bind(id)
            .execute(pool)
            .await?;
    }
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
            scope: row.get("scope"),
            created_at: row.get("created_at"),
        })
        .collect();

    Ok(tags)
}

pub async fn get_tags_by_category(pool: &SqlitePool, category_key: &str) -> Result<Vec<Tag>> {
    let rows = sqlx::query(
        "SELECT DISTINCT t.* FROM tags t
         LEFT JOIN tag_categories tc ON tc.tag_id = t.id
         WHERE t.scope = 'global'
            OR (t.scope = 'category' AND tc.category_key = ?)
         ORDER BY t.name",
    )
    .bind(category_key)
    .fetch_all(pool)
    .await?;

    let tags = rows
        .iter()
        .map(|row| Tag {
            id: row.get("id"),
            name: row.get("name"),
            scope: row.get("scope"),
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
            scope: row.get("scope"),
            created_at: row.get("created_at"),
        })),
        None => Ok(None),
    }
}

pub async fn add_tag(pool: &SqlitePool, name: &str, scope: &str) -> Result<Tag> {
    let row = sqlx::query("INSERT INTO tags (name, scope) VALUES (?, ?) RETURNING *")
        .bind(name)
        .bind(scope)
        .fetch_one(pool)
        .await?;

    Ok(Tag {
        id: row.get("id"),
        name: row.get("name"),
        scope: row.get("scope"),
        created_at: row.get("created_at"),
    })
}

pub async fn delete_tag(pool: &SqlitePool, id: i64) -> Result<()> {
    sqlx::query("DELETE FROM tag_categories WHERE tag_id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM tags WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_tags_by_scope(pool: &SqlitePool, scope: &str) -> Result<Vec<Tag>> {
    let rows = sqlx::query("SELECT * FROM tags WHERE scope = ? ORDER BY name")
        .bind(scope)
        .fetch_all(pool)
        .await?;
    let tags = rows
        .iter()
        .map(|row| Tag {
            id: row.get("id"),
            name: row.get("name"),
            scope: row.get("scope"),
            created_at: row.get("created_at"),
        })
        .collect();
    Ok(tags)
}

pub async fn get_tag_categories(pool: &SqlitePool, tag_id: i64) -> Result<Vec<String>> {
    let rows = sqlx::query("SELECT category_key FROM tag_categories WHERE tag_id = ? ORDER BY category_key")
        .bind(tag_id)
        .fetch_all(pool)
        .await?;
    Ok(rows.iter().map(|r| r.get("category_key")).collect())
}

pub async fn update_tag(pool: &SqlitePool, id: i64, name: &str, scope: &str) -> Result<()> {
    sqlx::query("UPDATE tags SET name = ?, scope = ? WHERE id = ?")
        .bind(name)
        .bind(scope)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_tag_categories(pool: &SqlitePool, tag_id: i64, category_keys: &[String]) -> Result<()> {
    // 先删后插
    sqlx::query("DELETE FROM tag_categories WHERE tag_id = ?")
        .bind(tag_id)
        .execute(pool)
        .await?;
    for key in category_keys {
        sqlx::query("INSERT OR IGNORE INTO tag_categories (tag_id, category_key) VALUES (?, ?)")
            .bind(tag_id)
            .bind(key)
            .execute(pool)
            .await?;
    }
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
            scope: row.get("scope"),
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
    // 1. 查有视频的作品
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

    let mut results: Vec<Video> = rows.iter().map(video_from_row).collect();

    // 补充：确保所有有 series_id 的作品都有 series_poster_data_url
    // 和视频页用相同的数据路径：直接从 video_series.poster_base64 读取
    let series_ids: Vec<i64> = results.iter()
        .filter_map(|v| v.series_id)
        .filter(|sid| results.iter().any(|r| r.series_id == Some(*sid) && r.series_poster_data_url.is_none()))
        .collect();
    if !series_ids.is_empty() {
        let placeholders = series_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!("SELECT id, poster_base64 FROM video_series WHERE id IN ({placeholders})");
        let mut query = sqlx::query(&sql);
        for sid in &series_ids {
            query = query.bind(sid);
        }
        if let Ok(series_rows) = query.fetch_all(pool).await {
            let poster_map: std::collections::HashMap<i64, Option<String>> = series_rows.iter()
                .filter_map(|row| {
                    let id: i64 = row.get("id");
                    let poster: Option<String> = row.try_get("poster_base64").ok().flatten();
                    Some((id, poster))
                })
                .collect();
            for video in results.iter_mut() {
                if let Some(sid) = video.series_id {
                    if video.series_poster_data_url.is_none() {
                        if let Some(poster) = poster_map.get(&sid) {
                            video.series_poster_data_url = poster.clone();
                            // 同时设置 thumbnail_data_url 作为 fallback
                            video.thumbnail_data_url = poster.clone();
                        }
                    }
                }
            }
        }
    }

    // 2. 查空视频集（关联了演员但没有视频的视频集）
    let existing_series_ids: std::collections::HashSet<i64> = results.iter()
        .filter_map(|v| v.series_id)
        .collect();

    let empty_series = sqlx::query(
        "SELECT s.id, s.title, s.poster, s.poster_base64 AS series_poster_base64, s.display_type, s.created_at
         FROM video_series s
         JOIN series_actors sa ON sa.series_id = s.id
         WHERE sa.actor_id = ? AND NOT EXISTS (SELECT 1 FROM videos v WHERE v.series_id = s.id)"
    )
    .bind(actor_id)
    .fetch_all(pool)
    .await?;

    for row in empty_series {
        let series_id: i64 = row.get("id");
        if existing_series_ids.contains(&series_id) { continue; }
        let title: String = row.get("title");
        let poster: Option<String> = row.get("poster");
        let created_at: String = row.get("created_at");
        let poster_base64: Option<String> = row.try_get("series_poster_base64").ok().flatten();
        // poster_base64 可能已经是完整 data URL，不要再加前缀
        let poster_data_url = poster_base64.clone();
        results.push(Video {
            id: 0,
            series_id: Some(series_id),
            file_name: title.clone(),
            file_path: String::new(),
            file_size: None,
            duration: None,
            episode_number: None,
            season: None,
            subtitle: None,
            thumbnail: poster.clone(),
            thumbnail_base64: poster_base64.clone(),
            // 同时设置 thumbnail_data_url，让 videoPosterDataUrl 能直接获取海报
            thumbnail_data_url: poster_data_url.clone(),
            series_title: Some(title),
            series_poster_data_url: poster_data_url,
            description: None,
            poster_orientation: None,
            created_at,
            is_favorite: None,
            series_has_chinese_sub: None,
            series_code: None,
            width: None,
            height: None,
            resolution: None,
            source_site: None,
            metadata: None,
        });
    }

    // 按时间排序
    results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(results)
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
            scope: row.get("scope"),
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

/// 返回 video_id → series_id 的轻量映射（只查两列，用于首页排序）
pub async fn get_completion_records(pool: &SqlitePool) -> Result<Vec<SeriesCompletionRecord>> {
    let rows = sqlx::query(
        r#"
        SELECT
            r.id AS record_id,
            s.id AS series_id,
            s.title,
            s.description,
            s.poster,
            s.poster_base64,
            s.poster_orientation,
            s.status,
            s.display_type,
            s.created_at AS series_created_at,
            s.updated_at AS series_updated_at,
            COALESCE((SELECT COUNT(*) FROM videos v WHERE v.series_id = s.id), 0) AS video_count,
            r.rating,
            r.review,
            r.completed_at,
            r.created_at AS record_created_at,
            r.updated_at AS record_updated_at,
            (
                SELECT MAX(ph.last_played)
                FROM play_history ph
                JOIN videos hv ON hv.id = ph.video_id
                WHERE hv.series_id = s.id
            ) AS last_played
        FROM video_series s
        LEFT JOIN series_completion_records r ON r.series_id = s.id
        WHERE COALESCE(s.is_watched, 0) = 1 OR r.id IS NOT NULL
        ORDER BY COALESCE(r.completed_at, last_played, s.updated_at, s.created_at) DESC
        "#,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let poster: Option<String> = row.get("poster");
            let resolved_poster = poster.map(|path| {
                storage::resolve_data_path(&path)
                    .to_string_lossy()
                    .to_string()
            });
            let poster_data_url: Option<String> = row.try_get("poster_base64").ok().flatten();
            SeriesCompletionRecord {
                id: row.try_get("record_id").ok(),
                series_id: row.get("series_id"),
                title: row.get("title"),
                description: row.get("description"),
                poster: resolved_poster,
                poster_data_url,
                poster_orientation: row.try_get("poster_orientation").ok(),
                video_count: row.get("video_count"),
                display_type: row.try_get("display_type").ok(),
                status: row.try_get("status").ok(),
                rating: row.try_get::<Option<f64>, _>("rating").ok().flatten().map(|value| {
                    let normalized = if value > 5.0 { value / 2.0 } else { value };
                    (normalized.clamp(0.1, 5.0) * 10.0).round() / 10.0
                }),
                review: row.try_get("review").ok().flatten(),
                completed_at: row.try_get("completed_at").ok().flatten(),
                last_played: row.try_get("last_played").ok().flatten(),
                created_at: row.try_get("record_created_at").ok().flatten(),
                updated_at: row.try_get("record_updated_at").ok().flatten(),
            }
        })
        .collect())
}

pub async fn upsert_completion_record(
    pool: &SqlitePool,
    input: CompletionRecordInput,
) -> Result<SeriesCompletionRecord> {
    let completed_at = input.completed_at.unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string());
    let review = input.review.map(|text| text.trim().to_string()).filter(|text| !text.is_empty());
    let rating = input.rating.map(|value| {
        let normalized = if value > 5.0 { value / 2.0 } else { value };
        (normalized.clamp(0.1, 5.0) * 10.0).round() / 10.0
    });

    sqlx::query(
        r#"
        INSERT INTO series_completion_records (series_id, rating, review, completed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(series_id) DO UPDATE SET
            rating = excluded.rating,
            review = excluded.review,
            completed_at = excluded.completed_at,
            updated_at = CURRENT_TIMESTAMP
        "#,
    )
    .bind(input.series_id)
    .bind(rating)
    .bind(review)
    .bind(completed_at)
    .execute(pool)
    .await?;

    sqlx::query("UPDATE video_series SET is_watched = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(input.series_id)
        .execute(pool)
        .await?;

    let records = get_completion_records(pool).await?;
    records
        .into_iter()
        .find(|record| record.series_id == input.series_id)
        .ok_or_else(|| anyhow::anyhow!("金番奖记录保存后未找到"))
}

pub async fn delete_completion_record(pool: &SqlitePool, series_id: i64) -> Result<()> {
    sqlx::query("DELETE FROM series_completion_records WHERE series_id = ?")
        .bind(series_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_video_series_map(pool: &SqlitePool) -> Result<Vec<(i64, i64)>> {
    let rows = sqlx::query("SELECT id, series_id FROM videos WHERE series_id IS NOT NULL")
        .fetch_all(pool)
        .await?;

    let map = rows
        .iter()
        .map(|row| (row.get::<i64, _>("id"), row.get::<i64, _>("series_id")))
        .collect();

    Ok(map)
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
    let rows = sqlx::query("SELECT s.id, s.title, s.description, s.poster, s.poster_base64 AS poster_base64, s.folder_path, s.poster_orientation, s.status, s.created_at, s.updated_at, s.is_favorite, s.is_watched, s.has_chinese_sub, s.display_type, COUNT(v.id) AS video_count, NULL AS last_watched_episode, NULL AS last_watched_season, MAX(CASE WHEN sa.actor_id IS NOT NULL THEN 1 ELSE 0 END) AS has_actor FROM video_series s LEFT JOIN videos v ON v.series_id = s.id LEFT JOIN series_actors sa ON sa.series_id = s.id WHERE s.is_favorite = 1 GROUP BY s.id ORDER BY s.created_at DESC")
        .fetch_all(pool)
        .await?;
    Ok(rows.iter().map(|row| VideoSeries {
        id: row.get("id"),
        title: row.get("title"),
        description: row.get("description"),
        poster: row.try_get::<Option<String>, _>("poster").ok().flatten().map(|path| storage::resolve_data_path(&path).to_string_lossy().to_string()),
        poster_data_url: None,
        poster_base64: None,
        folder_path: row.get("folder_path"),
        video_count: row.try_get("video_count").unwrap_or(0),
        poster_orientation: row.try_get("poster_orientation").ok().flatten(),
        status: row.try_get("status").ok().flatten(),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        is_favorite: row.try_get("is_favorite").ok().flatten(),
        is_watched: row.try_get("is_watched").ok().flatten(),
        last_watched_episode: None,
        last_watched_season: None,
        has_actor: row.try_get::<Option<i64>, _>("has_actor").ok().flatten().map(|v| v > 0).unwrap_or(false),
        code: None,
        has_chinese_sub: row.try_get("has_chinese_sub").ok().flatten(),
        display_type: row.try_get("display_type").ok().flatten(),
    }).collect())
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

fn usable_series_folder(folder_path: Option<&str>, title: &str) -> Option<PathBuf> {
    [folder_path.unwrap_or_default(), title]
        .into_iter()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .find_map(|path| {
            let direct = Path::new(path);
            if direct.is_dir() {
                return Some(direct.to_path_buf());
            }

            let resolved = storage::resolve_data_path(path);
            if resolved.is_dir() {
                Some(resolved)
            } else {
                None
            }
        })
}

fn folder_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn find_child_folder_by_identity(
    root: &Path,
    title: &str,
    code: Option<&str>,
    max_depth: usize,
) -> Option<PathBuf> {
    if max_depth == 0 || !root.is_dir() {
        return None;
    }

    let title = title.trim();
    let title_lower = title.to_lowercase();
    let code_upper = code
        .map(str::trim)
        .filter(|code| !code.is_empty())
        .map(|code| code.to_uppercase());

    let entries = std::fs::read_dir(root).ok()?;
    let mut child_dirs = Vec::new();
    for entry in entries.filter_map(|entry| entry.ok()) {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let name = folder_name(&path);
        let name_lower = name.to_lowercase();
        let name_code = crate::scanner::parse_adult_filename(&name).map(|info| info.code);

        let title_matches = !title.is_empty()
            && (name == title
                || name_lower == title_lower
                || crate::scanner::strip_episode_suffix(&name).to_lowercase() == title_lower);
        let code_matches = code_upper
            .as_deref()
            .map(|code| {
                name_code.as_deref() == Some(code) || name.to_uppercase().contains(code)
            })
            .unwrap_or(false);

        if title_matches || code_matches {
            return Some(path);
        }
        child_dirs.push(path);
    }

    for child in child_dirs {
        if let Some(found) = find_child_folder_by_identity(&child, title, code, max_depth - 1) {
            return Some(found);
        }
    }
    None
}

async fn resolve_series_folder(
    pool: &SqlitePool,
    folder_path: Option<&str>,
    title: &str,
    display_type: Option<&str>,
    code: Option<&str>,
) -> Result<Option<PathBuf>> {
    if let Some(folder) = usable_series_folder(folder_path, title) {
        return Ok(Some(folder));
    }

    let scan_paths = if let Some(kind) = display_type.filter(|kind| !kind.trim().is_empty()) {
        sqlx::query_scalar::<_, String>(
            "SELECT scan_path FROM categories WHERE key = ? AND scan_path IS NOT NULL AND scan_path != ''",
        )
        .bind(kind)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_scalar::<_, String>(
            "SELECT scan_path FROM categories WHERE scan_path IS NOT NULL AND scan_path != ''",
        )
        .fetch_all(pool)
        .await?
    };

    for scan_path in scan_paths {
        if let Some(root) = usable_series_folder(Some(&scan_path), "") {
            if let Some(found) = find_child_folder_by_identity(&root, title, code, 5) {
                return Ok(Some(found));
            }
        }
    }

    Ok(None)
}

fn normalize_path_string(path: &str) -> String {
    Path::new(path).to_string_lossy().replace('\\', "/")
}

fn same_stored_path(left: Option<&str>, right: &str) -> bool {
    left.map(|value| normalize_path_string(value) == normalize_path_string(right))
        .unwrap_or(false)
}

/// 重新扫描所有 video_series 的元数据（code、has_chinese_sub）
/// 重新扫描单个视频集的元数据（车牌、中字、标题、海报）
pub async fn rescan_single_series_metadata(pool: &SqlitePool, series_id: i64) -> Result<bool> {
    let row = sqlx::query_as::<_, (i64, String, Option<String>, Option<String>, Option<String>)>(
        "SELECT id, title, folder_path, display_type, code FROM video_series WHERE id = ?",
    )
    .bind(series_id)
    .fetch_optional(pool)
    .await?;

    let (id, title, folder_path, display_type, code) = match row {
        Some(r) => r,
        None => return Ok(false),
    };

    let source = resolve_series_folder(pool, folder_path.as_deref(), &title, display_type.as_deref(), code.as_deref()).await?;
    let folder_name = source
        .as_deref()
        .and_then(std::path::Path::file_name)
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| title.clone());
    let poster = source
        .as_deref()
        .and_then(crate::scanner::find_folder_poster);
    let poster_base64 = poster.as_deref().and_then(|p| {
        let resolved = storage::resolve_data_path(p);
        crate::scanner::generate_thumbnail_base64(std::path::Path::new(&resolved))
    });
    let poster_updated = if let Some(ref poster_path) = poster {
        update_video_series_poster(
            pool,
            id,
            Some(poster_path),
            poster_base64.as_deref(),
            Some("landscape"),
        )
        .await?;
        true
    } else {
        false
    };

    let mut found_video_files = false;
    if let Some(source) = source.as_deref() {
        let result = crate::scanner::scan_directory(&source.to_string_lossy()).await?;
        found_video_files = !result.videos.is_empty();
        if found_video_files {
            add_videos_batch(pool, result.videos, Some(id)).await?;
        }
    }

    // 番号检测：不限 display_type，任何分类只要文件夹名匹配番号格式都识别
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

fn normalize_season(season: i32) -> i32 {
    if season == 999 { 999 } else if season > 0 { season } else { 1 }
}

fn normalize_subtitle(subtitle: Option<&str>) -> String {
    subtitle.unwrap_or("").trim().to_string()
}

pub async fn get_series_seasons(pool: &SqlitePool, series_id: i64) -> Result<Vec<SeasonInfo>> {
    let mut groups: std::collections::BTreeMap<(i32, String), i64> = std::collections::BTreeMap::new();

    let meta_rows = sqlx::query("SELECT season, COALESCE(subtitle, '') AS subtitle FROM series_seasons WHERE series_id = ?")
        .bind(series_id)
        .fetch_all(pool)
        .await?;
    for row in meta_rows {
        let season: i32 = row.get("season");
        let subtitle: String = row.get("subtitle");
        groups.entry((normalize_season(season), subtitle)).or_insert(0);
    }

    let video_rows = sqlx::query(
        "SELECT season, COALESCE(subtitle, '') AS subtitle, COUNT(*) as video_count FROM videos WHERE series_id = ? GROUP BY season, subtitle"
    )
    .bind(series_id)
    .fetch_all(pool)
    .await?;
    for row in video_rows {
        let season: i32 = row.try_get("season").unwrap_or(0);
        let subtitle: String = row.try_get("subtitle").unwrap_or_default();
        let count: i64 = row.get("video_count");
        *groups.entry((normalize_season(season), subtitle)).or_insert(0) += count;
    }

    groups.entry((1, String::new())).or_insert(0);

    let mut seasons: Vec<SeasonInfo> = groups
        .into_iter()
        .map(|((season, subtitle), video_count)| SeasonInfo {
            season,
            subtitle: if subtitle.trim().is_empty() { None } else { Some(subtitle) },
            video_count,
        })
        .collect();
    seasons.sort_by(|a, b| {
        let ak = if a.season == 999 { i32::MAX } else { a.season };
        let bk = if b.season == 999 { i32::MAX } else { b.season };
        ak.cmp(&bk).then_with(|| a.subtitle.cmp(&b.subtitle))
    });
    Ok(seasons)
}

pub async fn delete_season(pool: &SqlitePool, series_id: i64, season: i32, subtitle: Option<String>) -> Result<()> {
    let target_season = normalize_season(season);
    let target_subtitle = normalize_subtitle(subtitle.as_deref());

    sqlx::query("DELETE FROM series_seasons WHERE series_id = ? AND season = ? AND COALESCE(subtitle, '') = ?")
        .bind(series_id)
        .bind(target_season)
        .bind(&target_subtitle)
        .execute(pool)
        .await?;

    if target_season == 1 {
        sqlx::query("DELETE FROM videos WHERE series_id = ? AND (season IS NULL OR season = 0 OR season = 1) AND COALESCE(subtitle, '') = ?")
            .bind(series_id)
            .bind(&target_subtitle)
            .execute(pool)
            .await?;
    } else {
        sqlx::query("DELETE FROM videos WHERE series_id = ? AND season = ? AND COALESCE(subtitle, '') = ?")
            .bind(series_id)
            .bind(target_season)
            .bind(&target_subtitle)
            .execute(pool)
            .await?;
    }
    Ok(())
}

pub async fn create_season(
    pool: &SqlitePool,
    series_id: i64,
    season: i32,
    subtitle: Option<&str>,
) -> Result<()> {
    let target_season = if season == 0 {
        let max_video_season: i32 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(CASE WHEN season IS NULL OR season = 0 THEN 1 ELSE season END), 0) FROM videos WHERE series_id = ? AND COALESCE(season, 0) < 999",
        )
        .bind(series_id)
        .fetch_one(pool)
        .await?;
        let max_meta_season: i32 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(season), 0) FROM series_seasons WHERE series_id = ? AND season < 999",
        )
        .bind(series_id)
        .fetch_one(pool)
        .await?;
        std::cmp::max(1, std::cmp::max(max_video_season, max_meta_season)) + 1
    } else {
        normalize_season(season)
    };
    let subtitle_text = normalize_subtitle(subtitle);
    sqlx::query(
        "INSERT OR IGNORE INTO series_seasons (series_id, season, subtitle) VALUES (?, ?, ?)"
    )
    .bind(series_id)
    .bind(target_season)
    .bind(&subtitle_text)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn update_season_group(
    pool: &SqlitePool,
    series_id: i64,
    from_season: i32,
    from_subtitle: Option<String>,
    to_season: i32,
    to_subtitle: Option<String>,
) -> Result<()> {
    let source_season = normalize_season(from_season);
    let source_subtitle = normalize_subtitle(from_subtitle.as_deref());
    let target_season = normalize_season(to_season);
    let target_subtitle = normalize_subtitle(to_subtitle.as_deref());

    sqlx::query("INSERT OR IGNORE INTO series_seasons (series_id, season, subtitle) VALUES (?, ?, ?)")
        .bind(series_id)
        .bind(target_season)
        .bind(&target_subtitle)
        .execute(pool)
        .await?;

    if source_season == 1 {
        sqlx::query("UPDATE videos SET season = ?, subtitle = ?, updated_at = CURRENT_TIMESTAMP WHERE series_id = ? AND (season IS NULL OR season = 0 OR season = 1) AND COALESCE(subtitle, '') = ?")
            .bind(target_season)
            .bind(&target_subtitle)
            .bind(series_id)
            .bind(&source_subtitle)
            .execute(pool)
            .await?;
    } else {
        sqlx::query("UPDATE videos SET season = ?, subtitle = ?, updated_at = CURRENT_TIMESTAMP WHERE series_id = ? AND season = ? AND COALESCE(subtitle, '') = ?")
            .bind(target_season)
            .bind(&target_subtitle)
            .bind(series_id)
            .bind(source_season)
            .bind(&source_subtitle)
            .execute(pool)
            .await?;
    }

    sqlx::query("DELETE FROM series_seasons WHERE series_id = ? AND season = ? AND COALESCE(subtitle, '') = ?")
        .bind(series_id)
        .bind(source_season)
        .bind(&source_subtitle)
        .execute(pool)
        .await?;

    Ok(())
}

pub async fn move_videos_to_season(
    pool: &SqlitePool,
    series_id: i64,
    video_ids: Vec<i64>,
    season: i32,
    subtitle: Option<String>,
) -> Result<()> {
    if video_ids.is_empty() {
        return Ok(());
    }
    let target_season = normalize_season(season);
    let target_subtitle = normalize_subtitle(subtitle.as_deref());

    sqlx::query("INSERT OR IGNORE INTO series_seasons (series_id, season, subtitle) VALUES (?, ?, ?)")
        .bind(series_id)
        .bind(target_season)
        .bind(&target_subtitle)
        .execute(pool)
        .await?;

    for video_id in video_ids {
        sqlx::query("UPDATE videos SET season = ?, subtitle = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND series_id = ?")
            .bind(target_season)
            .bind(&target_subtitle)
            .bind(video_id)
            .bind(series_id)
            .execute(pool)
            .await?;
    }

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

/// 批量补齐某个分类下视频集缺失的海报。
/// 语义对齐“单视频集右键检查更新”的海报修复部分：
/// 只在视频集海报路径或缓存缺失时从本地文件夹重新匹配海报；找不到不覆盖旧值；不新增/删除视频，不改标题/车牌/中字。
/// 返回 (updated, skipped, missing_series_count, missing_videos_count)，missing_videos_count 保持 0 以兼容旧接口。
pub async fn rescan_category_metadata(pool: &SqlitePool, category_key: &str) -> Result<(i64, i64, i64, i64)> {
    let series_list = sqlx::query_as::<_, (i64, String, Option<String>, Option<String>, Option<String>, Option<String>)>(&format!(
        "SELECT id, title, folder_path, code, poster, poster_base64 FROM video_series WHERE display_type = '{}' OR display_type = '' OR (display_type IS NULL AND '{}' = 'anime')",
        category_key, category_key
    ))
    .fetch_all(pool)
    .await?;

    let mut updated: i64 = 0;
    let mut skipped: i64 = 0;
    let mut missing_series_count: i64 = 0;

    for (id, title, folder_path, code, poster, poster_base64) in series_list {
        let folder_path_std = match resolve_series_folder(pool, folder_path.as_deref(), &title, Some(category_key), code.as_deref()).await? {
            Some(path) => path,
            None => {
                missing_series_count += 1;
                skipped += 1;
                continue;
            }
        };
        let candidate = crate::scanner::find_folder_poster(&folder_path_std);
        let base64_missing = poster_base64.as_deref().unwrap_or_default().trim().is_empty();
        let poster_missing = poster.as_deref().unwrap_or_default().trim().is_empty();
        let candidate_changed = candidate
            .as_deref()
            .map(|candidate_path| !same_stored_path(poster.as_deref(), candidate_path))
            .unwrap_or(false);

        if let Some(series_poster) = candidate {
            if poster_missing || base64_missing || candidate_changed {
                let resolved = storage::resolve_data_path(&series_poster);
                let series_poster_base64 =
                    crate::scanner::generate_thumbnail_base64(std::path::Path::new(&resolved));
                let orientation = crate::scanner::get_image_orientation(std::path::Path::new(&resolved));
                sqlx::query("UPDATE video_series SET poster = ?, poster_base64 = COALESCE(?, poster_base64), poster_orientation = COALESCE(?, poster_orientation), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
                    .bind(series_poster.as_str())
                    .bind(series_poster_base64.as_deref())
                    .bind(orientation.as_deref())
                    .bind(id)
                    .execute(pool)
                    .await?;
                updated += 1;
            } else {
                skipped += 1;
            }
        } else {
            skipped += 1;
        }
    }

    Ok((updated, skipped, missing_series_count, 0))
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
    pub renamed_videos_count: i64,
    pub poster_updated: bool,
}

/// 检测单个视频集的更新：新增分集 + 丢失分集（仅检测，不修改数据库）
pub async fn check_series_updates(pool: &SqlitePool, series_id: i64) -> Result<SeriesUpdateResult> {
    let row = sqlx::query_as::<_, (i64, String, Option<String>, Option<String>, Option<String>)>(
        "SELECT id, title, folder_path, display_type, code FROM video_series WHERE id = ?",
    )
    .bind(series_id)
    .fetch_optional(pool)
    .await?;

    let (_id, title, folder_path, display_type, code) = match row {
        Some(r) => r,
        None => return Ok(SeriesUpdateResult { new_videos: vec![], missing_videos: vec![], renamed_videos_count: 0, poster_updated: false }),
    };

    let folder_path_buf = resolve_series_folder(
        pool,
        folder_path.as_deref(),
        &title,
        display_type.as_deref(),
        code.as_deref(),
    )
    .await?;
    let source = folder_path_buf
        .as_deref()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| folder_path.clone().unwrap_or_else(|| title.clone()));
    let folder_path_std = Path::new(&source);

    // 检查更新也负责修复缺失的视频集海报：仅当当前视频集海报为空时，
    // 从本地视频集文件夹重新匹配海报；找不到时不覆盖旧值。
    let series_poster_missing = sqlx::query_as::<_, (Option<String>, Option<String>)>(
        "SELECT poster, poster_base64 FROM video_series WHERE id = ?",
    )
    .bind(series_id)
    .fetch_one(pool)
    .await
    .map(|(poster, poster_base64)| {
        poster.as_deref().unwrap_or_default().trim().is_empty()
            || poster_base64.as_deref().unwrap_or_default().trim().is_empty()
    })
    .unwrap_or(false);

    let mut poster_updated = false;
    if series_poster_missing && folder_path_std.is_dir() {
        if let Some(series_poster) = crate::scanner::find_folder_poster(folder_path_std) {
            let series_poster_base64 =
                crate::scanner::generate_thumbnail_base64(std::path::Path::new(&series_poster));
            update_video_series_poster(
                pool,
                series_id,
                Some(&series_poster),
                series_poster_base64.as_deref(),
                Some("landscape"),
            )
            .await?;
            poster_updated = true;
        }
    }

    // 获取数据库中现有的视频
    let existing_videos = get_series_videos(pool, series_id).await?;
    let mut existing_paths: std::collections::HashSet<String> = existing_videos
        .iter()
        .map(|v| v.file_path.clone())
        .collect();

    // 检测丢失的视频（数据库中有记录但文件不存在）
    let mut missing_videos: Vec<Video> = existing_videos
        .iter()
        .filter(|v| !std::path::Path::new(&v.file_path).is_file())
        .cloned()
        .collect();

    // 扫描文件夹获取当前视频。检查更新只做资源差异检测；但字幕文件名升级
    // （JUR-472 → JUR-472-C / JUR-472-AI → JUR-472-AI-C）按同一视频处理并更新路径，避免误报新增+丢失。
    let (new_videos, renamed_videos_count) = if folder_path_std.is_dir() {
        let mut scanned_new: Vec<Video> = crate::scanner::scan_directory_video_index(&source)
            .await?
            .into_iter()
            .filter(|v| !existing_paths.contains(&v.file_path))
            .collect();

        let mut missing_by_identity: std::collections::HashMap<String, Video> = missing_videos
            .iter()
            .filter_map(|v| crate::scanner::adult_rename_identity(&v.file_name).map(|key| (key, v.clone())))
            .collect();

        let mut remaining_new = Vec::new();
        let mut renamed_videos_count: i64 = 0;
        let mut renamed_old_paths = std::collections::HashSet::new();
        for scanned in scanned_new.drain(..) {
            let identity = crate::scanner::adult_rename_identity(&scanned.file_name);
            if let Some(existing) = identity.and_then(|key| missing_by_identity.remove(&key)) {
                let thumbnail_base64 = scanned
                    .thumbnail
                    .as_deref()
                    .and_then(|p| crate::scanner::generate_thumbnail_base64(std::path::Path::new(p)));
                let poster_orientation = scanned
                    .thumbnail
                    .as_deref()
                    .and_then(|p| crate::scanner::get_image_orientation(std::path::Path::new(p)));
                sqlx::query(
                    r#"
                    UPDATE videos
                    SET file_path = ?, file_name = ?, episode_number = ?, file_size = ?, season = ?, subtitle = ?,
                        thumbnail = COALESCE(?, thumbnail), thumbnail_base64 = COALESCE(?, thumbnail_base64),
                        poster_orientation = COALESCE(?, poster_orientation), updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    "#,
                )
                .bind(&scanned.file_path)
                .bind(&scanned.file_name)
                .bind(scanned.episode_number)
                .bind(scanned.file_size)
                .bind(scanned.season)
                .bind(&scanned.subtitle)
                .bind(&scanned.thumbnail)
                .bind(thumbnail_base64.as_deref())
                .bind(poster_orientation.as_deref())
                .bind(existing.id)
                .execute(pool)
                .await?;

                if crate::scanner::parse_adult_filename(&scanned.file_name)
                    .map(|info| info.has_chinese_sub)
                    .unwrap_or(false)
                {
                    let _ = sqlx::query("UPDATE video_series SET has_chinese_sub = 1 WHERE id = ?")
                        .bind(series_id)
                        .execute(pool)
                        .await;
                }

                renamed_videos_count += 1;
                renamed_old_paths.insert(existing.file_path);
                existing_paths.insert(scanned.file_path.clone());
            } else {
                remaining_new.push(scanned);
            }
        }

        missing_videos.retain(|v| !renamed_old_paths.contains(&v.file_path));
        (remaining_new, renamed_videos_count)
    } else {
        (vec![], 0)
    };

    Ok(SeriesUpdateResult { new_videos, missing_videos, renamed_videos_count, poster_updated })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeriesUpdateSummary {
    pub series_id: i64,
    pub series_title: String,
    pub new_videos: Vec<Video>,
    pub missing_videos: Vec<Video>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeriesInfo {
    pub id: Option<i64>,
    pub name: String,
    pub video_count: usize,
    pub folder_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryUpdateResult {
    pub new_series: Vec<SeriesInfo>,               // 新发现的文件夹名+视频数
    pub missing_series: Vec<SeriesInfo>,           // 数据库中已丢失的视频集标题+分集数
    pub series_updates: Vec<SeriesUpdateSummary>,  // 每个视频集的新增/丢失分集
    pub renamed_series: Vec<(i64, String, String, String)>,  // (id, old_title, new_title, new_path)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PosterRepairResult {
    pub scanned_series: i64,
    pub updated_series: i64,
    pub scanned_videos: i64,
    pub updated_videos: i64,
    pub skipped: i64,
}

pub async fn repair_missing_posters_with_progress<F>(
    pool: &SqlitePool,
    mut progress: F,
) -> Result<PosterRepairResult>
where
    F: FnMut(&PosterRepairResult) + Send,
{
    let mut result = PosterRepairResult {
        scanned_series: 0,
        updated_series: 0,
        scanned_videos: 0,
        updated_videos: 0,
        skipped: 0,
    };

    let series_rows = sqlx::query("SELECT id, title, folder_path, display_type, code, poster, poster_base64 FROM video_series ORDER BY id")
        .fetch_all(pool)
        .await?;

    for row in series_rows {
        result.scanned_series += 1;
        progress(&result);
        let id: i64 = row.get("id");
        let title: String = row.try_get("title").unwrap_or_default();
        let folder_path: Option<String> = row.try_get("folder_path").ok().flatten();
        let display_type: Option<String> = row.try_get("display_type").ok().flatten();
        let code: Option<String> = row.try_get("code").ok().flatten();
        let poster: Option<String> = row.try_get("poster").ok().flatten();
        let poster_base64: Option<String> = row.try_get("poster_base64").ok().flatten();
        let poster_missing = poster.as_deref().unwrap_or_default().trim().is_empty();
        let base64_missing = poster_base64.as_deref().unwrap_or_default().trim().is_empty();

        let folder = match resolve_series_folder(pool, folder_path.as_deref(), &title, display_type.as_deref(), code.as_deref()).await? {
            Some(path) => path,
            None => {
                result.skipped += 1;
                progress(&result);
                continue;
            }
        };

        let wrong_parent_poster = poster
            .as_deref()
            .map(|poster_path| {
                let poster_path = Path::new(poster_path);
                !poster_path.starts_with(&folder)
                    && poster_path
                        .parent()
                        .map(|poster_parent| folder.starts_with(poster_parent))
                        .unwrap_or(false)
            })
            .unwrap_or(false);

        let candidate = crate::scanner::find_folder_poster(&folder);
        let candidate_changed = candidate
            .as_deref()
            .map(|candidate_path| !same_stored_path(poster.as_deref(), candidate_path))
            .unwrap_or(false);

        if !poster_missing && !base64_missing && !wrong_parent_poster && !candidate_changed {
            continue;
        }

        if let Some(poster_path) = candidate.or_else(|| poster.clone()) {
            let resolved = storage::resolve_data_path(&poster_path);
            let base64 = if poster_missing || base64_missing || wrong_parent_poster || candidate_changed {
                crate::scanner::generate_thumbnail_base64(Path::new(&resolved))
            } else {
                poster_base64.clone()
            };
            let orientation = crate::scanner::get_image_orientation(Path::new(&resolved));
            sqlx::query("UPDATE video_series SET poster = ?, poster_base64 = COALESCE(?, poster_base64), poster_orientation = COALESCE(?, poster_orientation), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
                .bind(poster_path.as_str())
                .bind(base64.as_deref())
                .bind(orientation.as_deref())
                .bind(id)
                .execute(pool)
                .await?;
            result.updated_series += 1;
            progress(&result);
        } else if wrong_parent_poster {
            sqlx::query("UPDATE video_series SET poster = NULL, poster_base64 = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
                .bind(id)
                .execute(pool)
                .await?;
            result.updated_series += 1;
            progress(&result);
        } else {
            result.skipped += 1;
            progress(&result);
        }
    }

    let video_rows = sqlx::query("SELECT id, file_path, thumbnail, thumbnail_base64 FROM videos ORDER BY id")
        .fetch_all(pool)
        .await?;

    for row in video_rows {
        result.scanned_videos += 1;
        progress(&result);
        let id: i64 = row.get("id");
        let file_path: String = row.get("file_path");
        let thumbnail: Option<String> = row.try_get("thumbnail").ok().flatten();
        let thumbnail_base64: Option<String> = row.try_get("thumbnail_base64").ok().flatten();
        let thumbnail_missing = thumbnail.as_deref().unwrap_or_default().trim().is_empty();
        let base64_missing = thumbnail_base64.as_deref().unwrap_or_default().trim().is_empty();

        if !thumbnail_missing && !base64_missing {
            continue;
        }

        let video_path = Path::new(&file_path);
        let parent = match video_path.parent() {
            Some(parent) if parent.is_dir() => parent,
            _ => {
                result.skipped += 1;
                continue;
            }
        };

        let image_files: Vec<std::path::PathBuf> = std::fs::read_dir(parent)
            .map(|entries| {
                entries
                    .filter_map(|entry| entry.ok())
                    .map(|entry| entry.path())
                    .filter(|path| path.is_file())
                    .filter(|path| {
                        path.extension()
                            .and_then(|ext| ext.to_str())
                            .map(|ext| crate::scanner::IMAGE_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
                            .unwrap_or(false)
                    })
                    .collect()
            })
            .unwrap_or_default();

        let candidate = if thumbnail_missing {
            crate::scanner::find_poster_for_video(video_path, &image_files)
                .or_else(|| crate::scanner::find_folder_poster(parent))
        } else {
            thumbnail.clone()
        };

        if let Some(thumbnail_path) = candidate {
            let resolved = storage::resolve_data_path(&thumbnail_path);
            let base64 = if base64_missing {
                crate::scanner::generate_thumbnail_base64(Path::new(&resolved))
            } else {
                thumbnail_base64.clone()
            };
            let orientation = crate::scanner::get_image_orientation(Path::new(&resolved));
            sqlx::query("UPDATE videos SET thumbnail = COALESCE(?, thumbnail), thumbnail_base64 = COALESCE(?, thumbnail_base64), poster_orientation = COALESCE(?, poster_orientation) WHERE id = ?")
                .bind(if thumbnail_missing { Some(thumbnail_path.as_str()) } else { None })
                .bind(base64.as_deref())
                .bind(orientation.as_deref())
                .bind(id)
                .execute(pool)
                .await?;
            result.updated_videos += 1;
            progress(&result);
        } else {
            result.skipped += 1;
            progress(&result);
        }
    }

    Ok(result)
}

/// 检测整个分类的更新：新增视频集 + 丢失视频集 + 每个视频集的新增/丢失分集
pub async fn check_category_updates(pool: &SqlitePool, category_key: &str) -> Result<CategoryUpdateResult> {
    // 获取分类下的所有视频集（空字符串 display_type 归入默认分类）
    let series_list = sqlx::query_as::<_, (i64, String, Option<String>, Option<String>, Option<String>)>(&format!(
        "SELECT id, title, folder_path, display_type, code FROM video_series WHERE display_type = '{}' OR display_type = '' OR (display_type IS NULL AND '{}' = 'anime')",
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
    let mut existing_codes: std::collections::HashSet<String> = std::collections::HashSet::new();

    // 全库去重集合：只排除当前分类下的视频集，其他分类的视频集应该可以被归入当前分类
    // 建立名称到 display_type 的映射，用于判断是否属于当前分类
    let all_series_with_type = sqlx::query_as::<_, (String, Option<String>, Option<String>, Option<String>)>(
        "SELECT title, folder_path, code, display_type FROM video_series"
    )
    .fetch_all(pool)
    .await?;
    // 只有当前分类的视频集才加入 existing_base_names 做去重
    // 其他分类的视频集不加入，这样 collect_new 就能把它们识别为"新视频集"并归入当前分类
    let mut current_category_names: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (title, folder_path, code, display_type) in &all_series_with_type {
        let is_current = display_type.as_deref() == Some(category_key)
            || display_type.as_deref().map(|d| d.is_empty()).unwrap_or(false)
            || (display_type.is_none() && category_key == "anime");
        if is_current {
            existing_base_names.insert(title.clone());
            current_category_names.insert(title.clone());
            if let Some(path) = folder_path.as_deref().filter(|path| !path.trim().is_empty()) {
                existing_folder_paths.insert(path.to_string());
                let folder_name = std::path::Path::new(path)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| title.clone());
                existing_base_names.insert(folder_name.clone());
                current_category_names.insert(folder_name.clone());
                existing_base_names.insert(crate::scanner::strip_episode_suffix(&folder_name));
                current_category_names.insert(crate::scanner::strip_episode_suffix(&folder_name));
            }
        } else {
            // 其他分类的视频集：路径加入 existing_folder_paths 防止重复扫描，但名称不加入 existing_base_names
            if let Some(path) = folder_path.as_deref().filter(|path| !path.trim().is_empty()) {
                existing_folder_paths.insert(path.to_string());
            }
        }
        if let Some(code) = code.as_deref().filter(|code| !code.trim().is_empty()) {
            existing_codes.insert(code.to_uppercase());
        }
    }
    // 构建 base_name → (id, title, folder_path) 映射，用于检测文件夹改名
    let mut base_to_series: std::collections::HashMap<String, (i64, String, String)> = std::collections::HashMap::new();
    for (id, title, folder_path, _display_type, _code) in &series_list {
        let base = crate::scanner::strip_episode_suffix(title);
        base_to_series.entry(base).or_insert((*id, title.clone(), folder_path.clone().unwrap_or_default()));
        if let Some(ref fp) = folder_path {
            let folder_name = std::path::Path::new(fp)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| title.clone());
            let folder_base = crate::scanner::strip_episode_suffix(&folder_name);
            base_to_series.entry(folder_base).or_insert((*id, title.clone(), fp.clone()));
        }
    }
    let renamed_series: std::sync::Mutex<Vec<(i64, String, String, String)>> = std::sync::Mutex::new(Vec::new());

    eprintln!("[check_updates] category={} existing_base_names={:?} current_category_names={:?} existing_folder_paths_count={} base_to_series_count={}",
        category_key, existing_base_names, current_category_names, existing_folder_paths.len(), base_to_series.len());

    for (id, title, folder_path, display_type, code) in &series_list {
        let resolved_folder = resolve_series_folder(
            pool,
            folder_path.as_deref(),
            title,
            display_type.as_deref().or(Some(category_key)),
            code.as_deref(),
        )
        .await?;
        let source = resolved_folder
            .as_deref()
            .map(|path| path.to_string_lossy().to_string())
            .or_else(|| folder_path.clone())
            .unwrap_or_else(|| title.clone());
        existing_folder_paths.insert(source.clone());
        if let Some(code) = code.as_deref().filter(|code| !code.trim().is_empty()) {
            existing_codes.insert(code.to_uppercase());
        }
        existing_base_names.insert(title.clone());
        // 提取文件夹名，去掉集数后缀，用于匹配
        let folder_name = std::path::Path::new(&source)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| title.clone());
        existing_base_names.insert(crate::scanner::strip_episode_suffix(&folder_name));

        let folder_path_std = Path::new(&source);

        // 检测视频集文件夹是否缺失
        let series_missing = !folder_path_std.is_dir();

        if series_missing {
            // 查询该视频集的分集数
            let video_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM videos WHERE series_id = ?")
                .bind(id).fetch_one(pool).await.unwrap_or(0);
            missing_series.push(SeriesInfo {
                id: Some(*id),
                name: title.clone(),
                video_count: video_count as usize,
                folder_path: folder_path.clone(),
            });
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

    let new_series = if let Some(ref category) = category {
        if let Some(ref scan_path) = category.scan_path {
            let path = std::path::Path::new(scan_path);
            if path.is_dir() {
                let mut new_folders: Vec<(String, usize, String)> = Vec::new();

                // 分类配置决定检查更新时如何理解目录结构：
                //   actors=true  → 匹配演员目录，演员目录下继续识别时期
                //   tags=true    → 匹配标签目录
                //   两者都关闭 → 分类目录下一层直接作为视频集候选
                let features: serde_json::Value = serde_json::from_str(&category.features).unwrap_or_default();
                let actors_enabled = features.get("actors").and_then(|v| v.as_bool()).unwrap_or(false);
                let tags_enabled = features.get("tags").and_then(|v| v.as_bool()).unwrap_or(false);

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
                let all_actor_period_names: std::collections::HashSet<String> =
                    sqlx::query_scalar::<_, String>("SELECT name FROM actor_periods")
                        .fetch_all(pool).await.unwrap_or_default().into_iter().collect();

                // 收集目录下不在 existing_base_names 中的子文件夹名
                // 路径规范化：统一斜杠方向和大小写
                let normalize = |s: &str| -> String {
                    s.replace("\\", "/").to_lowercase()
                };
                let normalized_db_paths: std::collections::HashSet<String> =
                    existing_folder_paths.iter().map(|p| normalize(p)).collect();

                let mut collect_new = |parent: &std::path::Path| -> Vec<(String, usize, String)> {
                    let mut result = Vec::new();
                    if let Ok(entries) = std::fs::read_dir(parent) {
                        for entry in entries.filter_map(|e| e.ok()) {
                            let p = entry.path();
                            if !p.is_dir() { continue; }
                            let fps = p.to_string_lossy().to_string();
                            // 1) 规范化路径比较
                            if normalized_db_paths.contains(&normalize(&fps)) {
                                eprintln!("[check_updates] 跳过(路径已存在): {}", fps);
                                continue;
                            }
                            let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                            // 2) 文件夹名/车牌直接匹配；时期文件夹本身不是视频集
                            let parsed_code = crate::scanner::parse_adult_filename(&name).map(|info| info.code);
                            if existing_base_names.contains(&name) {
                                eprintln!("[check_updates] 跳过(名称已存在): {} existing_base_names包含={}", name, existing_base_names.contains(&name));
                                continue;
                            }
                            if all_actor_period_names.contains(&name)
                                || parsed_code.as_deref().map(|code| existing_codes.contains(code)).unwrap_or(false) { continue; }
                            // 3) 去掉集数后缀再匹配
                            let base = crate::scanner::strip_episode_suffix(&name);
                            if existing_base_names.contains(&base) {
                                // 基名匹配但名称不同 → 检测为改名
                                if let Some((sid, old_title, _old_path)) = base_to_series.get(&base) {
                                    if *old_title != name {
                                        eprintln!("[check_updates] 检测到改名: {} -> {}", old_title, name);
                                        renamed_series.lock().unwrap().push((*sid, old_title.clone(), name.clone(), fps.clone()));
                                    }
                                }
                                eprintln!("[check_updates] 跳过(base名称已存在): name={} base={}", name, base);
                                continue;
                            }
                            // 原来的 if !existing_base_names.contains(&base) 分支继续
                            {
                                // 统计视频文件数；空视频集文件夹也保留为 0
                                let count = std::fs::read_dir(&p)
                                    .map(|entries| entries.filter_map(|e| e.ok())
                                        .filter(|e| e.path().is_file() && crate::scanner::is_video_file(&e.path()))
                                        .count())
                                    .unwrap_or(0);
                                result.push((name, count, fps));
                            }
                        }
                    }
                    result
                };

                async fn actor_period_names_for(
                    pool: &SqlitePool,
                    name: &str,
                ) -> std::collections::HashSet<String> {
                    let aid = sqlx::query_scalar::<_, i64>(
                        "SELECT id FROM actors WHERE name = ? OR COALESCE(label, name) = ?")
                        .bind(name).bind(name).fetch_one(pool).await.unwrap_or(0);
                    if aid == 0 {
                        return std::collections::HashSet::new();
                    }
                    sqlx::query_scalar::<_, String>(
                        "SELECT name FROM actor_periods WHERE actor_id = ?")
                        .bind(aid).fetch_all(pool).await.unwrap_or_default().into_iter().collect()
                }

                async fn collect_from_actor_folder<F>(
                    pool: &SqlitePool,
                    actor_path: &std::path::Path,
                    collect_new: &mut F,
                ) -> Vec<(String, usize, String)>
                where
                    F: FnMut(&std::path::Path) -> Vec<(String, usize, String)> + ?Sized,
                {
                    let name = actor_path.file_name()
                        .map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                    let actor_periods = actor_period_names_for(pool, &name).await;
                    if actor_periods.is_empty() {
                        return collect_new(actor_path);
                    }

                    let mut found_period = false;
                    let mut result = Vec::new();
                    if let Ok(entries) = std::fs::read_dir(actor_path) {
                        for entry in entries.filter_map(|e| e.ok()) {
                            let p = entry.path();
                            if !p.is_dir() { continue; }
                            let sub_name = p.file_name()
                                .map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                            if actor_periods.contains(&sub_name) {
                                found_period = true;
                                result.extend(collect_new(&p));
                            }
                        }
                    }
                    if found_period {
                        result
                    } else {
                        collect_new(actor_path)
                    }
                }

                async fn collect_by_category_features<F>(
                    pool: &SqlitePool,
                    parent: &std::path::Path,
                    actors_enabled: bool,
                    tags_enabled: bool,
                    actor_names: &std::collections::HashSet<String>,
                    actor_labels: &std::collections::HashSet<String>,
                    tag_names: &std::collections::HashSet<String>,
                    collect_new: &mut F,
                ) -> Vec<(String, usize, String)>
                where
                    F: FnMut(&std::path::Path) -> Vec<(String, usize, String)> + ?Sized,
                {
                    if !actors_enabled && !tags_enabled {
                        // 分类没开演员/标签：下一层就是视频集；车牌/中字格式由 scan_category 新增时解析
                        return collect_new(parent);
                    }

                    let mut result = Vec::new();
                    if let Ok(entries) = std::fs::read_dir(parent) {
                        for entry in entries.filter_map(|e| e.ok()) {
                            let p = entry.path();
                            if !p.is_dir() { continue; }
                            let name = p.file_name()
                                .map(|n| n.to_string_lossy().to_string()).unwrap_or_default();

                            if actors_enabled && (actor_names.contains(&name) || actor_labels.contains(&name)) {
                                result.extend(collect_from_actor_folder(pool, &p, collect_new).await);
                                continue;
                            }

                            if tags_enabled && tag_names.contains(&name) {
                                result.extend(collect_new(&p));
                                continue;
                            }

                            // 匹配不上标签/演员的文件夹，也尝试当视频集扫描
                            result.extend(collect_new(&p));
                        }
                    }
                    result
                }

                let scan_path_has_subdirs = std::fs::read_dir(path)
                    .map(|entries| entries.filter_map(|e| e.ok()).any(|e| e.path().is_dir()))
                    .unwrap_or(false);
                if !scan_path_has_subdirs && !normalized_db_paths.contains(&normalize(scan_path)) {
                    let has_root_video = std::fs::read_dir(path)
                        .map(|entries| entries.filter_map(|e| e.ok()).any(|e| e.path().is_file() && crate::scanner::is_video_file(&e.path())))
                        .unwrap_or(false);
                    let has_root_poster = crate::scanner::find_folder_poster(path).is_some();
                    if has_root_video || has_root_poster {
                        let root_name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                        let root_base = crate::scanner::strip_episode_suffix(&root_name);
                        if !existing_base_names.contains(&root_name) && !existing_base_names.contains(&root_base) {
                            let count = std::fs::read_dir(path)
                                .map(|entries| entries.filter_map(|e| e.ok())
                                    .filter(|e| e.path().is_file() && crate::scanner::is_video_file(&e.path()))
                                    .count())
                                .unwrap_or(0);
                            new_folders.push((root_name, count, path.to_string_lossy().to_string()));
                        }
                    }
                }

                if let Ok(top_entries) = std::fs::read_dir(path) {
                    for entry in top_entries.filter_map(|e| e.ok()) {
                        let sub_path = entry.path();
                        if !sub_path.is_dir() { continue; }
                        let name = sub_path.file_name()
                            .map(|n| n.to_string_lossy().to_string()).unwrap_or_default();

                        if cat_names.contains(&name) || cat_keys.contains(&name) {
                            // scan_path 指向父级目录时，分类文件夹内继续按当前分类 features 识别
                            new_folders.extend(collect_by_category_features(
                                pool,
                                &sub_path,
                                actors_enabled,
                                tags_enabled,
                                &actor_names,
                                &actor_labels,
                                &tag_names,
                                &mut collect_new,
                            ).await);
                        } else if !actors_enabled && !tags_enabled {
                            // scan_path 本身就是分类目录，且分类未开演员/标签：顶层文件夹就是视频集
                            new_folders.extend(collect_new(path));
                            break;
                        } else if actors_enabled && (actor_names.contains(&name) || actor_labels.contains(&name)) {
                            // 匹配演员 → 进入演员目录；如有时期，进入时期目录找视频集
                            new_folders.extend(collect_from_actor_folder(pool, &sub_path, &mut collect_new).await);
                        } else if tags_enabled && tag_names.contains(&name) {
                            // 匹配标签 → 进入标签目录找视频集
                            new_folders.extend(collect_new(&sub_path));
                        } else if tags_enabled {
                            // 匹配不上标签 → 直接当视频集，需要去重检查
                            let fps = sub_path.to_string_lossy().to_string();
                            // 1) 路径已存在 → 跳过
                            let normalized_fps = fps.replace("\\", "/").to_lowercase();
                            if normalized_db_paths.contains(&normalized_fps) {
                                continue;
                            }
                            // 2) 名称已存在 → 跳过
                            if existing_base_names.contains(&name) {
                                continue;
                            }
                            // 3) 番号已存在 → 跳过
                            let parsed_code = crate::scanner::parse_adult_filename(&name).map(|info| info.code);
                            if parsed_code.as_deref().map(|code| existing_codes.contains(code)).unwrap_or(false) {
                                continue;
                            }
                            // 4) 去掉集数后缀再匹配
                            let base = crate::scanner::strip_episode_suffix(&name);
                            if existing_base_names.contains(&base) {
                                // 基名匹配但名称不同 → 检测为改名
                                if let Some((sid, old_title, _old_path)) = base_to_series.get(&base) {
                                    if *old_title != name {
                                        eprintln!("[check_updates] 检测到改名(非标签): {} -> {}", old_title, name);
                                        renamed_series.lock().unwrap().push((*sid, old_title.clone(), name.clone(), fps.clone()));
                                    }
                                }
                                continue;
                            }
                            // 通过所有去重检查，递归统计视频文件数
                            fn count_videos_recursive(dir: &std::path::Path) -> usize {
                                let mut count = 0;
                                if let Ok(entries) = std::fs::read_dir(dir) {
                                    for entry in entries.filter_map(|e| e.ok()) {
                                        let p = entry.path();
                                        if p.is_file() && crate::scanner::is_video_file(&p) {
                                            count += 1;
                                        } else if p.is_dir() {
                                            count += count_videos_recursive(&p);
                                        }
                                    }
                                }
                                count
                            }
                            let count = count_videos_recursive(&sub_path);
                            new_folders.push((name, count, fps));
                        }
                    }
                }
                new_folders.sort_by(|a, b| a.0.cmp(&b.0));
                new_folders.dedup_by(|a, b| a.0 == b.0);
                new_folders.into_iter().map(|(name, video_count, folder_path)| SeriesInfo { id: None, name, video_count, folder_path: Some(folder_path) }).collect()
            } else {
                vec![]
            }
        } else {
            vec![]
        }
    } else {
        vec![]
    };

    // 批量更新重命名的视频集，并从 missing_series 移除
    let renamed_series = renamed_series.into_inner().unwrap();
    let renamed_ids: std::collections::HashSet<i64> = renamed_series.iter().map(|(sid, _, _, _)| *sid).collect();
    missing_series.retain(|s| !s.id.map_or(false, |id| renamed_ids.contains(&id)));

    for (sid, old_title, new_title, new_path) in &renamed_series {
        eprintln!("[check_updates] 自动更新视频集: id={} {} → {}", sid, old_title, new_title);
        // 更新视频集名称和路径
        let _ = sqlx::query("UPDATE video_series SET title = ?, folder_path = ? WHERE id = ?")
            .bind(new_title)
            .bind(new_path)
            .bind(sid)
            .execute(&*pool).await;

        // 同时更新该视频集下所有视频的 file_path
        if let Ok(old_fp) = sqlx::query_scalar::<_, String>(
            "SELECT folder_path FROM video_series WHERE id = ?"
        ).bind(sid).fetch_one(&*pool).await {
            if let Some(old_dir_name) = std::path::Path::new(&old_fp).file_name() {
                if let Some(new_dir_name) = std::path::Path::new(new_path).file_name() {
                    let old_dir_str = old_dir_name.to_string_lossy().to_string();
                    let new_dir_str = new_dir_name.to_string_lossy().to_string();
                    if old_dir_str != new_dir_str {
                        let _ = sqlx::query(
                            "UPDATE video SET file_path = REPLACE(file_path, ?, ?) WHERE series_id = ?"
                        )
                        .bind(&old_dir_str)
                        .bind(&new_dir_str)
                        .bind(sid)
                        .execute(&*pool).await;
                    }
                }
            }
        }
    }

    Ok(CategoryUpdateResult {
        new_series,
        missing_series,
        series_updates,
        renamed_series,
    })
}