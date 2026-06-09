use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// 网站配置结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SiteConfig {
    pub name: String,
    pub base_url: String,
    pub search_url: String,
    pub search_method: String,
    pub search_params: HashMap<String, String>,
    pub list_selector: String,
    pub title_selector: String,
    pub url_selector: String,
    pub magnet_selector: String,
    pub info_selectors: HashMap<String, String>,
    pub headers: HashMap<String, String>,
    pub cookies: Option<String>,
    pub supports_online_play: bool,
    pub online_play_url_pattern: Option<String>,
}

// 网站配置模板
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SiteTemplate {
    pub name: String,
    pub description: String,
    pub config: SiteConfig,
}

// 获取预置网站模板
pub fn get_site_templates() -> Vec<SiteTemplate> {
    vec![
        SiteTemplate {
            name: "通用动漫网站".to_string(),
            description: "适用于大多数动漫资源网站".to_string(),
            config: SiteConfig {
                name: String::new(),
                base_url: String::new(),
                search_url: "{base_url}/search?keyword={keyword}".to_string(),
                search_method: "GET".to_string(),
                search_params: HashMap::new(),
                list_selector: ".video-list-item".to_string(),
                title_selector: ".video-title".to_string(),
                url_selector: ".video-link".to_string(),
                magnet_selector: ".magnet-link".to_string(),
                info_selectors: {
                    let mut map = HashMap::new();
                    map.insert("duration".to_string(), ".video-duration".to_string());
                    map.insert("date".to_string(), ".video-date".to_string());
                    map.insert("quality".to_string(), ".video-quality".to_string());
                    map
                },
                headers: {
                    let mut map = HashMap::new();
                    map.insert("User-Agent".to_string(), "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36".to_string());
                    map
                },
                cookies: None,
                supports_online_play: false,
                online_play_url_pattern: None,
            },
        },
        SiteTemplate {
            name: "BT 资源站".to_string(),
            description: "适用于 BT 资源下载站".to_string(),
            config: SiteConfig {
                name: String::new(),
                base_url: String::new(),
                search_url: "{base_url}/search/{keyword}".to_string(),
                search_method: "GET".to_string(),
                search_params: HashMap::new(),
                list_selector: ".list-item".to_string(),
                title_selector: ".item-title a".to_string(),
                url_selector: ".item-title a".to_string(),
                magnet_selector: ".magnet-link".to_string(),
                info_selectors: {
                    let mut map = HashMap::new();
                    map.insert("size".to_string(), ".item-size".to_string());
                    map.insert("date".to_string(), ".item-date".to_string());
                    map.insert("seeds".to_string(), ".item-seeds".to_string());
                    map
                },
                headers: {
                    let mut map = HashMap::new();
                    map.insert("User-Agent".to_string(), "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36".to_string());
                    map
                },
                cookies: None,
                supports_online_play: false,
                online_play_url_pattern: None,
            },
        },
        SiteTemplate {
            name: "在线播放站".to_string(),
            description: "支持在线播放的视频网站".to_string(),
            config: SiteConfig {
                name: String::new(),
                base_url: String::new(),
                search_url: "{base_url}/search?wd={keyword}".to_string(),
                search_method: "GET".to_string(),
                search_params: HashMap::new(),
                list_selector: ".video-item".to_string(),
                title_selector: ".video-name".to_string(),
                url_selector: ".video-link".to_string(),
                magnet_selector: String::new(),
                info_selectors: {
                    let mut map = HashMap::new();
                    map.insert("episode".to_string(), ".video-episode".to_string());
                    map.insert("date".to_string(), ".video-date".to_string());
                    map
                },
                headers: {
                    let mut map = HashMap::new();
                    map.insert("User-Agent".to_string(), "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36".to_string());
                    map
                },
                cookies: None,
                supports_online_play: true,
                online_play_url_pattern: Some("{base_url}/play/{id}".to_string()),
            },
        },
    ]
}

// 验证网站配置
pub fn validate_site_config(config: &SiteConfig) -> Result<()> {
    if config.name.is_empty() {
        return Err(anyhow::anyhow!("网站名称不能为空"));
    }
    
    if config.base_url.is_empty() {
        return Err(anyhow::anyhow!("网站 URL 不能为空"));
    }
    
    if config.search_url.is_empty() {
        return Err(anyhow::anyhow!("搜索 URL 不能为空"));
    }
    
    if config.list_selector.is_empty() {
        return Err(anyhow::anyhow!("列表选择器不能为空"));
    }
    
    if config.title_selector.is_empty() {
        return Err(anyhow::anyhow!("标题选择器不能为空"));
    }
    
    if config.url_selector.is_empty() {
        return Err(anyhow::anyhow!("链接选择器不能为空"));
    }
    
    Ok(())
}

// 测试网站配置
pub async fn test_site_config(config: &SiteConfig) -> Result<bool> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;
    
    // 测试基础 URL 是否可访问
    let response = client.get(&config.base_url).send().await?;
    
    if !response.status().is_success() {
        return Ok(false);
    }
    
    // 测试搜索 URL 是否有效
    let test_keyword = "test";
    let search_url = config.search_url
        .replace("{base_url}", &config.base_url)
        .replace("{keyword}", test_keyword);
    
    let mut request = client.get(&search_url);
    for (key, value) in &config.headers {
        request = request.header(key.as_str(), value.as_str());
    }
    
    let response = request.send().await?;
    Ok(response.status().is_success())
}
