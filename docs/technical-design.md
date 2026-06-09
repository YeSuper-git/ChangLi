# 长离 - 技术方案文档

## 1. 系统架构

### 1.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Tauri 2.0 桌面应用                       │
├─────────────────────────────────────────────────────────────┤
│  前端层 (React + TypeScript + TailwindCSS)                    │
│  ├── 首页：资源聚合展示                                       │
│  ├── 搜索页：跨站搜索                                        │
│  ├── 下载管理：任务列表、进度、状态                            │
│  ├── 视频库：本地视频管理、分类、筛选                          │
│  └── 播放器：mpv 内嵌播放界面                                 │
├─────────────────────────────────────────────────────────────┤
│  Rust 后端层                                                 │
│  ├── 网站解析引擎                                            │
│  │   ├── 网站配置管理（JSON/YAML）                           │
│  │   ├── 请求模块（reqwest）                                │
│  │   └── 解析模块（scraper/selectors）                      │
│  ├── 下载管理器                                              │
│  │   ├── aria2 RPC 客户端                                   │
│  │   ├── 任务队列                                           │
│  │   └── 进度追踪                                           │
│  ├── 本地文件管理                                            │
│  │   ├── 目录扫描                                           │
│  │   ├── 元数据存储（SQLite）                               │
│  │   └── 缩略图生成                                         │
│  ├── 播放器引擎                                              │
│  │   ├── mpv 绑定（libmpv-rs）                              │
│  │   ├── 播放控制                                           │
│  │   └── 字幕加载                                           │
│  └── 数据库层（SQLite + sqlx）                              │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 技术选型

| 模块 | 技术 | 说明 |
|------|------|------|
| **桌面框架** | Tauri 2.0 | 跨平台、轻量、安全 |
| **前端** | React 18 + TypeScript | 组件化、类型安全 |
| **UI 框架** | TailwindCSS | 实用优先、快速开发 |
| **播放器** | mpv (libmpv-rs) | 高性能、格式全、原画质 |
| **下载引擎** | aria2 RPC | 成熟、稳定、功能全 |
| **数据库** | SQLite + sqlx | 轻量、嵌入式、异步 |
| **HTTP 客户端** | reqwest | 异步、功能全 |
| **HTML 解析** | scraper | CSS 选择器、易用 |

## 2. 数据库设计

### 2.1 ER 图

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   sites     │       │  resources  │       │  downloads  │
├─────────────┤       ├─────────────┤       ├─────────────┤
│ id (PK)     │◄──┐   │ id (PK)     │◄──┐   │ id (PK)     │
│ name        │   │   │ site_id (FK)│───┘   │ resource_id │
│ url         │   │   │ title       │       │ aria2_gid   │
│ parser_type │   │   │ magnet      │       │ status      │
│ config      │   │   │ info        │       │ progress    │
│ enabled     │   │   │ created_at  │       │ file_path   │
└─────────────┘   │   └─────────────┘       └─────────────┘
                  │                           │
                  │   ┌─────────────┐       ┌─────────────┐
                  │   │   videos    │       │play_history │
                  │   ├─────────────┤       ├─────────────┤
                  │   │ id (PK)     │◄──────│ id (PK)     │
                  │   │ file_path   │       │ video_id(FK)│
                  │   │ file_name   │       │ last_position│
                  │   │ file_size   │       │ last_played │
                  │   │ duration    │       └─────────────┘
                  │   │ resolution  │
                  │   │ source_site │
                  │   │ metadata    │
                  │   │ thumbnail   │
                  │   │ created_at  │
                  │   └─────────────┘
                  │
                  └─── source_site (逻辑外键)
```

### 2.2 表结构

```sql
-- 网站配置表
CREATE TABLE sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    parser_type TEXT NOT NULL DEFAULT 'css',
    config JSON NOT NULL,
    enabled BOOLEAN DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 资源表
CREATE TABLE resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    url TEXT,
    magnet TEXT,
    info JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 下载任务表
CREATE TABLE downloads (
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
);

-- 本地视频表
CREATE TABLE videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    file_size INTEGER,
    duration REAL,
    width INTEGER,
    height INTEGER,
    resolution TEXT,
    source_site TEXT,
    metadata JSON,
    thumbnail TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 播放记录表
CREATE TABLE play_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
    last_position REAL DEFAULT 0,
    total_duration REAL,
    play_count INTEGER DEFAULT 1,
    last_played TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 索引
CREATE INDEX idx_resources_site_id ON resources(site_id);
CREATE INDEX idx_downloads_status ON downloads(status);
CREATE INDEX idx_videos_source_site ON videos(source_site);
CREATE INDEX idx_play_history_video_id ON play_history(video_id);
```

## 3. 核心模块设计

### 3.1 网站解析引擎

#### 3.1.1 网站配置结构

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SiteConfig {
    pub name: String,
    pub base_url: String,
    pub search_url: String,
    pub search_method: String,  // GET/POST
    pub search_params: HashMap<String, String>,
    pub list_selector: String,
    pub title_selector: String,
    pub url_selector: String,
    pub magnet_selector: String,
    pub info_selectors: HashMap<String, String>,
    pub headers: HashMap<String, String>,
    pub cookies: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Site {
    pub id: i64,
    pub name: String,
    pub url: String,
    pub parser_type: String,
    pub config: SiteConfig,
    pub enabled: bool,
}
```

#### 3.1.2 解析器实现

```rust
pub struct SiteParser {
    client: reqwest::Client,
    site: Site,
}

impl SiteParser {
    pub fn new(site: Site) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap();
        Self { client, site }
    }

    pub async fn search(&self, keyword: &str) -> Result<Vec<Resource>> {
        // 构建搜索 URL
        let url = self.build_search_url(keyword);
        
        // 发送请求
        let mut request = self.client.get(&url);
        for (key, value) in &self.site.config.headers {
            request = request.header(key.as_str(), value.as_str());
        }
        let response = request.send().await?;
        let html = response.text().await?;
        
        // 解析 HTML
        let document = Html::parse_document(&html);
        let list_selector = Selector::parse(&self.site.config.list_selector).unwrap();
        
        let mut resources = Vec::new();
        for element in document.select(&list_selector) {
            let resource = self.parse_resource_element(&element)?;
            resources.push(resource);
        }
        
        Ok(resources)
    }

    fn parse_resource_element(&self, element: &Element) -> Result<Resource> {
        let title = self.extract_text(element, &self.site.config.title_selector)?;
        let url = self.extract_attr(element, &self.site.config.url_selector, "href")?;
        let magnet = self.extract_text(element, &self.site.config.magnet_selector).ok();
        
        let mut info = serde_json::Map::new();
        for (key, selector) in &self.site.config.info_selectors {
            if let Ok(value) = self.extract_text(element, selector) {
                info.insert(key.clone(), serde_json::Value::String(value));
            }
        }
        
        Ok(Resource {
            id: 0,
            site_id: self.site.id,
            title,
            url: Some(url),
            magnet,
            info: Some(serde_json::Value::Object(info)),
            created_at: Utc::now(),
        })
    }
}
```

### 3.2 下载管理器

#### 3.2.1 aria2 RPC 客户端

```rust
pub struct Aria2Client {
    rpc_url: String,
    client: reqwest::Client,
    request_id: AtomicI64,
}

impl Aria2Client {
    pub fn new(rpc_url: &str) -> Self {
        Self {
            rpc_url: rpc_url.to_string(),
            client: reqwest::Client::new(),
            request_id: AtomicI64::new(1),
        }
    }

    pub async fn add_magnet(&self, magnet: &str, options: Option<DownloadOptions>) -> Result<String> {
        let params = vec![
            serde_json::Value::String(magnet.to_string()),
        ];
        
        let response = self.call("aria2.addUri", params).await?;
        let gid = response.as_str().unwrap().to_string();
        
        Ok(gid)
    }

    pub async fn get_status(&self, gid: &str) -> Result<DownloadStatus> {
        let params = vec![
            serde_json::Value::String(gid.to_string()),
        ];
        
        let response = self.call("aria2.tellStatus", params).await?;
        let status: DownloadStatus = serde_json::from_value(response)?;
        
        Ok(status)
    }

    pub async fn pause(&self, gid: &str) -> Result<()> {
        let params = vec![
            serde_json::Value::String(gid.to_string()),
        ];
        self.call("aria2.pause", params).await?;
        Ok(())
    }

    pub async fn resume(&self, gid: &str) -> Result<()> {
        let params = vec![
            serde_json::Value::String(gid.to_string()),
        ];
        self.call("aria2.resume", params).await?;
        Ok(())
    }

    pub async fn remove(&self, gid: &str) -> Result<()> {
        let params = vec![
            serde_json::Value::String(gid.to_string()),
        ];
        self.call("aria2.remove", params).await?;
        Ok(())
    }

    async fn call(&self, method: &str, params: Vec<serde_json::Value>) -> Result<serde_json::Value> {
        let id = self.request_id.fetch_add(1, Ordering::SeqCst);
        
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        
        let response = self.client.post(&self.rpc_url)
            .json(&request)
            .send()
            .await?;
        
        let body: serde_json::Value = response.json().await?;
        
        if let Some(error) = body.get("error") {
            return Err(anyhow::anyhow!("aria2 error: {}", error));
        }
        
        Ok(body["result"].clone())
    }
}
```

### 3.3 播放器引擎

#### 3.3.1 mpv 绑定

```rust
use libmpv::{Mpv, events::*};

pub struct VideoPlayer {
    mpv: Mpv,
    current_file: Option<String>,
}

impl VideoPlayer {
    pub fn new() -> Result<Self> {
        let mpv = Mpv::new()?;
        
        // 配置硬件解码
        mpv.set_property("hwdec", "auto")?;
        
        // 配置视频同步
        mpv.set_property("video-sync", "display-resample")?;
        
        // 配置音频输出
        mpv.set_property("audio-pull-mode", "yes")?;
        
        Ok(Self {
            mpv,
            current_file: None,
        })
    }

    pub fn load(&mut self, path: &str) -> Result<()> {
        self.mpv.command("loadfile", &[path])?;
        self.current_file = Some(path.to_string());
        Ok(())
    }

    pub fn play(&self) -> Result<()> {
        self.mpv.set_property("pause", false)?;
        Ok(())
    }

    pub fn pause(&self) -> Result<()> {
        self.mpv.set_property("pause", true)?;
        Ok(())
    }

    pub fn toggle_pause(&self) -> Result<()> {
        let paused: bool = self.mpv.get_property("pause")?;
        self.mpv.set_property("pause", !paused)?;
        Ok(())
    }

    pub fn seek(&self, position: f64) -> Result<()> {
        self.mpv.command("seek", &[&position.to_string(), "absolute"])?;
        Ok(())
    }

    pub fn set_speed(&self, speed: f64) -> Result<()> {
        self.mpv.set_property("speed", speed)?;
        Ok(())
    }

    pub fn set_volume(&self, volume: i64) -> Result<()> {
        self.mpv.set_property("volume", volume)?;
        Ok(())
    }

    pub fn get_position(&self) -> Result<f64> {
        let pos: f64 = self.mpv.get_property("time-pos")?;
        Ok(pos)
    }

    pub fn get_duration(&self) -> Result<f64> {
        let duration: f64 = self.mpv.get_property("duration")?;
        Ok(duration)
    }

    pub fn get_volume(&self) -> Result<i64> {
        let volume: i64 = self.mpv.get_property("volume")?;
        Ok(volume)
    }

    pub fn is_paused(&self) -> Result<bool> {
        let paused: bool = self.mpv.get_property("pause")?;
        Ok(paused)
    }

    pub fn load_subtitle(&self, path: &str) -> Result<()> {
        self.mpv.command("sub-add", &[path])?;
        Ok(())
    }

    pub fn set_fullscreen(&self, fullscreen: bool) -> Result<()> {
        self.mpv.set_property("fullscreen", fullscreen)?;
        Ok(())
    }
}
```

## 4. 前端架构

### 4.1 页面结构

```
src/
├── pages/
│   ├── Home.tsx          # 首页：资源聚合展示
│   ├── Search.tsx        # 搜索页：跨站搜索
│   ├── Downloads.tsx     # 下载管理：任务列表
│   ├── Library.tsx       # 视频库：本地视频
│   └── Player.tsx        # 播放器：视频播放
├── components/
│   ├── Layout.tsx        # 布局组件
│   ├── Sidebar.tsx       # 侧边栏
│   ├── VideoCard.tsx     # 视频卡片
│   ├── DownloadItem.tsx  # 下载项
│   ├── PlayerControls.tsx # 播放控制
│   └── SearchBar.tsx     # 搜索栏
├── utils/
│   ├── api.ts            # API 调用
│   ├── tauri.ts          # Tauri 命令
│   └── format.ts         # 格式化工具
└── App.tsx               # 主应用
```

### 4.2 Tauri 命令接口

```rust
// 网站相关
#[tauri::command]
async fn get_sites() -> Result<Vec<Site>> { }

#[tauri::command]
async fn add_site(site: SiteConfig) -> Result<Site> { }

#[tauri::command]
async fn update_site(id: i64, site: SiteConfig) -> Result<Site> { }

#[tauri::command]
async fn delete_site(id: i64) -> Result<()> { }

// 资源相关
#[tauri::command]
async fn search_resources(keyword: String, site_ids: Option<Vec<i64>>) -> Result<Vec<Resource>> { }

#[tauri::command]
async fn get_resource_detail(id: i64) -> Result<Resource> { }

// 下载相关
#[tauri::command]
async fn add_download(magnet: String) -> Result<Download> { }

#[tauri::command]
async fn get_downloads() -> Result<Vec<Download>> { }

#[tauri::command]
async fn pause_download(id: i64) -> Result<()> { }

#[tauri::command]
async fn resume_download(id: i64) -> Result<()> { }

#[tauri::command]
async fn remove_download(id: i64) -> Result<()> { }

// 视频相关
#[tauri::command]
async fn scan_videos(path: String) -> Result<Vec<Video>> { }

#[tauri::command]
async fn get_videos() -> Result<Vec<Video>> { }

#[tauri::command]
async fn delete_video(id: i64) -> Result<()> { }

// 播放器相关
#[tauri::command]
async fn play_video(id: i64) -> Result<()> { }

#[tauri::command]
async fn get_play_history() -> Result<Vec<PlayHistory>> { }
```

## 5. 错误处理

### 5.1 错误类型

```rust
#[derive(Debug, thiserror::Error)]
pub enum ChangLiError {
    #[error("网络请求失败: {0}")]
    NetworkError(#[from] reqwest::Error),
    
    #[error("解析失败: {0}")]
    ParseError(String),
    
    #[error("数据库错误: {0}")]
    DatabaseError(#[from] sqlx::Error),
    
    #[error("aria2 错误: {0}")]
    Aria2Error(String),
    
    #[error("播放器错误: {0}")]
    PlayerError(#[from] libmpv::Error),
    
    #[error("IO 错误: {0}")]
    IoError(#[from] std::io::Error),
    
    #[error("配置错误: {0}")]
    ConfigError(String),
}
```

## 6. 性能优化

### 6.1 前端优化
- 虚拟滚动：大量视频列表
- 图片懒加载：缩略图
- 搜索防抖：避免频繁请求

### 6.2 后端优化
- 连接池：HTTP 客户端
- 异步操作：所有 IO 操作
- 缓存：搜索结果缓存
- 批量操作：数据库批量插入

## 7. 安全考虑

### 7.1 输入验证
- 验证所有用户输入
- 防止 SQL 注入（使用参数化查询）
- 防止 XSS（前端转义）

### 7.2 网络安全
- HTTPS 优先
- Cookie 安全存储
- 代理支持

### 7.3 文件安全
- 文件路径验证
- 文件大小限制
- 病毒扫描（可选）

## 8. 测试策略

### 8.1 单元测试
- 解析器测试
- 数据库测试
- 工具函数测试

### 8.2 集成测试
- API 接口测试
- 端到端流程测试

### 8.3 性能测试
- 大量数据测试
- 并发测试
- 内存泄漏测试
