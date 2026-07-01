# ChangLi Windows 安装器 UI 设计落地

## 目标

把 Windows NSIS 安装器从默认样式升级为 ChangLi 品牌化安装入口，让用户第一次打开安装包时就能感知产品质感。

## 当前落地范围

Tauri v2 的 NSIS 默认安装器支持以下安全配置：

- `headerImage`: 150 x 57 BMP
- `sidebarImage`: 164 x 314 BMP
- `installerIcon`: ICO
- `installerHooks`: 安装前后逻辑 hook
- `template`: 完整自定义 NSIS 模板

本次优先使用低风险方式落地：重绘 `headerImage` 和 `sidebarImage`，不启用完整 NSIS template，避免自定义模板和 Tauri v2 内置安装流程冲突。

## 已更新资源

- `src-tauri/nsis/installer-sidebar.bmp`
  - Rose/orange 品牌渐变侧栏
  - 使用真实 ChangLi app 图标，不再使用“长”字占位
  - 强化安装器第一眼品牌感
  - 加入“本地数据库 / 内置播放器 / 自动建库”能力标签

- `src-tauri/nsis/installer-header.bmp`
  - 使用真实 ChangLi app 图标
  - 标题为 ChangLi + 安装向导
  - 延续 rose/orange 品牌色

- `src/assets/brand/app-icon.png`
  - 复制自 `src-tauri/icons/icon.png`
  - 用于 React 主程序顶栏品牌位

- `src/components/Layout.tsx`
  - 顶栏左上角从纯文字“长离”升级为 app 图标 + 长离文字
  - 保留原导航结构和交互

## 后续可选升级

如果后续要做到预览稿里的完整 1:1 自定义右侧布局，需要启用 NSIS `template` 并维护完整 `.nsi` 模板。风险点：

1. Tauri v2 模板变量变化会导致安装包构建或启动失败。
2. 完整 template 需要跟随 Tauri bundler 更新维护。
3. 自定义页面需要在 Windows 环境用真实 NSIS 构建验证。

因此建议先上线本次品牌资源版，确认 Windows 安装包稳定后，再单独开一轮完整 NSIS template 重构。
