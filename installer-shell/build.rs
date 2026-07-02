fn main() {
    #[cfg(target_os = "windows")]
    {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("../src-tauri/icons/icon.ico");
        res.set("ProductName", "ChangLi Installer");
        res.set("FileDescription", "ChangLi Installer");
        res.set("InternalName", "ChangLi Installer");
        let _ = res.compile();
    }
}
