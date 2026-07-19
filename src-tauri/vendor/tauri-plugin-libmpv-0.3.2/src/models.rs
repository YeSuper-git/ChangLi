use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::ffi::{c_char, c_void};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::{AppHandle, Runtime};

use crate::wrapper::MpvHandle;

pub struct MpvInstance<R: Runtime> {
    pub handle: *mut MpvHandle,
    /// Raw pointer passed to native libmpv as event_userdata.
    /// The pointed-to Arc<EventUserData> is also held by this struct
    /// (via `event_data`) so the callback can safely upgrade it even
    /// after the instance is removed from the map.
    pub event_userdata: *mut c_void,
    /// Keeps EventUserData alive until after mpv_wrapper_destroy returns.
    /// The callback clones this Arc before checking is_alive, ensuring
    /// the struct is not freed while a callback is in flight.
    pub event_data: Arc<EventUserData<R>>,
}

// MpvInstance contains raw pointers that are only accessed under the instances Mutex;
// the Arc-based EventUserData ensures the callback never touches freed memory.
// Send + Sync are required for the HashMap.
unsafe impl<R: Runtime> Send for MpvInstance<R> {}
unsafe impl<R: Runtime> Sync for MpvInstance<R> {}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MpvConfig {
    #[serde(default)]
    pub initial_options: IndexMap<String, serde_json::Value>,
    #[serde(default)]
    pub observed_properties: IndexMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VideoMarginRatio {
    pub left: Option<f64>,
    pub right: Option<f64>,
    pub top: Option<f64>,
    pub bottom: Option<f64>,
}

pub struct EventUserData<R: Runtime> {
    pub app: AppHandle<R>,
    pub free_fn: unsafe extern "C" fn(*mut c_char),
    pub window_label: String,
    /// Set to false before mpv_wrapper_destroy; callback checks this
    /// before accessing app/window_label.
    pub is_alive: AtomicBool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FfiResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
