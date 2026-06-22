use anyhow::Result;
use scraper::{ElementRef, Html, Selector};
use std::collections::HashMap;

// HTML 解析器
pub struct HtmlParser {
    document: Html,
}

impl HtmlParser {
    // 解析 HTML
    pub fn parse(html: &str) -> Self {
        let document = Html::parse_document(html);
        Self { document }
    }

    // 选择单个元素
    pub fn select_first(&self, selector: &str) -> Result<Option<ElementRef>> {
        let selector =
            Selector::parse(selector).map_err(|e| anyhow::anyhow!("无效的选择器: {}", e))?;

        Ok(self.document.select(&selector).next())
    }

    // 选择多个元素
    pub fn select_all(&self, selector: &str) -> Result<Vec<ElementRef>> {
        let selector =
            Selector::parse(selector).map_err(|e| anyhow::anyhow!("无效的选择器: {}", e))?;

        Ok(self.document.select(&selector).collect())
    }

    // 获取元素文本
    pub fn get_text(element: &ElementRef, selector: &str) -> Result<String> {
        let selector =
            Selector::parse(selector).map_err(|e| anyhow::anyhow!("无效的选择器: {}", e))?;

        let text = element
            .select(&selector)
            .next()
            .map(|el| el.text().collect::<String>())
            .unwrap_or_default();

        Ok(text.trim().to_string())
    }

    // 获取元素属性
    pub fn get_attr(element: &ElementRef, selector: &str, attr: &str) -> Result<String> {
        let selector =
            Selector::parse(selector).map_err(|e| anyhow::anyhow!("无效的选择器: {}", e))?;

        let value = element
            .select(&selector)
            .next()
            .and_then(|el| el.value().attr(attr))
            .unwrap_or_default()
            .to_string();

        Ok(value)
    }

    // 获取元素 HTML
    pub fn get_html(element: &ElementRef) -> String {
        element.html()
    }

    // 解析资源列表
    pub fn parse_resource_list(
        &self,
        list_selector: &str,
        title_selector: &str,
        url_selector: &str,
        magnet_selector: &str,
        info_selectors: &HashMap<String, String>,
        base_url: &str,
    ) -> Result<Vec<ParsedResource>> {
        let list_sel = Selector::parse(list_selector)
            .map_err(|e| anyhow::anyhow!("无效的列表选择器: {}", e))?;

        let mut resources = Vec::new();

        for element in self.document.select(&list_sel) {
            match self.parse_resource_element(
                &element,
                title_selector,
                url_selector,
                magnet_selector,
                info_selectors,
                base_url,
            ) {
                Ok(resource) => resources.push(resource),
                Err(e) => eprintln!("解析资源元素失败: {}", e),
            }
        }

        Ok(resources)
    }

    // 解析单个资源元素
    fn parse_resource_element(
        &self,
        element: &ElementRef,
        title_selector: &str,
        url_selector: &str,
        magnet_selector: &str,
        info_selectors: &HashMap<String, String>,
        base_url: &str,
    ) -> Result<ParsedResource> {
        let title = Self::get_text(element, title_selector)?;
        let url = Self::get_attr(element, url_selector, "href")?;
        let magnet = Self::get_text(element, magnet_selector).ok();

        // 处理相对 URL
        let full_url = if url.starts_with("http") {
            url
        } else if url.starts_with("/") {
            format!("{}{}", base_url.trim_end_matches('/'), url)
        } else {
            format!("{}/{}", base_url.trim_end_matches('/'), url)
        };

        // 解析额外信息
        let mut info = HashMap::new();
        for (key, selector) in info_selectors {
            if let Ok(value) = Self::get_text(element, selector) {
                if !value.is_empty() {
                    info.insert(key.clone(), value);
                }
            }
        }

        Ok(ParsedResource {
            title,
            url: full_url,
            magnet,
            info,
        })
    }

    // 解析分页信息
    pub fn parse_pagination(&self, selector: &str) -> Result<PaginationInfo> {
        let elements = self.select_all(selector)?;

        let mut total_pages = 1;
        let mut current_page = 1;

        for element in &elements {
            let text = element.text().collect::<String>();
            let text = text.trim();

            if let Ok(page) = text.parse::<i32>() {
                if page > total_pages {
                    total_pages = page;
                }
            }
        }

        // 查找当前页
        let active_selector = Selector::parse(".active, .current, [aria-current]").unwrap();
        for element in self.document.select(&active_selector) {
            let text = element.text().collect::<String>();
            if let Ok(page) = text.trim().parse::<i32>() {
                current_page = page;
                break;
            }
        }

        Ok(PaginationInfo {
            current_page,
            total_pages,
        })
    }
}

// 解析后的资源
#[derive(Debug, Clone)]
pub struct ParsedResource {
    pub title: String,
    pub url: String,
    pub magnet: Option<String>,
    pub info: HashMap<String, String>,
}

// 分页信息
#[derive(Debug, Clone)]
pub struct PaginationInfo {
    pub current_page: i32,
    pub total_pages: i32,
}
