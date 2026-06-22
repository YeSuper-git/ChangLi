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

// 下载状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadStatus {
    pub gid: String,
    pub status: String,
    pub total_length: String,
    pub completed_length: String,
    pub download_speed: String,
    pub upload_speed: String,
    pub files: Vec<FileInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub path: String,
    pub length: String,
    pub completed_length: String,
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

    // 添加 HTTP/FTP 下载
    pub async fn add_uri(&self, url: &str, options: Option<DownloadOptions>) -> Result<String> {
        let mut params = vec![serde_json::Value::String(url.to_string())];

        if let Some(opts) = options {
            let mut options_map = serde_json::Map::new();
            if let Some(dir) = opts.dir {
                options_map.insert("dir".to_string(), serde_json::Value::String(dir));
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

    // 获取下载状态
    pub async fn get_status(&self, gid: &str) -> Result<DownloadStatus> {
        let params = vec![serde_json::Value::String(gid.to_string())];

        let result = self.call("aria2.tellStatus", params).await?;
        let status: DownloadStatus = serde_json::from_value(result)?;

        Ok(status)
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

    // 强制删除下载
    pub async fn force_remove(&self, gid: &str) -> Result<()> {
        let params = vec![serde_json::Value::String(gid.to_string())];

        self.call("aria2.forceRemove", params).await?;
        Ok(())
    }

    // 获取全局统计信息
    pub async fn get_global_stat(&self) -> Result<GlobalStat> {
        let result = self.call("aria2.getGlobalStat", vec![]).await?;
        let stat: GlobalStat = serde_json::from_value(result)?;
        Ok(stat)
    }

    // 获取活跃下载列表
    pub async fn get_active(&self) -> Result<Vec<DownloadStatus>> {
        let result = self.call("aria2.tellActive", vec![]).await?;
        let downloads: Vec<DownloadStatus> = serde_json::from_value(result)?;
        Ok(downloads)
    }

    // 获取等待下载列表
    pub async fn get_waiting(&self, offset: i64, num: i64) -> Result<Vec<DownloadStatus>> {
        let params = vec![
            serde_json::Value::Number(offset.into()),
            serde_json::Value::Number(num.into()),
        ];

        let result = self.call("aria2.tellWaiting", params).await?;
        let downloads: Vec<DownloadStatus> = serde_json::from_value(result)?;
        Ok(downloads)
    }

    // 获取已完成下载列表
    pub async fn get_stopped(&self, offset: i64, num: i64) -> Result<Vec<DownloadStatus>> {
        let params = vec![
            serde_json::Value::Number(offset.into()),
            serde_json::Value::Number(num.into()),
        ];

        let result = self.call("aria2.tellStopped", params).await?;
        let downloads: Vec<DownloadStatus> = serde_json::from_value(result)?;
        Ok(downloads)
    }

    // 获取版本
    pub async fn get_version(&self) -> Result<String> {
        let result = self.call("aria2.getVersion", vec![]).await?;
        let version = result
            .get("version")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        Ok(version)
    }

    // 检查 aria2 是否运行
    pub async fn is_running(&self) -> bool {
        self.get_version().await.is_ok()
    }
}

// 全局统计信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalStat {
    pub download_speed: String,
    pub upload_speed: String,
    pub num_active: String,
    pub num_waiting: String,
    pub num_stopped: String,
    pub num_stopped_total: String,
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

pub async fn get_status(gid: &str) -> Result<DownloadStatus> {
    get_aria2_client().get_status(gid).await
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
