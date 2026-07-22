# 长离 ChangLi

> 智能视频资源管理平台 — 本地识别 · 智能分类 · 海报匹配 · 内置播放器

<p align="center">
  <img src="docs/screenshots/home.png" width="800" alt="ChangLi">
</p>

<p align="center">
  <strong>支持 macOS / Windows</strong> · MIT License · 免费开源
</p>

> ⚠️ **免责声明**：ChangLi 是一个本地视频资源管理工具，所有视频文件均存储于用户本地磁盘，本软件不提供、不托管、不分发任何视频内容。RSS 订阅功能仅解析用户自定义的信息源，磁力链接仅作为复制操作由用户自行决定是否使用。用户应自行确保所管理的内容符合当地法律法规。
>
> 🔒 **隐私声明**：所有数据均通过本地 SQLite 数据库管理，除 RSS 订阅更新外所有功能均支持离线使用，不收集、不上传任何用户个人信息。

---

## 核心功能

- **智能识别** — 自动扫描本地视频，识别视频集、季、选集层级
- **分类管理** — 自定义分类体系，标签筛选，文件夹自动识别
- **演员管理** — 演员信息维护，参演作品自动关联
- **海报匹配** — 自动匹配视频集海报，支持手动修复
- **内置播放器** — 基于 mpv 引擎，原片画质，倍速播放，画中画
- **RSS 订阅** — 订阅源管理，自动检查更新，磁力链接一键复制
- **影评记录** — 看完后记录评分、时间和短评

---

## 截图预览

<img src="docs/screenshots/library.png" width="800">

<img src="docs/screenshots/tags.png" width="800">

<img src="docs/screenshots/actors.png" width="800">

---

## 下载安装

### macOS
1. 下载 [最新 Release](https://github.com/YeSuper-git/ChangLi/releases/latest) 中的 `.dmg` 文件
2. 打开 DMG，将 `ChangLi` 拖到 `Applications` 文件夹
3. 首次打开可能提示"无法验证开发者"，在 **系统设置 → 隐私与安全性** 中点击"仍然打开"

### Windows
1. 下载 [最新 Release](https://github.com/YeSuper-git/ChangLi/releases/latest) 中的 `.exe` 安装包
2. 双击运行，按向导完成安装
3. 首次启动会有新手引导，跟着走即可

---

## 快速开始

1. 启动应用，首次进入会显示新手引导
2. 进入设置 → 数据存储 → 选择视频目录
3. 应用会自动扫描并识别视频集和分集
4. 点击任意视频集即可播放

---

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React + TypeScript + Tailwind CSS |
| 后端 | Tauri 2.0 + Rust |
| 播放器 | mpv（内置）/ 系统播放器 |
| 数据库 | SQLite（纯本地） |

---

## 系统要求

| 平台 | 最低要求 |
|------|----------|
| macOS | macOS 11.0+ |
| Windows | Windows 10 1903+（64-bit） |

---

## 反馈问题

[GitHub Issues](https://github.com/YeSuper-git/ChangLi/issues)

---

## License

[MIT License](LICENSE)
