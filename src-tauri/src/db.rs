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
    pub duration: Option<f64>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub resolution: Option<String>,
    pub source_site: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub thumbnail: Option<String>,
    pub thumbnail_data_url: Option<String>,
    pub description: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoSeries {
    pub id: i64,
    pub title: String,
    pub description: Option<String>,
    pub poster: Option<String>,
    pub poster_data_url: Option<String>,
    pub folder_path: Option<String>,
    pub video_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

// 演员
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Actor {
    pub id: i64,
    pub name: String,
    pub photo: Option<String>,
    pub photo_data_url: Option<String>,
    pub bio: Option<String>,
    pub birthday: Option<String>,
    pub height: Option<String>,
    pub measurements: Option<String>,
    pub japanese_name: Option<String>,
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

// 资源演员关联
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceActor {
    pub resource_id: i64,
    pub actor_id: i64,
    pub role: Option<String>,
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

    migrations::run(&pool).await?;

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
        "INSERT OR IGNORE INTO videos (file_path, file_name, series_id, episode_number, file_size, duration, width, height, resolution, source_site, metadata, thumbnail, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&video.file_path)
    .bind(&video.file_name)
    .bind(video.series_id)
    .bind(video.episode_number)
    .bind(video.file_size)
    .bind(video.duration)
    .bind(video.width)
    .bind(video.height)
    .bind(&video.resolution)
    .bind(&video.source_site)
    .bind(&metadata_str)
    .bind(&video.thumbnail)
    .bind(&video.description)
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
    let thumbnail_data_url = resolved_thumbnail
        .as_ref()
        .and_then(|path| image_data_url(Path::new(path)));

    Video {
        id: row.get("id"),
        file_path: row.get("file_path"),
        file_name: row.get("file_name"),
        series_id: row.get("series_id"),
        episode_number: row.get("episode_number"),
        file_size: row.get("file_size"),
        duration: row.get("duration"),
        width: row.get("width"),
        height: row.get("height"),
        resolution: row.get("resolution"),
        source_site: row.get("source_site"),
        metadata: row
            .get::<Option<String>, _>("metadata")
            .and_then(|s| serde_json::from_str(&s).ok()),
        thumbnail: resolved_thumbnail,
        thumbnail_data_url,
        description: row.get("description"),
        created_at: row.get("created_at"),
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

pub async fn get_standalone_videos(pool: &SqlitePool) -> Result<Vec<Video>> {
    let rows = sqlx::query("SELECT * FROM videos WHERE series_id IS NULL ORDER BY created_at DESC")
        .fetch_all(pool)
        .await?;
    Ok(rows.iter().map(video_from_row).collect())
}

fn series_from_row(row: &SqliteRow) -> VideoSeries {
    let poster: Option<String> = row.get("poster");
    let resolved_poster = poster.map(|path| {
        storage::resolve_data_path(&path)
            .to_string_lossy()
            .to_string()
    });
    let poster_data_url = resolved_poster
        .as_ref()
        .and_then(|path| image_data_url(Path::new(path)));
    VideoSeries {
        id: row.get("id"),
        title: row.get("title"),
        description: row.get("description"),
        poster: resolved_poster,
        poster_data_url,
        folder_path: row.get("folder_path"),
        video_count: row.try_get("video_count").unwrap_or(0),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

pub async fn add_video_series(
    pool: &SqlitePool,
    title: &str,
    folder_path: Option<&str>,
    poster: Option<&str>,
) -> Result<VideoSeries> {
    sqlx::query("INSERT OR IGNORE INTO video_series (title, folder_path, poster) VALUES (?, ?, ?)")
        .bind(title)
        .bind(folder_path)
        .bind(poster)
        .execute(pool)
        .await?;
    if let Some(path) = folder_path {
        if let Some(series) = get_video_series_by_folder_path(pool, path).await? {
            return Ok(series);
        }
    }
    let row = sqlx::query(
        "SELECT video_series.*, 0 AS video_count FROM video_series WHERE id = last_insert_rowid()",
    )
    .fetch_one(pool)
    .await?;
    Ok(series_from_row(&row))
}

pub async fn get_video_series_by_folder_path(
    pool: &SqlitePool,
    folder_path: &str,
) -> Result<Option<VideoSeries>> {
    let row = sqlx::query("SELECT s.*, COUNT(v.id) AS video_count FROM video_series s LEFT JOIN videos v ON v.series_id = s.id WHERE s.folder_path = ? GROUP BY s.id")
        .bind(folder_path)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|row| series_from_row(&row)))
}

pub async fn get_video_series_list(pool: &SqlitePool) -> Result<Vec<VideoSeries>> {
    let rows = sqlx::query("SELECT s.*, COUNT(v.id) AS video_count FROM video_series s LEFT JOIN videos v ON v.series_id = s.id GROUP BY s.id ORDER BY s.updated_at DESC, s.created_at DESC")
        .fetch_all(pool)
        .await?;
    Ok(rows.iter().map(series_from_row).collect())
}

pub async fn get_video_series(pool: &SqlitePool, id: i64) -> Result<Option<VideoSeries>> {
    let row = sqlx::query("SELECT s.*, COUNT(v.id) AS video_count FROM video_series s LEFT JOIN videos v ON v.series_id = s.id WHERE s.id = ? GROUP BY s.id")
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

pub async fn update_video_series(
    pool: &SqlitePool,
    id: i64,
    title: String,
    description: Option<String>,
    poster: Option<String>,
) -> Result<VideoSeries> {
    sqlx::query("UPDATE video_series SET title = ?, description = ?, poster = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(title)
        .bind(description)
        .bind(poster)
        .bind(id)
        .execute(pool)
        .await?;
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
    } else {
        sqlx::query("UPDATE videos SET series_id = NULL, episode_number = NULL, updated_at = CURRENT_TIMESTAMP WHERE series_id = ?").bind(id).execute(pool).await?;
    }
    sqlx::query("DELETE FROM video_series WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
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
    let rows = sqlx::query("SELECT * FROM actors ORDER BY name")
        .fetch_all(pool)
        .await?;

    let actors = rows.iter().map(actor_from_row).collect();

    Ok(actors)
}

pub async fn get_actor(pool: &SqlitePool, id: i64) -> Result<Option<Actor>> {
    let row = sqlx::query("SELECT * FROM actors WHERE id = ?")
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
) -> Result<Actor> {
    let row = sqlx::query(
        "INSERT INTO actors (name, photo, bio, birthday, height, measurements, japanese_name) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *",
    )
    .bind(name)
    .bind(photo)
    .bind(bio)
    .bind(birthday)
    .bind(height)
    .bind(measurements)
    .bind(japanese_name)
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
) -> Result<Actor> {
    let row = sqlx::query(
        "UPDATE actors SET name = ?, photo = ?, bio = ?, birthday = ?, height = ?, measurements = ?, japanese_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING *",
    )
    .bind(name)
    .bind(photo)
    .bind(bio)
    .bind(birthday)
    .bind(height)
    .bind(measurements)
    .bind(japanese_name)
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
    let resolved_photo = photo.map(|path| {
        storage::resolve_data_path(&path)
            .to_string_lossy()
            .to_string()
    });
    let photo_data_url = resolved_photo
        .as_ref()
        .and_then(|path| image_data_url(Path::new(path)));

    Actor {
        id: row.get("id"),
        name: row.get("name"),
        photo: resolved_photo,
        photo_data_url,
        bio: row.get("bio"),
        birthday: row.get("birthday"),
        height: row.get("height"),
        measurements: row.get("measurements"),
        japanese_name: row.get("japanese_name"),
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
pub async fn add_resource_tag(pool: &SqlitePool, resource_id: i64, tag_id: i64) -> Result<()> {
    sqlx::query("INSERT OR IGNORE INTO resource_tags (resource_id, tag_id) VALUES (?, ?)")
        .bind(resource_id)
        .bind(tag_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn remove_resource_tag(pool: &SqlitePool, resource_id: i64, tag_id: i64) -> Result<()> {
    sqlx::query("DELETE FROM resource_tags WHERE resource_id = ? AND tag_id = ?")
        .bind(resource_id)
        .bind(tag_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_resource_tags(pool: &SqlitePool, resource_id: i64) -> Result<Vec<Tag>> {
    let rows = sqlx::query(
        "SELECT t.* FROM tags t JOIN resource_tags rt ON t.id = rt.tag_id WHERE rt.resource_id = ? ORDER BY t.name",
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
) -> Result<()> {
    sqlx::query(
        "INSERT OR IGNORE INTO resource_actors (resource_id, actor_id, role) VALUES (?, ?, ?)",
    )
    .bind(resource_id)
    .bind(actor_id)
    .bind(role)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn remove_resource_actor(
    pool: &SqlitePool,
    resource_id: i64,
    actor_id: i64,
) -> Result<()> {
    sqlx::query("DELETE FROM resource_actors WHERE resource_id = ? AND actor_id = ?")
        .bind(resource_id)
        .bind(actor_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_resource_actors(pool: &SqlitePool, resource_id: i64) -> Result<Vec<Actor>> {
    let rows = sqlx::query(
        "SELECT a.* FROM actors a JOIN resource_actors ra ON a.id = ra.actor_id WHERE ra.resource_id = ? ORDER BY a.name",
    )
    .bind(resource_id)
    .fetch_all(pool)
    .await?;

    let actors = rows.iter().map(actor_from_row).collect();

    Ok(actors)
}

pub async fn get_actor_resources(pool: &SqlitePool, actor_id: i64) -> Result<Vec<Resource>> {
    let rows = sqlx::query(
        "SELECT r.* FROM resources r JOIN resource_actors ra ON r.id = ra.resource_id WHERE ra.actor_id = ? ORDER BY r.created_at DESC",
    )
    .bind(actor_id)
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
            info: row
                .get::<Option<String>, _>("info")
                .and_then(|s| serde_json::from_str(&s).ok()),
            created_at: row.get("created_at"),
        })
        .collect();

    Ok(resources)
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
