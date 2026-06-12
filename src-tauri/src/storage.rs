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

pub fn is_portable_mode() -> bool {
    portable_root_dir().is_some()
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

    if is_portable_mode() {
        migrate_default_data_to_portable_if_needed()?;
    }

    Ok(())
}

fn migrate_default_data_to_portable_if_needed() -> Result<()> {
    let default_dir = default_data_dir();
    let active = active_data_dir();

    if default_dir == active || !default_dir.exists() {
        return Ok(());
    }

    let active_db = active.join("changli.db");
    let default_db = default_dir.join("changli.db");

    // Only seed portable data on first portable run. If portable already has a DB,
    // never overwrite it.
    if active_db.exists() || !default_db.exists() {
        return Ok(());
    }

    copy_dir_missing_only(&default_dir, &active)?;
    Ok(())
}

fn copy_dir_missing_only(source: &Path, dest: &Path) -> Result<()> {
    std::fs::create_dir_all(dest)?;

    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let dest_path = dest.join(entry.file_name());

        if source_path.is_dir() {
            copy_dir_missing_only(&source_path, &dest_path)?;
        } else if !dest_path.exists() {
            if let Some(parent) = dest_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(&source_path, &dest_path)?;
        }
    }

    Ok(())
}
