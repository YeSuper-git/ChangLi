# ChangLi Windows 自定义安装器

## 结论

NSIS `template` 只能替换 wizard 内部页面，外层仍然是 NSIS 默认安装器框架。要做到“完全不是默认安装器”，必须让用户打开的是 ChangLi 自己的安装器外壳。

当前方案：

1. Tauri 仍然在 CI 中生成内层 NSIS 安装包，用于真实文件复制、注册表、快捷方式、卸载信息。
2. CI 随后编译 `installer-shell`。
3. `installer-shell` 使用 Tao + Wry/WebView2 承载 HTML/CSS 安装器 UI，并在编译期通过 `CHANGLI_NSIS_SETUP` 把内层 NSIS exe 嵌入到自定义安装器 exe。
4. 用户最终下载/打开的是 `ChangLi_{version}_x64-setup.exe`，看到的是 ChangLi 自定义窗口，不再直接看到 NSIS wizard。
5. 点击“开始安装”后，自定义安装器把内层 NSIS 写入临时目录，并用 `/S /D=<用户选择目录>` 静默执行。
6. 安装完成/失败状态以 NSIS 子进程退出结果为准，不能用 `setTimeout` 或随机进度假装完成。

## 文件

- `installer-shell/`
  - 独立 Rust + Tao + Wry/WebView2 自定义安装器外壳
  - 无 NSIS 默认窗口
  - HTML/CSS 渲染预览稿级 UI
  - Rust IPC 处理拖动、关闭、目录选择、安装、完成状态
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

当前窗口内容：

- 左侧 rose/orange ChangLi 品牌区
- 真实 ChangLi app 图标直接展示，不额外包白底容器
- 左上背景有细线纹理
- 标题：`装好后 / 直接进入 / 收藏宇宙`
- 左侧玻璃标签：本地优先 / 安静安装 / 桌面入口
- 左下三个堆叠透明玻璃卡片
- 右侧基础背景上的标题区：
  - 顶部步骤指示：彩色长条 + 两个灰点
  - 右上灰色版本号：`v{version}`
  - 主标题：`准备安装长离`
  - 说明：`选择安装位置后，安装器会自动写入运行组件并创建桌面入口。过程清楚、安静、不打扰。`
- 右侧一个操作卡片：
  - 安装位置真实路径
  - `更改` 按钮打开目录选择器
  - 1 / 2 / 3 三个真实安装步骤
  - `安装后打开` 勾选项
  - `开机自启` 勾选项
- 未开始安装时不显示进度条、不显示预计时间
- 安装中只显示真实安装中状态；成功/失败由 NSIS 退出码决定
- `取消` / `关闭` 在未安装时退出；安装中禁用取消避免假交互

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
ChangLi_${{ steps.version.outputs.version }}_x64-setup.exe
```

## 验证边界

macOS 本机可验证：

- 前端构建
- Tauri 配置 JSON
- Rust 主程序 `cargo check`
- installer-shell `cargo fmt --check`
- installer-shell Windows target `cargo check --target x86_64-pc-windows-msvc`
- 静态 HTML 预览结构

自定义 Windows 安装器的真实窗口、WebView2 渲染、目录选择、拖动、圆角裁剪、静默安装和安装后启动流程，必须通过 GitHub Actions `windows-latest` 构建后的真实 artifact 验证。
