// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod downloader;
mod keyword_extractor;
mod migrations;
mod parser;
mod player;
mod preview;
mod rss_parser;
mod scanner;
mod site_config;
mod storage;

use futures_util::StreamExt;
use image::ImageReader;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager, State};
use tokio::sync::Mutex;

#[derive(Clone, serde::Serialize)]
struct PosterRepairStatus {
    status: String,
    scanned_series: i64,
    updated_series: i64,
    scanned_videos: i64,
    updated_videos: i64,
    skipped: i64,
    error: Option<String>,
}

impl Default for PosterRepairStatus {
    fn default() -> Self {
        Self {
            status: "idle".to_string(),
            scanned_series: 0,
            updated_series: 0,
            scanned_videos: 0,
            updated_videos: 0,
            skipped: 0,
            error: None,
        }
    }
}

#[derive(Clone, serde::Serialize)]
struct InstalledPlayer {
    name: String,
    path: String,
}

// 应用状态
struct AppState {
    db: Mutex<Option<sqlx::SqlitePool>>,
    poster_repair_status: Arc<Mutex<PosterRepairStatus>>,
    update_download_cancel: Arc<AtomicBool>,
}

// 防止并发初始化的全局锁
static INIT_LOCK: Mutex<()> = Mutex::const_new(());

// 初始化数据库（如果已在 setup 中初始化则直接返回）
// === 订阅相关命令 ===

#[derive(serde::Serialize)]
struct DetectRssResult {
    rss_url: String,
    feed_season: Option<i32>,
}

#[tauri::command]
async fn detect_rss_url(url: String) -> Result<DetectRssResult, String> {
    let url = url.trim();
    
    // Mikanani: /Home/Bangumi/{id} → /RSS/Bangumi?bangumiId={id}
    // 同时获取页面标题提取季号
    if url.contains("mikanani") && url.contains("/Home/Bangumi/") {
        if let Some(id_pos) = url.rfind('/') {
            let bangumi_id = &url[id_pos + 1..];
            let bangumi_id = bangumi_id.split('?').next().unwrap_or(bangumi_id);
            let rss_url = format!("https://mikanani.kas.pub/RSS/Bangumi?bangumiId={}", bangumi_id);
            
            // 获取页面标题提取季号
            let feed_season = if let Ok(resp) = reqwest::get(url).await {
                if let Ok(html) = resp.text().await {
                    // 从 <title> 或 <h1> 提取季号
                    extract_season_from_html(&html)
                } else { None }
            } else { None };
            
            return Ok(DetectRssResult { rss_url, feed_season });
        }
    }
    
    // 已经是 RSS URL
    if url.contains("/RSS/") || url.contains("rss") {
        return Ok(DetectRssResult { rss_url: url.to_string(), feed_season: None });
    }
    
    // 尝试从页面提取 RSS 链接
    Err("无法识别 RSS 地址，请输入番组页面 URL 或 RSS URL".to_string())
}

/// 从 HTML 页面标题提取季号
fn extract_season_from_html(html: &str) -> Option<i32> {
    use regex::Regex;
    // 提取 <title>...</title> 或 <h1>...</h1>
    let title_patterns = [
        r"(?i)<title[^>]*>([^<]+)</title>",
        r"(?i)<h1[^>]*>([^<]+)</h1>",
    ];
    for pattern in &title_patterns {
        if let Ok(re) = Regex::new(pattern) {
            if let Some(caps) = re.captures(html) {
                if let Some(title_text) = caps.get(1) {
                    return extract_season_number(title_text.as_str());
                }
            }
        }
    }
    None
}

/// 获取 RSS 并解析
#[tauri::command]
async fn fetch_rss(url: String) -> Result<rss_parser::RssFeed, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
    
    let response = client
        .get(&url)
        .header(reqwest::header::USER_AGENT, "ChangLi/1.0")
        .send()
        .await
        .map_err(|e| format!("请求失败: {e}"))?;
    
    let xml = response.text().await.map_err(|e| format!("读取响应失败: {e}"))?;
    
    rss_parser::parse_mikanani_rss(&xml).map_err(|e| format!("解析 RSS 失败: {e}"))
}

/// 从 RSS 条目标题中提取关键词
#[tauri::command]
async fn extract_keywords_from_rss(url: String) -> Result<std::collections::HashMap<String, Vec<String>>, String> {
    let feed = fetch_rss(url).await?;
    let titles: Vec<String> = feed.items.iter().map(|i| i.title.clone()).collect();
    
    let keywords = keyword_extractor::extract_keywords(&titles);
    
    // 转换为 String key
    let result: std::collections::HashMap<String, Vec<String>> = keywords
        .into_iter()
        .map(|(cat, vals)| (cat.display_name().to_string(), vals))
        .collect();
    
    Ok(result)
}

/// 创建订阅
#[tauri::command]
async fn create_subscription(
    state: State<'_, AppState>,
    series_id: i64,
    site_id: Option<i64>,
    bangumi_url: String,
    rss_url: String,
    title: String,
    preferences: Option<String>,
    download_mode: Option<String>,
) -> Result<db::BangumiSubscription, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    
    let prefs = preferences.unwrap_or_else(|| "{}".to_string());
    let mode = download_mode.unwrap_or_else(|| "clipboard".to_string());
    
    sqlx::query(
        r#"INSERT INTO bangumi_subscriptions (series_id, site_id, bangumi_url, rss_url, title, preferences, download_mode)
           VALUES (?, ?, ?, ?, ?, ?, ?)"#
    )
    .bind(series_id)
    .bind(site_id)
    .bind(&bangumi_url)
    .bind(&rss_url)
    .bind(&title)
    .bind(&prefs)
    .bind(&mode)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;
    
    // 查询刚插入的记录
    let sub = sqlx::query_as::<_, db::BangumiSubscription>(
        "SELECT * FROM bangumi_subscriptions WHERE series_id = ? AND bangumi_url = ? ORDER BY id DESC LIMIT 1"
    )
    .bind(series_id)
    .bind(&bangumi_url)
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())?;
    
    Ok(sub)
}

/// 获取视频集的订阅
#[tauri::command]
async fn get_subscription_by_series(
    state: State<'_, AppState>,
    series_id: i64,
) -> Result<Option<db::BangumiSubscription>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    
    let sub = sqlx::query_as::<_, db::BangumiSubscription>(
        "SELECT * FROM bangumi_subscriptions WHERE series_id = ? AND enabled = 1 LIMIT 1"
    )
    .bind(series_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| e.to_string())?;
    
    Ok(sub)
}

/// 获取所有订阅
#[tauri::command]
async fn get_all_subscriptions(
    state: State<'_, AppState>,
) -> Result<Vec<db::BangumiSubscription>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    
    let subs = sqlx::query_as::<_, db::BangumiSubscription>(
        "SELECT s.*, vs.title as series_title FROM bangumi_subscriptions s LEFT JOIN video_series vs ON s.series_id = vs.id ORDER BY s.created_at DESC"
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    
    Ok(subs)
}

/// 删除订阅
#[tauri::command]
async fn delete_subscription(
    state: State<'_, AppState>,
    id: i64,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };

    sqlx::query("DELETE FROM bangumi_subscriptions WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// 更新订阅（series_id 和/或 preferences）
#[tauri::command]
async fn update_subscription_cmd(
    state: State<'_, AppState>,
    subscription_id: i64,
    series_id: Option<i64>,
    preferences: Option<String>,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::update_subscription(&pool, subscription_id, series_id, preferences)
        .await
        .map_err(|e| e.to_string())
}
/// 检查 selectedPrefixes 的一个 part 是否匹配标题中的对应关键词
/// 支持简中/繁中/简繁等语言变体、画质变体、来源变体、容器变体
fn prefix_part_matches_title(part: &str, title_lower: &str) -> bool {
    if title_lower.contains(part) { return true; }
    // 语言变体
    if part.contains("简中") {
        return title_lower.contains("简日内嵌") || title_lower.contains("简日内封")
            || title_lower.contains("简体内嵌") || title_lower.contains("简体内封")
            || title_lower.contains("简体") || title_lower.contains("chs")
            || title_lower.contains("[gb]");
    }
    if part.contains("繁中") {
        return title_lower.contains("繁日内嵌") || title_lower.contains("繁日内封")
            || title_lower.contains("繁体内嵌") || title_lower.contains("繁体内封")
            || title_lower.contains("繁体") || title_lower.contains("cht")
            || title_lower.contains("[big5]");
    }
    if part.contains("简繁") {
        return title_lower.contains("简繁") || title_lower.contains("简／繁")
            || title_lower.contains("简/繁") || title_lower.contains("简繁内封")
            || title_lower.contains("简繁内嵌");
    }
    // 画质变体
    if part.contains("1080p") || part.contains("1920x1080") {
        return title_lower.contains("1080p") || title_lower.contains("1920x1080");
    }
    if part.contains("4k") || part.contains("2160p") || part.contains("3840x2160") {
        return title_lower.contains("4k") || title_lower.contains("2160p") || title_lower.contains("3840x2160");
    }
    // 来源变体
    if part.contains("cr") {
        return title_lower.contains("cr ") || title_lower.contains("[cr]")
            || title_lower.contains("crwebrip") || title_lower.contains("cr webrip") || title_lower.contains("cr web");
    }
    if part.contains("abema") { return title_lower.contains("abema"); }
    if part.contains("baha") { return title_lower.contains("baha"); }
    // 容器变体
    if part.contains("mp4") { return title_lower.contains("[mp4]") || title_lower.contains(".mp4"); }
    if part.contains("mkv") { return title_lower.contains("[mkv]") || title_lower.contains(".mkv"); }
    false
}

fn infer_previous_seasons_episode_offset(
    existing_season_episode: &[(Option<i32>, Option<i32>)],
    target_season: i32,
) -> Option<i32> {
    if target_season <= 1 {
        return Some(0);
    }

    let mut offset = 0;
    for season in 1..target_season {
        let season_max = existing_season_episode
            .iter()
            .filter_map(|(s, ep)| match (s, ep) {
                (Some(existing_season), Some(existing_episode)) if *existing_season == season => Some(*existing_episode),
                _ => None,
            })
            .max();

        match season_max {
            Some(max_episode) if max_episode > 0 => offset += max_episode,
            _ => return None,
        }
    }

    Some(offset)
}

fn subscription_item_already_exists(
    existing_season_episode: &[(Option<i32>, Option<i32>)],
    existing_episodes: &[Option<i32>],
    item_season: Option<i32>,
    item_episode: i32,
    existing_episode_progress: i32,
) -> bool {
    if let Some(season) = item_season {
        // 直接季内集数匹配：第三季第 1 集 → (3, 1)
        if existing_season_episode.contains(&(Some(season), Some(item_episode))) {
            return true;
        }

        // 兼容已入库为全局集数/无季号的历史数据。
        if existing_season_episode.contains(&(Some(0), Some(item_episode)))
            || existing_season_episode.contains(&(None, Some(item_episode)))
        {
            return true;
        }

        // 有些源用全局集数：例如已有第一季 12 集、第二季 12 集，第三季第 1 集写成 25。
        // 不固定每季 12 集，而是根据本地已有前序季的最大集数动态推断 offset。
        if let Some(offset) = infer_previous_seasons_episode_offset(existing_season_episode, season) {
            if item_episode > offset {
                let normalized_episode = item_episode - offset;
                if existing_season_episode.contains(&(Some(season), Some(normalized_episode))) {
                    return true;
                }
            }
        }

        return false;
    }

    existing_episodes.contains(&Some(item_episode)) || item_episode <= existing_episode_progress
}

/// 手动触发订阅检查（获取新集数列表）
#[tauri::command]
async fn check_subscription_updates(
    state: State<'_, AppState>,
    subscription_id: i64,
) -> Result<Vec<db::SubscriptionDownload>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    
    // 获取订阅信息
    let sub = sqlx::query_as::<_, db::BangumiSubscription>(
        "SELECT * FROM bangumi_subscriptions WHERE id = ?"
    )
    .bind(subscription_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| format!("获取订阅失败: {e}"))?;
    
    // 获取 RSS
    let feed = fetch_rss(sub.rss_url.clone()).await?;
    
    // 解析用户选择的版本前缀
    let selected_prefixes: Vec<String> = if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&sub.preferences) {
        if let Some(arr) = parsed.get("selectedPrefixes").and_then(|v| v.as_array()) {
            arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };
    
    // 查询视频集已有的最大集数；如果历史视频没有 episode_number，用视频数量兜底
    let max_episode: Option<i32> = if let Some(series_id) = sub.series_id {
        sqlx::query_scalar::<_, Option<i32>>("SELECT MAX(episode_number) FROM videos WHERE series_id = ?")
            .bind(series_id)
            .fetch_one(&pool)
            .await
            .ok()
            .flatten()
    } else {
        None
    };
    let existing_video_count: i32 = if let Some(series_id) = sub.series_id {
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM videos WHERE series_id = ?")
            .bind(series_id)
            .fetch_one(&pool)
            .await
            .unwrap_or(0) as i32
    } else {
        0
    };
    let existing_episode_progress = std::cmp::max(max_episode.unwrap_or(0), existing_video_count);
    
    // 查询视频集中已有的 (season, episode_number) 组合
    let existing_season_episode: Vec<(Option<i32>, Option<i32>)> = if let Some(series_id) = sub.series_id {
        sqlx::query_as::<_, (Option<i32>, Option<i32>)>("SELECT season, episode_number FROM videos WHERE series_id = ?")
            .bind(series_id)
            .fetch_all(&pool)
            .await
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    // 也保留纯集数列表用于无季号时的匹配
    let existing_episodes: Vec<Option<i32>> = existing_season_episode.iter().map(|(_, ep)| *ep).collect();

    // 从订阅 preferences 中读取 feedSeason；旧订阅缺失时，从 RSS 源标题实时提取
    let feed_season: Option<i32> = serde_json::from_str::<serde_json::Value>(&sub.preferences)
        .ok()
        .and_then(|v| v.get("feedSeason")?.as_i64())
        .map(|s| s as i32)
        .or_else(|| extract_season_number(&feed.title));

    let mut new_items = Vec::new();
    
    for item in &feed.items {
        // 如果用户选择了版本，用 selectedPrefixes 关键词匹配
        if !selected_prefixes.is_empty() {
            let title_lower = item.title.to_lowercase();
            let matched = selected_prefixes.iter().any(|prefix| {
                let prefix_lower = prefix.to_lowercase();
                let parts: Vec<&str> = prefix_lower.split(' ').collect();
                parts.iter().all(|part| prefix_part_matches_title(part, &title_lower))
            });
            if !matched { continue; }
        }
        
        let item_season = extract_season_number(&item.title).or(feed_season);
        let item_episode = extract_episode_number(&item.title);
        if let Some(ep) = item_episode {
            if subscription_item_already_exists(
                &existing_season_episode,
                &existing_episodes,
                item_season,
                ep,
                existing_episode_progress,
            ) {
                continue;
            }
        }
        
        // 提取磁力链接
        let mut magnet = item.magnet_link.clone();
        if magnet.is_none() {
            if let Some(ref hash) = item.info_hash {
                let hash = hash.trim();
                if hash.len() == 40 || hash.len() == 32 {
                    magnet = Some(format!("magnet:?xt=urn:btih:{hash}"));
                }
            }
        }
        if magnet.is_none() && !item.link.is_empty() {
            if let Ok(resp) = reqwest::get(&item.link).await {
              if let Ok(html) = resp.text().await {
                let lower = html.to_lowercase();
                if let Some(start) = lower.find("magnet:?xt=") {
                    let slice = &html[start..];
                    if let Some(end) = slice.find('"') {
                        let raw = &slice[..end];
                        magnet = Some(raw.replace("&amp;", "&").to_string());
                    }
                }
              }
            }
        }
        
        new_items.push(db::SubscriptionDownload {
            id: 0,
            subscription_id,
            guid: item.guid.clone(),
            title: item.title.clone(),
            torrent_url: item.torrent_url.clone(),
            magnet_link: magnet,
            file_size: item.content_length,
            pub_date: item.pub_date.clone(),
            status: "pending".to_string(),
            aria2_gid: None,
            file_path: None,
            notified: false,
            created_at: String::new(),
            updated_at: String::new(),
        });
    }
    
    // 更新最后检查时间
    sqlx::query("UPDATE bangumi_subscriptions SET last_check_at = datetime('now', 'localtime') WHERE id = ?")
        .bind(subscription_id)
        .execute(&pool)
        .await
        .ok();
    
    Ok(new_items)
}


/// 从标题中提取集数
fn extract_season_number(title: &str) -> Option<i32> {
        use regex::Regex;
    
        // 中文数字映射
        let chinese_num = |s: &str| -> Option<i32> {
            match s {
                "一" => Some(1), "二" | "两" => Some(2), "三" => Some(3),
                "四" => Some(4), "五" => Some(5), "六" => Some(6),
                "七" => Some(7), "八" => Some(8), "九" => Some(9),
                "十" => Some(10), "十一" => Some(11), "十二" => Some(12),
                "十三" => Some(13), "十四" => Some(14), "十五" => Some(15),
                "十六" => Some(16), "十七" => Some(17), "十八" => Some(18),
                "十九" => Some(19), "二十" => Some(20),
                _ => s.parse::<i32>().ok(),
            }
        };
    
        // 1. 中文格式：第X季（支持中文数字和阿拉伯数字）
        if let Ok(re) = Regex::new(r"第\s*([^\d\s季]{1,4})\s*季") {
            if let Some(caps) = re.captures(title) {
                if let Some(s) = caps.get(1) {
                    if let Some(season) = chinese_num(s.as_str()) {
                        if season >= 1 && season <= 99 { return Some(season); }
                    }
                }
            }
        }
    
        // 2. 英文格式：3rd Season、Season 1
        let patterns = [
            r"(?i)(\d+)(?:st|nd|rd|th)\s+Season",
            r"(?i)Season\s*(\d+)",
        ];
        for pattern in &patterns {
            if let Ok(re) = Regex::new(pattern) {
                if let Some(caps) = re.captures(title) {
                    if let Some(s) = caps.get(1) {
                        if let Ok(season) = s.as_str().parse::<i32>() {
                            if season >= 1 && season <= 99 { return Some(season); }
                        }
                    }
                }
            }
        }
        None
    }

fn extract_episode_number(title: &str) -> Option<i32> {
    use regex::Regex;
    
    // 按优先级尝试多种集数格式
    let patterns = [
        (r"EP\.?\s*(\d+)", true),                    // "EP02", "EP.02" (高优先)
        (r"(?:-|–|—)\s*(\d+)\s*(?:\[|$)", true),   // "- 02 [" 或 "- 02" 在末尾
        (r"\[(\d{1,3})(?:v\d+)?\]\s*(?:\[|$)", true), // "[01][1080P]"、"[01v2][1080P]"
        (r"#(\d+)", true),                              // "#02"
        (r"第\s*(\d+)\s*集", true),                   // "第02集"
        (r"(\d+)\s*话", true),                         // "02话"
        (r"(\d+)\s*話", true),                         // "02話"
        (r"S\d+E(\d+)", true),                         // "S01E02"
        (r"(?:-|–|—)\s*(\d+)", false),                // "- 02" (低优先，可能误匹配)
    ];
    
    for (pattern, _) in &patterns {
        if let Ok(re) = Regex::new(pattern) {
            if let Some(caps) = re.captures(title) {
                if let Some(ep_str) = caps.get(1) {
                    if let Ok(ep) = ep_str.as_str().parse::<i32>() {
                        // 排除明显不是集数的数字（如年份、分辨率等）
                        if ep > 0 && ep < 1000 {
                            return Some(ep);
                        }
                    }
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod subscription_title_tests {
    use super::extract_episode_number;

    #[test]
    fn extracts_mikanani_bracket_episode_before_quality_tags() {
        let title = "[桜都字幕组] 关于同组的染谷同学是性感女优这件事。 / Onaji Zemi no Someya-san ga Sexy Joyuu Datta Hanashi. [01][1080P][简体内嵌]";
        assert_eq!(extract_episode_number(title), Some(1));
    }

    #[test]
    fn ignores_quality_tag_when_episode_is_absent() {
        let title = "[桜都字幕组] 测试番组 [1080P][简体内嵌]";
        assert_eq!(extract_episode_number(title), None);
    }
}

/// 更新订阅关键词偏好
#[tauri::command]
async fn update_subscription_keywords(
    state: State<'_, AppState>,
    subscription_id: i64,
    keywords: Vec<(String, String, bool)>, // (category, value, is_selected)
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    
    // 清除旧关键词
    sqlx::query("DELETE FROM subscription_keywords WHERE subscription_id = ?")
        .bind(subscription_id)
        .execute(&pool)
        .await
        .ok();
    
    // 插入新关键词
    for (category, value, is_selected) in keywords {
        sqlx::query(
            "INSERT INTO subscription_keywords (subscription_id, keyword_category, keyword_value, is_selected) VALUES (?, ?, ?, ?)"
        )
        .bind(subscription_id)
        .bind(&category)
        .bind(&value)
        .bind(is_selected)
        .execute(&pool)
        .await
        .ok();
    }
    
    Ok(())
}

/// 获取订阅关键词
#[tauri::command]
async fn get_subscription_keywords(
    state: State<'_, AppState>,
    subscription_id: i64,
) -> Result<Vec<db::SubscriptionKeyword>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    
    let keywords = sqlx::query_as::<_, db::SubscriptionKeyword>(
        "SELECT * FROM subscription_keywords WHERE subscription_id = ? ORDER BY keyword_category, keyword_value"
    )
    .bind(subscription_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    
    Ok(keywords)
}

// === 原有命令 ===

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
    // 用全局锁防止并发初始化
    let _init_guard = INIT_LOCK.lock().await;
    // double-check：拿到锁后再检查一次
    {
        let guard = state.db.lock().await;
        if guard.is_some() {
            eprintln!("[ChangLi] 数据库已在后台初始化完成，跳过重复初始化");
            return Ok(());
        }
    }
    // 如果后台尚未完成，等待并执行初始化
    eprintln!("[ChangLi] init_db: 开始初始化...");
    let db = db::init_database().await.map_err(|e| {
        eprintln!("[ChangLi] init_db 失败: {}", e);
        e.to_string()
    })?;
    eprintln!("[ChangLi] init_db: 初始化成功");
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

/// 从文件名提取成人视频元数据（标题、车牌、中文字幕）
fn extract_adult_metadata(name: &str) -> (String, Option<String>, i32) {
    if let Some(info) = scanner::parse_adult_filename(name) {
        let title = info.title.unwrap_or_else(|| name.to_string());
        (
            title,
            Some(info.code),
            if info.has_chinese_sub { 1 } else { 0 },
        )
    } else {
        (name.to_string(), None, 0)
    }
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
        let file_stem = import_path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "未命名视频".to_string());
        let parent_dir = import_path
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "/".to_string());
        let thumb = video
            .thumbnail
            .as_deref()
            .and_then(|t| scanner::generate_thumbnail_base64(std::path::Path::new(t)));
        let (series_title, code, has_chinese_sub) = extract_adult_metadata(&file_stem);
        let series = db::add_video_series(
            &pool,
            &series_title,
            Some(&parent_dir),
            video.thumbnail.as_deref(),
            Some("landscape"),
            Some("ongoing"),
            thumb.as_deref(),
            None,
        )
        .await
        .map_err(|e| e.to_string())?;
        if let Some(c) = code {
            let _ =
                sqlx::query("UPDATE video_series SET code = ?, has_chinese_sub = ? WHERE id = ?")
                    .bind(&c)
                    .bind(has_chinese_sub)
                    .bind(series.id)
                    .execute(&pool)
                    .await;
        }
        db::add_videos_batch(&pool, vec![video], Some(series.id))
            .await
            .map_err(|e| e.to_string())?;
        return Ok(ScanResult {
            added: 1,
            updated: 0,
        });
    }

    let folder_name = import_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("未命名视频集")
        .to_string();

    // 如果文件夹名匹配已有标签，自动拆子文件夹为视频集并关联标签
    if let Ok(Some(tag)) = db::get_tag_by_name(&pool, folder_name.trim()).await {
        eprintln!(
            "[ChangLi] 文件夹名 '{}' 匹配标签 '{}'，自动拆分子文件夹",
            folder_name, tag.name
        );
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
                let sub_poster = crate::scanner::find_folder_poster(&entry_path);
                let sub_poster_base64 = sub_poster
                    .as_deref()
                    .and_then(|p| scanner::generate_thumbnail_base64(std::path::Path::new(p)));
                let folder_path_str = entry_path.to_string_lossy().to_string();
                if let Some(existing) = db::get_video_series_by_folder_path(&pool, &folder_path_str)
                    .await
                    .map_err(|e| e.to_string())?
                {
                    // 已存在：更新海报
                    db::update_video_series_poster(
                        &pool,
                        existing.id,
                        sub_poster.as_deref(),
                        sub_poster_base64.as_deref(),
                        Some("landscape"),
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                    db::add_videos_batch(&pool, sub_result.videos, Some(existing.id))
                        .await
                        .map_err(|e| e.to_string())?;
                    updated += 1;
                } else {
                    let series = db::add_video_series(
                        &pool,
                        &entry_name,
                        Some(&folder_path_str),
                        sub_poster.as_deref(),
                        Some("landscape"),
                        Some("ongoing"),
                        sub_poster_base64.as_deref(),
                                None,
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                    db::add_videos_batch(&pool, sub_result.videos, Some(series.id))
                        .await
                        .map_err(|e| e.to_string())?;
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
                let file_stem = entry_path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| entry_name.clone());
                let thumb = video
                    .thumbnail
                    .as_deref()
                    .and_then(|t| scanner::generate_thumbnail_base64(std::path::Path::new(t)));
                let file_path_str = entry_path.to_string_lossy().to_string();
                if let Some(existing) = db::get_video_series_by_folder_path(&pool, &file_path_str)
                    .await
                    .map_err(|e| e.to_string())?
                {
                    db::update_video_series_poster(
                        &pool,
                        existing.id,
                        video.thumbnail.as_deref(),
                        thumb.as_deref(),
                        Some("landscape"),
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                    db::add_videos_batch(&pool, vec![video], Some(existing.id))
                        .await
                        .map_err(|e| e.to_string())?;
                    updated += 1;
                } else {
                    let series = db::add_video_series(
                        &pool,
                        &file_stem,
                        Some(&file_path_str),
                        video.thumbnail.as_deref(),
                        Some("landscape"),
                        Some("ongoing"),
                        thumb.as_deref(),
                                None,
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                    db::add_videos_batch(&pool, vec![video], Some(series.id))
                        .await
                        .map_err(|e| e.to_string())?;
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
        eprintln!(
            "[ChangLi] 文件夹名 '{}' 匹配演员 '{}'，自动拆分子文件夹并关联演员",
            folder_name, actor.name
        );
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
                let sub_poster = crate::scanner::find_folder_poster(&entry_path);
                let sub_poster_base64 = sub_poster
                    .as_deref()
                    .and_then(|p| scanner::generate_thumbnail_base64(std::path::Path::new(p)));

                let folder_path_str = entry_path.to_string_lossy().to_string();
                if let Some(existing) = db::get_video_series_by_folder_path(&pool, &folder_path_str)
                    .await
                    .map_err(|e| e.to_string())?
                {
                    db::update_video_series_poster(
                        &pool,
                        existing.id,
                        sub_poster.as_deref(),
                        sub_poster_base64.as_deref(),
                        Some("landscape"),
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                    db::add_videos_batch(&pool, sub_result.videos, Some(existing.id))
                        .await
                        .map_err(|e| e.to_string())?;
                    updated += 1;
                } else {
                    let (series_title, code, has_chinese_sub) = extract_adult_metadata(&entry_name);
                    let series = db::add_video_series(
                        &pool,
                        &series_title,
                        Some(&folder_path_str),
                        sub_poster.as_deref(),
                        Some("landscape"),
                        Some("ongoing"),
                        sub_poster_base64.as_deref(),
                                None,
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                    // 设置 code 和 has_chinese_sub
                    if let Some(c) = code {
                        let _ = sqlx::query(
                            "UPDATE video_series SET code = ?, has_chinese_sub = ? WHERE id = ?",
                        )
                        .bind(&c)
                        .bind(has_chinese_sub)
                        .bind(series.id)
                        .execute(&pool)
                        .await;
                    }
                    db::add_videos_batch(&pool, sub_result.videos, Some(series.id))
                        .await
                        .map_err(|e| e.to_string())?;
                    if let Err(e) =
                        db::add_series_actor(&pool, series.id, actor.id, None, None).await
                    {
                        eprintln!("[ChangLi] 关联演员到视频集失败: {}", e);
                    }
                    // 设置 display_type = 'adult'
                    let _ = db::update_video_series_display_type(&pool, series.id, "adult").await;
                    added += 1;
                }
            } else if entry_path.is_file() && scanner::is_video_file(&entry_path) {
                // 根目录下的视频也创建视频集并关联演员
                let video = scanner::scan_video_file(&entry_path, None)
                    .await
                    .map_err(|e| e.to_string())?;
                let file_stem = entry_path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| entry_name.clone());
                let thumb = video
                    .thumbnail
                    .as_deref()
                    .and_then(|t| scanner::generate_thumbnail_base64(std::path::Path::new(t)));
                let file_path_str = entry_path.to_string_lossy().to_string();
                if let Some(existing) = db::get_video_series_by_folder_path(&pool, &file_path_str)
                    .await
                    .map_err(|e| e.to_string())?
                {
                    db::update_video_series_poster(
                        &pool,
                        existing.id,
                        video.thumbnail.as_deref(),
                        thumb.as_deref(),
                        Some("landscape"),
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                    db::add_videos_batch(&pool, vec![video], Some(existing.id))
                        .await
                        .map_err(|e| e.to_string())?;
                    updated += 1;
                } else {
                    let (series_title, code, has_chinese_sub) = extract_adult_metadata(&file_stem);
                    let series = db::add_video_series(
                        &pool,
                        &series_title,
                        Some(&file_path_str),
                        video.thumbnail.as_deref(),
                        Some("landscape"),
                        Some("ongoing"),
                        thumb.as_deref(),
                                None,
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                    // 设置 code 和 has_chinese_sub
                    if let Some(c) = code {
                        let _ = sqlx::query(
                            "UPDATE video_series SET code = ?, has_chinese_sub = ? WHERE id = ?",
                        )
                        .bind(&c)
                        .bind(has_chinese_sub)
                        .bind(series.id)
                        .execute(&pool)
                        .await;
                    }
                    db::add_videos_batch(&pool, vec![video], Some(series.id))
                        .await
                        .map_err(|e| e.to_string())?;
                    if let Err(e) =
                        db::add_series_actor(&pool, series.id, actor.id, None, None).await
                    {
                        eprintln!("[ChangLi] 关联演员到视频集失败: {}", e);
                    }
                    // 设置 display_type = 'adult'
                    let _ = db::update_video_series_display_type(&pool, series.id, "adult").await;
                    added += 1;
                }
            }
        }

        return Ok(ScanResult { added, updated });
    }

    let result = scanner::scan_directory(&path)
        .await
        .map_err(|e| e.to_string())?;

    let mut series_poster = crate::scanner::find_folder_poster(&std::path::Path::new(&path));
    // 空文件夹：尝试从文件夹内找图片作为海报
    if series_poster.is_none() {
        if let Ok(entries) = std::fs::read_dir(&path) {
            for entry in entries.filter_map(|e| e.ok()) {
                let p = entry.path();
                if p.is_file() {
                    if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                        if scanner::IMAGE_EXTENSIONS.contains(&ext.to_lowercase().as_str()) {
                            series_poster = Some(p.to_string_lossy().to_string());
                            break;
                        }
                    }
                }
            }
        }
    }
    let series_poster_base64 = series_poster
        .as_deref()
        .and_then(|p| scanner::generate_thumbnail_base64(std::path::Path::new(p)));

    if let Some(existing) = db::get_video_series_by_folder_path(&pool, &path)
        .await
        .map_err(|e| e.to_string())?
    {
        // 已存在：更新海报
        db::update_video_series_poster(
            &pool,
            existing.id,
            series_poster.as_deref(),
            series_poster_base64.as_deref(),
            Some("landscape"),
        )
        .await
        .map_err(|e| e.to_string())?;
        // 自动更新元数据（code、has_chinese_sub）
        if existing.code.is_none() || existing.code.as_deref() == Some("") {
            let (new_title, code, has_chinese_sub) = extract_adult_metadata(&folder_name);
            if let Some(c) = code {
                let _ = sqlx::query("UPDATE video_series SET code = ?, has_chinese_sub = ?, title = ? WHERE id = ? AND (code IS NULL OR code = '')")
                    .bind(&c)
                    .bind(has_chinese_sub)
                    .bind(&new_title)
                    .bind(existing.id)
                    .execute(&pool).await;
            }
        }
        db::add_videos_batch(&pool, result.videos, Some(existing.id))
            .await
            .map_err(|e| e.to_string())?;
        Ok(ScanResult {
            added: 0,
            updated: 1,
        })
    } else {
        let (series_title, code, has_chinese_sub) = extract_adult_metadata(&folder_name);
        let series = db::add_video_series(
            &pool,
            &series_title,
            Some(&path),
            series_poster.as_deref(),
            Some("landscape"),
            Some("ongoing"),
            series_poster_base64.as_deref(),
            None,
        )
        .await
        .map_err(|e| e.to_string())?;
        // 设置 code 和 has_chinese_sub
        if let Some(c) = code {
            let _ =
                sqlx::query("UPDATE video_series SET code = ?, has_chinese_sub = ? WHERE id = ?")
                    .bind(&c)
                    .bind(has_chinese_sub)
                    .bind(series.id)
                    .execute(&pool)
                    .await;
        }
        db::add_videos_batch(&pool, result.videos, Some(series.id))
            .await
            .map_err(|e| e.to_string())?;
        // 路径6：如果父目录名匹配演员名，自动关联演员并设置 display_type='adult'
        if let Some(parent) = import_path.parent() {
            let parent_name = parent
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            if !parent_name.is_empty() {
                if let Ok(Some(actor)) =
                    db::get_actor_by_name_or_jp(&pool, parent_name.trim()).await
                {
                    eprintln!(
                        "[ChangLi] 父目录 '{}' 匹配演员 '{}'，自动关联",
                        parent_name, actor.name,
                    );
                    let _ = db::add_series_actor(&pool, series.id, actor.id, None, None).await;
                    let _ = db::update_video_series_display_type(&pool, series.id, "adult").await;
                }
            }
        }
        Ok(ScanResult {
            added: 1,
            updated: 0,
        })
    }
}

#[tauri::command]
async fn scan_videos_for_actor(
    state: State<'_, AppState>,
    path: String,
    actor_id: i64,
    period_id: Option<i64>,
) -> Result<ScanResult, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };

    // 校验文件夹名
    // 如果指定了时期，用时期名校验；否则用演员名校验
    // 也支持番号格式的文件夹名（如 STARS-667C[标题]）
    let actor = db::get_actor(&pool, actor_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("演员不存在")?;
    let folder_name = Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let folder_trimmed = folder_name.trim();

    // 如果指定了时期，用时期名校验
    let period_name = if let Some(pid) = period_id {
        db::get_actor_periods(&pool, actor_id)
            .await
            .ok()
            .and_then(|periods| periods.into_iter().find(|p| p.id == pid).map(|p| p.name))
    } else {
        None
    };

    let name_matches = if let Some(ref pname) = period_name {
        folder_trimmed.eq_ignore_ascii_case(pname.trim())
    } else {
        folder_trimmed.eq_ignore_ascii_case(actor.name.trim())
            || actor
                .japanese_name
                .as_deref()
                .map(|jp| folder_trimmed.eq_ignore_ascii_case(jp.trim()))
                .unwrap_or(false)
    };

    // 如果名称不匹配，检查是否是番号格式的文件夹
    let is_video_folder = !name_matches
        && scanner::parse_adult_filename(folder_trimmed).is_some();

    if !name_matches && !is_video_folder {
        let expected = period_name
            .as_deref()
            .unwrap_or(&actor.name);
        return Err(format!(
            "文件夹名 '{}' 不匹配 '{}' 或番号格式",
            folder_name, expected
        ));
    }

    let mut added: i64 = 0;
    let mut updated: i64 = 0;

    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();
        let entry_name = entry.file_name().to_string_lossy().to_string();

        if !entry_path.is_dir() {
            continue;
        }

        let sub_result = scanner::scan_directory(&entry_path.to_string_lossy())
            .await
            .map_err(|e| e.to_string())?;
        let sub_poster = crate::scanner::find_folder_poster(&entry_path);
        let sub_poster_base64 = sub_poster
            .as_deref()
            .and_then(|p| scanner::generate_thumbnail_base64(std::path::Path::new(p)));
        let folder_path_str = entry_path.to_string_lossy().to_string();
        if let Some(existing) = db::get_video_series_by_folder_path(&pool, &folder_path_str)
            .await
            .map_err(|e| e.to_string())?
        {
            db::update_video_series_poster(
                &pool,
                existing.id,
                sub_poster.as_deref(),
                sub_poster_base64.as_deref(),
                Some("landscape"),
            )
            .await
            .map_err(|e| e.to_string())?;
            db::add_videos_batch(&pool, sub_result.videos, Some(existing.id))
                .await
                .map_err(|e| e.to_string())?;
            let _ = db::add_series_actor(&pool, existing.id, actor_id, None, period_id).await;
            let _ = db::update_video_series_display_type(&pool, existing.id, "adult").await;
            updated += 1;
        } else {
            let (series_title, code, has_chinese_sub) = extract_adult_metadata(&entry_name);
            let series = db::add_video_series(
                &pool,
                &series_title,
                Some(&folder_path_str),
                sub_poster.as_deref(),
                Some("landscape"),
                Some("ongoing"),
                sub_poster_base64.as_deref(),
                None,
            )
            .await
            .map_err(|e| e.to_string())?;
            if let Some(c) = code {
                let _ = sqlx::query(
                    "UPDATE video_series SET code = ?, has_chinese_sub = ? WHERE id = ?",
                )
                .bind(&c)
                .bind(has_chinese_sub)
                .bind(series.id)
                .execute(&pool)
                .await;
            }
            db::add_videos_batch(&pool, sub_result.videos, Some(series.id))
                .await
                .map_err(|e| e.to_string())?;
            let _ = db::add_series_actor(&pool, series.id, actor_id, None, period_id).await;
            let _ = db::update_video_series_display_type(&pool, series.id, "adult").await;
            added += 1;
        }
    }

    if added == 0 && updated == 0 {
        return Err("文件夹中没有找到视频".to_string());
    }

    Ok(ScanResult { added, updated })
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
async fn get_video_series_list_lite(
    state: State<'_, AppState>,
) -> Result<Vec<(i64, String, Option<String>)>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_video_series_list_lite(&pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_video_series_poster_data_url(
    state: State<'_, AppState>,
    id: i64,
) -> Result<Option<String>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_video_series_poster_data_url(&pool, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_video_series_list(
    state: State<'_, AppState>,
    sort_by: Option<String>,
    sort_order: Option<String>,
) -> Result<Vec<db::VideoSeries>, String> {
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
    eprintln!(
        "[update_video_series] id={}, has_chinese_sub={:?}",
        id, has_chinese_sub
    );
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    let stored_poster = poster.as_deref().map(normalize_photo_path_for_storage);
    let poster_base64 = stored_poster
        .as_deref()
        .and_then(|p| scanner::generate_thumbnail_base64(std::path::Path::new(p)));
    db::update_video_series(
        &pool,
        id,
        title,
        description,
        stored_poster,
        poster_orientation,
        status,
        poster_base64,
        code,
        has_chinese_sub,
    )
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
async fn delete_video_series_batch(
    state: State<'_, AppState>,
    ids: Vec<i64>,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    for id in ids {
        db::delete_video_series(&pool, id, true)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn delete_videos_batch(
    state: State<'_, AppState>,
    ids: Vec<i64>,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for id in ids {
        sqlx::query("DELETE FROM videos WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())
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
async fn switch_series_type_to(state: State<'_, AppState>, series_id: i64, category_key: String) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::update_video_series_display_type(&pool, series_id, &category_key)
        .await
        .map_err(|e| e.to_string())
}



fn find_season_folder_poster_for_video(video_path: &Path) -> Option<String> {
    let parent = video_path.parent()?;
    if let Some(parent_name) = parent.file_name().map(|n| n.to_string_lossy().to_string()) {
        if matches!(scanner::classify_series_subfolder(&parent_name), scanner::SeriesSubfolderKind::Season(_)) {
            return scanner::find_folder_poster(parent);
        }
    }

    let grandparent = parent.parent()?;
    if let Some(gp_name) = grandparent.file_name().map(|n| n.to_string_lossy().to_string()) {
        if matches!(scanner::classify_series_subfolder(&gp_name), scanner::SeriesSubfolderKind::Season(_)) {
            return scanner::find_folder_poster(grandparent);
        }
    }

    None
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
    let season_folder_poster = find_season_folder_poster_for_video(video_path);
    let mut video = scanner::scan_video_file(video_path, season_folder_poster.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    video.series_id = Some(series_id);

    // 从文件路径推断季号：检查父目录/祖父目录是否为季节子文件夹
    if let Some(parent) = video_path.parent() {
        if let Some(parent_name) = parent.file_name().map(|n| n.to_string_lossy().to_string()) {
            match scanner::classify_series_subfolder(&parent_name) {
                scanner::SeriesSubfolderKind::Season(season) => {
                    video.season = Some(season);
                }
                _ => {
                    // 父目录不是季节文件夹，尝试祖父目录（视频在子子文件夹中）
                    if let Some(grandparent) = parent.parent() {
                        if let Some(gp_name) = grandparent.file_name().map(|n| n.to_string_lossy().to_string()) {
                            if let scanner::SeriesSubfolderKind::Season(season) = scanner::classify_series_subfolder(&gp_name) {
                                video.season = Some(season);
                            }
                        }
                    }
                }
            }
        }
    }

    // 文件名提取不到集数时，分配下一个集数序号
    if video.episode_number.is_none() {
        let season_val = video.season.unwrap_or(0);
        let max_ep: Option<i32> = sqlx::query_scalar(
            "SELECT MAX(episode_number) FROM videos WHERE series_id = ? AND COALESCE(season, 0) = ? AND episode_number IS NOT NULL",
        )
        .bind(series_id)
        .bind(season_val)
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten();
        video.episode_number = Some(max_ep.unwrap_or(0) + 1);
    }

    let saved = db::add_video(&pool, video)
        .await
        .map_err(|e| e.to_string())?;
    db::set_video_series(&pool, saved.id, Some(series_id), saved.episode_number)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_videos_to_series(
    state: State<'_, AppState>,
    series_id: i64,
    paths: Vec<String>,
) -> Result<Vec<db::Video>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    let mut videos = Vec::new();
    for path in paths {
        let video_path = Path::new(&path);
        if !video_path.is_file() || !scanner::is_video_file(video_path) {
            continue;
        }
        let season_folder_poster = find_season_folder_poster_for_video(video_path);
        let mut video = scanner::scan_video_file(video_path, season_folder_poster.as_deref())
            .await
            .map_err(|e| e.to_string())?;
        video.series_id = Some(series_id);

        // 从文件路径推断季号
        if let Some(parent) = video_path.parent() {
            if let Some(parent_name) = parent.file_name().map(|n| n.to_string_lossy().to_string()) {
                match scanner::classify_series_subfolder(&parent_name) {
                    scanner::SeriesSubfolderKind::Season(season) => { video.season = Some(season); }
                    _ => {
                        if let Some(grandparent) = parent.parent() {
                            if let Some(gp_name) = grandparent.file_name().map(|n| n.to_string_lossy().to_string()) {
                                if let scanner::SeriesSubfolderKind::Season(season) = scanner::classify_series_subfolder(&gp_name) {
                                    video.season = Some(season);
                                }
                            }
                        }
                    }
                }
            }
        }

        // 文件名提取不到集数时，分配下一个集数序号
        if video.episode_number.is_none() {
            let season_val = video.season.unwrap_or(0);
            let max_ep: Option<i32> = sqlx::query_scalar(
                "SELECT MAX(episode_number) FROM videos WHERE series_id = ? AND COALESCE(season, 0) = ? AND episode_number IS NOT NULL",
            )
            .bind(series_id)
            .bind(season_val)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten();
            video.episode_number = Some(max_ep.unwrap_or(0) + 1);
        }

        videos.push(video);
    }
    if videos.is_empty() {
        return Ok(Vec::new());
    }
    db::add_videos_batch(&pool, videos, Some(series_id))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_empty_video_series(
    state: State<'_, AppState>,
    title: String,
    display_type: Option<String>,
) -> Result<db::VideoSeries, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::create_empty_video_series(&pool, &title, display_type.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_video_episode_numbers(
    state: State<'_, AppState>,
    updates: Vec<(i64, i32)>,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::update_video_episode_numbers(&pool, &updates)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_category_series_by_paths(
    state: State<'_, AppState>,
    category_key: String,
    paths: Vec<String>,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };

    for folder in paths {
        let folder_path = Path::new(&folder);
        if !folder_path.is_dir() {
            continue;
        }
        let folder_name = folder_path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        if folder_name.is_empty() {
            continue;
        }
        let scan_result = scanner::scan_directory(&folder)
            .await
            .map_err(|e| e.to_string())?;
        let poster = scanner::find_folder_poster(folder_path);
        let poster_base64 = poster
            .as_deref()
            .and_then(|p| scanner::generate_thumbnail_base64(Path::new(p)));

        let series = if let Some(existing) = db::get_video_series_by_folder_path(&pool, &folder)
            .await
            .map_err(|e| e.to_string())?
        {
            existing
        } else {
            let (series_title, code, has_chinese_sub) = extract_adult_metadata(&folder_name);
            let series = db::add_video_series(
                &pool,
                &series_title,
                Some(&folder),
                poster.as_deref(),
                Some("landscape"),
                Some("ongoing"),
                poster_base64.as_deref(),
                Some(&category_key),
            )
            .await
            .map_err(|e| e.to_string())?;
            if let Some(c) = code {
                let _ = sqlx::query("UPDATE video_series SET code = ?, has_chinese_sub = ? WHERE id = ?")
                    .bind(&c)
                    .bind(has_chinese_sub)
                    .bind(series.id)
                    .execute(&pool)
                    .await;
            }
            series
        };

        db::add_videos_batch(&pool, scan_result.videos, Some(series.id))
            .await
            .map_err(|e| e.to_string())?;
        let _ = db::update_video_series_display_type(&pool, series.id, &category_key).await;

        if let Some(parent) = folder_path.parent() {
            if let Some(parent_name) = parent.file_name().map(|s| s.to_string_lossy().to_string()) {
                if let Ok(Some(tag)) = db::get_tag_by_name(&pool, parent_name.trim()).await {
                    let _ = db::add_series_tag(&pool, series.id, tag.id).await;
                }
                if let Ok(Some(actor)) = db::get_actor_by_name_or_jp(&pool, parent_name.trim()).await {
                    let _ = db::add_series_actor(&pool, series.id, actor.id, None, None).await;
                } else if let Some(grand) = parent.parent() {
                    if let Some(actor_name) = grand.file_name().map(|s| s.to_string_lossy().to_string()) {
                        if let Ok(Some(actor)) = db::get_actor_by_name_or_jp(&pool, actor_name.trim()).await {
                            let periods = db::get_actor_periods(&pool, actor.id).await.unwrap_or_default();
                            let period_id = periods.into_iter().find(|p| p.name == parent_name).map(|p| p.id);
                            let _ = db::add_series_actor(&pool, series.id, actor.id, None, period_id).await;
                        }
                    }
                }
            }
        }
    }
    Ok(())
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
async fn get_actors_by_category(state: State<'_, AppState>, category_key: String) -> Result<Vec<db::Actor>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_actors_by_category(&pool, &category_key).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn increment_actor_view(state: State<'_, AppState>, actor_id: i64) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::increment_actor_view_count(&pool, actor_id).await.map_err(|e| e.to_string())
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
    alias: Option<String>,
) -> Result<db::Actor, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    let stored_photo = photo.as_deref().map(normalize_photo_path_for_storage);
    let avatar_base64 = stored_photo
        .as_deref()
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
        alias.as_deref(),
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
    alias: Option<String>,
    weight: Option<String>,
) -> Result<db::Actor, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    let stored_photo = photo.as_deref().map(normalize_photo_path_for_storage);
    let avatar_base64 = stored_photo
        .as_deref()
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
        alias.as_deref(),
        weight.as_deref(),
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
async fn set_download_dir(path: String) -> Result<storage::StorageInfo, String> {
    storage::set_download_dir(&path).map_err(|e| e.to_string())?;
    storage::storage_info().map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_auto_use_last_download_dir(enabled: bool) -> Result<storage::StorageInfo, String> {
    storage::set_auto_use_last_download_dir(enabled).map_err(|e| e.to_string())?;
    storage::storage_info().map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_player_mode(mode: String) -> Result<storage::StorageInfo, String> {
    storage::set_player_mode(&mode).map_err(|e| e.to_string())?;
    storage::storage_info().map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_external_player_path(path: Option<String>) -> Result<storage::StorageInfo, String> {
    storage::set_external_player_path(path.as_deref()).map_err(|e| e.to_string())?;
    storage::storage_info().map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_installed_players() -> Result<Vec<InstalledPlayer>, String> {
    Ok(discover_installed_players())
}

fn discover_installed_players() -> Vec<InstalledPlayer> {
    let mut players = Vec::new();
    let mut seen = std::collections::HashSet::<String>::new();
    if let Some(default_name) = system_default_video_player_name() {
        players.push(InstalledPlayer {
            name: format!("系统默认播放器（{}）", default_name),
            path: String::new(),
        });
        seen.insert(String::new());
    }
    // macOS: 直接扫描 Applications 目录（不使用 mdfind，避免 GUI 应用中弹出终端窗口）
    #[cfg(target_os = "macos")]
    {
        for path in [
            PathBuf::from("/System/Applications"),
            PathBuf::from("/Applications"),
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("~"))
                .join("Applications"),
        ] {
            if !path.exists() {
                continue;
            }
            for entry in walkdir::WalkDir::new(path).max_depth(2).into_iter().filter_map(Result::ok) {
                let app_path = entry.path();
                if app_path.extension().and_then(|ext| ext.to_str()) == Some("app") {
                    push_player_candidate(app_path, &mut players, &mut seen);
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        discover_windows_players(&mut players, &mut seen);
    }

    let mut default_entries = Vec::new();
    let mut other_entries = Vec::new();
    for player in players {
        if player.path.is_empty() {
            default_entries.push(player);
        } else {
            other_entries.push(player);
        }
    }
    other_entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    default_entries.extend(other_entries);
    default_entries
}

fn system_default_video_player_name() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        windows_default_video_player().map(|(name, _path)| name)
    }

    #[cfg(target_os = "macos")]
    {
        None
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        None
    }
}

fn push_player_candidate(
    app_path: &Path,
    players: &mut Vec<InstalledPlayer>,
    seen: &mut std::collections::HashSet<String>,
) {
    if !app_path.exists() {
        return;
    }
    let name = app_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    if name.is_empty() || !looks_like_video_player(&name) {
        return;
    }
    let path = app_path.to_string_lossy().to_string();
    if seen.insert(path.clone()) {
        players.push(InstalledPlayer { name, path });
    }
}

fn looks_like_video_player(name: &str) -> bool {
    let lower = name.to_lowercase();
    [
        "iina",
        "vlc",
        "quicktime",
        "movist",
        "mpv",
        "mpvnet",
        "potplayer",
        "mpc-hc",
        "mpc-be",
        "kmplayer",
        "wmplayer",
        "infuse",
        "elmedia",
        "player",
        "播放器",
        "视频",
    ]
    .iter()
    .any(|keyword| lower.contains(keyword))
}

#[cfg(target_os = "windows")]
fn windows_default_video_player() -> Option<(String, Option<String>)> {
    use winreg::enums::{HKEY_CLASSES_ROOT, HKEY_CURRENT_USER, KEY_READ};
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let user_choice = hkcu
        .open_subkey_with_flags(
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.mp4\UserChoice",
            KEY_READ,
        )
        .ok()?;
    let prog_id: String = user_choice.get_value("ProgId").ok()?;

    let hkcr = RegKey::predef(HKEY_CLASSES_ROOT);
    let class_key = hkcr.open_subkey_with_flags(&prog_id, KEY_READ).ok()?;
    let app_name = class_key
        .open_subkey_with_flags("Application", KEY_READ)
        .ok()
        .and_then(|key| key.get_value::<String, _>("ApplicationName").ok())
        .or_else(|| class_key.get_value::<String, _>("").ok())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| prog_id.clone());

    let command = class_key
        .open_subkey_with_flags(r"shell\open\command", KEY_READ)
        .ok()
        .and_then(|key| key.get_value::<String, _>("").ok());
    let exe_path = command.as_deref().and_then(parse_windows_command_exe);

    Some((app_name, exe_path))
}

#[cfg(target_os = "windows")]
fn parse_windows_command_exe(command: &str) -> Option<String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(rest) = trimmed.strip_prefix('"') {
        let end = rest.find('"')?;
        let candidate = rest[..end].to_string();
        return Path::new(&candidate).exists().then_some(candidate);
    }
    let lower = trimmed.to_lowercase();
    if let Some(index) = lower.find(".exe") {
        let candidate = trimmed[..index + 4].trim().to_string();
        return Path::new(&candidate).exists().then_some(candidate);
    }
    None
}

#[cfg(target_os = "windows")]
fn discover_windows_players(
    players: &mut Vec<InstalledPlayer>,
    seen: &mut std::collections::HashSet<String>,
) {
    if let Some((_name, Some(path))) = windows_default_video_player() {
        push_windows_player_path(Path::new(&path), players, seen);
    }

    for exe in ["vlc.exe", "mpv.exe", "mpvnet.exe", "PotPlayerMini64.exe", "PotPlayerMini.exe", "mpc-hc64.exe", "mpc-hc.exe", "mpc-be64.exe", "mpc-be.exe", "KMPlayer.exe", "wmplayer.exe"] {
        if let Ok(output) = std::process::Command::new("where").arg(exe).output() {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                for line in text.lines() {
                    push_windows_player_path(Path::new(line.trim()), players, seen);
                }
            }
        }
    }

    let mut roots = Vec::<PathBuf>::new();
    for key in ["ProgramFiles", "ProgramFiles(x86)", "LocalAppData"] {
        if let Some(value) = std::env::var_os(key) {
            roots.push(PathBuf::from(value));
        }
    }
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join("AppData").join("Local").join("Programs"));
    }

    for root in roots {
        if !root.exists() {
            continue;
        }
        for entry in walkdir::WalkDir::new(root).max_depth(4).into_iter().filter_map(Result::ok) {
            let path = entry.path();
            if path.is_file()
                && path.extension().and_then(|ext| ext.to_str()).map(|ext| ext.eq_ignore_ascii_case("exe")).unwrap_or(false)
                && path.file_name().and_then(|name| name.to_str()).map(looks_like_video_player).unwrap_or(false)
            {
                push_windows_player_path(path, players, seen);
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn push_windows_player_path(
    exe_path: &Path,
    players: &mut Vec<InstalledPlayer>,
    seen: &mut std::collections::HashSet<String>,
) {
    if !exe_path.exists() {
        return;
    }
    let path = exe_path.to_string_lossy().to_string();
    if !seen.insert(path.clone()) {
        return;
    }
    let name = exe_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("播放器")
        .to_string();
    players.push(InstalledPlayer { name, path });
}


#[tauri::command]
async fn open_series_in_file_manager(state: State<'_, AppState>, series_id: i64) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };

    let folder_path = sqlx::query_scalar::<_, Option<String>>("SELECT folder_path FROM video_series WHERE id = ?")
        .bind(series_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| e.to_string())?
        .flatten()
        .ok_or_else(|| "该视频集没有源文件路径".to_string())?;

    let source = std::path::PathBuf::from(&folder_path);
    let target = if source.is_file() {
        source
            .parent()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| "无法定位源文件所在位置".to_string())?
    } else {
        source
    };

    if !target.exists() {
        return Err("源文件路径不存在".to_string());
    }

    open::that(&target).map_err(|e| e.to_string())
}

#[tauri::command]
async fn repair_missing_posters_silent(state: State<'_, AppState>) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };

    let status = state.poster_repair_status.clone();
    {
        let mut current = status.lock().await;
        if current.status == "running" {
            return Ok(());
        }
        *current = PosterRepairStatus {
            status: "running".to_string(),
            ..PosterRepairStatus::default()
        };
    }

    tauri::async_runtime::spawn(async move {
        let progress_status = status.clone();
        match db::repair_missing_posters_with_progress(&pool, move |result| {
            let progress_status = progress_status.clone();
            let result = result.clone();
            tauri::async_runtime::spawn(async move {
                let mut current = progress_status.lock().await;
                if current.status == "running" {
                    current.scanned_series = result.scanned_series;
                    current.updated_series = result.updated_series;
                    current.scanned_videos = result.scanned_videos;
                    current.updated_videos = result.updated_videos;
                    current.skipped = result.skipped;
                }
            });
        }).await {
            Ok(result) => {
                eprintln!(
                    "[ChangLi] 批量修复海报完成: scanned_series={}, updated_series={}, scanned_videos={}, updated_videos={}, skipped={}",
                    result.scanned_series,
                    result.updated_series,
                    result.scanned_videos,
                    result.updated_videos,
                    result.skipped,
                );
                let mut current = status.lock().await;
                *current = PosterRepairStatus {
                    status: "success".to_string(),
                    scanned_series: result.scanned_series,
                    updated_series: result.updated_series,
                    scanned_videos: result.scanned_videos,
                    updated_videos: result.updated_videos,
                    skipped: result.skipped,
                    error: None,
                };
            }
            Err(error) => {
                eprintln!("[ChangLi] 批量修复海报失败: {error}");
                let mut current = status.lock().await;
                *current = PosterRepairStatus {
                    status: "error".to_string(),
                    error: Some(error.to_string()),
                    ..current.clone()
                };
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn start_poster_update_silent(state: State<'_, AppState>) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };

    let status = state.poster_repair_status.clone();
    {
        let mut current = status.lock().await;
        if current.status == "running" {
            return Ok(());
        }
        *current = PosterRepairStatus {
            status: "running".to_string(),
            ..PosterRepairStatus::default()
        };
    }

    tauri::async_runtime::spawn(async move {
        let progress_status = status.clone();
        let repair_result = db::repair_missing_posters_with_progress(&pool, move |result| {
            let progress_status = progress_status.clone();
            let result = result.clone();
            tauri::async_runtime::spawn(async move {
                let mut current = progress_status.lock().await;
                if current.status == "running" {
                    current.scanned_series = result.scanned_series;
                    current.updated_series = result.updated_series;
                    current.scanned_videos = result.scanned_videos;
                    current.updated_videos = result.updated_videos;
                    current.skipped = result.skipped;
                }
            });
        }).await;

        let repair_result = match repair_result {
            Ok(result) => result,
            Err(error) => {
                eprintln!("[ChangLi] 批量更新海报修复阶段失败: {error}");
                let mut current = status.lock().await;
                *current = PosterRepairStatus {
                    status: "error".to_string(),
                    error: Some(error.to_string()),
                    ..current.clone()
                };
                return;
            }
        };

        match regenerate_all_poster_base64_internal(&pool, Some(status.clone())).await {
            Ok(cache_updated) => {
                eprintln!(
                    "[ChangLi] 批量更新海报完成: repair_series={}, repair_videos={}, cache_updated={}",
                    repair_result.updated_series,
                    repair_result.updated_videos,
                    cache_updated,
                );
                let mut current = status.lock().await;
                *current = PosterRepairStatus {
                    status: "success".to_string(),
                    scanned_series: repair_result.scanned_series,
                    updated_series: cache_updated as i64,
                    scanned_videos: repair_result.scanned_videos,
                    updated_videos: repair_result.updated_videos,
                    skipped: repair_result.skipped,
                    error: None,
                };
            }
            Err(error) => {
                eprintln!("[ChangLi] 批量更新海报缓存阶段失败: {error}");
                let mut current = status.lock().await;
                *current = PosterRepairStatus {
                    status: "error".to_string(),
                    error: Some(error),
                    ..current.clone()
                };
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn get_poster_repair_status(state: State<'_, AppState>) -> Result<PosterRepairStatus, String> {
    Ok(state.poster_repair_status.lock().await.clone())
}

fn preview_temp_dir() -> PathBuf {
    std::env::temp_dir().join("changli-preview")
}

#[tauri::command]
async fn create_preview_file_path(seq: u64) -> Result<String, String> {
    let dir = preview_temp_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let filename = format!("preview-{}-{seq}.jpg", uuid::Uuid::new_v4());
    Ok(dir.join(filename).to_string_lossy().to_string())
}

#[tauri::command]
async fn delete_preview_file(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let preview_dir = preview_temp_dir();
    let canonical_dir = preview_dir.canonicalize().map_err(|e| e.to_string())?;

    if target.exists() {
        let canonical_target = target.canonicalize().map_err(|e| e.to_string())?;
        if !canonical_target.starts_with(&canonical_dir) {
            return Err("拒绝删除非 ChangLi 预览临时文件".to_string());
        }
        std::fs::remove_file(canonical_target).map_err(|e| e.to_string())?;
    }

    Ok(())
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
async fn reorder_actor_periods_cmd(
    state: State<'_, AppState>,
    period_ids: Vec<i64>,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::reorder_actor_periods(&pool, period_ids)
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
async fn get_tags_by_category(state: State<'_, AppState>, category_key: String) -> Result<Vec<db::Tag>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_tags_by_category(&pool, &category_key).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_tag(state: State<'_, AppState>, name: String, scope: Option<String>) -> Result<db::Tag, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    let scope_str = scope.as_deref().unwrap_or("global");
    db::add_tag(&pool, &name, scope_str).await.map_err(|e| e.to_string())
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
async fn update_tag(state: State<'_, AppState>, id: i64, name: String, scope: Option<String>) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    let scope_str = scope.as_deref().unwrap_or("global");
    db::update_tag(&pool, id, &name, scope_str).await.map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct TagWithCategories {
    #[serde(flatten)]
    tag: db::Tag,
    category_keys: Vec<String>,
}

#[tauri::command]
async fn get_tags_with_categories(state: State<'_, AppState>) -> Result<Vec<TagWithCategories>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    let tags = db::get_tags(&pool).await.map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for tag in tags {
        let categories = db::get_tag_categories(&pool, tag.id).await.map_err(|e| e.to_string())?;
        result.push(TagWithCategories { tag, category_keys: categories });
    }
    Ok(result)
}

#[tauri::command]
async fn update_tag_categories(state: State<'_, AppState>, tag_id: i64, category_keys: Vec<String>) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::update_tag_categories(&pool, tag_id, &category_keys).await.map_err(|e| e.to_string())
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

#[tauri::command]
async fn update_actor_work_period(
    state: State<'_, AppState>,
    actor_id: i64,
    work_type: String,
    work_id: i64,
    period_id: Option<i64>,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::update_actor_work_period(&pool, actor_id, &work_type, work_id, period_id)
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
        open_player_window(app, state, id).await?;
        db::record_play_history(&pool, video.id, 0.0, video.duration)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}


#[tauri::command]
async fn open_player_window(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: i64,
) -> Result<(), String> {
    eprintln!("[player] open_player_window called for video id={}", id);

    // 最终播放器方案：所有平台统一由 tauri-plugin-mpv + mpv --wid 嵌入播放，
    // 播放器窗口必须固定 label=player，保证插件实例、窗口句柄、get_player_wid 和清理逻辑指向同一窗口。

    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };

    let video = db::get_video(&pool, id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "视频不存在".to_string())?;

    // 系统播放器模式：交给操作系统默认播放器，或用户在设置中指定的本地播放器。
    // 内置「离火播放器」链路保留在下方，Windows 默认仍走内置播放体验。
    if use_external_player() {
        let video_path = Path::new(&video.file_path);
        if !video_path.is_file() {
            return Err("视频文件不存在，请确认文件仍在原位置".to_string());
        }

        if let Some(player_window) = app.get_webview_window("player") {
            let _ = player_window.close();
        }

        open_video_with_system_player(video_path)?;
        return Ok(());
    }

    let mut target_w = 1280.0;
    let mut target_h = 720.0;
    if let Some(main) = app.get_webview_window("main") {
        let main_size = main.outer_size().map_err(|e| e.to_string())?;
        let scale = main.scale_factor().unwrap_or(1.0);
        target_w = (main_size.width as f64 / scale * 0.90).max(960.0);
        target_h = (main_size.height as f64 / scale * 0.88).max(540.0);
    } else if let Some(monitor) = app.primary_monitor().map_err(|e| e.to_string())? {
        let scale = monitor.scale_factor();
        target_w = (monitor.size().width as f64 / scale * 0.78).max(960.0);
        target_h = (monitor.size().height as f64 / scale * 0.78).max(540.0);
    }

    // 播放窗口按视频比例贴近主程序窗口大小：高分辨率会被限制，低分辨率也会自动放大。
    let aspect = match (video.width, video.height) {
        (Some(w), Some(h)) if w > 0 && h > 0 => (w as f64 / h as f64).clamp(0.45, 3.20),
        _ => 16.0 / 9.0,
    };
    let mut player_w = target_w;
    let mut player_h = (player_w / aspect).round();
    if player_h > target_h {
        player_h = target_h;
        player_w = (player_h * aspect).round();
    }
    player_w = player_w.max(640.0).min(target_w);
    player_h = player_h.max(360.0).min(target_h);

    // Use the same window creation path as player.rs to ensure consistent
    // window properties (transparent, decorations, skip_taskbar, etc.).
    let window = player::get_or_create_player_window(&app)
        .map_err(|e| e.to_string())?;

    window.set_title(&format!("ChangLi Player - {}", video.file_name)).map_err(|e| e.to_string())?;
    window.set_size(tauri::LogicalSize::new(player_w, player_h)).map_err(|e| e.to_string())?;

    // Navigate to the video — if the window already existed, replace the URL;
    // if newly created, the URL was set to a default by get_or_create_player_window.
    let js = format!("window.location.replace('index.html?window=player&videoId={}');", video.id);
    window.eval(&js).map_err(|e| e.to_string())?;

    if let Some(main) = app.get_webview_window("main") {
        let main_pos = main.outer_position().map_err(|e| e.to_string())?;
        let main_size = main.outer_size().map_err(|e| e.to_string())?;
        let scale = main.scale_factor().unwrap_or(1.0);
        let x = main_pos.x as f64 / scale + (main_size.width as f64 / scale - player_w) / 2.0;
        let y = main_pos.y as f64 / scale + (main_size.height as f64 / scale - player_h) / 2.0;
        window
            .set_position(tauri::LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    } else {
        window.center().map_err(|e| e.to_string())?;
    }
    // 先立即显示并聚焦，避免 mpv 已在后台播放但窗口因 dwidth/dheight 事件未触发而一直隐藏。
    // 前端收到视频尺寸后仍会按比例做小幅微调。
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

fn use_external_player() -> bool {
    cfg!(any(target_os = "macos", target_os = "windows")) && storage::player_mode() != "builtin"
}

fn open_video_with_system_player(video_path: &Path) -> Result<(), String> {
    let player_path = storage::external_player_path()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty());

    #[cfg(target_os = "macos")]
    {
        let mut command = std::process::Command::new("open");
        if let Some(player_path) = player_path {
            if !Path::new(&player_path).exists() {
                return Err("选择的播放器不存在，请在设置中重新选择".to_string());
            }
            command.arg("-a").arg(player_path);
        }
        command
            .arg(video_path)
            .spawn()
            .map_err(|e| format!("打开系统播放器失败：{e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(player_path) = player_path {
            if !Path::new(&player_path).exists() {
                return Err("选择的播放器不存在，请在设置中重新选择".to_string());
            }
            std::process::Command::new(player_path)
                .arg(video_path)
                .spawn()
                .map_err(|e| format!("打开系统播放器失败：{e}"))?;
            return Ok(());
        }
        open::that(video_path).map_err(|e| format!("打开系统默认播放器失败：{e}"))?;
        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = video_path;
        Err("当前平台不支持系统播放器模式".to_string())
    }
}

/// 一键切换游戏覆盖禁用状态
#[tauri::command]
fn set_game_overlay_disabled(disabled: bool) -> Result<String, String> {
    player::set_game_overlay_disabled(disabled)
}

/// 读取游戏覆盖当前禁用状态
#[tauri::command]
fn get_game_overlay_disabled() -> Result<bool, String> {
    player::read_game_overlay_disabled()
}

#[tauri::command]
async fn get_missing_series_videos(
    state: State<'_, AppState>,
    series_id: i64,
) -> Result<Vec<db::Video>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };

    let videos = db::get_series_videos(&pool, series_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(videos
        .into_iter()
        .filter(|video| !std::path::Path::new(&video.file_path).is_file())
        .collect())
}

#[tauri::command]
async fn update_play_history(
    state: State<'_, AppState>,
    video_id: i64,
    last_position: f64,
    total_duration: Option<f64>,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::record_play_history(&pool, video_id, last_position, total_duration)
        .await
        .map_err(|e| e.to_string())
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
async fn get_video_series_map(state: State<'_, AppState>) -> Result<Vec<(i64, i64)>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_video_series_map(&pool).await.map_err(|e| e.to_string())
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
async fn get_series_seasons(
    state: State<'_, AppState>,
    series_id: i64,
) -> Result<Vec<db::SeasonInfo>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_series_seasons(&pool, series_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_season(
    state: State<'_, AppState>,
    series_id: i64,
    season: i32,
    subtitle: Option<String>,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::delete_season(&pool, series_id, season, subtitle)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_season(
    state: State<'_, AppState>,
    series_id: i64,
    season: i32,
    subtitle: Option<String>,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::create_season(&pool, series_id, season, subtitle.as_deref())
        .await
        .map_err(|e| e.to_string())
}


#[tauri::command]
async fn update_season_group(
    state: State<'_, AppState>,
    series_id: i64,
    from_season: i32,
    from_subtitle: Option<String>,
    to_season: i32,
    to_subtitle: Option<String>,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::update_season_group(&pool, series_id, from_season, from_subtitle, to_season, to_subtitle)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn move_videos_to_season(
    state: State<'_, AppState>,
    series_id: i64,
    video_ids: Vec<i64>,
    season: i32,
    subtitle: Option<String>,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::move_videos_to_season(&pool, series_id, video_ids, season, subtitle)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_video_subtitle(
    state: State<'_, AppState>,
    video_id: i64,
    subtitle: Option<String>,
) -> Result<(), String> {
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
    db::rescan_all_series_metadata(&pool)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn rescan_anime_metadata(state: State<'_, AppState>) -> Result<(i64, i64), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::rescan_anime_metadata(&pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn rescan_adult_metadata(state: State<'_, AppState>) -> Result<(i64, i64), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::rescan_adult_metadata(&pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn rescan_single_series_metadata(
    state: State<'_, AppState>,
    series_id: i64,
) -> Result<bool, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::rescan_single_series_metadata(&pool, series_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn check_series_updates(
    state: State<'_, AppState>,
    series_id: i64,
) -> Result<db::SeriesUpdateResult, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::check_series_updates(&pool, series_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn check_category_updates(
    state: State<'_, AppState>,
    category_key: String,
) -> Result<db::CategoryUpdateResult, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::check_category_updates(&pool, &category_key)
        .await
        .map_err(|e| e.to_string())
}

// 演员多海报命令
#[tauri::command]
async fn get_actor_photos(
    state: State<'_, AppState>,
    actor_id: i64,
) -> Result<Vec<db::ActorPhoto>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_actor_photos(&pool, actor_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_actor_photo_cmd(
    state: State<'_, AppState>,
    actor_id: i64,
    photo: Option<String>,
    photo_base64: Option<String>,
    is_primary: Option<i32>,
) -> Result<db::ActorPhoto, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    let stored_photo = photo.as_deref().map(normalize_photo_path_for_storage);
    // 如果没传 base64，从文件路径读取生成
    let effective_base64 = if photo_base64.is_some() {
        photo_base64
    } else if let Some(ref path) = stored_photo {
        let resolved = storage::resolve_data_path(path);
        db::image_data_url(&resolved)
    } else {
        None
    };
    db::add_actor_photo(
        &pool,
        actor_id,
        stored_photo.as_deref(),
        effective_base64.as_deref(),
        is_primary.unwrap_or(0),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_actor_photo_cmd(state: State<'_, AppState>, photo_id: i64) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::delete_actor_photo(&pool, photo_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_primary_photo_cmd(
    state: State<'_, AppState>,
    actor_id: i64,
    photo_id: i64,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::set_primary_photo(&pool, actor_id, photo_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn reorder_actor_photos_cmd(
    state: State<'_, AppState>,
    actor_id: i64,
    photo_ids: Vec<i64>,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::reorder_actor_photos(&pool, actor_id, photo_ids)
        .await
        .map_err(|e| e.to_string())
}


#[derive(serde::Serialize)]
struct ReleaseAssetInfo {
    name: String,
    browser_download_url: String,
}

#[derive(serde::Serialize)]
struct LatestReleaseInfo {
    tag_name: String,
    html_url: String,
    body: Option<String>,
    assets: Vec<ReleaseAssetInfo>,
}

#[derive(serde::Deserialize)]
struct GitHubReleaseAsset {
    name: String,
    browser_download_url: String,
}

#[derive(serde::Deserialize)]
struct GitHubLatestRelease {
    tag_name: String,
    html_url: String,
    body: Option<String>,
    assets: Vec<GitHubReleaseAsset>,
}

// ==================== 应用内更新下载 ====================

#[derive(Clone, serde::Serialize)]
struct UpdateDownloadProgress {
    downloaded: u64,
    total: u64,
    percentage: f64,
}

#[tauri::command]
async fn download_update(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    url: String,
    file_name: String,
) -> Result<String, String> {
    // 重置取消标志
    state.update_download_cancel.store(false, Ordering::SeqCst);

    let update_dir = std::env::current_exe()
        .map_err(|e| format!("获取应用路径失败: {e}"))?
        .parent()
        .ok_or("获取应用目录失败")?
        .join("updates");
    
    // 清理旧的下载文件
    if update_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&update_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.ends_with(".exe") || name.ends_with(".dmg") || name.ends_with(".msi") {
                        let _ = std::fs::remove_file(&path);
                    }
                }
            }
        }
    }
    
    std::fs::create_dir_all(&update_dir).map_err(|e| format!("创建更新目录失败: {e}"))?;
    let file_path = update_dir.join(&file_name);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .redirect(reqwest::redirect::Policy::limited(20))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let response = client
        .get(&url)
        .header(reqwest::header::USER_AGENT, "ChangLi-App/1.0")
        .send()
        .await
        .map_err(|e| format!("下载请求失败: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("下载失败，HTTP 状态码: {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    let mut file = tokio::fs::File::create(&file_path)
        .await
        .map_err(|e| format!("创建文件失败: {e}"))?;

    let mut stream = response.bytes_stream();
    let mut last_emit = std::time::Instant::now();

    while let Some(chunk) = stream.next().await {
        // 检查取消标志
        if state.update_download_cancel.load(Ordering::SeqCst) {
            drop(file);
            let _ = tokio::fs::remove_file(&file_path).await;
            return Err("下载已取消".to_string());
        }

        let chunk = chunk.map_err(|e| format!("下载数据失败: {e}"))?;
        use tokio::io::AsyncWriteExt;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入文件失败: {e}"))?;

        downloaded += chunk.len() as u64;

        // 每 200ms 发送一次进度事件，避免过多事件
        if last_emit.elapsed() >= std::time::Duration::from_millis(200) || downloaded >= total_size {
            let percentage = if total_size > 0 {
                (downloaded as f64 / total_size as f64) * 100.0
            } else {
                0.0
            };
            let _ = app.emit(
                "update-download-progress",
                UpdateDownloadProgress {
                    downloaded,
                    total: total_size,
                    percentage,
                },
            );
            last_emit = std::time::Instant::now();
        }
    }

    file.sync_all()
        .await
        .map_err(|e| format!("同步文件失败: {e}"))?;

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn cancel_update_download(state: State<'_, AppState>) -> Result<(), String> {
    state.update_download_cancel.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle, file_path: String) -> Result<(), String> {
    // 先打开安装包，再退出程序，避免 macOS 覆盖安装时主程序仍在运行
    open::that(&file_path).map_err(|e| format!("打开安装包失败: {e}"))?;
    // 延迟 500ms 确保安装程序已启动
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    // 退出程序（macOS 关窗口不等于退出，必须用 app.exit）
    app.exit(0);
    Ok(())
}

/// 安装 WebView2 运行时（静默安装）
#[cfg(target_os = "windows")]
fn install_webview2_silent(app: &tauri::AppHandle) {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let installer = resource_dir.join("webview2").join("MicrosoftEdgeWebview2Setup.exe");
        if installer.exists() {
            eprintln!("[webview2] 执行静默安装: {}", installer.display());
            let _ = std::process::Command::new(&installer)
                .args(["/silent", "/install"])
                .spawn();
        } else {
            eprintln!("[webview2] 安装包不存在: {}", installer.display());
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn install_webview2_silent(_app: &tauri::AppHandle) {}

/// 获取更新缓存目录路径
#[tauri::command]
async fn get_updates_dir(app: tauri::AppHandle) -> Result<String, String> {
    let update_dir = std::env::current_exe()
        .map_err(|e| format!("获取应用路径失败: {e}"))?
        .parent()
        .ok_or("获取应用目录失败")?
        .join("updates");
    Ok(update_dir.to_string_lossy().to_string())
}

/// 获取已下载的更新文件信息
#[tauri::command]
async fn get_downloaded_update(app: tauri::AppHandle) -> Result<Option<(String, String, u64)>, String> {
    let update_dir = std::env::current_exe()
        .map_err(|e| format!("获取应用路径失败: {e}"))?
        .parent()
        .ok_or("获取应用目录失败")?
        .join("updates");
    if !update_dir.exists() {
        return Ok(None);
    }
    
    // 找最新的安装包
    let mut candidates: Vec<(std::time::SystemTime, std::path::PathBuf)> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&update_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.ends_with(".exe") || name.ends_with(".dmg") {
                    if let Ok(meta) = path.metadata() {
                        if let Ok(modified) = meta.modified() {
                            candidates.push((modified, path));
                        }
                    }
                }
            }
        }
    }
    
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    
    if let Some((_, path)) = candidates.first() {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        Ok(Some((path.to_string_lossy().to_string(), name, size)))
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn check_env_dependencies(app: tauri::AppHandle) -> Result<Vec<(String, bool, String)>, String> {
    let mut results = Vec::new();

    // 检查 WebView2 (Windows)
    #[cfg(target_os = "windows")]
    {
        let webview2_installed = {
            let path1 = std::path::PathBuf::from(r"C:\Program Files (x86)\Microsoft\EdgeWebView\Application");
            let path2 = std::path::PathBuf::from(r"C:\Program Files\Microsoft\EdgeWebView\Application");
            let path3 = std::path::PathBuf::from(r"C:\Program Files (x86)\Microsoft\Edge\Application");
            path1.exists() || path2.exists() || path3.exists()
        };
        results.push((
            "WebView2 运行时".to_string(),
            webview2_installed,
            if webview2_installed { "已安装".to_string() } else { "未安装，播放器和界面依赖此组件".to_string() },
        ));
    }

    // 检查 mpv
    {
        let mpv_found = {
            #[cfg(target_os = "macos")]
            {
                std::path::Path::new("/opt/homebrew/bin/mpv").exists()
                    || std::path::Path::new("/usr/local/bin/mpv").exists()
                    || std::process::Command::new("which").arg("mpv").output().map(|o| o.status.success()).unwrap_or(false)
            }
            #[cfg(target_os = "windows")]
            {
                // 检查 PATH
                let in_path = std::process::Command::new("where").arg("mpv.exe").output().map(|o| o.status.success()).unwrap_or(false);
                // 检查应用内置
                let bundled = app.path().resource_dir()
                    .map(|rd| {
                        rd.join("mpv").join("mpv.exe").exists()
                        || rd.join("mpv.exe").exists()
                        || rd.join("resources").join("mpv").join("mpv.exe").exists()
                        || rd.join("resources").join("mpv.exe").exists()
                    })
                    .unwrap_or(false);
                in_path || bundled
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            { false }
        };
        results.push((
            "mpv 播放器".to_string(),
            mpv_found,
            if mpv_found { "已安装".to_string() } else { "未安装，视频播放依赖此组件".to_string() },
        ));
    }

    // 检查 ffmpeg
    {
        let ffmpeg_found = {
            #[cfg(target_os = "macos")]
            {
                std::path::Path::new("/opt/homebrew/bin/ffmpeg").exists()
                    || std::path::Path::new("/usr/local/bin/ffmpeg").exists()
                    || std::process::Command::new("which").arg("ffmpeg").output().map(|o| o.status.success()).unwrap_or(false)
            }
            #[cfg(target_os = "windows")]
            {
                let in_path = std::process::Command::new("where").arg("ffmpeg.exe").output().map(|o| o.status.success()).unwrap_or(false);
                let bundled = app.path().resource_dir()
                    .map(|rd| {
                        rd.join("ffmpeg").join("ffmpeg.exe").exists()
                        || rd.join("ffmpeg.exe").exists()
                        || rd.join("resources").join("ffmpeg").join("ffmpeg.exe").exists()
                        || rd.join("resources").join("ffmpeg.exe").exists()
                    })
                    .unwrap_or(false);
                in_path || bundled
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            { false }
        };
        results.push((
            "ffmpeg".to_string(),
            ffmpeg_found,
            if ffmpeg_found { "已安装".to_string() } else { "未安装，缩略图生成依赖此组件".to_string() },
        ));
    }

    Ok(results)
}

#[tauri::command]
async fn install_dependency(name: String) -> Result<String, String> {
    match name.as_str() {
        "WebView2 运行时" => {
            // 下载 WebView2 bootstrapper 并静默安装
            let url = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
            let resp = reqwest::get(url).await.map_err(|e| format!("下载失败: {e}"))?;
            let bytes = resp.bytes().await.map_err(|e| format!("读取失败: {e}"))?;
            let installer_path = std::env::temp_dir().join("MicrosoftEdgeWebview2Setup.exe");
            std::fs::write(&installer_path, &bytes).map_err(|e| format!("写入失败: {e}"))?;
            std::process::Command::new(&installer_path)
                .args(["/silent", "/install"])
                .spawn()
                .map_err(|e| format!("安装失败: {e}"))?;
            Ok("WebView2 安装程序已启动，请等待安装完成".to_string())
        }
        "mpv 播放器" => {
            #[cfg(target_os = "macos")]
            {
                let status = std::process::Command::new("brew")
                    .args(["install", "mpv"])
                    .status()
                    .map_err(|e| format!("brew 执行失败: {e}"))?;
                if status.success() {
                    Ok("mpv 安装完成".to_string())
                } else {
                    Err("mpv 安装失败，请手动运行 brew install mpv".to_string())
                }
            }
            #[cfg(target_os = "windows")]
            {
                // 尝试 winget 安装
                let status = std::process::Command::new("winget")
                    .args(["install", "--id", "sharkdp.mpv", "--accept-package-agreements", "--accept-source-agreements"])
                    .status();
                if status.map(|s| s.success()).unwrap_or(false) {
                    Ok("mpv 安装完成".to_string())
                } else {
                    // 打开浏览器下载
                    let _ = open::that("https://sourceforge.net/projects/mpv-player-windows/files/");
                    Ok("winget 不可用，已在浏览器中打开 mpv 下载页面，请手动安装".to_string())
                }
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            { Err("不支持自动安装".to_string()) }
        }
        "ffmpeg" => {
            #[cfg(target_os = "macos")]
            {
                let status = std::process::Command::new("brew")
                    .args(["install", "ffmpeg"])
                    .status()
                    .map_err(|e| format!("brew 执行失败: {e}"))?;
                if status.success() {
                    Ok("ffmpeg 安装完成".to_string())
                } else {
                    Err("ffmpeg 安装失败，请手动运行 brew install ffmpeg".to_string())
                }
            }
            #[cfg(target_os = "windows")]
            {
                // 尝试 winget 安装
                let status = std::process::Command::new("winget")
                    .args(["install", "--id", "Gyan.FFmpeg", "--accept-package-agreements", "--accept-source-agreements"])
                    .status();
                if status.map(|s| s.success()).unwrap_or(false) {
                    Ok("ffmpeg 安装完成".to_string())
                } else {
                    let _ = open::that("https://www.gyan.dev/ffmpeg/builds/");
                    Ok("winget 不可用，已在浏览器中打开 ffmpeg 下载页面，请手动安装".to_string())
                }
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            { Err("不支持自动安装".to_string()) }
        }
        _ => Err(format!("未知依赖: {}", name)),
    }
}

#[tauri::command]
async fn cleanup_old_installers() -> Result<u32, String> {
    let mut count = 0u32;
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(app_dir) = exe_path.parent() {
            if let Ok(entries) = std::fs::read_dir(app_dir) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let path = entry.path();
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        if name.ends_with(".dmg") || name.ends_with(".exe") || name.ends_with(".msi") {
                            if std::fs::remove_file(&path).is_ok() {
                                count += 1;
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(count)
}

#[tauri::command]
async fn check_latest_release() -> Result<LatestReleaseInfo, String> {
    const REPO: &str = "YeSuper-git/ChangLi";
    const API_URL: &str = "https://api.github.com/repos/YeSuper-git/ChangLi/releases/latest";
    const LATEST_URL: &str = "https://github.com/YeSuper-git/ChangLi/releases/latest";
    const UA: &str = "ChangLi-App/1.0 (+https://github.com/YeSuper-git/ChangLi)";

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let api_result = client
        .get(API_URL)
        .header(reqwest::header::USER_AGENT, UA)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await;

    match api_result {
        Ok(response) if response.status().is_success() => {
            let release = response
                .json::<GitHubLatestRelease>()
                .await
                .map_err(|e| format!("解析 GitHub Release 响应失败: {e}"))?;
            return Ok(LatestReleaseInfo {
                tag_name: release.tag_name,
                html_url: release.html_url,
                body: release.body,
                assets: release
                    .assets
                    .into_iter()
                    .map(|asset| ReleaseAssetInfo {
                        name: asset.name,
                        browser_download_url: asset.browser_download_url,
                    })
                    .collect(),
            });
        }
        Ok(response) => {
            eprintln!("[ChangLi] GitHub Release API 返回 {}，尝试 releases/latest fallback", response.status());
        }
        Err(error) => {
            eprintln!("[ChangLi] GitHub Release API 请求失败: {error}，尝试 releases/latest fallback");
        }
    }

    let response = client
        .get(LATEST_URL)
        .header(reqwest::header::USER_AGENT, UA)
        .send()
        .await
        .map_err(|e| format!("检查更新失败: {e}"))?;
    let final_url = response.url().clone();
    let tag = final_url
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .filter(|segment| segment.starts_with('v'))
        .ok_or_else(|| format!("无法解析最新版本地址: {final_url}"))?
        .to_string();
    let version = tag.trim_start_matches('v');
    let full_exe_name = format!("ChangLi_{version}_x64-setup.exe");
    let update_exe_name = format!("ChangLi_{version}_x64-update.exe");
    let dmg_name = format!("ChangLi_{version}_aarch64.dmg");
    let html_url = format!("https://github.com/{REPO}/releases/tag/{tag}");
    // 优先使用更新包（轻量），fallback 到完整安装包
    let update_url = format!("https://github.com/{REPO}/releases/download/{tag}/{update_exe_name}");
    let full_url = format!("https://github.com/{REPO}/releases/download/{tag}/{full_exe_name}");
    let exe_url = update_url;
    let dmg_url = format!("https://github.com/{REPO}/releases/download/{tag}/{dmg_name}");

    // 尝试获取 release body（通过 API 获取 release 信息）
    // 检查更新包是否存在，不存在则 fallback 到完整安装包
    let exe_url = {
        let check_client = reqwest::Client::builder()
            .user_agent("ChangLi")
            .build()
            .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
        let resp = check_client.head(&exe_url).send().await;
        match resp {
            Ok(r) if r.status().is_success() => exe_url,
            _ => {
                eprintln!("[update] 更新包不存在，使用完整安装包");
                full_url
            }
        }
    };

    let body = {
        let release_api = format!("https://api.github.com/repos/{REPO}/releases/tags/{tag}");
        match client.get(&release_api)
            .header(reqwest::header::ACCEPT, "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send().await
        {
            Ok(resp) if resp.status().is_success() => {
                resp.json::<serde_json::Value>().await
                    .ok()
                    .and_then(|v| v["body"].as_str().map(|s| s.to_string()))
            }
            _ => None
        }
    };

    Ok(LatestReleaseInfo {
        tag_name: tag,
        html_url,
        body,
        assets: vec![
            ReleaseAssetInfo {
                name: exe_url.split('/').last().unwrap_or(&"ChangLi.exe").to_string(),
                browser_download_url: exe_url,
            },
            ReleaseAssetInfo {
                name: dmg_name,
                browser_download_url: dmg_url,
            },
        ],
    })
}

fn main() {
    let builder = tauri::Builder::default();
    // macOS must never register the external-process mpv plugin: even accidental
    // plugin:mpv|init calls must fail instead of opening an external player.
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_plugin_libmpv::init());
    #[cfg(not(target_os = "macos"))]
    let builder = builder.plugin(tauri_plugin_mpv::init());

    builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            db: Mutex::new(None),
            poster_repair_status: Arc::new(Mutex::new(PosterRepairStatus::default())),
            update_download_cancel: Arc::new(AtomicBool::new(false)),
        })
        .setup(|app| {
            // Windows: 后台静默安装 WebView2
            #[cfg(target_os = "windows")]
            {
                let app_handle = app.handle().clone();
                std::thread::spawn(move || {
                    install_webview2_silent(&app_handle);
                });
            }

            // 创建主窗口
            #[cfg(target_os = "macos")]
            {
                use tauri::WebviewUrl;
                use tauri::WebviewWindowBuilder;
                let _window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("长离")
                    .inner_size(1280.0, 800.0)
                    .min_inner_size(800.0, 600.0)
                    .resizable(true)
                    .fullscreen(false)
                    .decorations(true)
                    .transparent(true)
                    .hidden_title(true)
                    .title_bar_style(tauri::TitleBarStyle::Overlay)
                    .traffic_light_position(tauri::LogicalPosition::new(14, 32))
                    .center()
                    .build()
                    .expect("failed to create main window");
            }
            #[cfg(not(target_os = "macos"))]
            {
                use tauri::WebviewUrl;
                use tauri::WebviewWindowBuilder;
                let _window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("长离")
                    .inner_size(1280.0, 800.0)
                    .min_inner_size(800.0, 600.0)
                    .resizable(true)
                    .fullscreen(false)
                    .transparent(true)
                    .decorations(false)
                    .center()
                    .build()
                    .expect("failed to create main window");
            }

            if let Some(window) = app.get_webview_window("main") {
                window.set_always_on_top(true)?;
                window.set_focus()?;
                window.set_always_on_top(false)?;
            }
            player::disable_game_dvr();
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                player::handle_main_window_event(&window.app_handle(), event);
            } else if window.label() == "player" {
                player::handle_player_window_event(&window.app_handle(), event);
            }
        })
        .invoke_handler(tauri::generate_handler![
            init_db,
            check_latest_release,
            download_update,
            cancel_update_download,
            install_update,
            player::request_close_player,
            get_downloaded_update,
            get_updates_dir,
            detect_rss_url,
            fetch_rss,
            extract_keywords_from_rss,
            create_subscription,
            get_subscription_by_series,
            get_all_subscriptions,
            delete_subscription,
            update_subscription_cmd,
            check_subscription_updates,
            update_subscription_keywords,
            get_subscription_keywords,
            check_env_dependencies,
            install_dependency,
            cleanup_old_installers,
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
            scan_videos_for_actor,
            get_videos,
            get_video,
            delete_video,
            get_video_series_list,
            get_video_series_poster_data_url,
            get_video_series_by_tag,
            get_video_series_by_tag_name,
            get_video_series_by_actor,
            get_series_playback_video,
            get_video_series_detail,
            update_video_series,
            delete_video_series,
            delete_video_series_batch,
            delete_videos_batch,
            switch_series_type,
            switch_series_type_to,
            add_video_to_series,
            add_videos_to_series,
            create_empty_video_series,
            update_video_episode_numbers,
            add_category_series_by_paths,
            remove_video_from_series,
            get_actors,
            get_actors_by_category,
            increment_actor_view,
            get_actor,
            add_actor,
            update_actor,
            delete_actor,
            get_actor_resources,
            get_tags,
            get_tags_by_category,
            add_tag,
            delete_tag,
            update_tag,
            get_tags_with_categories,
            update_tag_categories,
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
            update_actor_work_period,
            play_video,
            open_player_window,
            get_missing_series_videos,
            check_series_updates,
            check_category_updates,
            update_play_history,
            get_play_history,
            get_video_series_map,
            get_recent_watch_items,
            update_watch_progress,
            get_watch_progress,
            get_resource_watch_progress,
            update_video,
            save_actor_photo,
            save_video_thumbnail,
            create_preview_file_path,
            delete_preview_file,
            get_storage_info,
            open_data_dir,
            set_download_dir,
            set_auto_use_last_download_dir,
            set_player_mode,
            set_external_player_path,
            list_installed_players,
            open_series_in_file_manager,
            repair_missing_posters_silent,
            start_poster_update_silent,
            get_poster_repair_status,
            toggle_favorite,
            toggle_chinese_sub,
            toggle_watched,
            get_completion_records,
            save_completion_record,
            delete_completion_record,
            get_favorite_videos_cmd,
            get_favorite_series_cmd,
            rescan_all_series_metadata,
            rescan_single_series_metadata,
            delete_all_videos,
            delete_all_anime,
            delete_all_adult,
            delete_videos_by_category,
            rescan_anime_metadata,
            rescan_adult_metadata,
            rescan_category_metadata,
            get_series_seasons,
            delete_season,
            create_season,
            update_season_group,
            move_videos_to_season,
            update_video_subtitle,
            get_actor_periods,
            add_actor_period,
            update_actor_period,
            delete_actor_period,
            reorder_actor_periods_cmd,
            get_actor_work_period_map,
            get_actor_photos,
            add_actor_photo_cmd,
            delete_actor_photo_cmd,
            set_primary_photo_cmd,
            reorder_actor_photos_cmd,
            get_all_categories,
            create_category_cmd,
            update_category_cmd,
            delete_category_cmd,
            reorder_categories_cmd,
            scan_category,
            get_all_actor_fields,
            update_actor_field_cmd,
            create_actor_field_cmd,
            delete_actor_field_cmd,
            reorder_actor_fields_cmd,
            get_preset_templates_cmd,
            get_extension_preset_templates_cmd,
            is_preset_template_enabled_cmd,
            enable_preset_template_cmd,
            disable_preset_template_cmd,
            regenerate_all_poster_base64,
            get_video_series_list_lite,
            player::mpv_send_command,
            set_game_overlay_disabled,
            get_game_overlay_disabled,
            player::get_player_wid,
            player::find_mpv_path,
            player::kill_mpv,
            preview::thumbnail_service::get_preview_thumb,
            preview::thumbnail_service::prebuild_thumbnails,
            preview::thumbnail_service::get_thumb_cache_dir,
            preview::thumbnail_service::abort_prebuild_cmd,
            preview::thumbnail_service::clear_preview_cache,
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
async fn toggle_favorite(
    state: State<'_, AppState>,
    id: i64,
    fav_type: String,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    match fav_type.as_str() {
        "video" => db::toggle_favorite_video(&pool, id)
            .await
            .map_err(|e| e.to_string()),
        "series" => db::toggle_favorite_series(&pool, id)
            .await
            .map_err(|e| e.to_string()),
        _ => Err("无效类型".to_string()),
    }
}

#[tauri::command]
async fn toggle_chinese_sub(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::toggle_chinese_sub_series(&pool, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn toggle_watched(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::toggle_watched_series(&pool, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_completion_records(
    state: State<'_, AppState>,
) -> Result<Vec<db::SeriesCompletionRecord>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_completion_records(&pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_completion_record(
    state: State<'_, AppState>,
    input: db::CompletionRecordInput,
) -> Result<db::SeriesCompletionRecord, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::upsert_completion_record(&pool, input)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_completion_record(state: State<'_, AppState>, series_id: i64) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::delete_completion_record(&pool, series_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_favorite_videos_cmd(state: State<'_, AppState>) -> Result<Vec<db::Video>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_favorite_videos(&pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_favorite_series_cmd(
    state: State<'_, AppState>,
) -> Result<Vec<db::VideoSeries>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_favorite_series(&pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_all_videos(state: State<'_, AppState>) -> Result<(i64, i64), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::delete_all_videos(&pool)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn delete_all_anime(state: State<'_, AppState>) -> Result<(i64, i64), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::delete_all_anime(&pool).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_all_adult(state: State<'_, AppState>) -> Result<(i64, i64), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::delete_all_adult(&pool).await.map_err(|e| e.to_string())
}
#[tauri::command]
async fn delete_videos_by_category(state: State<'_, AppState>, category_key: String) -> Result<(i64, i64), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::delete_videos_by_category(&pool, &category_key).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn rescan_category_metadata(state: State<'_, AppState>, category_key: String) -> Result<(i64, i64, i64, i64), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::rescan_category_metadata(&pool, &category_key).await.map_err(|e| e.to_string())
}

// ==================== 大类配置 Commands ====================

#[tauri::command]
async fn get_all_categories(state: State<'_, AppState>) -> Result<Vec<db::Category>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_all_categories(&pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_category_cmd(
    state: State<'_, AppState>,
    key: String,
    name: String,
    card_layout: String,
    features: String,
    scan_path: Option<String>,
) -> Result<db::Category, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::create_category(&pool, &key, &name, &card_layout, &features, scan_path.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_category_cmd(
    state: State<'_, AppState>,
    key: String,
    name: String,
    card_layout: String,
    features: String,
    scan_path: Option<String>,
) -> Result<db::Category, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::update_category(&pool, &key, &name, &card_layout, &features, scan_path.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_category_cmd(state: State<'_, AppState>, key: String) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::delete_category(&pool, &key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn reorder_categories_cmd(state: State<'_, AppState>, category_keys: Vec<String>) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::reorder_categories(&pool, &category_keys)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn scan_category(state: State<'_, AppState>, category_key: String) -> Result<ScanResult, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };

    // 1. 读取大类配置
    let category = db::get_category_by_key(&pool, &category_key)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("大类 '{}' 不存在", category_key))?;

    let scan_path = category.scan_path.ok_or_else(|| {
        format!("大类 '{}' 未设置扫描路径", category.name)
    })?;

    let path = Path::new(&scan_path);
    if !path.exists() {
        return Err(format!("扫描路径不存在: {}", scan_path));
    }

    // 解析 features
    let features: serde_json::Value = serde_json::from_str(&category.features).unwrap_or_default();
    let actors_enabled = features.get("actors").and_then(|v| v.as_bool()).unwrap_or(false);
    let tags_enabled = features.get("tags").and_then(|v| v.as_bool()).unwrap_or(false);

    let mut added: i64 = 0;
    let mut updated: i64 = 0;

    // 2. 检查 scan_path 下是否有子文件夹
    let mut has_subdirs = false;
    let mut has_videos = false;
    if let Ok(check_entries) = std::fs::read_dir(&scan_path) {
        for e in check_entries.filter_map(|e| e.ok()) {
            if e.path().is_dir() { has_subdirs = true; }
            if e.path().is_file() && scanner::is_video_file(&e.path()) { has_videos = true; }
        }
    }
    let root_poster = crate::scanner::find_folder_poster(std::path::Path::new(&scan_path));

    // 如果没有子文件夹，把 scan_path 本身当一个视频集；动漫暂无资源视频集可能只有海报、没有视频文件。
    if !has_subdirs && (has_videos || root_poster.is_some()) {
        let folder_name = std::path::Path::new(&scan_path)
            .file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let (series_title, code, has_chinese_sub) = extract_adult_metadata(&folder_name);
        let scan_result = scanner::scan_directory(&scan_path).await.map_err(|e| e.to_string())?;
        let poster = root_poster;
        let poster_base64 = poster.as_deref().and_then(|p| scanner::generate_thumbnail_base64(std::path::Path::new(p)));
        if let Some(existing) = db::get_video_series_by_folder_path(&pool, &scan_path).await.map_err(|e| e.to_string())? {
            // 全量检查更新只同步视频增删与分类关联，不改已有视频集海报。
            db::add_videos_batch(&pool, scan_result.videos, Some(existing.id)).await.map_err(|e| e.to_string())?;
            updated += 1;
        } else {
            let series = db::add_video_series(&pool, &series_title, Some(&scan_path), poster.as_deref(), Some("landscape"), Some("ongoing"), poster_base64.as_deref(), Some(&category_key)).await.map_err(|e| e.to_string())?;
            if let Some(c) = code {
                let _ = sqlx::query("UPDATE video_series SET code = ?, has_chinese_sub = ? WHERE id = ?").bind(&c).bind(has_chinese_sub).bind(series.id).execute(&pool).await;
            }
            db::add_videos_batch(&pool, scan_result.videos, Some(series.id)).await.map_err(|e| e.to_string())?;
            let _ = db::update_video_series_display_type(&pool, series.id, &category_key).await;
            added += 1;
        }
        return Ok(ScanResult { added, updated });
    }

    // 3. 遍历子文件夹
    let entries = std::fs::read_dir(&scan_path).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();
        let entry_name = entry.file_name().to_string_lossy().to_string();

        if !entry_path.is_dir() {
            continue;
        }

        // 分类未勾选演员/标签时，分类下一层直接就是视频集
        if !actors_enabled && !tags_enabled {
            let scan_result = scanner::scan_directory(&entry_path.to_string_lossy())
                .await
                .map_err(|e| e.to_string())?;
            let poster = crate::scanner::find_folder_poster(&entry_path);
            let poster_base64 = poster.as_deref().and_then(|p| {
                scanner::generate_thumbnail_base64(std::path::Path::new(p))
            });
            let folder_path_str = entry_path.to_string_lossy().to_string();

            if let Some(existing) = db::get_video_series_by_folder_path(&pool, &folder_path_str)
                .await
                .map_err(|e| e.to_string())?
            {
                // 全量检查更新只同步视频增删与分类关联，不改已有视频集海报。
                db::add_videos_batch(&pool, scan_result.videos, Some(existing.id))
                    .await.map_err(|e| e.to_string())?;
                let _ = db::update_video_series_display_type(&pool, existing.id, &category_key).await;
                updated += 1;
            } else {
                let (series_title, code, has_chinese_sub) = extract_adult_metadata(&entry_name);
                let series = db::add_video_series(
                    &pool,
                    &series_title,
                    Some(&folder_path_str),
                    poster.as_deref(),
                    Some("landscape"),
                    Some("ongoing"),
                    poster_base64.as_deref(),
                    Some(&category_key),
                ).await.map_err(|e| e.to_string())?;
                if let Some(c) = code {
                    let _ = sqlx::query("UPDATE video_series SET code = ?, has_chinese_sub = ? WHERE id = ?")
                        .bind(&c).bind(has_chinese_sub).bind(series.id).execute(&pool).await;
                }
                db::add_videos_batch(&pool, scan_result.videos, Some(series.id))
                    .await.map_err(|e| e.to_string())?;
                let _ = db::update_video_series_display_type(&pool, series.id, &category_key).await;
                added += 1;
            }
            continue;
        }

        // 3. 根据 features 决定匹配方式
        let matched_actor: Option<i64> = if actors_enabled {
            match db::get_actor_by_name_or_jp(&pool, entry_name.trim()).await {
                Ok(Some(actor)) => Some(actor.id),
                _ => None,
            }
        } else {
            None
        };

        let matched_tag: Option<i64> = if tags_enabled && matched_actor.is_none() {
            match db::get_tag_by_name(&pool, entry_name.trim()).await {
                Ok(Some(tag)) => Some(tag.id),
                _ => None,
            }
        } else {
            None
        };

        // 都没匹配到但启用了标签/演员：跳过
        if (actors_enabled || tags_enabled) && matched_actor.is_none() && matched_tag.is_none() {
            eprintln!("[ChangLi] scan_category: 子文件夹 '{}' 未匹配到演员或标签，跳过", entry_name);
            continue;
        }

        // 4. 处理子文件夹下的子文件夹/视频
        // 如果匹配到演员，预加载时期列表用于时期文件夹匹配
        let actor_periods: Vec<db::ActorPeriod> = if let Some(aid) = matched_actor {
            db::get_actor_periods(&pool, aid).await.unwrap_or_default()
        } else {
            vec![]
        };
        // 演员时期名 → period_id 的映射
        let period_map: std::collections::HashMap<String, i64> = actor_periods
            .iter()
            .map(|p| (p.name.clone(), p.id))
            .collect();

        let sub_entries = std::fs::read_dir(&entry_path).map_err(|e| e.to_string())?;
        for sub_entry in sub_entries {
            let sub_entry = sub_entry.map_err(|e| e.to_string())?;
            let sub_entry_path = sub_entry.path();
            let sub_entry_name = sub_entry.file_name().to_string_lossy().to_string();

            // 如果子文件夹名匹配演员时期名，递归进时期文件夹扫描
            let matched_period_id = period_map.get(&sub_entry_name).copied();
            if sub_entry_path.is_dir() && matched_period_id.is_some() {
                let period_path = &sub_entry_path;
                let period_entries = std::fs::read_dir(period_path).map_err(|e| e.to_string())?;
                for period_entry in period_entries {
                    let period_entry = period_entry.map_err(|e| e.to_string())?;
                    let pe_path = period_entry.path();
                    if !pe_path.is_dir() { continue; }
                    let pe_name = period_entry.file_name().to_string_lossy().to_string();
                    let pe_result = scanner::scan_directory(&pe_path.to_string_lossy())
                        .await.map_err(|e| e.to_string())?;
                    // 时期文件夹下每个视频集必须只取自己的海报，不能取时期父目录海报，
                    // 否则同一时期下的多个无季视频集会被批量替换成同一张图。
                    let pe_poster = crate::scanner::find_folder_poster(&pe_path);
                    let pe_poster_base64 = pe_poster.as_deref().and_then(|p| {
                        scanner::generate_thumbnail_base64(std::path::Path::new(p))
                    });
                    let pe_folder = pe_path.to_string_lossy().to_string();

                    if let Some(existing) = db::get_video_series_by_folder_path(&pool, &pe_folder)
                        .await.map_err(|e| e.to_string())?
                    {
                        // 全量检查更新只同步视频增删与分类关联，不改已有视频集海报。
                        db::add_videos_batch(&pool, pe_result.videos, Some(existing.id))
                            .await.map_err(|e| e.to_string())?;
                        if let Some(aid) = matched_actor {
                            let _ = db::add_series_actor(&pool, existing.id, aid, None, matched_period_id).await;
                            let _ = db::update_video_series_display_type(&pool, existing.id, &category_key).await;
                        }
                        updated += 1;
                    } else {
                        let (series_title, code, has_chinese_sub) = extract_adult_metadata(&pe_name);
                        let series = db::add_video_series(
                            &pool, &series_title, Some(&pe_folder),
                            pe_poster.as_deref(), Some("landscape"), Some("ongoing"),
                            pe_poster_base64.as_deref(), Some(&category_key),
                        ).await.map_err(|e| e.to_string())?;
                        if let Some(c) = code {
                            let _ = sqlx::query("UPDATE video_series SET code = ?, has_chinese_sub = ? WHERE id = ?")
                                .bind(&c).bind(has_chinese_sub).bind(series.id).execute(&pool).await;
                        }
                        db::add_videos_batch(&pool, pe_result.videos, Some(series.id))
                            .await.map_err(|e| e.to_string())?;
                        if let Some(aid) = matched_actor {
                            let _ = db::add_series_actor(&pool, series.id, aid, None, matched_period_id).await;
                        }
                        let _ = db::update_video_series_display_type(&pool, series.id, &category_key).await;
                        added += 1;
                    }
                }
                continue; // 时期文件夹已处理，跳过下面的直接视频集逻辑
            }

            if sub_entry_path.is_dir() {
                let sub_result = scanner::scan_directory(&sub_entry_path.to_string_lossy())
                    .await
                    .map_err(|e| e.to_string())?;
                // 演员/标签目录下每个视频集必须只取自己的海报，不能取演员/标签父目录海报，
                // 否则同一演员/标签下多个无季视频集会被批量替换成同一张图。
                let sub_poster = crate::scanner::find_folder_poster(&sub_entry_path);
                let sub_poster_base64 = sub_poster.as_deref().and_then(|p| {
                    scanner::generate_thumbnail_base64(std::path::Path::new(p))
                });
                let folder_path_str = sub_entry_path.to_string_lossy().to_string();

                if let Some(existing) = db::get_video_series_by_folder_path(&pool, &folder_path_str)
                    .await
                    .map_err(|e| e.to_string())?
                {
                    // 全量检查更新只同步视频增删与分类关联，不改已有视频集海报。
                    db::add_videos_batch(&pool, sub_result.videos, Some(existing.id))
                        .await.map_err(|e| e.to_string())?;
                    if let Some(aid) = matched_actor {
                        let _ = db::add_series_actor(&pool, existing.id, aid, None, None).await;
                        let _ = db::update_video_series_display_type(&pool, existing.id, &category_key).await;
                    }
                    if let Some(tid) = matched_tag {
                        let _ = db::add_series_tag(&pool, existing.id, tid).await;
                        let _ = db::update_video_series_display_type(&pool, existing.id, &category_key).await;
                    }
                    updated += 1;
                } else {
                    let (series_title, code, has_chinese_sub) = extract_adult_metadata(&sub_entry_name);
                    let series = db::add_video_series(
                        &pool, &series_title, Some(&folder_path_str),
                        sub_poster.as_deref(), Some("landscape"), Some("ongoing"),
                        sub_poster_base64.as_deref(), Some(&category_key),
                    ).await.map_err(|e| e.to_string())?;
                    if let Some(c) = code {
                        let _ = sqlx::query("UPDATE video_series SET code = ?, has_chinese_sub = ? WHERE id = ?")
                            .bind(&c).bind(has_chinese_sub).bind(series.id).execute(&pool).await;
                    }
                    db::add_videos_batch(&pool, sub_result.videos, Some(series.id))
                        .await.map_err(|e| e.to_string())?;
                    if let Some(aid) = matched_actor {
                        let _ = db::add_series_actor(&pool, series.id, aid, None, None).await;
                    }
                    if let Some(tid) = matched_tag {
                        let _ = db::add_series_tag(&pool, series.id, tid).await;
                    }
                    let _ = db::update_video_series_display_type(&pool, series.id, &category_key).await;
                    added += 1;
                }
            } else if sub_entry_path.is_file() && scanner::is_video_file(&sub_entry_path) {
                let video = scanner::scan_video_file(&sub_entry_path, None)
                    .await.map_err(|e| e.to_string())?;
                let file_stem = sub_entry_path.file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| sub_entry_name.clone());
                let thumb = video.thumbnail.as_deref().and_then(|t| {
                    scanner::generate_thumbnail_base64(std::path::Path::new(t))
                });
                let file_path_str = sub_entry_path.to_string_lossy().to_string();

                if let Some(existing) = db::get_video_series_by_folder_path(&pool, &file_path_str)
                    .await.map_err(|e| e.to_string())?
                {
                    // 全量检查更新只同步视频增删与分类关联，不改已有视频集海报。
                    db::add_videos_batch(&pool, vec![video], Some(existing.id))
                        .await.map_err(|e| e.to_string())?;
                    if let Some(aid) = matched_actor {
                        let _ = db::add_series_actor(&pool, existing.id, aid, None, None).await;
                        let _ = db::update_video_series_display_type(&pool, existing.id, &category_key).await;
                    }
                    if let Some(tid) = matched_tag {
                        let _ = db::add_series_tag(&pool, existing.id, tid).await;
                        let _ = db::update_video_series_display_type(&pool, existing.id, &category_key).await;
                    }
                    updated += 1;
                } else {
                    let (series_title, code, has_chinese_sub) = extract_adult_metadata(&file_stem);
                    let series = db::add_video_series(
                        &pool, &series_title, Some(&file_path_str),
                        video.thumbnail.as_deref(), Some("landscape"), Some("ongoing"),
                        thumb.as_deref(),
                                None,
                    ).await.map_err(|e| e.to_string())?;
                    if let Some(c) = code {
                        let _ = sqlx::query("UPDATE video_series SET code = ?, has_chinese_sub = ? WHERE id = ?")
                            .bind(&c).bind(has_chinese_sub).bind(series.id).execute(&pool).await;
                    }
                    db::add_videos_batch(&pool, vec![video], Some(series.id))
                        .await.map_err(|e| e.to_string())?;
                    if let Some(aid) = matched_actor {
                        let _ = db::add_series_actor(&pool, series.id, aid, None, None).await;
                    }
                    if let Some(tid) = matched_tag {
                        let _ = db::add_series_tag(&pool, series.id, tid).await;
                    }
                    let _ = db::update_video_series_display_type(&pool, series.id, &category_key).await;
                    added += 1;
                }
            }
        }
    }

    Ok(ScanResult { added, updated })
}

// ==================== 演员字段配置 Commands ====================

#[tauri::command]
async fn get_all_actor_fields(
    state: State<'_, AppState>,
) -> Result<Vec<db::ActorField>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_all_actor_fields(&pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_actor_field_cmd(
    state: State<'_, AppState>,
    field_key: String,
    field_label: String,
    field_type: String,
    options: Option<String>,
    format: Option<String>,
    enabled: bool,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::update_actor_field(&pool, &field_key, &field_label, &field_type, options.as_deref(), format.as_deref(), enabled)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_actor_field_cmd(
    state: State<'_, AppState>,
    field_key: String,
    field_label: String,
    field_type: String,
    options: Option<String>,
    format: Option<String>,
) -> Result<db::ActorField, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::create_actor_field(&pool, &field_key, &field_label, &field_type, options.as_deref(), format.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_actor_field_cmd(
    state: State<'_, AppState>,
    field_key: String,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::delete_actor_field(&pool, &field_key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn reorder_actor_fields_cmd(
    state: State<'_, AppState>,
    field_keys: Vec<String>,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::reorder_actor_fields(&pool, &field_keys)
        .await
        .map_err(|e| e.to_string())
}

// ==================== 预设模板 Commands ====================

#[tauri::command]
async fn get_preset_templates_cmd(
    state: State<'_, AppState>,
) -> Result<Vec<db::PresetTemplate>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_preset_templates(&pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_extension_preset_templates_cmd(
    state: State<'_, AppState>,
) -> Result<Vec<db::PresetTemplate>, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::get_extension_preset_templates(&pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn is_preset_template_enabled_cmd(
    state: State<'_, AppState>,
    key: String,
) -> Result<bool, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::is_preset_template_enabled(&pool, &key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn enable_preset_template_cmd(
    state: State<'_, AppState>,
    key: String,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::enable_preset_template(&pool, &key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn disable_preset_template_cmd(
    state: State<'_, AppState>,
    key: String,
) -> Result<(), String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    db::disable_preset_template(&pool, &key).await.map_err(|e| e.to_string())
}

async fn regenerate_all_poster_base64_internal(
    pool: &sqlx::SqlitePool,
    status: Option<Arc<Mutex<PosterRepairStatus>>>,
) -> Result<i32, String> {
    let rows: Vec<(i64, Option<String>)> = sqlx::query_as(
        "SELECT id, poster FROM video_series WHERE poster IS NOT NULL AND poster != ''"
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut updated = 0;
    let total = rows.len() as i64;
    for (index, (id, poster)) in rows.iter().enumerate() {
        if let Some(p) = poster {
            let path = std::path::Path::new(p);
            if let Some(b64) = scanner::generate_thumbnail_base64(path) {
                sqlx::query("UPDATE video_series SET poster_base64 = ? WHERE id = ?")
                    .bind(&b64)
                    .bind(id)
                    .execute(pool)
                    .await
                    .map_err(|e| e.to_string())?;
                updated += 1;
            }
        }

        if let Some(status) = &status {
            if index % 10 == 0 || index + 1 == rows.len() {
                let mut current = status.lock().await;
                if current.status == "running" {
                    current.scanned_series = total;
                    current.updated_series = updated as i64;
                }
            }
        }
    }
    Ok(updated)
}

#[tauri::command]
async fn regenerate_all_poster_base64(state: State<'_, AppState>) -> Result<i32, String> {
    let pool = {
        let guard = state.db.lock().await;
        guard.as_ref().ok_or("数据库未初始化")?.clone()
    };
    regenerate_all_poster_base64_internal(&pool, None).await
}
