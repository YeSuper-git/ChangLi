use log::{error, info, trace, warn};
use once_cell::sync::OnceCell;
use raw_window_handle::HasWindowHandle;
use scopeguard::defer;
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::ffi::{c_char, c_void, CStr, CString};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use tauri::{plugin::PluginApi, AppHandle, Manager, Runtime};

use crate::models::*;
use crate::utils::get_wid;
use crate::wrapper::LibmpvWrapper;
use crate::Error;
use crate::Result;

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Mpv<R>> {
    info!("Plugin registered.");
    let mpv = Mpv {
        app: app.clone(),
        instances: Mutex::new(HashMap::new()),
        wrapper: OnceCell::new(),
    };
    Ok(mpv)
}

pub struct Mpv<R: Runtime> {
    app: AppHandle<R>,
    pub instances: Mutex<HashMap<String, MpvInstance<R>>>,
    pub wrapper: OnceCell<LibmpvWrapper>,
}

/// Event callback invoked from native libmpv worker threads.
///
/// SAFETY: `userdata` was created with `Arc::into_raw` in `init_wid_mode`.
/// Each callback first increments the strong count, then reconstructs one
/// temporary `Arc`, so the native raw pointer remains valid for future
/// callbacks until `destroy()` reclaims it.
pub unsafe extern "C" fn event_callback<R: Runtime>(event: *const c_char, userdata: *mut c_void) {
    if event.is_null() || userdata.is_null() {
        return;
    }

    let userdata_ptr = userdata as *const EventUserData<R>;
    unsafe {
        Arc::increment_strong_count(userdata_ptr);
    }
    let event_data_arc: Arc<EventUserData<R>> = unsafe { Arc::from_raw(userdata_ptr) };

    // Free the native event string. free_fn is a plain function pointer, safe to read.
    let free_fn = event_data_arc.free_fn;
    let event_string = unsafe { CStr::from_ptr(event).to_string_lossy().to_string() };
    unsafe {
        free_fn(event as *mut c_char);
    }

    // Guard: if the instance is being destroyed, skip event emission.
    if !event_data_arc.is_alive.load(Ordering::Acquire) {
        // Drop our Arc clone; if this was the last reference, the data is freed here.
        drop(event_data_arc);
        return;
    }

    // Clone out the fields we need for the async task, then drop the Arc.
    let app = event_data_arc.app.clone();
    let window_label = event_data_arc.window_label.clone();
    drop(event_data_arc);

    tauri::async_runtime::spawn(async move {
        match serde_json::from_str::<serde_json::Value>(&event_string) {
            Ok(event) => {
                let event_name = format!("mpv-event-{}", window_label);
                if let Err(e) = app.emit_to(&window_label, &event_name, &event) {
                    error!("Failed to emit mpv event to frontend: {}", e);
                }
            }
            Err(e) => {
                error!("Failed to deserialize mpv FFI event: {}", e);
            }
        }
    });
}

impl<R: Runtime> Mpv<R> {
    pub fn init(&self, mpv_config: MpvConfig, window_label: &str) -> Result<String> {
        self.init_wid_mode(mpv_config, window_label)?;
        Ok(window_label.to_string())
    }

    fn init_wid_mode(&self, mpv_config: MpvConfig, window_label: &str) -> Result<String> {
        let app = self.app.clone();

        let wrapper = self.get_wrapper()?;

        let free_fn = wrapper.mpv_wrapper_free;

        let mut initial_options = mpv_config.initial_options.clone();

        let Some(mut instances_lock) = self.lock_and_check_existence(window_label)? else {
            return Ok(window_label.to_string());
        };

        let audio_only = initial_options.iter().any(|(key, value)| {
            (key == "video" && (value == "no" || value == false))
                || (key == "vid" && (value == "no" || value == false))
        });

        if audio_only {
            info!(
                "Audio-only mode detected for window '{}'. Skipping window embedding.",
                window_label
            );
        }

        if !audio_only && !initial_options.contains_key("wid") {
            let wid_result = (|| -> crate::Result<i64> {
                let window = self
                    .app
                    .get_webview_window(window_label)
                    .ok_or_else(|| crate::Error::WindowNotFound(window_label.to_string()))?;
                let window_handle = window.window_handle()?;
                let raw_window_handle = window_handle.as_raw();
                get_wid(raw_window_handle)
            })();

            match wid_result {
                Ok(wid) => {
                    initial_options.insert("wid".to_string(), serde_json::json!(wid));
                }
                Err(e) => {
                    error!(
                        "Failed to get wid for window '{}': {}. Skipping window embedding.",
                        window_label, e
                    );
                }
            }
        }

        let initial_options_string = serde_json::to_string(&initial_options)?;
        let observed_properties_string = serde_json::to_string(&mpv_config.observed_properties)?;

        let c_initial_options = CString::new(initial_options_string)?;
        let c_observed_properties = CString::new(observed_properties_string)?;

        // Create EventUserData wrapped in Arc for safe shared ownership.
        let event_data: Arc<EventUserData<R>> = Arc::new(EventUserData {
            app,
            free_fn,
            window_label: window_label.to_string(),
            is_alive: AtomicBool::new(true),
        });

        // Pass a raw pointer to the Arc to native libmpv. We also keep a
        // clone in MpvInstance so the allocation stays alive even if the
        // native side's callback hasn't fired yet when destroy() runs.
        let event_userdata = Arc::into_raw(event_data.clone()) as *mut c_void;

        let mpv_handle = unsafe {
            wrapper.mpv_wrapper_create(
                c_initial_options.as_ptr(),
                c_observed_properties.as_ptr(),
                Some(event_callback::<R>),
                event_userdata,
            )
        };

        if mpv_handle.is_null() {
            // Signal callbacks to stop, then reclaim the Arc.
            event_data.is_alive.store(false, Ordering::Release);
            // Reconstruct and drop the Arc that was passed to the native side.
            let _ = unsafe { Arc::from_raw(event_userdata as *const EventUserData<R>) };
            return Err(crate::Error::CreateInstance);
        }

        info!("mpv instance initialized for window '{}'.", window_label);

        let instance = MpvInstance {
            handle: mpv_handle,
            event_userdata: event_userdata,
            event_data: event_data,
        };

        instances_lock.insert(window_label.to_string(), instance);

        info!("Wid mode initialized for window '{}'.", window_label);

        Ok(window_label.to_string())
    }

    pub fn destroy(&self, window_label: &str) -> Result<()> {
        // Phase 1: Under the lock, mark is_alive = false and remove the instance.
        // Any event_callback that checks is_alive after this point will return early.
        // The Arc in MpvInstance.event_data keeps EventUserData alive even after
        // the instance is removed from the map, so in-flight callbacks are safe.
        let removed = {
            let mut instances_lock = match self.instances.lock() {
                Ok(guard) => guard,
                Err(poisoned) => {
                    warn!("Mutex was poisoned, recovering.");
                    poisoned.into_inner()
                }
            };
            // Signal callbacks to stop while holding the lock.
            if let Some(instance) = instances_lock.get(window_label) {
                instance.event_data.is_alive.store(false, Ordering::Release);
            }
            instances_lock.remove(window_label)
        };

        if let Some(instance) = removed {
            // Phase 2: Destroy the native mpv handle. After this returns,
            // no new callbacks should be generated by the native side.
            let wrapper = self.get_wrapper()?;
            unsafe {
                wrapper.mpv_wrapper_destroy(instance.handle);
            }

            // Phase 3: Reclaim the raw Arc pointer that was passed to native libmpv.
            // This balances the Arc::into_raw in init_wid_mode.
            // The allocation will only be freed when both this Arc AND the one in
            // instance.event_data are dropped (i.e., after this function returns).
            let _ = unsafe { Arc::from_raw(instance.event_userdata as *const EventUserData<R>) };

            // Phase 4: Drop the MpvInstance (and its event_data Arc clone).
            // If no in-flight callback holds a clone, the EventUserData is freed now.
            drop(instance);

            info!(
                "mpv instance for window '{}' has been destroyed.",
                window_label,
            );
        } else {
            trace!(
                "No running mpv instance found for window '{}' to destroy.",
                window_label
            );
        }
        Ok(())
    }

    pub fn command(
        &self,
        name: &str,
        args: &Vec<serde_json::Value>,
        window_label: &str,
    ) -> Result<()> {
        if args.is_empty() {
            trace!("COMMAND '{}'", name);
        } else {
            trace!("COMMAND '{}' '{:?}'", name, args);
        }

        self.with_instance(window_label, |instance| {
            let wrapper = self.get_wrapper()?;

            let args_string = serde_json::to_string(&args)?;

            let c_name = CString::new(name)?;
            let c_args = CString::new(args_string)?;

            let result_ptr = unsafe {
                wrapper.mpv_wrapper_command(instance.handle, c_name.as_ptr(), c_args.as_ptr())
            };

            if result_ptr.is_null() {
                return Err(crate::Error::FFI("Call returned null pointer".into()));
            }

            defer! {
                unsafe { wrapper.mpv_wrapper_free(result_ptr) };
            }

            let response_str = unsafe { CStr::from_ptr(result_ptr).to_string_lossy() };
            let response: FfiResponse = serde_json::from_str(&response_str)?;

            if let Some(err) = response.error {
                Err(crate::Error::Command {
                    window_label: window_label.to_string(),
                    message: err,
                })
            } else {
                Ok(())
            }
        })
    }

    pub fn set_property(
        &self,
        name: &str,
        value: &serde_json::Value,
        window_label: &str,
    ) -> crate::Result<()> {
        trace!("SET PROPERTY '{}' '{:?}'", name, value);

        self.with_instance(window_label, |instance| {
            let wrapper = self.get_wrapper()?;

            let value_string = serde_json::to_string(value)?;

            let c_name = CString::new(name)?;
            let c_value = CString::new(value_string)?;

            let result_ptr = unsafe {
                wrapper.mpv_wrapper_set_property(instance.handle, c_name.as_ptr(), c_value.as_ptr())
            };

            if result_ptr.is_null() {
                return Err(crate::Error::FFI("Call returned null pointer".into()));
            }

            defer! {
                unsafe { wrapper.mpv_wrapper_free(result_ptr) };
            }

            let response_str = unsafe { CStr::from_ptr(result_ptr).to_string_lossy() };
            let response: FfiResponse = serde_json::from_str(&response_str)?;

            if let Some(err) = response.error {
                Err(crate::Error::SetProperty {
                    window_label: window_label.to_string(),
                    message: err,
                })
            } else {
                Ok(())
            }
        })
    }

    pub fn get_property(
        &self,
        name: String,
        format: String,
        window_label: &str,
    ) -> crate::Result<serde_json::Value> {
        self.with_instance(window_label, |instance| {
            let wrapper = self.get_wrapper()?;

            let c_name = CString::new(name.clone())?;
            let c_format = CString::new(format.as_str())?;

            let result_ptr = unsafe {
                wrapper.mpv_wrapper_get_property(
                    instance.handle,
                    c_name.as_ptr(),
                    c_format.as_ptr(),
                )
            };

            defer! {
                unsafe { wrapper.mpv_wrapper_free(result_ptr) };
            }

            let response_str = unsafe {
                if result_ptr.is_null() {
                    return Err(crate::Error::GetProperty {
                        window_label: window_label.to_string(),
                        message: "FFI call returned null pointer".into(),
                    });
                }
                CStr::from_ptr(result_ptr).to_string_lossy()
            };

            let response: FfiResponse = serde_json::from_str(&response_str)?;

            if let Some(err) = response.error {
                return Err(crate::Error::GetProperty {
                    window_label: window_label.to_string(),
                    message: err,
                });
            }

            let value = response.data.ok_or_else(|| crate::Error::GetProperty {
                window_label: window_label.to_string(),
                message: "FFI response contained no data".to_string(),
            })?;

            trace!("GET PROPERTY '{}' '{:?}'", name, value);
            Ok(value)
        })
    }

    pub fn set_video_margin_ratio(
        &self,
        ratio: VideoMarginRatio,
        window_label: &str,
    ) -> Result<()> {
        trace!("SET VIDEO MARGIN RATIO '{:?}'", ratio);

        let margins = [
            ("video-margin-ratio-left", ratio.left),
            ("video-margin-ratio-right", ratio.right),
            ("video-margin-ratio-top", ratio.top),
            ("video-margin-ratio-bottom", ratio.bottom),
        ];

        for (property, value_option) in margins {
            if let Some(value) = value_option {
                self.set_property(property, &serde_json::json!(value), window_label)?;
            }
        }
        Ok(())
    }

    fn lock_and_check_existence<'a>(
        &'a self,
        window_label: &str,
    ) -> Result<Option<std::sync::MutexGuard<'a, HashMap<String, MpvInstance<R>>>>> {
        let instances_lock = match self.instances.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };

        if instances_lock.contains_key(window_label) {
            info!(
                "mpv instance for window '{}' already exists. Skipping initialization.",
                window_label
            );
            Ok(None)
        } else {
            Ok(Some(instances_lock))
        }
    }

    fn with_instance<F, T>(&self, window_label: &str, operation: F) -> Result<T>
    where
        F: FnOnce(&MpvInstance<R>) -> Result<T>,
    {
        let instances_lock = match self.instances.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                warn!("Mutex was poisoned, recovering.");
                poisoned.into_inner()
            }
        };

        let instance = instances_lock.get(window_label).ok_or_else(|| {
            crate::Error::InstanceNotFound(format!(
                "mpv instance for window label '{}' not found",
                window_label
            ))
        })?;

        operation(instance)
    }

    fn get_wrapper(&self) -> Result<&LibmpvWrapper> {
        self.wrapper.get_or_try_init(|| {
            info!("libmpv-wrapper not initialized. Trying to load libmpv-wrapper now...");

            #[cfg(target_os = "windows")]
            let lib_name = "libmpv-wrapper.dll";
            #[cfg(target_os = "macos")]
            let lib_name = "libmpv-wrapper.dylib";
            #[cfg(target_os = "linux")]
            let lib_name = "libmpv-wrapper.so";

            let mut search_dirs: Vec<PathBuf> = Vec::new();
            if let Ok(exe_path) = std::env::current_exe() {
                if let Some(exe_dir) = exe_path.parent() {
                    search_dirs.push(exe_dir.to_path_buf());
                    search_dirs.push(exe_dir.join("lib"));
                    // Tauri macOS bundles place resources under Contents/Resources, while the
                    // executable lives under Contents/MacOS. The upstream plugin only checks the
                    // executable directory, so packaged apps cannot find bundled libmpv-wrapper.
                    search_dirs.push(exe_dir.join("../Resources/lib"));
                    search_dirs.push(exe_dir.join("../Resources"));
                }
            }

            let searched_paths: Vec<String> = search_dirs
                .iter()
                .map(|dir| dir.join(lib_name).to_string_lossy().into_owned())
                .collect();

            let valid_lib_path: String = searched_paths
                .iter()
                .find(|path| PathBuf::from(path).exists())
                .cloned()
                .unwrap_or_else(|| lib_name.to_string());

            info!("Attempting to load libmpv-wrapper from: {}", valid_lib_path);
            let result = unsafe { LibmpvWrapper::new(&valid_lib_path) };

            match result {
                Ok(wrapper) => {
                    info!("Successfully loaded libmpv-wrapper.");
                    Ok(wrapper)
                }
                Err(e) => Err(Error::FFI(format!(
                    "[CL-MAC-LIBMPV-WRAPPER] Failed to load libmpv-wrapper from '{}'. Searched: [{}]. Error: {:?}",
                    valid_lib_path,
                    searched_paths.join(", "),
                    e
                ))
                .into()),
            }
        })
    }
}
