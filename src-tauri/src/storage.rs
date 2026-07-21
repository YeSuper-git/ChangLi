use anyhow::Result;
use serde::{Deserialize, Serialize};
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
    pub download_dir: String,
    pub auto_use_last_download_dir: bool,
    pub player_mode: String,
    pub external_player_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StorageSettings {
    download_dir: Option<String>,
    auto_use_last_download_dir: bool,
    player_mode: Option<String>,
    external_player_path: Option<String>,
}

impl Default for StorageSettings {
    fn default() -> Self {
        Self {
            download_dir: None,
            auto_use_last_download_dir: false,
            player_mode: None,
            external_player_path: None,
        }
    }
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

fn storage_settings_path() -> PathBuf {
    active_data_dir().join("storage-settings.json")
}

fn default_download_dir() -> PathBuf {
    dirs::download_dir()
        .or_else(|| dirs::home_dir().map(|home| home.join("Downloads")))
        .unwrap_or_else(active_data_dir)
}

fn read_storage_settings() -> StorageSettings {
    let path = storage_settings_path();
    std::fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<StorageSettings>(&content).ok())
        .unwrap_or_default()
}

fn write_storage_settings(settings: &StorageSettings) -> Result<()> {
    std::fs::create_dir_all(active_data_dir())?;
    let content = serde_json::to_string_pretty(settings)?;
    std::fs::write(storage_settings_path(), content)?;
    Ok(())
}

pub fn download_dir() -> PathBuf {
    read_storage_settings()
        .download_dir
        .map(PathBuf::from)
        .unwrap_or_else(default_download_dir)
}

pub fn set_download_dir(path: &str) -> Result<PathBuf> {
    let selected = PathBuf::from(path);
    std::fs::create_dir_all(&selected)?;
    let mut settings = read_storage_settings();
    settings.download_dir = Some(selected.to_string_lossy().to_string());
    write_storage_settings(&settings)?;
    Ok(selected)
}

pub fn set_auto_use_last_download_dir(enabled: bool) -> Result<()> {
    let mut settings = read_storage_settings();
    settings.auto_use_last_download_dir = enabled;
    write_storage_settings(&settings)
}

pub fn auto_use_last_download_dir() -> bool {
    read_storage_settings().auto_use_last_download_dir
}

pub fn player_mode() -> String {
    read_storage_settings()
        .player_mode
        .filter(|mode| mode == "system" || mode == "builtin")
        .unwrap_or_else(default_player_mode)
}

fn default_player_mode() -> String {
    if cfg!(target_os = "macos") {
        "system".to_string()
    } else {
        "builtin".to_string()
    }
}

pub fn external_player_path() -> Option<String> {
    read_storage_settings().external_player_path
}

pub fn set_player_mode(mode: &str) -> Result<()> {
    let normalized = match mode {
        "system" | "builtin" => mode.to_string(),
        _ => default_player_mode(),
    };
    let mut settings = read_storage_settings();
    settings.player_mode = Some(normalized);
    write_storage_settings(&settings)
}

pub fn set_external_player_path(path: Option<&str>) -> Result<()> {
    let mut settings = read_storage_settings();
    settings.external_player_path = path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    write_storage_settings(&settings)
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
    let settings = read_storage_settings();
    let download_dir = settings
        .download_dir
        .clone()
        .unwrap_or_else(|| default_download_dir().to_string_lossy().to_string());
    let player_mode = settings
        .player_mode
        .clone()
        .filter(|mode| mode == "system" || mode == "builtin")
        .unwrap_or_else(default_player_mode);

    Ok(StorageInfo {
        mode: if portable_root.is_some() {
            "portable".to_string()
        } else {
            "system".to_string()
        },
        data_dir: data_dir.to_string_lossy().to_string(),
        db_path: db_path.to_string_lossy().to_string(),
        portable_root: portable_root.map(|path| path.to_string_lossy().to_string()),
        download_dir,
        auto_use_last_download_dir: settings.auto_use_last_download_dir,
        player_mode,
        external_player_path: settings.external_player_path,
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
