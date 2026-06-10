use anyhow::Result;
use reqwest::Client;
use std::collections::HashMap;
use std::time::Duration;

// HTTP 客户端封装
pub struct HttpClient {
    client: Client,
}

impl HttpClient {
    pub fn new() -> Result<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()?;
        
        Ok(Self { client })
    }
    
    // GET 请求
    pub async fn get(&self, url: &str, headers: &HashMap<String, String>) -> Result<String> {
        let mut request = self.client.get(url);
        
        for (key, value) in headers {
            request = request.header(key.as_str(), value.as_str());
        }
        
        let response = request.send().await?;
        
        if !response.status().is_success() {
            return Err(anyhow::anyhow!("HTTP 请求失败: {}", response.status()));
        }
        
        let body = response.text().await?;
        Ok(body)
    }
    
    // POST 请求
    pub async fn post(
        &self,
        url: &str,
        headers: &HashMap<String, String>,
        body: &str,
    ) -> Result<String> {
        let mut request = self.client.post(url);
        
        for (key, value) in headers {
            request = request.header(key.as_str(), value.as_str());
        }
        
        let response = request
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(body.to_string())
            .send()
            .await?;
        
        if !response.status().is_success() {
            return Err(anyhow::anyhow!("HTTP 请求失败: {}", response.status()));
        }
        
        let body = response.text().await?;
        Ok(body)
    }
    
    // 带 cookies 的 GET 请求
    pub async fn get_with_cookies(
        &self,
        url: &str,
        headers: &HashMap<String, String>,
        cookies: &str,
    ) -> Result<String> {
        let mut request = self.client.get(url);
        
        for (key, value) in headers {
            request = request.header(key.as_str(), value.as_str());
        }
        
        request = request.header("Cookie", cookies);
        
        let response = request.send().await?;
        
        if !response.status().is_success() {
            return Err(anyhow::anyhow!("HTTP 请求失败: {}", response.status()));
        }
        
        let body = response.text().await?;
        Ok(body)
    }
    
    // 下载文件
    pub async fn download_file(
        &self,
        url: &str,
        headers: &HashMap<String, String>,
        save_path: &str,
    ) -> Result<()> {
        let mut request = self.client.get(url);
        
        for (key, value) in headers {
            request = request.header(key.as_str(), value.as_str());
        }
        
        let response = request.send().await?;
        
        if !response.status().is_success() {
            return Err(anyhow::anyhow!("下载失败: {}", response.status()));
        }
        
        let bytes = response.bytes().await?;
        std::fs::write(save_path, bytes)?;
        
        Ok(())
    }
}

// 全局 HTTP 客户端
use std::sync::OnceLock;

static HTTP_CLIENT: OnceLock<HttpClient> = OnceLock::new();

pub fn get_http_client() -> &'static HttpClient {
    HTTP_CLIENT.get_or_init(|| {
        HttpClient::new().expect("Failed to create HTTP client")
    })
}
