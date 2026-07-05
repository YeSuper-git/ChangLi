use anyhow::Result;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicI64, Ordering};

// aria2 RPC 客户端
pub struct Aria2Client {
    rpc_url: String,
    client: Client,
    request_id: AtomicI64,
}

// aria2 RPC 请求
#[derive(Debug, Serialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: i64,
    method: String,
    params: Vec<serde_json::Value>,
}

// aria2 RPC 响应
#[derive(Debug, Deserialize)]
struct JsonRpcResponse {
    result: Option<serde_json::Value>,
    error: Option<JsonRpcError>,
}

#[derive(Debug, Deserialize)]
struct JsonRpcError {
    code: i64,
    message: String,
}

// 下载选项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadOptions {
    pub dir: Option<String>,
    pub max_download_limit: Option<String>,
    pub max_upload_limit: Option<String>,
    pub seed_time: Option<i64>,
}

impl Aria2Client {
    pub fn new(rpc_url: &str) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            rpc_url: rpc_url.to_string(),
            client,
            request_id: AtomicI64::new(1),
        }
    }

    // 调用 RPC 方法
    async fn call(
        &self,
        method: &str,
        params: Vec<serde_json::Value>,
    ) -> Result<serde_json::Value> {
        let id = self.request_id.fetch_add(1, Ordering::SeqCst);

        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id,
            method: method.to_string(),
            params,
        };

        let response = self
            .client
            .post(&self.rpc_url)
            .json(&request)
            .send()
            .await?;

        let body: JsonRpcResponse = response.json().await?;

        if let Some(error) = body.error {
            return Err(anyhow::anyhow!(
                "aria2 错误: {} ({})",
                error.message,
                error.code
            ));
        }

        body.result
            .ok_or_else(|| anyhow::anyhow!("aria2 返回空结果"))
    }

    // 添加磁力链接下载
    pub async fn add_magnet(
        &self,
        magnet: &str,
        options: Option<DownloadOptions>,
    ) -> Result<String> {
        let mut params = vec![serde_json::Value::String(magnet.to_string())];

        if let Some(opts) = options {
            let mut options_map = serde_json::Map::new();
            if let Some(dir) = opts.dir {
                options_map.insert("dir".to_string(), serde_json::Value::String(dir));
            }
            if let Some(limit) = opts.max_download_limit {
                options_map.insert(
                    "max-download-limit".to_string(),
                    serde_json::Value::String(limit),
                );
            }
            if let Some(limit) = opts.max_upload_limit {
                options_map.insert(
                    "max-upload-limit".to_string(),
                    serde_json::Value::String(limit),
                );
            }
            params.push(serde_json::Value::Object(options_map));
        }

        let result = self.call("aria2.addUri", params).await?;
        let gid = result
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("无法获取 GID"))?
            .to_string();

        Ok(gid)
    }

    // 暂停下载
    pub async fn pause(&self, gid: &str) -> Result<()> {
        let params = vec![serde_json::Value::String(gid.to_string())];

        self.call("aria2.pause", params).await?;
        Ok(())
    }

    // 恢复下载
    pub async fn resume(&self, gid: &str) -> Result<()> {
        let params = vec![serde_json::Value::String(gid.to_string())];

        self.call("aria2.resume", params).await?;
        Ok(())
    }

    // 删除下载
    pub async fn remove(&self, gid: &str) -> Result<()> {
        let params = vec![serde_json::Value::String(gid.to_string())];

        self.call("aria2.remove", params).await?;
        Ok(())
    }

}

// 全局 aria2 客户端
use std::sync::OnceLock;

static ARIA2_CLIENT: OnceLock<Aria2Client> = OnceLock::new();

pub fn get_aria2_client() -> &'static Aria2Client {
    ARIA2_CLIENT.get_or_init(|| Aria2Client::new("http://localhost:6800/jsonrpc"))
}

// 便捷函数
pub async fn add_magnet(magnet: &str) -> Result<String> {
    get_aria2_client().add_magnet(magnet, None).await
}

pub async fn pause(gid: &str) -> Result<()> {
    get_aria2_client().pause(gid).await
}

pub async fn resume(gid: &str) -> Result<()> {
    get_aria2_client().resume(gid).await
}

pub async fn remove(gid: &str) -> Result<()> {
    get_aria2_client().remove(gid).await
}
