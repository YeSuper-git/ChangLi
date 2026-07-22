# 长离 ChangLi

> 智能视频管理播放平台 — 自动识别、智能分类、海报匹配、内置播放器

<p align="center">
  <img src="docs/screenshots/home.png" width="800" alt="ChangLi 首页">
</p>

**支持 macOS / Windows** · **MIT License** · **免费开源**

> ⚠️ **免责声明**：ChangLi 仅是一个本地视频资源管理和播放平台，不提供任何视频内容、资源下载或在线播放服务。所有视频文件均来自用户本地磁盘，本项目不涉及任何视频资源的存储、分发或版权问题。

---

## ✨ 核心功能

- **智能识别** — 自动识别视频集、季、选集层级
- **分类管理** — 自定义分类、标签文件夹自动识别、一体化筛选
- **演员系统** — 演员信息管理、参演作品自动关联
- **海报匹配** — 自动匹配视频集和分集海报
- **内置播放器** — mpv 引擎，原片画质，倍速播放，画中画
- **RSS 订阅** — 自动检查更新，磁力链接一键复制
- **影评记录** — 看完后记录评分、时间和短评

---

## 📸 截图预览

<img src="docs/screenshots/home.png" width="800">

<img src="docs/screenshots/library.png" width="800">

<img src="docs/screenshots/tags.png" width="800">

<img src="docs/screenshots/actors.png" width="800">

---

## 📥 下载安装

### macOS
1. 下载 [最新 Release](https://github.com/YeSuper-git/ChangLi/releases/latest) 中的 `.dmg` 文件
2. 打开 DMG，将 `ChangLi` 拖到 `Applications` 文件夹
3. 首次打开可能提示"无法验证开发者"，在 **系统设置 → 隐私与安全性** 中点击"仍然打开"

### Windows
1. 下载 [最新 Release](https://github.com/YeSuper-git/ChangLi/releases/latest) 中的 `.exe` 安装包
2. 双击运行，按向导完成安装
3. 首次启动会有新手引导，跟着走即可

---

## 🚀 快速开始

1. **启动应用** → 首次进入会显示新手引导
2. **添加视频目录** → 设置 → 数据存储 → 更换下载目录
3. **扫描视频** → 应用会自动识别视频集和分集
4. **开始播放** → 点击任意视频集即可播放

---

## 🛠️ 技术栈

React + TypeScript + Tailwind CSS + Tauri 2.0 + Rust + mpv + SQLite

---

## 📋 系统要求

| 平台 | 最低要求 |
|------|----------|
| macOS | macOS 11.0+ |
| Windows | Windows 10 1903+ (64-bit) |

---

## 🤝 反馈问题

- [GitHub Issues](https://github.com/YeSuper-git/ChangLi/issues)

---

## 📄 License

[MIT License](LICENSE)
