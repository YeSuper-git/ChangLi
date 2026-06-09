use anyhow::Result;
use serde::{Deserialize, Serialize};

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
    error: Option<serde_json::Value>,
}

// 下载状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadStatus {
    pub gid: String,
    pub status: String,
    pub total_length: String,
    pub completed_length: String,
    pub download_speed: String,
    pub files: Vec<FileInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub path: String,
    pub length: String,
    pub completed_length: String,
}

// 添加磁力链接下载
pub async fn add_magnet(magnet: &str) -> Result<String> {
    let client = reqwest::Client::new();
    
    let request = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        id: 1,
        method: "aria2.addUri".to_string(),
        params: vec![
            serde_json::Value::String(magnet.to_string()),
        ],
    };
    
    let response = client
        .post("http://localhost:6800/jsonrpc")
        .json(&request)
        .send()
        .await?;
    
    let body: JsonRpcResponse = response.json().await?;
    
    if let Some(error) = body.error {
        return Err(anyhow::anyhow!("aria2 错误: {}", error));
    }
    
    let gid = body.result
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .ok_or_else(|| anyhow::anyhow!("无法获取 GID"))?;
    
    Ok(gid)
}

// 获取下载状态
pub async fn get_status(gid: &str) -> Result<DownloadStatus> {
    let client = reqwest::Client::new();
    
    let request = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        id: 1,
        method: "aria2.tellStatus".to_string(),
        params: vec![
            serde_json::Value::String(gid.to_string()),
        ],
    };
    
    let response = client
        .post("http://localhost:6800/jsonrpc")
        .json(&request)
        .send()
        .await?;
    
    let body: JsonRpcResponse = response.json().await?;
    
    if let Some(error) = body.error {
        return Err(anyhow::anyhow!("aria2 错误: {}", error));
    }
    
    let status: DownloadStatus = serde_json::from_value(
        body.result.ok_or_else(|| anyhow::anyhow!("无法获取状态"))?
    )?;
    
    Ok(status)
}

// 暂停下载
pub async fn pause(gid: &str) -> Result<()> {
    let client = reqwest::Client::new();
    
    let request = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        id: 1,
        method: "aria2.pause".to_string(),
        params: vec![
            serde_json::Value::String(gid.to_string()),
        ],
    };
    
    let response = client
        .post("http://localhost:6800/jsonrpc")
        .json(&request)
        .send()
        .await?;
    
    let body: JsonRpcResponse = response.json().await?;
    
    if let Some(error) = body.error {
        return Err(anyhow::anyhow!("aria2 错误: {}", error));
    }
    
    Ok(())
}

// 恢复下载
pub async fn resume(gid: &str) -> Result<()> {
    let client = reqwest::Client::new();
    
    let request = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        id: 1,
        method: "aria2.resume".to_string(),
        params: vec![
            serde_json::Value::String(gid.to_string()),
        ],
    };
    
    let response = client
        .post("http://localhost:6800/jsonrpc")
        .json(&request)
        .send()
        .await?;
    
    let body: JsonRpcResponse = response.json().await?;
    
    if let Some(error) = body.error {
        return Err(anyhow::anyhow!("aria2 错误: {}", error));
    }
    
    Ok(())
}

// 删除下载
pub async fn remove(gid: &str) -> Result<()> {
    let client = reqwest::Client::new();
    
    let request = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        id: 1,
        method: "aria2.remove".to_string(),
        params: vec![
            serde_json::Value::String(gid.to_string()),
        ],
    };
    
    let response = client
        .post("http://localhost:6800/jsonrpc")
        .json(&request)
        .send()
        .await?;
    
    let body: JsonRpcResponse = response.json().await?;
    
    if let Some(error) = body.error {
        return Err(anyhow::anyhow!("aria2 错误: {}", error));
    }
    
    Ok(())
}
