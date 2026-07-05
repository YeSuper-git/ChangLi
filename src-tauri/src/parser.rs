use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// 网站配置
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
}

// 网站信息
#[derive(Debug, Clone)]
pub struct Site {
    pub id: i64,
    pub config: SiteConfig,
}

// 资源信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resource {
    pub id: i64,
    pub site_id: i64,
    pub title: String,
    pub url: Option<String>,
    pub magnet: Option<String>,
    pub info: Option<serde_json::Value>,
    pub supports_online_play: bool,
}

// 搜索资源
pub async fn search_resources(site: &Site, keyword: &str) -> Result<Vec<Resource>> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    // 构建搜索 URL
    let search_url = site.config.search_url.replace("{keyword}", keyword);

    // 发送请求
    let mut request = if site.config.search_method.to_uppercase() == "POST" {
        client.post(&search_url)
    } else {
        client.get(&search_url)
    };

    // 添加 headers
    for (key, value) in &site.config.headers {
        request = request.header(key.as_str(), value.as_str());
    }

    // 添加 cookies
    if let Some(cookies) = &site.config.cookies {
        request = request.header("Cookie", cookies.as_str());
    }

    let response = request.send().await?;
    let html = response.text().await?;

    // 解析 HTML
    let document = scraper::Html::parse_document(&html);
    let list_selector = scraper::Selector::parse(&site.config.list_selector)
        .map_err(|e| anyhow::anyhow!("无效的选择器: {}", e))?;

    let mut resources = Vec::new();
    for element in document.select(&list_selector) {
        match parse_resource_element(&element, site) {
            Ok(resource) => resources.push(resource),
            Err(e) => eprintln!("解析资源元素失败: {}", e),
        }
    }

    Ok(resources)
}

fn parse_resource_element(element: &scraper::ElementRef, site: &Site) -> Result<Resource> {
    let title = extract_text(element, &site.config.title_selector)?;
    let url = extract_attr(element, &site.config.url_selector, "href")?;
    let magnet = extract_text(element, &site.config.magnet_selector).ok();

    let mut info = serde_json::Map::new();
    for (key, selector) in &site.config.info_selectors {
        if let Ok(value) = extract_text(element, selector) {
            info.insert(key.clone(), serde_json::Value::String(value));
        }
    }

    Ok(Resource {
        id: 0,
        site_id: site.id,
        title,
        url: Some(url),
        magnet,
        info: Some(serde_json::Value::Object(info)),
        supports_online_play: site.config.supports_online_play,
    })
}

fn extract_text(element: &scraper::ElementRef, selector: &str) -> Result<String> {
    let selector =
        scraper::Selector::parse(selector).map_err(|e| anyhow::anyhow!("无效的选择器: {}", e))?;

    let text = element
        .select(&selector)
        .next()
        .map(|el| el.text().collect::<String>())
        .unwrap_or_default();

    Ok(text.trim().to_string())
}

fn extract_attr(element: &scraper::ElementRef, selector: &str, attr: &str) -> Result<String> {
    let selector =
        scraper::Selector::parse(selector).map_err(|e| anyhow::anyhow!("无效的选择器: {}", e))?;

    let value = element
        .select(&selector)
        .next()
        .and_then(|el| el.value().attr(attr))
        .unwrap_or_default()
        .to_string();

    Ok(value)
}
