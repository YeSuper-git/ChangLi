# 长离 (ChangLi)

智能视频管理播放平台，支持本地资源识别、分类管理、海报匹配、内置高清播放器，自动维护视频库元数据。

**支持 macOS / Windows**

## ✨ 功能特性

### 🎬 智能视频识别
- 自动扫描本地目录，识别视频集、季、选集层级
- 支持 1-2季、1-3季 范围格式识别
- S01E01 标准季集格式识别
- 番号自动提取（绅士专区）

### 🏷️ 分类与标签
- 自定义分类（动漫/泡面番/OVA 等）
- 标签文件夹自动识别（如"科幻"/"动作"文件夹自动关联标签）
- 演员/标签/状态一体化筛选面板
- 标签支持双击编辑

### 🎭 演员管理
- 演员信息管理（生日/身高/体重/简介）
- 参演作品自动关联
- 隐藏彩蛋字段（三围/罩杯，通过新增字段名称解锁）

### 🖼️ 海报系统
- 自动匹配视频集海报（poster.jpg/cover.jpg/folder.jpg）
- 分集海报识别（优先当前文件夹，再往上一级找）
- 编辑更换海报（支持本地上传/URL）

### 📺 内置高清播放器
- mpv 播放引擎，原片原画质
- 支持倍速播放（0.25x-4x）
- 支持所有主流格式（MP4/MKV/AVI/FLV 等）
- 画中画（PiP）模式
- 微信输入法防注入

### 🔄 更新维护
- 全量检查更新（识别新增/移除/改名视频集）
- 单个视频集检查更新
- 内置下载更新包（显示进度，支持取消）
- 安装后自动清理安装包

### 🎓 新手引导
- 首次启动自动触发步骤引导式教程
- 覆盖首页/视频库/视频集详情/演员详情/设置页
- 支持跳过/重新进入

## 🛠️ 技术栈

| 模块 | 技术 |
|------|------|
| **桌面框架** | Tauri 2.0 |
| **前端** | React + TypeScript + TailwindCSS |
| **播放器** | mpv (tauri-plugin-mpv) |
| **数据库** | SQLite |
| **更新** | GitHub Releases API |

## 🚀 快速开始

### 环境要求

- Node.js >= 18
- Rust >= 1.70
- mpv（brew install mpv / scoop install mpv）

### 安装

```bash
git clone https://github.com/YeSuper-git/ChangLi.git
cd ChangLi
npm install
npm run tauri dev
```

### 构建

```bash
npm run tauri build
```

## 📦 下载

前往 [Releases](https://github.com/YeSuper-git/ChangLi/releases) 下载最新版本。

- **macOS**: `.dmg` 文件，拖入 Applications 即可
- **Windows**: `.exe` 安装包，双击安装

## 📄 License

MIT License
