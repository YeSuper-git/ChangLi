# ChangLi Windows 安装器 UI 设计落地

## 目标

完全摒弃默认 NSIS 欢迎/路径选择/start menu 页面，把 Windows 安装器升级为 ChangLi 自有品牌安装前端。

## 当前落地范围

本次启用 Tauri v2 NSIS `template`：

```json
"template": "nsis/installer.nsi"
```

并基于 Tauri v2 默认模板保留底层安装能力：

- WebView2 检查与安装逻辑
- 旧版本检测与覆盖安装逻辑
- 文件复制、资源复制、external binaries 复制
- 注册表写入
- 桌面/开始菜单快捷方式
- 卸载逻辑
- 安静安装/被动安装参数

页面层改为 ChangLi 自定义安装前端。

## 已替换的默认页面

`src-tauri/nsis/installer.nsi` 中已移除默认：

- `MUI_PAGE_WELCOME`
- `MUI_PAGE_DIRECTORY`
- `MUI_PAGE_STARTMENU`
- `MUI_PAGE_FINISH`
- `MULTIUSER_PAGE_INSTALLMODE`

替换为：

```nsi
Page custom ChangLiBrandPageCreate ChangLiBrandPageLeave
```

## 自定义安装页内容

自定义页包括：

- 左侧 rose/orange ChangLi 品牌侧栏
- 真实 ChangLi app 图标，不使用“长”字占位
- 版本提示：`ChangLi ${VERSION}`
- 主标题：`准备安装长离`
- 说明文案：本地影音资料库、保留数据、播放环境
- 安装位置卡片
- “更改”按钮，使用 `nsDialogs::SelectFolderDialog` 选择安装目录
- 三张能力卡：
  - 保留本地数据
  - 播放器就绪
  - 一键启动
- 底部状态文案：`准备就绪 · 约 1 分钟完成`
- 默认向导按钮重命名：
  - 下一步 → `开始安装`
  - 取消 → `取消`
  - 上一步隐藏

## 自定义完成页

安装完成后不使用默认 `MUI_PAGE_FINISH`，改为 `ChangLiFinishPageCreate`：

- 左侧沿用 ChangLi 品牌侧栏
- 标题：`长离已安装完成`
- 展示安装路径摘要
- 勾选项：`完成后立即打开 ChangLi`
- 底部状态：`本地数据已保留 · 快捷方式已创建 · 播放环境已就绪`
- 默认向导按钮重命名：`完成`

## 资源

- `src-tauri/nsis/installer-sidebar.bmp`
  - 左侧品牌主视觉，尺寸 164 x 314
- `src-tauri/nsis/installer-header.bmp`
  - 备用 header 视觉，尺寸 150 x 57
- `src-tauri/nsis/installer.nsi`
  - 完整自定义 NSIS template
- `src/assets/brand/app-icon.png`
  - React 顶栏真实 app 图标

## 主程序顶栏修复

`src/components/Layout.tsx` 使用真实 app 图标 + `长离` 文本。

`src/index.css` 删除了旧的：

```css
.changli-wordmark::before
```

因此不会再出现原来的橙色伪图标，也不是在旧图标右侧新增真实图标，而是彻底替换旧图标。

## 验证说明

macOS 本机可以验证：

```bash
npm run build
```

Windows NSIS installer template 必须通过 Windows CI / Windows 构建机生成真实 `.exe` 后做最终安装器视觉和安装流程验证。
