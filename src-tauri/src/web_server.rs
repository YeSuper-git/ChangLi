use axum::{
    extract::{Path, State as AxumState},
    http::{HeaderValue, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::get,
    Router,
};
use base64::Engine;
use sqlx::sqlite::SqlitePool;
use sqlx::Row;
use std::sync::Arc;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex;

use crate::storage;

// Shared state for the web server
pub struct WebAppState {
    pub db: Arc<Mutex<Option<SqlitePool>>>,
}

// MIME type helper
fn guess_mime(path: &str) -> &str {
    if path.ends_with(".mp4") || path.ends_with(".m4v") {
        "video/mp4"
    } else if path.ends_with(".mkv") || path.ends_with(".webm") {
        "video/webm"
    } else if path.ends_with(".avi") {
        "video/x-msvideo"
    } else if path.ends_with(".mov") {
        "video/quicktime"
    } else if path.ends_with(".ts") {
        "video/mp2t"
    } else {
        "application/octet-stream"
    }
}

// Default poster SVG (a simple film icon) - using String to avoid concat! issues with #
fn default_poster_svg() -> String {
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"280\" viewBox=\"0 0 200 280\">\
     <rect width=\"200\" height=\"280\" fill=\"#1a1a2e\" rx=\"8\"/>\
     <rect x=\"20\" y=\"20\" width=\"160\" height=\"240\" fill=\"#16213e\" rx=\"4\"/>\
     <circle cx=\"100\" cy=\"140\" r=\"40\" fill=\"none\" stroke=\"#e94560\" stroke-width=\"3\"/>\
     <polygon points=\"90,120 90,160 120,140\" fill=\"#e94560\"/>\
     <text x=\"100\" y=\"200\" text-anchor=\"middle\" fill=\"#e94560\" font-size=\"14\" font-family=\"sans-serif\">ChangLi</text>\
     </svg>".to_string()
}

// --- API Handlers ---

/// GET /api/series - List all video series
async fn api_series_list(
    AxumState(state): AxumState<Arc<WebAppState>>,
) -> Result<axum::Json<serde_json::Value>, StatusCode> {
    let pool = {
        let guard = state.db.lock().await;
        guard
            .as_ref()
            .ok_or(StatusCode::SERVICE_UNAVAILABLE)?
            .clone()
    };

    let rows = sqlx::query(
        r#"SELECT s.id, s.title, s.description, s.status, s.created_at, s.updated_at,
                  s.is_favorite, s.is_watched, s.display_type, s.code,
                  COUNT(v.id) AS video_count
           FROM video_series s
           LEFT JOIN videos v ON v.series_id = s.id
           GROUP BY s.id
           ORDER BY s.created_at DESC, s.id DESC"#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let series: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            let id: i64 = row.get("id");
            serde_json::json!({
                "id": id,
                "title": row.get::<String, _>("title"),
                "description": row.get::<Option<String>, _>("description"),
                "status": row.get::<Option<String>, _>("status"),
                "created_at": row.get::<String, _>("created_at"),
                "video_count": row.get::<i64, _>("video_count"),
                "display_type": row.get::<Option<String>, _>("display_type"),
                "code": row.get::<Option<String>, _>("code"),
            })
        })
        .collect();

    Ok(axum::Json(serde_json::json!({ "series": series })))
}

/// GET /api/series/:id - Series detail with video list
async fn api_series_detail(
    AxumState(state): AxumState<Arc<WebAppState>>,
    Path(id): Path<i64>,
) -> Result<axum::Json<serde_json::Value>, StatusCode> {
    let pool = {
        let guard = state.db.lock().await;
        guard
            .as_ref()
            .ok_or(StatusCode::SERVICE_UNAVAILABLE)?
            .clone()
    };

    // Get series info
    let series_row = sqlx::query(
        r#"SELECT s.id, s.title, s.description, s.status, s.created_at, s.updated_at,
                  s.is_favorite, s.is_watched, s.display_type, s.code,
                  COUNT(v.id) AS video_count
           FROM video_series s
           LEFT JOIN videos v ON v.series_id = s.id
           WHERE s.id = ?
           GROUP BY s.id"#,
    )
    .bind(id)
    .fetch_optional(&pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let row = series_row.ok_or(StatusCode::NOT_FOUND)?;

    // Get videos
    let video_rows = sqlx::query(
        r#"SELECT id, file_name, episode_number, season, file_size, duration,
                  width, height, resolution, created_at
           FROM videos
           WHERE series_id = ?
           ORDER BY episode_number IS NULL, episode_number, file_name"#,
    )
    .bind(id)
    .fetch_all(&pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let videos: Vec<serde_json::Value> = video_rows
        .iter()
        .map(|v| {
            serde_json::json!({
                "id": v.get::<i64, _>("id"),
                "file_name": v.get::<String, _>("file_name"),
                "episode_number": v.get::<Option<i32>, _>("episode_number"),
                "season": v.get::<Option<i32>, _>("season"),
                "file_size": v.get::<Option<i64>, _>("file_size"),
                "duration": v.get::<Option<f64>, _>("duration"),
                "resolution": v.get::<Option<String>, _>("resolution"),
            })
        })
        .collect();

    Ok(axum::Json(serde_json::json!({
        "series": {
            "id": row.get::<i64, _>("id"),
            "title": row.get::<String, _>("title"),
            "description": row.get::<Option<String>, _>("description"),
            "status": row.get::<Option<String>, _>("status"),
            "video_count": row.get::<i64, _>("video_count"),
        },
        "videos": videos
    })))
}

/// GET /api/poster/:id - Poster image (base64 decoded from DB)
async fn api_poster(
    AxumState(state): AxumState<Arc<WebAppState>>,
    Path(id): Path<i64>,
) -> Result<Response, StatusCode> {
    let pool = {
        let guard = state.db.lock().await;
        guard
            .as_ref()
            .ok_or(StatusCode::SERVICE_UNAVAILABLE)?
            .clone()
    };

    let row = sqlx::query("SELECT poster_base64, poster FROM video_series WHERE id = ?")
        .bind(id)
        .fetch_optional(&pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let row = row.ok_or(StatusCode::NOT_FOUND)?;

    // Try poster_base64 first (data URL format: data:image/jpeg;base64,...)
    if let Some(data_url) = row
        .try_get::<Option<String>, _>("poster_base64")
        .ok()
        .flatten()
    {
        if !data_url.trim().is_empty() {
            // Parse data URL to extract the base64 data and mime type
            if let Some(comma_pos) = data_url.find(',') {
                let header = &data_url[..comma_pos];
                let b64_data = &data_url[comma_pos + 1..];

                let mime = if header.contains("image/png") {
                    "image/png"
                } else if header.contains("image/webp") {
                    "image/webp"
                } else {
                    "image/jpeg"
                };

                if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(b64_data) {
                    let mut headers = axum::http::HeaderMap::new();
                    headers.insert("content-type", HeaderValue::from_static(mime));
                    headers.insert(
                        "cache-control",
                        HeaderValue::from_static("public, max-age=86400"),
                    );
                    return Ok((headers, bytes).into_response());
                }
            }
        }
    }

    // Try reading from poster file path
    if let Some(poster_path) = row.try_get::<Option<String>, _>("poster").ok().flatten() {
        let resolved = storage::resolve_data_path(&poster_path);
        if resolved.exists() {
            if let Ok(bytes) = tokio::fs::read(&resolved).await {
                let mime = if resolved.to_string_lossy().ends_with(".png") {
                    "image/png"
                } else if resolved.to_string_lossy().ends_with(".webp") {
                    "image/webp"
                } else {
                    "image/jpeg"
                };
                let mut headers = axum::http::HeaderMap::new();
                headers.insert("content-type", HeaderValue::from_static(mime));
                headers.insert(
                    "cache-control",
                    HeaderValue::from_static("public, max-age=86400"),
                );
                return Ok((headers, bytes).into_response());
            }
        }
    }

    // Return default poster
    let svg = default_poster_svg();
    let mut headers = axum::http::HeaderMap::new();
    headers.insert("content-type", HeaderValue::from_static("image/svg+xml"));
    headers.insert(
        "cache-control",
        HeaderValue::from_static("public, max-age=86400"),
    );
    Ok((headers, svg.into_bytes()).into_response())
}

/// GET /api/stream/:id - Video stream with Range support
async fn api_stream(
    AxumState(state): AxumState<Arc<WebAppState>>,
    Path(id): Path<i64>,
    req: axum::http::Request<axum::body::Body>,
) -> Result<Response, StatusCode> {
    let pool = {
        let guard = state.db.lock().await;
        guard
            .as_ref()
            .ok_or(StatusCode::SERVICE_UNAVAILABLE)?
            .clone()
    };

    // Get video file path
    let row = sqlx::query("SELECT file_path FROM videos WHERE id = ?")
        .bind(id)
        .fetch_optional(&pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let row = row.ok_or(StatusCode::NOT_FOUND)?;
    let file_path: String = row.get("file_path");
    let path = std::path::PathBuf::from(&file_path);

    if !path.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    let file_size = std::fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mime = guess_mime(&file_path).to_string();

    // Check for Range header
    let range_header = req.headers().get("range").and_then(|v| v.to_str().ok());

    if let Some(range_str) = range_header {
        // Parse Range: bytes=start-end
        if let Some(range_val) = range_str.strip_prefix("bytes=") {
            let parts: Vec<&str> = range_val.split('-').collect();
            if parts.len() == 2 {
                let start: u64 = parts[0].parse().unwrap_or(0);
                let end: u64 = if parts[1].is_empty() {
                    file_size - 1
                } else {
                    parts[1].parse().unwrap_or(file_size - 1).min(file_size - 1)
                };

                let content_length = end - start + 1;

                // Stream the range using async_stream
                let stream = async_stream::stream! {
                    let mut file = match File::open(path).await {
                        Ok(f) => f,
                        Err(_) => return,
                    };
                    if file.seek(std::io::SeekFrom::Start(start)).await.is_err() {
                        return;
                    }
                    let mut remaining = content_length;
                    let mut buf = vec![0u8; 64 * 1024]; // 64KB chunks
                    while remaining > 0 {
                        let to_read = remaining.min(buf.len() as u64) as usize;
                        match file.read(&mut buf[..to_read]).await {
                            Ok(0) => break,
                            Ok(n) => {
                                remaining -= n as u64;
                                yield Ok::<_, std::convert::Infallible>(
                                    axum::body::Bytes::copy_from_slice(&buf[..n])
                                );
                            }
                            Err(_) => break,
                        }
                    }
                };

                let mut headers = axum::http::HeaderMap::new();
                headers.insert("content-type", HeaderValue::from_str(&mime).unwrap());
                headers.insert("accept-ranges", HeaderValue::from_static("bytes"));
                headers.insert(
                    "content-range",
                    HeaderValue::from_str(&format!("bytes {}-{}/{}", start, end, file_size))
                        .unwrap_or_else(|_| HeaderValue::from_static("bytes */*")),
                );
                headers.insert(
                    "content-length",
                    HeaderValue::from_str(&content_length.to_string()).unwrap(),
                );

                return Ok((
                    StatusCode::PARTIAL_CONTENT,
                    headers,
                    axum::body::Body::from_stream(stream),
                )
                    .into_response());
            }
        }
    }

    // No range request - return full file
    let stream = async_stream::stream! {
        let mut file = match File::open(path).await {
            Ok(f) => f,
            Err(_) => return,
        };
        let mut buf = vec![0u8; 64 * 1024]; // 64KB chunks
        loop {
            match file.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    yield Ok::<_, std::convert::Infallible>(
                        axum::body::Bytes::copy_from_slice(&buf[..n])
                    );
                }
                Err(_) => break,
            }
        }
    };

    let mut headers = axum::http::HeaderMap::new();
    headers.insert("content-type", HeaderValue::from_str(&mime).unwrap());
    headers.insert("accept-ranges", HeaderValue::from_static("bytes"));
    headers.insert(
        "content-length",
        HeaderValue::from_str(&file_size.to_string()).unwrap(),
    );

    Ok((
        StatusCode::OK,
        headers,
        axum::body::Body::from_stream(stream),
    )
        .into_response())
}

/// GET /api/categories - List all categories
async fn api_categories(
    AxumState(state): AxumState<Arc<WebAppState>>,
) -> Result<axum::Json<serde_json::Value>, StatusCode> {
    let pool = {
        let guard = state.db.lock().await;
        guard
            .as_ref()
            .ok_or(StatusCode::SERVICE_UNAVAILABLE)?
            .clone()
    };
    let rows =
        sqlx::query("SELECT id, key, name, card_layout FROM categories ORDER BY sort_order, id")
            .fetch_all(&pool)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let cats: Vec<serde_json::Value> = rows.iter().map(|row| {
        serde_json::json!({
            "id": row.get::<i64, _>("id"),
            "key": row.get::<String, _>("key"),
            "name": row.get::<String, _>("name"),
            "card_layout": row.get::<Option<String>, _>("card_layout").unwrap_or_else(|| "poster".to_string()),
        })
    }).collect();
    Ok(axum::Json(serde_json::json!({ "categories": cats })))
}

/// GET /api/actors - List all actors with series count
async fn api_actors(
    AxumState(state): AxumState<Arc<WebAppState>>,
) -> Result<axum::Json<serde_json::Value>, StatusCode> {
    let pool = {
        let guard = state.db.lock().await;
        guard
            .as_ref()
            .ok_or(StatusCode::SERVICE_UNAVAILABLE)?
            .clone()
    };
    let rows = sqlx::query(
        r#"SELECT a.id, a.name, a.avatar_base64, COUNT(sa.series_id) AS series_count
           FROM actors a
           LEFT JOIN series_actors sa ON sa.actor_id = a.id
           GROUP BY a.id
           HAVING series_count > 0
           ORDER BY series_count DESC, a.name"#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let actors: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            let id: i64 = row.get("id");
            let avatar: Option<String> = row.get("avatar_base64");
            serde_json::json!({
                "id": id,
                "name": row.get::<String, _>("name"),
                "avatar": avatar.unwrap_or_default(),
                "series_count": row.get::<i64, _>("series_count"),
            })
        })
        .collect();
    Ok(axum::Json(serde_json::json!({ "actors": actors })))
}

/// GET /api/actors/:id/series - Series by actor
async fn api_actor_series(
    AxumState(state): AxumState<Arc<WebAppState>>,
    Path(actor_id): Path<i64>,
) -> Result<axum::Json<serde_json::Value>, StatusCode> {
    let pool = {
        let guard = state.db.lock().await;
        guard
            .as_ref()
            .ok_or(StatusCode::SERVICE_UNAVAILABLE)?
            .clone()
    };
    let rows = sqlx::query(
        r#"SELECT s.id, s.title, s.description, s.status, s.display_type, s.code,
                  COUNT(v.id) AS video_count
           FROM video_series s
           JOIN series_actors sa ON sa.series_id = s.id
           LEFT JOIN videos v ON v.series_id = s.id
           WHERE sa.actor_id = ?
           GROUP BY s.id
           ORDER BY s.created_at DESC"#,
    )
    .bind(actor_id)
    .fetch_all(&pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let series: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "id": row.get::<i64, _>("id"),
                "title": row.get::<String, _>("title"),
                "description": row.get::<Option<String>, _>("description"),
                "status": row.get::<Option<String>, _>("status"),
                "display_type": row.get::<Option<String>, _>("display_type"),
                "video_count": row.get::<i64, _>("video_count"),
            })
        })
        .collect();
    Ok(axum::Json(serde_json::json!({ "series": series })))
}

/// GET /api/search?q=xxx - Search series by title
async fn api_search(
    AxumState(state): AxumState<Arc<WebAppState>>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<axum::Json<serde_json::Value>, StatusCode> {
    let q = params.get("q").cloned().unwrap_or_default();
    if q.is_empty() {
        return Ok(axum::Json(serde_json::json!({ "series": [] })));
    }
    let pool = {
        let guard = state.db.lock().await;
        guard
            .as_ref()
            .ok_or(StatusCode::SERVICE_UNAVAILABLE)?
            .clone()
    };
    let pattern = format!("%{}%", q);
    let rows = sqlx::query(
        r#"SELECT s.id, s.title, s.description, s.status, s.display_type, s.code,
                  COUNT(v.id) AS video_count
           FROM video_series s
           LEFT JOIN videos v ON v.series_id = s.id
           WHERE s.title LIKE ?
           GROUP BY s.id
           ORDER BY s.created_at DESC"#,
    )
    .bind(&pattern)
    .fetch_all(&pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let series: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "id": row.get::<i64, _>("id"),
                "title": row.get::<String, _>("title"),
                "description": row.get::<Option<String>, _>("description"),
                "status": row.get::<Option<String>, _>("status"),
                "display_type": row.get::<Option<String>, _>("display_type"),
                "video_count": row.get::<i64, _>("video_count"),
            })
        })
        .collect();
    Ok(axum::Json(serde_json::json!({ "series": series })))
}

/// GET / - Serve the web player HTML
async fn index_page() -> Html<&'static str> {
    Html(include_str!("../../src/web-player/index.html"))
}

/// Build the axum router
fn build_router(state: Arc<WebAppState>) -> Router {
    Router::new()
        .route("/", get(index_page))
        .route("/api/series", get(api_series_list))
        .route("/api/series/{id}", get(api_series_detail))
        .route("/api/poster/{id}", get(api_poster))
        .route("/api/stream/{id}", get(api_stream))
        .route("/api/categories", get(api_categories))
        .route("/api/actors", get(api_actors))
        .route("/api/actors/{id}/series", get(api_actor_series))
        .route("/api/search", get(api_search))
        .layer(
            tower_http::cors::CorsLayer::new()
                .allow_origin(tower_http::cors::Any)
                .allow_methods(tower_http::cors::Any)
                .allow_headers(tower_http::cors::Any),
        )
        .with_state(state)
}

/// Start the web server
pub async fn start_web_server(db: Arc<Mutex<Option<SqlitePool>>>) {
    let state = Arc::new(WebAppState { db });
    let app = build_router(state);

    let port: u16 = std::fs::read_to_string(
        dirs::config_dir()
            .unwrap_or_default()
            .join("changli")
            .join("web_port.txt"),
    )
    .ok()
    .and_then(|s| s.trim().parse().ok())
    .unwrap_or(9527);
    let addr = format!("0.0.0.0:{}", port);

    // Get local IP for display
    let local_ip = get_local_ip().unwrap_or_else(|| "127.0.0.1".to_string());

    match TcpListener::bind(&addr).await {
        Ok(listener) => {
            eprintln!(
                "[ChangLi Web] 🌐 局域网 Web 播放器已启动: http://{}:{}",
                local_ip, port
            );
            eprintln!(
                "[ChangLi Web] 📱 手机/平板浏览器访问: http://{}:{}",
                local_ip, port
            );

            if let Err(e) = axum::serve(listener, app).await {
                eprintln!("[ChangLi Web] ❌ Web 服务器错误: {}", e);
            }
        }
        Err(e) => {
            eprintln!(
                "[ChangLi Web] ❌ 启动 Web 服务器失败 (端口 {}): {}",
                port, e
            );
            eprintln!("[ChangLi Web] 💡 可能是端口被占用，请检查是否有其他程序占用 9527 端口");
        }
    }
}

/// Save web server settings
#[tauri::command]
pub fn save_web_server_settings(enabled: bool, port: u16) -> Result<(), String> {
    let config_dir = dirs::config_dir().unwrap_or_default().join("changli");
    std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    std::fs::write(
        config_dir.join("web_server_enabled"),
        if enabled { "true" } else { "false" },
    )
    .map_err(|e| e.to_string())?;
    std::fs::write(config_dir.join("web_port.txt"), port.to_string()).map_err(|e| e.to_string())?;
    Ok(())
}

/// Get web server info for settings page
#[tauri::command]
pub fn get_web_server_info() -> Result<serde_json::Value, String> {
    let local_ip = get_local_ip().unwrap_or_else(|| "127.0.0.1".to_string());
    let port = std::fs::read_to_string(
        dirs::config_dir()
            .unwrap_or_default()
            .join("changli")
            .join("web_port.txt"),
    )
    .ok()
    .and_then(|s| s.trim().parse().ok())
    .unwrap_or(9527u16);
    let enabled = std::fs::read_to_string(
        dirs::config_dir()
            .unwrap_or_default()
            .join("changli")
            .join("web_server_enabled"),
    )
    .ok()
    .and_then(|s| s.trim().parse::<bool>().ok())
    .unwrap_or(false);
    Ok(serde_json::json!({
        "enabled": enabled,
        "ip": local_ip,
        "port": port,
        "url": format!("http://{}:{}", local_ip, port),
    }))
}

/// Get the local network IP address
fn get_local_ip() -> Option<String> {
    use std::net::UdpSocket;
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let addr = socket.local_addr().ok()?;
    Some(addr.ip().to_string())
}
