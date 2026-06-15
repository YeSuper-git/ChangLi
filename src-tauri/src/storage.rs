use anyhow::Result;
use serde::Serialize;
use std::path::{Path, PathBuf};

const APP_DATA_DIR_NAME: &str = "changli";
const PORTABLE_DATA_DIR_NAME: &str = "data";
const PORTABLE_FLAG_FILE: &str = "portable.flag";

#[derive(Debug, Clone, Serialize)]
pub struct StorageInfo {
    pub mode: String,
    pub data_dir: String,
    pub db_path: String,
    pub portable_root: Option<String>,
}

pub fn default_data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(APP_DATA_DIR_NAME)
}

fn app_root_dir() -> Result<PathBuf> {
    let exe = std::env::current_exe()?;

    // macOS packaged apps run from Foo.app/Contents/MacOS/Foo. For portable mode,
    // data should sit next to Foo.app, not inside the signed app bundle.
    for ancestor in exe.ancestors() {
        if ancestor.extension().and_then(|ext| ext.to_str()) == Some("app") {
            if let Some(parent) = ancestor.parent() {
                return Ok(parent.to_path_buf());
            }
        }
    }

    Ok(exe.parent().unwrap_or_else(|| Path::new(".")).to_path_buf())
}

pub fn portable_root_dir() -> Option<PathBuf> {
    let root = app_root_dir().ok()?;
    let flag = root.join(PORTABLE_FLAG_FILE);
    let data_dir = root.join(PORTABLE_DATA_DIR_NAME);

    if flag.exists() || data_dir.exists() {
        Some(root)
    } else {
        None
    }
}

pub fn active_data_dir() -> PathBuf {
    if let Some(root) = portable_root_dir() {
        root.join(PORTABLE_DATA_DIR_NAME)
    } else {
        default_data_dir()
    }
}

pub fn db_path() -> PathBuf {
    active_data_dir().join("changli.db")
}

pub fn actor_photos_dir() -> PathBuf {
    active_data_dir().join("actors").join("photos")
}

pub fn video_thumbnails_dir() -> PathBuf {
    active_data_dir().join("videos").join("thumbnails")
}

pub fn resolve_data_path(path: &str) -> PathBuf {
    let source = Path::new(path);
    if source.is_absolute() {
        source.to_path_buf()
    } else {
        active_data_dir().join(source)
    }
}

pub fn path_relative_to_data_dir(path: &Path) -> String {
    let data_dir = active_data_dir();
    path.strip_prefix(&data_dir)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

pub fn storage_info() -> Result<StorageInfo> {
    let data_dir = active_data_dir();
    let db_path = db_path();
    let portable_root = portable_root_dir();

    Ok(StorageInfo {
        mode: if portable_root.is_some() {
            "portable".to_string()
        } else {
            "system".to_string()
        },
        data_dir: data_dir.to_string_lossy().to_string(),
        db_path: db_path.to_string_lossy().to_string(),
        portable_root: portable_root.map(|path| path.to_string_lossy().to_string()),
    })
}

pub fn prepare_active_data_dir() -> Result<()> {
    let active = active_data_dir();
    std::fs::create_dir_all(&active)?;

    // 不再自动把 system 数据目录复制到 portable 数据目录。
    // 旧逻辑会在用户创建空 data/ 或 portable.flag 时，把另一份 changli.db 拷贝过来，
    // 容易表现为“删掉的数据又回来了”或“程序连接的不是我正在看的数据库”。
    // 现在 init_database 只会打开 active_data_dir()/changli.db 并执行幂等迁移，
    // 不会覆盖、复制或重置任何已有数据。
    Ok(())
}
