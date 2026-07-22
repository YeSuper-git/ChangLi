# 长离 ChangLi

> 智能视频管理播放平台 — 自动识别、智能分类、海报匹配、内置播放器

<p align="center">
  <img src="docs/screenshots/home.png" width="800" alt="ChangLi 首页">
</p>

**支持 macOS / Windows** · **MIT License** · **免费开源**

---

## ✨ 核心功能

### 🎬 智能识别
自动扫描本地视频文件，智能识别视频集、季、选集层级，无需手动整理文件夹结构。

### 📂 分类管理
自定义分类体系，支持标签管理、文件夹自动识别、一体化筛选搜索。

### 🎭 演员系统
演员信息管理，参演作品自动关联，支持演员详情页和作品列表。

### 🖼️ 海报匹配
自动匹配视频集和分集海报，支持手动修复和批量更新。

### ▶️ 内置播放器
基于 mpv 引擎，支持原片画质播放、倍速播放、画中画模式、播放进度记录。

### 📺 RSS 订阅
支持 RSS 订阅源管理，自动检查更新，磁力链接一键复制。

### 🔔 智能通知
订阅更新检查、版本更新提醒，支持后台静默检查。

### 📝 影评记录
看完后记录评分、时间和短评，个人观影笔记。

---

## 📸 截图预览

| 首页 | 视频库 | 播放器 |
|------|--------|--------|
| ![首页](docs/screenshots/home.png) | ![视频库](docs/screenshots/library.png) | ![播放器](docs/screenshots/player.png) |

| 演员库 | 设置 | 订阅 |
|--------|------|------|
| ![演员库](docs/screenshots/actors.png) | ![设置](docs/screenshots/settings.png) | ![订阅](docs/screenshots/subscriptions.png) |

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

- **前端**：React + TypeScript + Tailwind CSS
- **后端**：Tauri 2.0 + Rust
- **播放器**：mpv（内置）/ 系统播放器
- **数据库**：SQLite
- **构建**：Vite + Cargo

---

## 📋 系统要求

| 平台 | 最低要求 |
|------|----------|
| macOS | macOS 11.0+ (Big Sur) |
| Windows | Windows 10 1903+ (64-bit) |

---

## 🤝 反馈问题

- [GitHub Issues](https://github.com/YeSuper-git/ChangLi/issues)
- 抖音联系二维码见应用内「关于」页面

---

## 📄 License

[MIT License](LICENSE)

---

<p align="center">
  <sub>Made with ❤️ by <a href="https://github.com/YeSuper-git">YeSuper</a></sub>
</p>
