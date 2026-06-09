# 长离 (ChangLi)

全功能视频管理播放平台，支持网站资源拉取、磁力链接下载、本地视频管理和内置高清播放器。

## ✨ 功能特性

### 🌐 网站资源拉取
- 用户自定义网站列表
- 不同网站不同解析规则
- 支持搜索和订阅
- 自动提取磁力链接

### 📥 磁力下载管理
- aria2 RPC 下载引擎
- 下载队列管理
- 进度追踪和状态管理
- 支持暂停/恢复/删除

### 📂 本地视频管理
- 自动扫描本地目录
- 根据来源网站存储不同元数据
- 分类、标签、筛选
- 缩略图生成

### 🎬 内置高清播放器
- mpv 播放引擎
- 原片原画质原帧率播放
- 支持倍速播放（0.25x-4x）
- 支持所有主流格式（MP4/MKV/AVI/FLV等）
- 字幕支持

## 🛠️ 技术栈

| 模块 | 技术 |
|------|------|
| **桌面框架** | Tauri 2.0 |
| **前端** | React + TypeScript + TailwindCSS |
| **播放器** | mpv (libmpv-rs) |
| **下载引擎** | aria2 RPC |
| **数据库** | SQLite |
| **网站解析** | reqwest + scraper |

## 📁 项目结构

```
ChangLi/
├── src-tauri/              # Rust 后端
│   ├── src/
│   │   ├── main.rs         # 入口
│   │   ├── parser/         # 网站解析引擎
│   │   ├── downloader/     # 下载管理器
│   │   ├── player/         # 播放器引擎
│   │   ├── scanner/        # 本地文件扫描
│   │   ├── db/             # 数据库操作
│   │   └── utils/          # 工具函数
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                    # 前端
│   ├── components/         # 通用组件
│   ├── pages/              # 页面
│   │   ├── Home.tsx        # 首页
│   │   ├── Search.tsx      # 搜索页
│   │   ├── Downloads.tsx   # 下载管理
│   │   ├── Library.tsx     # 视频库
│   │   └── Player.tsx      # 播放器
│   ├── utils/              # 工具函数
│   └── assets/             # 静态资源
├── docs/                   # 文档
├── scripts/                # 脚本
└── tests/                  # 测试
```

## 🚀 快速开始

### 环境要求

- Node.js >= 18
- Rust >= 1.70
- aria2（需要安装并启动 RPC）

### 安装

```bash
# 克隆仓库
git clone https://github.com/YeSuper-git/ChangLi.git
cd ChangLi

# 安装依赖
npm install

# 开发模式
npm run tauri dev

# 构建
npm run tauri build
```

### 配置 aria2

```bash
# macOS
brew install aria2
aria2c --enable-rpc --rpc-listen-all=true --rpc-allow-origin-all=true

# Windows
# 下载 aria2 并运行
aria2c.exe --enable-rpc --rpc-listen-all=true --rpc-allow-origin-all=true
```

## 📖 文档

- [需求文档](docs/requirements.md)
- [技术方案](docs/technical-design.md)
- [API 文档](docs/api.md)
- [开发指南](docs/development.md)

## 📝 开发计划

- [ ] Phase 1: 项目搭建、基础架构（1 周）
- [ ] Phase 2: 网站解析引擎（1-2 周）
- [ ] Phase 3: 下载管理器（1 周）
- [ ] Phase 4: 本地视频管理（1 周）
- [ ] Phase 5: 播放器集成（1-2 周）
- [ ] Phase 6: UI 完善、测试（1-2 周）

## 📄 License

MIT License

## 👥 贡献

欢迎提交 Issue 和 Pull Request！

## 🙏 致谢

- [Tauri](https://tauri.app/)
- [mpv](https://mpv.io/)
- [aria2](https://aria2.github.io/)
