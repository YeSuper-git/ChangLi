use std::{cell::Cell, sync::mpsc};

use tao::{
    event::{ElementState, MouseButton, MouseScrollDelta, WindowEvent},
    event_loop::EventLoopProxy,
    platform::windows::WindowExtWindows,
    window::Window,
};
use webview2_com::{Microsoft::Web::WebView2::Win32::*, *};
use windows::{
    core::{Interface, HSTRING, PWSTR},
    Win32::{
        Foundation::{E_POINTER, HWND, POINT, RECT},
        Graphics::{
            DirectComposition::{
                DCompositionCreateDevice, IDCompositionDevice, IDCompositionRectangleClip,
                IDCompositionTarget, IDCompositionVisual,
            },
            Dxgi::IDXGIDevice,
        },
        System::{Com::CoTaskMemFree, WinRT::EventRegistrationToken},
    },
};

use crate::InstallerEvent;

const CORNER_RADIUS_DIP: f32 = 34.0;

/// WebView2 hosted through ICoreWebView2CompositionController.
///
/// All COM and DirectComposition objects live and are released on Tao's UI
/// thread. Field order is intentional: the WebView controller is closed before
/// the visual tree and device are released.
pub struct CompositionWebView {
    webview: ICoreWebView2,
    composition_controller: ICoreWebView2CompositionController,
    controller: ICoreWebView2Controller,
    message_token: EventRegistrationToken,
    _visual: IDCompositionVisual,
    clip: IDCompositionRectangleClip,
    target: IDCompositionTarget,
    device: IDCompositionDevice,
    cursor: Cell<POINT>,
    buttons: Cell<COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS>,
}

impl CompositionWebView {
    pub fn new(
        window: &Window,
        html: &str,
        proxy: EventLoopProxy<InstallerEvent>,
    ) -> std::result::Result<Self, String> {
        let hwnd = HWND(window.hwnd() as *mut core::ffi::c_void);
        let environment = create_environment().map_err(error_text)?;
        let environment3: ICoreWebView2Environment3 = environment.cast().map_err(error_text)?;
        let composition_controller =
            create_composition_controller(&environment3, hwnd).map_err(error_text)?;
        let controller: ICoreWebView2Controller =
            composition_controller.cast().map_err(error_text)?;
        let webview = unsafe { controller.CoreWebView2() }.map_err(error_text)?;

        let device: IDCompositionDevice =
            unsafe { DCompositionCreateDevice(None::<&IDXGIDevice>) }.map_err(error_text)?;
        let target = unsafe { device.CreateTargetForHwnd(hwnd, true) }.map_err(error_text)?;
        let visual = unsafe { device.CreateVisual() }.map_err(error_text)?;
        let clip = unsafe { device.CreateRectangleClip() }.map_err(error_text)?;

        unsafe {
            visual.SetClip(&clip).map_err(error_text)?;
            target.SetRoot(&visual).map_err(error_text)?;
            composition_controller
                .SetRootVisualTarget(&visual)
                .map_err(error_text)?;
        }

        let message_handler =
            WebMessageReceivedEventHandler::create(Box::new(move |_sender, args| {
                if let Some(args) = args {
                    if let Some(command) = web_message_string(&args) {
                        if let Some(event) = installer_event(&command) {
                            let _ = proxy.send_event(event);
                        }
                    }
                }
                Ok(())
            }));
        let mut message_token = EventRegistrationToken::default();
        unsafe {
            webview
                .add_WebMessageReceived(&message_handler, &mut message_token)
                .map_err(error_text)?;

            let controller2: ICoreWebView2Controller2 = controller.cast().map_err(error_text)?;
            controller2
                .SetDefaultBackgroundColor(COREWEBVIEW2_COLOR {
                    A: 0,
                    R: 0,
                    G: 0,
                    B: 0,
                })
                .map_err(error_text)?;

            controller.SetIsVisible(true).map_err(error_text)?;
            let document = HSTRING::from(webview_html(html));
            webview.NavigateToString(&document).map_err(error_text)?;
        }

        let instance = Self {
            webview,
            composition_controller,
            controller,
            message_token,
            _visual: visual,
            clip,
            target,
            device,
            cursor: Cell::new(POINT::default()),
            buttons: Cell::new(COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_NONE),
        };
        instance.resize(window)?;
        Ok(instance)
    }

    pub fn evaluate_script(&self, script: &str) -> std::result::Result<(), String> {
        let handler = ExecuteScriptCompletedHandler::create(Box::new(|_error, _json| Ok(())));
        let script = HSTRING::from(script);
        unsafe { self.webview.ExecuteScript(&script, &handler) }.map_err(error_text)
    }

    pub fn handle_window_event(&self, window: &Window, event: &WindowEvent<'_>) {
        match event {
            WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
                let _ = self.resize(window);
            }
            WindowEvent::Focused(true) => unsafe {
                let _ = self
                    .controller
                    .MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
            },
            WindowEvent::CursorMoved { position, .. } => {
                let point = POINT {
                    x: position.x.round() as i32,
                    y: position.y.round() as i32,
                };
                self.cursor.set(point);
                self.send_mouse(COREWEBVIEW2_MOUSE_EVENT_KIND_MOVE, self.buttons.get(), 0);
            }
            WindowEvent::CursorLeft { .. } => {
                self.send_mouse(COREWEBVIEW2_MOUSE_EVENT_KIND_LEAVE, self.buttons.get(), 0)
            }
            WindowEvent::MouseInput { state, button, .. } => {
                self.handle_mouse_button(*state, *button)
            }
            WindowEvent::MouseWheel { delta, .. } => {
                let amount = match delta {
                    MouseScrollDelta::LineDelta(_, y) => (*y * 120.0).round() as i32,
                    MouseScrollDelta::PixelDelta(position) => position.y.round() as i32,
                    _ => return,
                };
                self.send_mouse(
                    COREWEBVIEW2_MOUSE_EVENT_KIND_WHEEL,
                    self.buttons.get(),
                    (amount as u32) << 16,
                );
            }
            _ => {}
        }
    }

    fn resize(&self, window: &Window) -> std::result::Result<(), String> {
        let size = window.inner_size();
        let width = size.width as i32;
        let height = size.height as i32;
        let radius = CORNER_RADIUS_DIP * window.scale_factor() as f32;
        unsafe {
            self.controller
                .SetBounds(RECT {
                    left: 0,
                    top: 0,
                    right: width,
                    bottom: height,
                })
                .map_err(error_text)?;
            self.clip.SetLeft2(0.0).map_err(error_text)?;
            self.clip.SetTop2(0.0).map_err(error_text)?;
            self.clip.SetRight2(width as f32).map_err(error_text)?;
            self.clip.SetBottom2(height as f32).map_err(error_text)?;
            self.clip.SetTopLeftRadiusX2(radius).map_err(error_text)?;
            self.clip.SetTopLeftRadiusY2(radius).map_err(error_text)?;
            self.clip.SetTopRightRadiusX2(radius).map_err(error_text)?;
            self.clip.SetTopRightRadiusY2(radius).map_err(error_text)?;
            self.clip
                .SetBottomLeftRadiusX2(radius)
                .map_err(error_text)?;
            self.clip
                .SetBottomLeftRadiusY2(radius)
                .map_err(error_text)?;
            self.clip
                .SetBottomRightRadiusX2(radius)
                .map_err(error_text)?;
            self.clip
                .SetBottomRightRadiusY2(radius)
                .map_err(error_text)?;
            self.device.Commit().map_err(error_text)?;
        }
        Ok(())
    }

    fn handle_mouse_button(&self, state: ElementState, button: MouseButton) {
        let (down, up, key) = match button {
            MouseButton::Left => (
                COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_DOWN,
                COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_UP,
                COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_LEFT_BUTTON,
            ),
            MouseButton::Right => (
                COREWEBVIEW2_MOUSE_EVENT_KIND_RIGHT_BUTTON_DOWN,
                COREWEBVIEW2_MOUSE_EVENT_KIND_RIGHT_BUTTON_UP,
                COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_RIGHT_BUTTON,
            ),
            MouseButton::Middle => (
                COREWEBVIEW2_MOUSE_EVENT_KIND_MIDDLE_BUTTON_DOWN,
                COREWEBVIEW2_MOUSE_EVENT_KIND_MIDDLE_BUTTON_UP,
                COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_MIDDLE_BUTTON,
            ),
            _ => return,
        };

        let old = self.buttons.get();
        let event = match state {
            ElementState::Pressed => {
                self.buttons
                    .set(COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS(old.0 | key.0));
                down
            }
            ElementState::Released => {
                self.buttons
                    .set(COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS(old.0 & !key.0));
                up
            }
            _ => return,
        };
        self.send_mouse(event, self.buttons.get(), 0);
    }

    fn send_mouse(
        &self,
        kind: COREWEBVIEW2_MOUSE_EVENT_KIND,
        keys: COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS,
        data: u32,
    ) {
        unsafe {
            let _ = self
                .composition_controller
                .SendMouseInput(kind, keys, data, self.cursor.get());
        }
    }
}

impl Drop for CompositionWebView {
    fn drop(&mut self) {
        unsafe {
            let _ = self.webview.remove_WebMessageReceived(self.message_token);
            let _ = self.controller.SetIsVisible(false);
            let _ = self.composition_controller.SetRootVisualTarget(None);
            let _ = self.target.SetRoot(None);
            let _ = self.device.Commit();
            let _ = self.controller.Close();
        }
    }
}

fn create_environment() -> webview2_com::Result<ICoreWebView2Environment> {
    let (tx, rx) = mpsc::channel();
    CreateCoreWebView2EnvironmentCompletedHandler::wait_for_async_operation(
        Box::new(|handler| unsafe {
            CreateCoreWebView2Environment(&handler).map_err(webview2_com::Error::WindowsError)
        }),
        Box::new(move |error, environment| {
            error?;
            tx.send(environment.ok_or_else(|| windows::core::Error::from(E_POINTER)))
                .expect("send WebView2 environment over initialization channel");
            Ok(())
        }),
    )?;
    rx.recv()
        .map_err(|_| webview2_com::Error::SendError)?
        .map_err(Into::into)
}

fn create_composition_controller(
    environment: &ICoreWebView2Environment3,
    hwnd: HWND,
) -> webview2_com::Result<ICoreWebView2CompositionController> {
    let (tx, rx) = mpsc::channel();
    CreateCoreWebView2CompositionControllerCompletedHandler::wait_for_async_operation(
        Box::new({
            let environment = environment.clone();
            move |handler| unsafe {
                environment
                    .CreateCoreWebView2CompositionController(hwnd, &handler)
                    .map_err(webview2_com::Error::WindowsError)
            }
        }),
        Box::new(move |error, controller| {
            error?;
            tx.send(controller.ok_or_else(|| windows::core::Error::from(E_POINTER)))
                .expect("send composition controller over initialization channel");
            Ok(())
        }),
    )?;
    rx.recv()
        .map_err(|_| webview2_com::Error::SendError)?
        .map_err(Into::into)
}

fn web_message_string(args: &ICoreWebView2WebMessageReceivedEventArgs) -> Option<String> {
    let mut value = PWSTR::null();
    unsafe {
        args.TryGetWebMessageAsString(&mut value).ok()?;
        if value.is_null() {
            return None;
        }
        let command = value.to_string().ok();
        CoTaskMemFree(Some(value.0.cast()));
        command
    }
}

fn installer_event(command: &str) -> Option<InstallerEvent> {
    match command
        .trim()
        .trim_start_matches("changli://")
        .trim_end_matches('/')
    {
        "ready" => Some(InstallerEvent::Ready),
        "drag" => Some(InstallerEvent::Drag),
        "close" => Some(InstallerEvent::Close),
        "choose-dir" => Some(InstallerEvent::ChooseDir),
        "install" => Some(InstallerEvent::Install),
        "launch-close" => Some(InstallerEvent::CloseAndLaunch),
        _ => None,
    }
}

fn webview_html(html: &str) -> String {
    html.replace(
        "<head>",
        r#"<head><script>
window.__changliHostCommand = command => {
  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.postMessage(command);
  } else {
    window.location.href = command;
  }
};
</script>"#,
    )
}

fn error_text(error: impl std::fmt::Display) -> String {
    error.to_string()
}
