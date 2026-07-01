# ChangLi Windows 自定义安装器

## 结论

NSIS `template` 只能替换 wizard 内部页面，外层仍然是 NSIS 默认安装器框架。要做到“完全不是默认安装器”，必须让用户打开的是 ChangLi 自己的安装器外壳。

当前方案：

1. Tauri 仍然在 CI 中生成内层 NSIS 安装包，用于真实文件复制、注册表、快捷方式、卸载信息。
2. CI 随后编译 `installer-shell`。
3. `installer-shell` 在编译期通过 `CHANGLI_NSIS_SETUP` 把内层 NSIS exe 嵌入到自定义安装器 exe。
4. 用户最终下载/打开的是 `ChangLi-{version}-setup.exe`，看到的是 ChangLi 自定义窗口，不再直接看到 NSIS wizard。
5. 点击“开始安装”后，自定义安装器把内层 NSIS 写入临时目录并用 `/S` 静默执行。

## 文件

- `installer-shell/`
  - 独立 Rust/Win32 自定义安装器外壳
  - 无 NSIS 默认窗口
  - 无 WebView/Electron 依赖
  - 绘制 ChangLi 品牌 UI
- `.github/workflows/build.yml`
  - 先通过 `tauri-action` 生成内层 NSIS 安装包
  - 再编译 `installer-shell`
  - 最终上传自定义安装器 exe
- `src-tauri/tauri.conf.json`
  - 不再引用 `nsis/installer.nsi` template
  - 保留默认 NSIS 作为静默安装后端
- `src/index.css`
  - 删除 `.changli-wordmark::before`
  - 程序本体左上角不再显示旧橙色伪图标

## 自定义安装器 UI

自定义窗口内容：

- 左侧 rose/orange ChangLi 品牌区
- 真实 ChangLi app 图标
- 标题：`装好后 / 直接进入 / 收藏宇宙`
- 能力标签：本地数据库 / 内置播放器 / 自动建库
- 右侧安装信息区
- 版本：`ChangLi {version}`
- 主标题：`准备安装长离`
- 安装位置卡片
- 三张能力卡：
  - 保留本地数据
  - 播放器就绪
  - 一键启动
- 底部进度条
- `取消` / `开始安装` 按钮

## 工作流

发布时：

```powershell
# tauri-action 生成内层 NSIS
args: --bundles nsis

# 编译自定义安装器外壳
$env:CHANGLI_NSIS_SETUP = $setup.FullName
$env:CHANGLI_APP_VERSION = "${{ steps.version.outputs.version }}"
cargo build --manifest-path installer-shell/Cargo.toml --release --target x86_64-pc-windows-msvc

# 上传最终自定义安装器
ChangLi-${{ steps.version.outputs.version }}-setup.exe
```

## 验证边界

macOS 本机可验证：

- 前端构建
- Tauri 配置 JSON
- Rust 主程序 `cargo check`
- installer-shell 格式化

自定义 Windows 安装器的真实窗口和安装流程必须通过 GitHub Actions `windows-latest` 构建后验证。
