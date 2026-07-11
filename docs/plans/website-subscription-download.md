# Website Subscription & Auto-Download Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add anime RSS subscription management to ChangLi so users can subscribe to bangumi RSS feeds (e.g., Mikanani), auto-detect new episodes, and auto-download them via aria2 based on user preferences (subtitle group, resolution, codec, etc.).

**Architecture:** Backend-driven — Rust handles RSS fetching, XML parsing, title keyword extraction, subscription scheduling, and aria2 download orchestration. Frontend provides subscription management UI, preference selection from extracted keywords, and download status monitoring. A background tokio task runs periodic RSS checks.

**Tech Stack:** Rust (reqwest, xml-rs or quick-xml, tokio), SQLite (sqlx), React + TypeScript frontend, aria2 JSON-RPC client (existing `downloader.rs`), Tauri 2.x commands.

---

## Part 1: Database Schema

### Task 1: Add `bangumi_subscriptions` table

**Objective:** Store RSS feed subscriptions binding a bangumi URL to a video series with download preferences.

**Files:**
- Modify: `src-tauri/src/migrations.rs` — add new migration function
- Modify: `src-tauri/src/db.rs` — add Rust struct + CRUD functions

**Step 1: Define the migration in migrations.rs**

Add a new async function `create_subscription_tables` and call it from `run()`:

```rust
// In migrations.rs — add to run() function:
async fn create_subscription_tables(pool: &SqlitePool) -> Result<()> {
    execute(
        pool,
        r#"
        CREATE TABLE IF NOT EXISTS bangumi_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            series_id INTEGER REFERENCES video_series(id) ON DELETE CASCADE,
            site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
            bangumi_url TEXT NOT NULL,
            rss_url TEXT NOT NULL,
            title TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            check_interval_minutes INTEGER NOT NULL DEFAULT 60,
            last_check_at TIMESTAMP,
            auto_download INTEGER NOT NULL DEFAULT 0,
            download_dir TEXT,
            preferences TEXT NOT NULL DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        "#,
        "create bangumi_subscriptions table",
    )
    .await?;

    execute(
        pool,
        r#"
        CREATE TABLE IF NOT EXISTS subscription_downloads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subscription_id INTEGER REFERENCES bangumi_subscriptions(id) ON DELETE CASCADE,
            guid TEXT NOT NULL,
            title TEXT NOT NULL,
            torrent_url TEXT,
            magnet_link TEXT,
            file_size INTEGER,
            pub_date TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            aria2_gid TEXT,
            file_path TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(subscription_id, guid)
        )
        "#,
        "create subscription_downloads table",
    )
    .await?;

    execute(
        pool,
        r#"
        CREATE TABLE IF NOT EXISTS subscription_keywords (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subscription_id INTEGER REFERENCES bangumi_subscriptions(id) ON DELETE CASCADE,
            keyword_category TEXT NOT NULL,
            keyword_value TEXT NOT NULL,
            is_selected INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(subscription_id, keyword_category, keyword_value)
        )
        "#,
        "create subscription_keywords table",
    )
    .await?;

    Ok(())
}
```

Add the call in `run()`: `create_subscription_tables(pool).await?;`

**Step 2: Add Rust structs in db.rs**

```rust
// Add after WatchProgress struct:

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub download_dir: Option<String>,
    pub preferences: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewBangumiSubscription {
    pub series_id: Option<i64>,
    pub site_id: Option<i64>,
    pub bangumi_url: String,
    pub rss_url: String,
    pub title: String,
    pub enabled: Option<bool>,
    pub check_interval_minutes: Option<i64>,
    pub auto_download: Option<bool>,
    pub download_dir: Option<String>,
    pub preferences: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubscriptionKeyword {
    pub id: i64,
    pub subscription_id: i64,
    pub keyword_category: String,
    pub keyword_value: String,
    pub is_selected: bool,
    pub created_at: String,
}
```

**Step 3: Add CRUD functions in db.rs**

```rust
// Subscription CRUD
pub async fn get_subscriptions(pool: &SqlitePool) -> Result<Vec<BangumiSubscription>> { ... }
pub async fn add_subscription(pool: &SqlitePool, sub: NewBangumiSubscription) -> Result<BangumiSubscription> { ... }
pub async fn update_subscription(pool: &SqlitePool, id: i64, sub: NewBangumiSubscription) -> Result<BangumiSubscription> { ... }
pub async fn delete_subscription(pool: &SqlitePool, id: i64) -> Result<()> { ... }
pub async fn get_subscription_by_id(pool: &SqlitePool, id: i64) -> Result<BangumiSubscription> { ... }

// SubscriptionDownload CRUD
pub async fn add_subscription_download(pool: &SqlitePool, dl: SubscriptionDownload) -> Result<SubscriptionDownload> { ... }
pub async fn get_subscription_downloads(pool: &SqlitePool, subscription_id: i64) -> Result<Vec<SubscriptionDownload>> { ... }
pub async fn update_subscription_download_status(pool: &SqlitePool, id: i64, status: &str) -> Result<()> { ... }
pub async fn get_subscription_download_by_guid(pool: &SqlitePool, subscription_id: i64, guid: &str) -> Result<Option<SubscriptionDownload>> { ... }

// SubscriptionKeyword CRUD
pub async fn upsert_subscription_keywords(pool: &SqlitePool, subscription_id: i64, keywords: Vec<(String, String)>) -> Result<()> { ... }
pub async fn get_subscription_keywords(pool: &SqlitePool, subscription_id: i64) -> Result<Vec<SubscriptionKeyword>> { ... }
pub async fn update_keyword_selection(pool: &SqlitePool, subscription_id: i64, category: &str, value: &str, selected: bool) -> Result<()> { ... }
```

**Step 4: Verify**

Run: `cd src-tauri && cargo check` — Expected: no errors (struct definitions compile).

**Step 5: Commit**

```bash
git add src-tauri/src/migrations.rs src-tauri/src/db.rs
git commit -m "feat: add bangumi_subscriptions, subscription_downloads, subscription_keywords tables"
```

---

### Task 2: Add `bangumi_sites` template table

**Objective:** Store a predefined list of supported RSS site types (Mikanani, etc.) so the app knows how to generate RSS URLs from bangumi page URLs.

**Files:**
- Modify: `src-tauri/src/migrations.rs`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/site_config.rs`

**Step 1: Add migration**

```rust
execute(
    pool,
    r#"
    CREATE TABLE IF NOT EXISTS bangumi_site_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        base_url TEXT NOT NULL,
        rss_url_pattern TEXT NOT NULL,
        bangumi_url_pattern TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    "#,
    "create bangumi_site_templates table",
).await?;

// Seed default templates
execute(
    pool,
    r#"
    INSERT OR IGNORE INTO bangumi_site_templates (name, base_url, rss_url_pattern, bangumi_url_pattern)
    VALUES
        ('Mikanani', 'https://mikanani.kas.pub', 'https://mikanani.kas.pub/RSS/Bangumi?bangumiId={id}', 'https://mikanani.kas.pub/Home/Bangumi/{id}')
    "#,
    "seed bangumi site templates",
).await?;
```

**Step 2: Add Rust struct**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BangumiSiteTemplate {
    pub id: i64,
    pub name: String,
    pub base_url: String,
    pub rss_url_pattern: String,
    pub bangumi_url_pattern: Option<String>,
    pub enabled: bool,
    pub created_at: String,
}
```

**Step 3: Verify**

Run: `cargo check` — Expected: compiles.

**Step 4: Commit**

```bash
git add src-tauri/src/migrations.rs src-tauri/src/db.rs
git commit -m "feat: add bangumi_site_templates table with Mikanani default"
```

---

## Part 2: Rust Backend — RSS Parser & Keyword Extractor

### Task 3: Create RSS parser module

**Objective:** Parse Mikanani RSS XML into structured items with title, magnet/torrent URL, file size, and publish date.

**Files:**
- Create: `src-tauri/src/rss_parser.rs`
- Modify: `src-tauri/src/main.rs` — add `mod rss_parser;`
- Modify: `src-tauri/Cargo.toml` — add `quick-xml` dependency

**Step 1: Add quick-xml dependency**

```toml
# In Cargo.toml
quick-xml = "0.37"
```

**Step 2: Create rss_parser.rs**

```rust
use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RssItem {
    pub guid: String,
    pub title: String,
    pub description: String,
    pub link: String,
    pub torrent_url: Option<String>,
    pub content_length: Option<i64>,
    pub pub_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RssFeed {
    pub title: String,
    pub link: String,
    pub description: String,
    pub items: Vec<RssItem>,
}

/// Parse RSS XML string into RssFeed
pub fn parse_rss(xml: &str) -> Result<RssFeed> {
    let mut reader = quick::xml::Reader::from_str(xml);
    let mut feed = RssFeed {
        title: String::new(),
        link: String::new(),
        description: String::new(),
        items: Vec::new(),
    };

    let mut current_item: Option<RssItem> = None;
    let mut in_item = false;
    let mut in_torrent = false;
    let mut buf = String::new();
    let mut current_tag = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(quick::xml::events::Event::Start(ref e)) | Ok(quick::xml::events::Event::Empty(ref e)) => {
                let tag_name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match tag_name.as_str() {
                    "item" => {
                        in_item = true;
                        current_item = Some(RssItem {
                            guid: String::new(),
                            title: String::new(),
                            description: String::new(),
                            link: String::new(),
                            torrent_url: None,
                            content_length: None,
                            pub_date: None,
                        });
                    }
                    "enclosure" if in_item => {
                        // Extract torrent URL from enclosure element
                        if let Some(ref mut item) = current_item {
                            for attr in e.attributes().flatten() {
                                if attr.key.as_ref() == b"url" {
                                    item.torrent_url = Some(String::from_utf8_lossy(&attr.value).to_string());
                                }
                            }
                        }
                    }
                    _ if !in_item => {
                        // Channel-level tags
                        if let Some(ref mut item) = current_item {
                            // skip
                        } else {
                            current_tag = tag_name.clone();
                        }
                    }
                    _ => {
                        current_tag = tag_name;
                        if current_tag == "torrent" {
                            in_torrent = true;
                        }
                    }
                }
            }
            Ok(quick::xml::events::Event::Text(ref e)) => {
                let text = e.unescape().unwrap_or_default().to_string();
                if in_item {
                    if let Some(ref mut item) = current_item {
                        match current_tag.as_str() {
                            "guid" => item.guid = text,
                            "title" => item.title = text,
                            "description" => item.description = text,
                            "link" => item.link = text,
                            _ => {}
                        }
                    }
                } else {
                    match current_tag.as_str() {
                        "title" => feed.title = text,
                        "link" => feed.link = text,
                        "description" => feed.description = text,
                        _ => {}
                    }
                }
                if in_torrent && in_item {
                    if let Some(ref mut item) = current_item {
                        match current_tag.as_str() {
                            "contentLength" => {
                                item.content_length = text.parse::<i64>().ok();
                            }
                            "pubDate" => item.pub_date = Some(text),
                            "link" => {} // torrent link inside <torrent> — we use enclosure instead
                            _ => {}
                        }
                    }
                }
            }
            Ok(quick::xml::events::Event::End(ref e)) => {
                let tag_name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                if tag_name == "item" && in_item {
                    if let Some(item) = current_item.take() {
                        feed.items.push(item);
                    }
                    in_item = false;
                }
                if tag_name == "torrent" {
                    in_torrent = false;
                }
            }
            Ok(quick::xml::events::Event::Eof) => break,
            Err(e) => return Err(anyhow::anyhow!("RSS parse error: {e}")),
            _ => {}
        }
        buf.clear();
    }

    Ok(feed)
}

/// Extract episode number from title
pub fn extract_episode(title: &str) -> Option<i32> {
    // Patterns: "- 12", "- 02", "| 01-12" (take first for batch)
    let re = regex::Regex::new(r"[-–]\s*(\d+)").ok()?;
    re.captures(title)
        .and_then(|cap| cap.get(1))
        .and_then(|m| m.as_str().parse::<i32>().ok())
}
```

**Step 3: Verify**

Run: `cd src-tauri && cargo check` — Expected: compiles.

**Step 4: Commit**

```bash
git add src-tauri/src/rss_parser.rs src-tauri/src/main.rs src-tauri/Cargo.toml
git commit -m "feat: add RSS XML parser module with episode number extraction"
```

---

### Task 4: Create keyword extractor module

**Objective:** Dynamically extract subtitle group, resolution, codec, audio, source, subtitle type, container, and quality from anime RSS titles.

**Files:**
- Create: `src-tauri/src/keyword_extractor.rs`
- Modify: `src-tauri/src/main.rs` — add `mod keyword_extractor;`

**Step 1: Create keyword_extractor.rs**

The keyword extractor is dynamic — it collects all unique keyword values from the RSS feed titles and presents them to the user, rather than using hardcoded categories.

```rust
use std::collections::{HashMap, HashSet};
use regex::Regex;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ExtractedKeywords {
    /// category -> set of unique values
    pub categories: HashMap<String, Vec<String>>,
}

/// Known keyword category patterns (order matters for extraction)
const CATEGORY_PATTERNS: &[(&str, &str)] = &[
    ("subtitle_group", r"^\[([^\]]+)\]"),           // [LoliHouse], [ANi], etc.
    ("episode", r"[-–]\s*(\d+)"),                     // - 12, - 02
    ("resolution", r"\b(\d{3,4}[pP])\b"),             // 1080P, 720p
    ("resolution_x", r"(\d{3,4}x\d{3,4})"),           // 1920x1080, 3840x2160
    ("codec_video", r"\b(HEVC|AVC|x264|x265|H\.?264|H\.?265|VP9|AV1)\b"),
    ("codec_video_bit", r"\b(HEVC-10bit|10bit)\b"),
    ("codec_audio", r"\b(AAC|FLAC|FLAC\s*\d+\.\d+|DTS|DTS-HD|OPUS|AC-3|EAC-3)\b"),
    ("source", r"\b(Baha|CR|Crunchyroll|WEB-DL|WEBRIP|B-Global|Bilibili|Bstation|ABEMA|Netflix)\b"),
    ("subtitle_type", r"(简繁内封字幕|简繁日外挂|简繁字幕|简中字幕|繁中字幕|中文字幕|内封字幕|外挂字幕|日文|中日双语|简日字幕)"),
    ("container", r"\b(MKV|MP4|AVI)\b"),
    ("quality_source", r"\b(BDrip|BD-Rip|Blu-?ray|WEB-?DL|WEBRip|WEBRIP|DTV|HDTV)\b"),
    ("season", r"\bS(\d+)\b"),
    ("batch", r"(\d+)\s*[-–~]\s*(\d+)\s*合集"),
];

/// Extract keywords from a list of titles
pub fn extract_keywords(titles: &[&str]) -> ExtractedKeywords {
    let mut categories: HashMap<String, HashSet<String>> = HashMap::new();

    for title in titles {
        for (category, pattern) in CATEGORY_PATTERNS {
            if let Ok(re) = Regex::new(pattern) {
                for cap in re.captures_iter(title) {
                    // For subtitle_group, take the first capture group
                    // For batch (e.g. "01-12"), skip episode extraction
                    let value = if category == &"batch" {
                        continue; // skip batch, it will be captured by episode pattern
                    } else if category == &"codec_video_bit" {
                        // Skip if already matched full codec
                        if categories.get("codec_video").map_or(false, |v| v.contains(cap.get(0).unwrap().as_str())) {
                            continue;
                        }
                        cap.get(0).unwrap().as_str().to_string()
                    } else if category == &"episode" {
                        // Skip if this is part of a batch pattern (e.g. "01-12")
                        let full_match = cap.get(0).unwrap().as_str();
                        if title.contains(&format!("{} 合集", full_match)) {
                            continue;
                        }
                        cap.get(1).unwrap().as_str().to_string()
                    } else {
                        cap.get(1).unwrap_or_else(|| cap.get(0).unwrap()).as_str().to_string()
                    };

                    categories.entry(category.to_string()).or_default().insert(value);
                }
            }
        }
    }

    // Convert to sorted Vecs
    let mut result = HashMap::new();
    for (k, v) in categories {
        let mut sorted: Vec<String> = v.into_iter().collect();
        sorted.sort();
        result.insert(k, sorted);
    }

    result
}

/// Filter titles based on user-selected keywords
pub fn filter_by_preferences(
    titles: &[&str],
    preferences: &HashMap<String, Vec<String>>, // category -> selected values
) -> Vec<usize> {
    // Returns indices of titles that match ALL selected preferences
    let mut matching_indices = Vec::new();

    for (idx, title) in titles.iter().enumerate() {
        let mut all_match = true;

        for (category, selected_values) in preferences {
            if selected_values.is_empty() {
                continue; // No filter for this category
            }

            let title_lower = title.to_lowercase();
            let matched = selected_values.iter().any(|v| {
                title_lower.contains(&v.to_lowercase())
            });

            if !matched {
                all_match = false;
                break;
            }
        }

        if all_match {
            matching_indices.push(idx);
        }
    }

    matching_indices
}
```

**Step 2: Verify**

Run: `cd src-tauri && cargo check` — Expected: compiles.

**Step 3: Commit**

```bash
git add src-tauri/src/keyword_extractor.rs src-tauri/src/main.rs
git commit -m "feat: add dynamic keyword extractor for anime RSS titles"
```

---

### Task 5: Create subscription manager module

**Objective:** Handle RSS fetching, subscription checking, auto-download scheduling, and aria2 integration.

**Files:**
- Create: `src-tauri/src/subscription_manager.rs`
- Modify: `src-tauri/src/main.rs` — add `mod subscription_manager;`

**Step 1: Create subscription_manager.rs**

```rust
use anyhow::Result;
use sqlx::sqlite::SqlitePool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::db;
use crate::downloader;
use crate::keyword_extractor;
use crate::rss_parser;

/// State for background subscription checking
pub struct SubscriptionManager {
    pub running: Arc<Mutex<bool>>,
}

impl SubscriptionManager {
    pub fn new() -> Self {
        Self {
            running: Arc::new(Mutex::new(false)),
        }
    }

    /// Start the background check loop
    pub async fn start(&self, pool: SqlitePool) {
        let mut running = self.running.lock().await;
        if *running {
            return;
        }
        *running = true;
        drop(running);

        let running = self.running.clone();
        tokio::spawn(async move {
            loop {
                if !*running.lock().await {
                    break;
                }
                if let Err(e) = check_all_subscriptions(&pool).await {
                    eprintln!("[SubscriptionManager] Check error: {e}");
                }
                // Sleep for 60 seconds between checks
                tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            }
        });
    }

    pub async fn stop(&self) {
        let mut running = self.running.lock().await;
        *running = false;
    }
}

/// Fetch RSS and extract new items for a subscription
pub async fn fetch_and_parse_rss(rss_url: &str) -> Result<rss_parser::RssFeed> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    let response = client.get(rss_url).send().await?;
    let xml = response.text().await?;

    rss_parser::parse_rss(&xml)
}

/// Extract keywords from all RSS items for a subscription
pub async fn extract_keywords_for_subscription(
    pool: &SqlitePool,
    subscription_id: i64,
) -> Result<keyword_extractor::ExtractedKeywords> {
    let sub = db::get_subscription_by_id(pool, subscription_id).await?;
    let feed = fetch_and_parse_rss(&sub.rss_url).await?;

    let titles: Vec<&str> = feed.items.iter().map(|i| i.title.as_str()).collect();
    Ok(keyword_extractor::extract_keywords(&titles))
}

/// Check a single subscription for new episodes
async fn check_subscription(pool: &SqlitePool, sub: &db::BangumiSubscription) -> Result<()> {
    let feed = fetch_and_parse_rss(&sub.rss_url).await?;

    // Get existing downloads for this subscription
    let existing = db::get_subscription_downloads(pool, sub.id).await?;
    let existing_guids: std::collections::HashSet<String> =
        existing.into_iter().map(|d| d.guid).collect();

    // Filter for new items
    let new_items: Vec<&rss_parser::RssItem> = feed
        .items
        .iter()
        .filter(|item| !existing_guids.contains(&item.guid))
        .collect();

    if new_items.is_empty() {
        return Ok(());
    }

    // Load user preferences
    let keywords = db::get_subscription_keywords(pool, sub.id).await?;
    let preferences: HashMap<String, Vec<String>> = keywords
        .iter()
        .filter(|k| k.is_selected)
        .fold(HashMap::new(), |mut acc, k| {
            acc.entry(k.keyword_category.clone())
                .or_default()
                .push(k.keyword_value.clone());
            acc
        });

    // Filter by preferences
    let new_titles: Vec<&str> = new_items.iter().map(|i| i.title.as_str()).collect();
    let matching_indices = keyword_extractor::filter_by_preferences(&new_titles, &preferences);

    // Insert new items and auto-download if enabled
    for &idx in &matching_indices {
        let item = new_items[idx];
        let download = db::SubscriptionDownload {
            id: 0, // auto-generated
            subscription_id: sub.id,
            guid: item.guid.clone(),
            title: item.title.clone(),
            torrent_url: item.torrent_url.clone(),
            magnet_link: None,
            file_size: item.content_length,
            pub_date: item.pub_date.clone(),
            status: if sub.auto_download { "downloading".to_string() } else { "pending".to_string() },
            aria2_gid: None,
            file_path: None,
            created_at: String::new(),
            updated_at: String::new(),
        };

        let saved = db::add_subscription_download(pool, download).await?;

        if sub.auto_download {
            // Start download via aria2
            if let Some(ref torrent_url) = item.torrent_url {
                match downloader::add_magnet(torrent_url).await {
                    Ok(gid) => {
                        db::update_subscription_download_status(pool, saved.id, "downloading").await?;
                        // Store the GID for progress tracking
                        sqlx::query("UPDATE subscription_downloads SET aria2_gid = ? WHERE id = ?")
                            .bind(&gid)
                            .bind(saved.id)
                            .execute(pool)
                            .await?;
                    }
                    Err(e) => {
                        eprintln!("[SubscriptionManager] Download start failed: {e}");
                        db::update_subscription_download_status(pool, saved.id, "error").await?;
                    }
                }
            }
        }
    }

    // Update last check time
    sqlx::query("UPDATE bangumi_subscriptions SET last_check_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(sub.id)
        .execute(pool)
        .await?;

    Ok(())
}

/// Check all enabled subscriptions
async fn check_all_subscriptions(pool: &SqlitePool) -> Result<()> {
    let subscriptions = db::get_subscriptions(pool).await?;

    for sub in subscriptions {
        if !sub.enabled {
            continue;
        }

        // Check if it's time to check this subscription
        if let Some(ref last_check) = sub.last_check_at {
            if let Ok(last_check_time) = chrono::NaiveDateTime::parse_from_str(
                last_check, "%Y-%m-%d %H:%M:%S"
            ) {
                let now = chrono::Utc::now().naive_utc();
                let elapsed = now.signed_duration_since(last_check_time);
                if elapsed.num_minutes() < sub.check_interval_minutes {
                    continue;
                }
            }
        }

        if let Err(e) = check_subscription(pool, &sub).await {
            eprintln!("[SubscriptionManager] Failed to check subscription {}: {e}", sub.id);
        }
    }

    Ok(())
}
```

**Step 2: Verify**

Run: `cd src-tauri && cargo check` — Expected: compiles.

**Step 3: Commit**

```bash
git add src-tauri/src/subscription_manager.rs src-tauri/src/main.rs
git commit -m "feat: add subscription manager with RSS checking and auto-download"
```

---

### Task 6: Add Tauri commands for subscriptions

**Objective:** Expose subscription management via Tauri commands so the frontend can interact with it.

**Files:**
- Modify: `src-tauri/src/main.rs` — add Tauri commands

**Step 1: Add commands in main.rs**

Add these commands after the existing site commands:

```rust
// ===== 订阅相关命令 =====

#[tauri::command]
async fn get_subscriptions(state: State<'_, AppState>) -> Result<Vec<db::BangumiSubscription>, String> {
    let pool = { let guard = state.db.lock().await; guard.as_ref().ok_or("数据库未初始化")?.clone() };
    db::get_subscriptions(&pool).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_subscription(state: State<'_, AppState>, sub: db::NewBangumiSubscription) -> Result<db::BangumiSubscription, String> {
    let pool = { let guard = state.db.lock().await; guard.as_ref().ok_or("数据库未初始化")?.clone() };
    db::add_subscription(&pool, sub).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_subscription(state: State<'_, AppState>, id: i64, sub: db::NewBangumiSubscription) -> Result<db::BangumiSubscription, String> {
    let pool = { let guard = state.db.lock().await; guard.as_ref().ok_or("数据库未初始化")?.clone() };
    db::update_subscription(&pool, id, sub).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_subscription(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let pool = { let guard = state.db.lock().await; guard.as_ref().ok_or("数据库未初始化")?.clone() };
    db::delete_subscription(&pool, id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_subscription_downloads(state: State<'_, AppState>, subscription_id: i64) -> Result<Vec<db::SubscriptionDownload>, String> {
    let pool = { let guard = state.db.lock().await; guard.as_ref().ok_or("数据库未初始化")?.clone() };
    db::get_subscription_downloads(&pool, subscription_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn fetch_subscription_rss(state: State<'_, AppState>, subscription_id: i64) -> Result<rss_parser::RssFeed, String> {
    let pool = { let guard = state.db.lock().await; guard.as_ref().ok_or("数据库未初始化")?.clone() };
    subscription_manager::fetch_and_parse_rss(
        &db::get_subscription_by_id(&pool, subscription_id).await.map_err(|e| e.to_string())?.rss_url
    ).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn extract_subscription_keywords(state: State<'_, AppState>, subscription_id: i64) -> Result<keyword_extractor::ExtractedKeywords, String> {
    let pool = { let guard = state.db.lock().await; guard.as_ref().ok_or("数据库未初始化")?.clone() };
    subscription_manager::extract_keywords_for_subscription(&pool, subscription_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_subscription_keywords(state: State<'_, AppState>, subscription_id: i64, keywords: Vec<(String, String)>) -> Result<(), String> {
    let pool = { let guard = state.db.lock().await; guard.as_ref().ok_or("数据库未初始化")?.clone() };
    db::upsert_subscription_keywords(&pool, subscription_id, keywords).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn start_subscription_check(state: State<'_, AppState>) -> Result<(), String> {
    let pool = { let guard = state.db.lock().await; guard.as_ref().ok_or("数据库未初始化")?.clone() };
    // Background check is started on app init — this command is for manual trigger
    subscription_manager::check_all_subscriptions(&pool).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_bangumi_site_templates(state: State<'_, AppState>) -> Result<Vec<db::BangumiSiteTemplate>, String> {
    let pool = { let guard = state.db.lock().await; guard.as_ref().ok_or("数据库未初始化")?.clone() };
    sqlx::query_as::<_, db::BangumiSiteTemplate>("SELECT * FROM bangumi_site_templates WHERE enabled = 1")
        .fetch_all(&pool).await.map_err(|e| e.to_string())
}
```

**Step 2: Register commands in the invoke_handler**

Find the `.invoke_handler(tauri::generate_handler![...])` block in `main.rs` and add all new commands.

**Step 3: Verify**

Run: `cd src-tauri && cargo check` — Expected: compiles.

**Step 4: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "feat: add Tauri commands for subscription CRUD and RSS operations"
```

---

## Part 3: Frontend — TypeScript API Layer

### Task 7: Add TypeScript types and API functions

**Objective:** Add frontend types and API wrappers for all subscription-related Tauri commands.

**Files:**
- Modify: `src/utils/api.ts`

**Step 1: Add types**

```typescript
// ===== Subscription Types =====

export interface BangumiSubscription {
  id: number;
  series_id: number | null;
  site_id: number | null;
  bangumi_url: string;
  rss_url: string;
  title: string;
  enabled: boolean;
  check_interval_minutes: number;
  last_check_at: string | null;
  auto_download: boolean;
  download_dir: string | null;
  preferences: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface NewBangumiSubscription {
  series_id?: number | null;
  site_id?: number | null;
  bangumi_url: string;
  rss_url: string;
  title: string;
  enabled?: boolean;
  check_interval_minutes?: number;
  auto_download?: boolean;
  download_dir?: string;
  preferences?: Record<string, any>;
}

export interface SubscriptionDownload {
  id: number;
  subscription_id: number;
  guid: string;
  title: string;
  torrent_url: string | null;
  magnet_link: string | null;
  file_size: number | null;
  pub_date: string | null;
  status: string;
  aria2_gid: string | null;
  file_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExtractedKeywords {
  categories: Record<string, string[]>;
}

export interface BangumiSiteTemplate {
  id: number;
  name: string;
  base_url: string;
  rss_url_pattern: string;
  bangumi_url_pattern: string | null;
  enabled: boolean;
  created_at: string;
}

export interface RssFeed {
  title: string;
  link: string;
  description: string;
  items: RssItem[];
}

export interface RssItem {
  guid: string;
  title: string;
  description: string;
  link: string;
  torrent_url: string | null;
  content_length: number | null;
  pub_date: string | null;
}
```

**Step 2: Add API functions**

```typescript
// ===== Subscription API =====

export async function getSubscriptions(): Promise<BangumiSubscription[]> {
  return invoke<BangumiSubscription[]>('get_subscriptions');
}

export async function addSubscription(sub: NewBangumiSubscription): Promise<BangumiSubscription> {
  return invoke<BangumiSubscription>('add_subscription', { sub });
}

export async function updateSubscription(id: number, sub: NewBangumiSubscription): Promise<BangumiSubscription> {
  return invoke<BangumiSubscription>('update_subscription', { id, sub });
}

export async function deleteSubscription(id: number): Promise<void> {
  await invoke('delete_subscription', { id });
}

export async function getSubscriptionDownloads(subscriptionId: number): Promise<SubscriptionDownload[]> {
  return invoke<SubscriptionDownload[]>('get_subscription_downloads', { subscriptionId });
}

export async function fetchSubscriptionRss(subscriptionId: number): Promise<RssFeed> {
  return invoke<RssFeed>('fetch_subscription_rss', { subscriptionId });
}

export async function extractSubscriptionKeywords(subscriptionId: number): Promise<ExtractedKeywords> {
  return invoke<ExtractedKeywords>('extract_subscription_keywords', { subscriptionId });
}

export async function updateSubscriptionKeywords(subscriptionId: number, keywords: [string, string][]): Promise<void> {
  await invoke('update_subscription_keywords', { subscriptionId, keywords });
}

export async function startSubscriptionCheck(): Promise<void> {
  await invoke('start_subscription_check');
}

export async function getBangumiSiteTemplates(): Promise<BangumiSiteTemplate[]> {
  return invoke<BangumiSiteTemplate[]>('get_bangumi_site_templates');
}
```

**Step 3: Verify**

Run: `cd /private/tmp/changli-poster-repair-1783234185 && npx tsc --noEmit` — Expected: no errors.

**Step 4: Commit**

```bash
git add src/utils/api.ts
git commit -m "feat: add TypeScript types and API functions for subscriptions"
```

---

## Part 4: Frontend — Subscription Management UI

### Task 8: Create SubscriptionManager page component

**Objective:** A dedicated page for managing subscriptions — list, add, edit, delete, view downloads, set preferences.

**Files:**
- Create: `src/pages/SubscriptionManager.tsx`

**Step 1: Create SubscriptionManager.tsx**

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  getSubscriptions, addSubscription, deleteSubscription, updateSubscription,
  getSubscriptionDownloads, fetchSubscriptionRss, extractSubscriptionKeywords,
  updateSubscriptionKeywords, getBangumiSiteTemplates,
} from '../utils/api';
import type {
  BangumiSubscription, NewBangumiSubscription, SubscriptionDownload,
  ExtractedKeywords, BangumiSiteTemplate, RssFeed, RssItem,
} from '../utils/api';
import loadingIcon from '../assets/icons/loading.svg';

const SubscriptionManager: React.FC = () => {
  const [subscriptions, setSubscriptions] = useState<BangumiSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [templates, setTemplates] = useState<BangumiSiteTemplate[]>([]);

  // Add form state
  const [formUrl, setFormUrl] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formSite, setFormSite] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  // Detail view state
  const [selectedSub, setSelectedSub] = useState<BangumiSubscription | null>(null);
  const [downloads, setDownloads] = useState<SubscriptionDownload[]>([]);
  const [keywords, setKeywords] = useState<ExtractedKeywords | null>(null);
  const [selectedKeywords, setSelectedKeywords] = useState<Record<string, Set<string>>>({});

  useEffect(() => { loadSubscriptions(); loadTemplates(); }, []);

  const loadSubscriptions = async () => {
    try {
      const subs = await getSubscriptions();
      setSubscriptions(subs);
    } catch (err) {
      console.error('Failed to load subscriptions:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadTemplates = async () => {
    try {
      const tpls = await getBangumiSiteTemplates();
      setTemplates(tpls);
    } catch (err) {
      console.error('Failed to load templates:', err);
    }
  };

  const handleAdd = async () => {
    if (!formUrl.trim() || !formTitle.trim()) return;
    setAdding(true);
    try {
      // Generate RSS URL from bangumi URL based on selected template
      const template = templates.find(t => t.id === formSite);
      let rssUrl = '';
      if (template && template.rss_url_pattern) {
        // Extract bangumi ID from URL
        const idMatch = formUrl.match(/(\d+)/);
        if (idMatch) {
          rssUrl = template.rss_url_pattern.replace('{id}', idMatch[1]);
        }
      }

      const sub: NewBangumiSubscription = {
        bangumi_url: formUrl,
        rss_url: rssUrl,
        title: formTitle,
        site_id: formSite,
        enabled: true,
        check_interval_minutes: 60,
        auto_download: false,
      };

      await addSubscription(sub);
      setShowAddModal(false);
      setFormUrl('');
      setFormTitle('');
      setFormSite(null);
      loadSubscriptions();
    } catch (err) {
      console.error('Failed to add subscription:', err);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteSubscription(id);
      loadSubscriptions();
    } catch (err) {
      console.error('Failed to delete subscription:', err);
    }
  };

  const handleSelectSub = async (sub: BangumiSubscription) => {
    setSelectedSub(sub);
    try {
      const [dl, kw] = await Promise.all([
        getSubscriptionDownloads(sub.id),
        extractSubscriptionKeywords(sub.id),
      ]);
      setDownloads(dl);
      setKeywords(kw);

      // Initialize selected keywords from subscription preferences
      const initial: Record<string, Set<string>> = {};
      if (kw) {
        for (const [cat, values] of Object.entries(kw.categories)) {
          initial[cat] = new Set();
        }
      }
      setSelectedKeywords(initial);
    } catch (err) {
      console.error('Failed to load subscription details:', err);
    }
  };

  const handleToggleKeyword = (category: string, value: string) => {
    setSelectedKeywords(prev => {
      const newSet = new Set(prev[category] || []);
      if (newSet.has(value)) {
        newSet.delete(value);
      } else {
        newSet.add(value);
      }
      return { ...prev, [category]: newSet };
    });
  };

  const handleSaveKeywords = async () => {
    if (!selectedSub) return;
    const keywordPairs: [string, string][] = [];
    for (const [cat, values] of Object.entries(selectedKeywords)) {
      for (const v of values) {
        keywordPairs.push([cat, v]);
      }
    }
    try {
      await updateSubscriptionKeywords(selectedSub.id, keywordPairs);
    } catch (err) {
      console.error('Failed to save keywords:', err);
    }
  };

  const handleManualCheck = async (sub: BangumiSubscription) => {
    try {
      await handleSelectSub(sub);
    } catch (err) {
      console.error('Failed to check:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 flex items-center gap-2">
          <img src={loadingIcon} alt="加载中" className="w-6 h-6" /> 加载中...
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">订阅管理</h1>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
        >
          添加订阅
        </button>
      </div>

      {/* Subscription List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {subscriptions.map(sub => (
          <div
            key={sub.id}
            className={`p-4 border rounded-lg cursor-pointer transition-all ${
              selectedSub?.id === sub.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-400'
            }`}
            onClick={() => handleSelectSub(sub)}
          >
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-semibold">{sub.title}</h3>
                <p className="text-sm text-gray-500 mt-1">{sub.bangumi_url}</p>
                <div className="flex gap-2 mt-2 text-xs">
                  <span className={`px-2 py-1 rounded ${sub.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {sub.enabled ? '启用' : '禁用'}
                  </span>
                  <span className={`px-2 py-1 rounded ${sub.auto_download ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                    {sub.auto_download ? '自动下载' : '手动'}
                  </span>
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={(e) => { e.stopPropagation(); handleManualCheck(sub); }}
                  className="p-1 text-gray-400 hover:text-blue-500"
                  title="手动检查"
                >
                  🔄
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(sub.id); }}
                  className="p-1 text-gray-400 hover:text-red-500"
                  title="删除"
                >
                  🗑️
                </button>
              </div>
            </div>
            {sub.last_check_at && (
              <p className="text-xs text-gray-400 mt-2">
                上次检查: {sub.last_check_at}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Detail Panel */}
      {selectedSub && (
        <div className="mt-6 p-6 border rounded-lg bg-gray-50">
          <h2 className="text-xl font-bold mb-4">{selectedSub.title} - 下载记录</h2>

          {/* Keyword Selection */}
          {keywords && Object.keys(keywords.categories).length > 0 && (
            <div className="mb-6">
              <h3 className="font-semibold mb-3">偏好设置</h3>
              {Object.entries(keywords.categories).map(([category, values]) => (
                <div key={category} className="mb-3">
                  <h4 className="text-sm font-medium text-gray-600 mb-2">{category}</h4>
                  <div className="flex flex-wrap gap-2">
                    {values.map(value => (
                      <button
                        key={value}
                        onClick={() => handleToggleKeyword(category, value)}
                        className={`px-3 py-1 text-sm rounded-full border ${
                          selectedKeywords[category]?.has(value)
                            ? 'bg-blue-500 text-white border-blue-500'
                            : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                        }`}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <button
                onClick={handleSaveKeywords}
                className="mt-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
              >
                保存偏好
              </button>
            </div>
          )}

          {/* Downloads Table */}
          {downloads.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">标题</th>
                    <th className="text-left py-2">大小</th>
                    <th className="text-left py-2">状态</th>
                    <th className="text-left py-2">日期</th>
                  </tr>
                </thead>
                <tbody>
                  {downloads.map(dl => (
                    <tr key={dl.id} className="border-b hover:bg-gray-100">
                      <td className="py-2 text-sm max-w-md truncate">{dl.title}</td>
                      <td className="py-2 text-sm">
                        {dl.file_size ? `${(dl.file_size / 1024 / 1024).toFixed(1)} MB` : '-'}
                      </td>
                      <td className="py-2 text-sm">
                        <span className={`px-2 py-1 rounded text-xs ${
                          dl.status === 'completed' ? 'bg-green-100 text-green-700' :
                          dl.status === 'downloading' ? 'bg-blue-100 text-blue-700' :
                          dl.status === 'error' ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-500'
                        }`}>
                          {dl.status}
                        </span>
                      </td>
                      <td className="py-2 text-sm text-gray-500">{dl.pub_date || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">暂无下载记录</p>
          )}
        </div>
      )}

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">添加订阅</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">站点</label>
                <select
                  value={formSite || ''}
                  onChange={(e) => setFormSite(Number(e.target.value) || null)}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  <option value="">选择站点...</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">番组 URL</label>
                <input
                  type="url"
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder="https://mikanani.kas.pub/Home/Bangumi/3006"
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">标题</label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="邻人似银河"
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                取消
              </button>
              <button
                onClick={handleAdd}
                disabled={adding || !formUrl.trim() || !formTitle.trim()}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
              >
                {adding ? '添加中...' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SubscriptionManager;
```

**Step 2: Verify**

Run: `cd /private/tmp/changli-poster-repair-1783234185 && npx tsc --noEmit` — Expected: no errors.

**Step 3: Commit**

```bash
git add src/pages/SubscriptionManager.tsx
git commit -m "feat: add SubscriptionManager page component"
```

---

### Task 9: Add subscription page to router

**Objective:** Register the SubscriptionManager page in the app router.

**Files:**
- Modify: `src/App.tsx`

**Step 1: Add route**

```tsx
import SubscriptionManager from './pages/SubscriptionManager';

// In the routes section:
<Route path="/subscriptions" element={<SubscriptionManager />} />
```

**Step 2: Add navigation link**

In `src/components/Layout.tsx` or wherever the nav sidebar is, add a link:
```tsx
<NavLink to="/subscriptions">订阅管理</NavLink>
```

**Step 3: Verify**

Run: `cd /private/tmp/changli-poster-repair-1783234185 && npm run build` — Expected: build succeeds.

**Step 4: Commit**

```bash
git add src/App.tsx src/components/Layout.tsx
git commit -m "feat: add subscription route and navigation"
```

---

## Part 5: Integration & Background Processing

### Task 10: Start subscription checker on app launch

**Objective:** Start the background subscription checker when the app initializes.

**Files:**
- Modify: `src-tauri/src/main.rs`

**Step 1: Add SubscriptionManager to AppState**

```rust
struct AppState {
    db: Mutex<Option<sqlx::SqlitePool>>,
    poster_repair_status: Arc<Mutex<PosterRepairStatus>>,
    update_download_cancel: Arc<AtomicBool>,
    subscription_manager: Arc<subscription_manager::SubscriptionManager>,
}
```

**Step 2: Initialize in setup**

In the `tauri::Builder::default().setup(|app| { ... })` block, after database init:

```rust
// Start subscription checker
let sub_manager = Arc::new(subscription_manager::SubscriptionManager::new());
app.manage(sub_manager.clone());
// Start checking after a short delay
let pool_clone = db_pool.clone();
tokio::spawn(async move {
    tokio::time::sleep(std::time::Duration::from_secs(30)).await; // Wait for app to fully initialize
    sub_manager.start(pool_clone).await;
});
```

**Step 3: Verify**

Run: `cd src-tauri && cargo check` — Expected: compiles.

**Step 4: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "feat: start subscription background checker on app launch"
```

---

### Task 11: Integrate subscription downloads with existing Downloads page

**Objective:** Show subscription downloads alongside manual downloads in the Downloads page.

**Files:**
- Modify: `src/pages/Downloads.tsx`

**Step 1: Add subscription downloads section**

Add a tab or section in Downloads.tsx that shows subscription downloads:

```tsx
// Add state
const [subDownloads, setSubDownloads] = useState<SubscriptionDownload[]>([]);

// Add useEffect to load subscription downloads
useEffect(() => {
  loadSubscriptionDownloads();
}, []);

const loadSubscriptionDownloads = async () => {
  try {
    const subs = await getSubscriptions();
    const allDl: SubscriptionDownload[] = [];
    for (const sub of subs) {
      const dls = await getSubscriptionDownloads(sub.id);
      allDl.push(...dls);
    }
    setSubDownloads(allDl);
  } catch (err) {
    console.error('Failed to load subscription downloads:', err);
  }
};

// Add tab for "订阅下载"
const [activeTab, setActiveTab] = useState('all'); // Add 'subscription' option
```

**Step 2: Verify**

Run: `cd /private/tmp/changli-poster-repair-1783234185 && npm run build` — Expected: build succeeds.

**Step 3: Commit**

```bash
git add src/pages/Downloads.tsx
git commit -m "feat: integrate subscription downloads into Downloads page"
```

---

## Part 6: Error Handling & Edge Cases

### Task 12: Add error handling and retry logic

**Objective:** Handle network errors, RSS parse failures, aria2 connection issues, and retry failed downloads.

**Files:**
- Modify: `src-tauri/src/subscription_manager.rs`

**Step 1: Add retry logic**

```rust
/// Retry a failed subscription check with exponential backoff
async fn check_subscription_with_retry(pool: &SqlitePool, sub: &db::BangumiSubscription, max_retries: u32) -> Result<()> {
    let mut last_err = None;

    for attempt in 0..max_retries {
        match check_subscription(pool, sub).await {
            Ok(()) => return Ok(()),
            Err(e) => {
                eprintln!("[SubscriptionManager] Attempt {}/{} failed for subscription {}: {e}",
                    attempt + 1, max_retries, sub.id);
                last_err = Some(e);

                if attempt < max_retries - 1 {
                    // Exponential backoff: 5s, 15s, 45s...
                    let delay = 5 * 3u64.pow(attempt);
                    tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
                }
            }
        }
    }

    Err(last_err.unwrap())
}
```

**Step 2: Add error notification to frontend**

Emit Tauri events for subscription errors:

```rust
// In check_all_subscriptions, after error:
app_handle.emit("subscription-error", serde_json::json!({
    "subscription_id": sub.id,
    "error": e.to_string()
}))?;
```

**Step 3: Verify**

Run: `cd src-tauri && cargo check` — Expected: compiles.

**Step 4: Commit**

```bash
git add src-tauri/src/subscription_manager.rs
git commit -m "feat: add retry logic and error notifications for subscription checks"
```

---

## Part 7: Video Series Integration

### Task 13: Auto-sync downloaded videos to video series

**Objective:** When a subscription download completes, scan the download directory and add videos to the associated video series.

**Files:**
- Modify: `src-tauri/src/subscription_manager.rs`

**Step 1: Add post-download sync logic**

```rust
/// After a download completes, sync to video series
async fn sync_download_to_series(pool: &SqlitePool, download: &db::SubscriptionDownload) -> Result<()> {
    let sub = db::get_subscription_by_id(pool, download.subscription_id).await?;

    let Some(series_id) = sub.series_id else {
        return Ok(()); // No series bound
    };

    let Some(ref file_path) = download.file_path else {
        return Ok(()); // Download not complete yet
    };

    let path = std::path::Path::new(file_path);
    if !path.exists() {
        return Ok(());
    }

    // If it's a directory (multi-file torrent), scan for video files
    let video_extensions = ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "ts"];
    let files_to_add: Vec<std::path::PathBuf> = if path.is_dir() {
        walkdir::WalkDir::new(path)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_type().is_file()
                    && e.path().extension()
                        .and_then(|ext| ext.to_str())
                        .map_or(false, |ext| video_extensions.contains(&ext.to_lowercase().as_str()))
            })
            .map(|e| e.path().to_path_buf())
            .collect()
    } else if path.extension().and_then(|ext| ext.to_str())
        .map_or(false, |ext| video_extensions.contains(&ext.to_lowercase().as_str()))
    {
        vec![path.to_path_buf()]
    } else {
        return Ok(());
    };

    // Use existing scanner logic to add videos
    for video_path in files_to_add {
        let file_name = video_path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        // Extract episode number from the download title
        let episode = crate::rss_parser::extract_episode(&download.title);

        let video = db::Video {
            id: 0,
            file_path: video_path.to_string_lossy().to_string(),
            file_name,
            series_id: Some(series_id),
            episode_number: episode,
            file_size: download.file_size,
            season: None,
            subtitle: None,
            duration: None,
            width: None,
            height: None,
            resolution: None,
            source_site: Some("subscription".to_string()),
            metadata: Some(serde_json::json!({
                "subscription_id": download.subscription_id,
                "rss_title": download.title,
                "guid": download.guid,
            })),
            thumbnail: None,
            thumbnail_base64: None,
            thumbnail_data_url: None,
            series_title: None,
            series_poster_data_url: None,
            description: None,
            poster_orientation: None,
            created_at: String::new(),
            is_favorite: None,
            series_has_chinese_sub: None,
            series_code: None,
        };

        db::add_video(pool, video).await?;
    }

    Ok(())
}
```

**Step 2: Call sync after download completes**

In the download status check loop (or in `check_all_subscriptions`):

```rust
// After updating download status to "completed":
if new_status == "completed" {
    if let Ok(download) = db::get_subscription_download_by_guid(pool, &sub_id, &guid).await? {
        if let Err(e) = sync_download_to_series(pool, &download).await {
            eprintln!("[SubscriptionManager] Sync to series failed: {e}");
        }
    }
}
```

**Step 3: Verify**

Run: `cd src-tauri && cargo check` — Expected: compiles.

**Step 4: Commit**

```bash
git add src-tauri/src/subscription_manager.rs
git commit -m "feat: auto-sync subscription downloads to video series"
```

---

## Part 8: Polish & Testing

### Task 14: Add subscription status monitoring to frontend

**Objective:** Show real-time subscription check status and download progress in the UI.

**Files:**
- Modify: `src/pages/SubscriptionManager.tsx`

**Step 1: Add Tauri event listener for subscription updates**

```tsx
import { listen } from '@tauri-apps/api/event';

useEffect(() => {
  const unlisten = listen('subscription-update', (event) => {
    const { subscription_id, status } = event.payload as { subscription_id: number; status: string };
    // Update subscription list or show notification
    loadSubscriptions();
  });

  return () => { unlisten.then(fn => fn()); };
}, []);
```

**Step 2: Add "Last checked" timestamp display and manual refresh**

The SubscriptionManager already shows `last_check_at`. Add a manual refresh button that triggers `startSubscriptionCheck()`.

**Step 3: Verify**

Run: `cd /private/tmp/changli-poster-repair-1783234185 && npm run build` — Expected: build succeeds.

**Step 4: Commit**

```bash
git add src/pages/SubscriptionManager.tsx
git commit -m "feat: add real-time subscription status monitoring"
```

---

### Task 15: End-to-end verification

**Objective:** Verify the entire flow works — add subscription, fetch RSS, extract keywords, select preferences, auto-download, sync to series.

**Verification steps:**

1. **Build check**: `cd src-tauri && cargo check` — Expected: no errors
2. **Frontend build**: `cd /private/tmp/changli-poster-repair-1783234185 && npm run build` — Expected: no errors
3. **Manual test flow**:
   - Open app → Navigate to 订阅管理
   - Click 添加订阅 → Select Mikanani → Enter a bangumi URL (e.g., `https://mikanani.kas.pub/Home/Bangumi/3006`) → Enter title
   - Verify subscription appears in list
   - Click on subscription → Verify RSS is fetched and keywords are extracted
   - Toggle keyword preferences (subtitle group, resolution, etc.)
   - Save preferences
   - Enable auto_download toggle
   - Wait for next check cycle or click manual check
   - Verify new downloads appear in Downloads page

**Step 1: Full build test**

```bash
cd /private/tmp/changli-poster-repair-1783234185 && npm run build && cd src-tauri && cargo check
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: complete subscription & auto-download feature"
```

---

## Summary of Files Created/Modified

### New Files
- `src-tauri/src/rss_parser.rs` — RSS XML parser
- `src-tauri/src/keyword_extractor.rs` — Dynamic title keyword extraction
- `src-tauri/src/subscription_manager.rs` — Background subscription checker + aria2 integration
- `src/pages/SubscriptionManager.tsx` — Subscription management UI

### Modified Files
- `src-tauri/Cargo.toml` — Added `quick-xml` dependency
- `src-tauri/src/main.rs` — Added `mod` declarations, Tauri commands, AppState changes
- `src-tauri/src/db.rs` — Added structs, migrations, CRUD functions
- `src-tauri/src/migrations.rs` — Added subscription tables
- `src/utils/api.ts` — Added TypeScript types and API functions
- `src/App.tsx` — Added subscription route
- `src/components/Layout.tsx` — Added navigation link
- `src/pages/Downloads.tsx` — Integrated subscription downloads

## Key Design Decisions

1. **Dynamic keyword extraction**: Keywords are extracted from actual RSS titles, not hardcoded. This makes the system work for any anime site, not just Mikanani.
2. **User selects from extracted options**: Users click keyword bubbles to set preferences — no manual typing needed.
3. **Background tokio task**: Subscription checks run on a 60-second loop, checking each subscription at its configured interval.
4. **aria2 RPC integration**: Existing `downloader.rs` aria2 client is used directly — no new download engine needed.
5. **Series binding optional**: Users can create subscriptions without binding to a series, or bind later. Auto-sync only runs when a series is bound.
