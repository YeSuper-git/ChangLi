#!/bin/bash
# 下载 Windows 版 mpv 和 ffmpeg 用于打包
set -e

BINARIES_DIR="$(dirname "$0")/../src-tauri/binaries"
mkdir -p "$BINARIES_DIR"
cd "$BINARIES_DIR"

echo "=== 下载 mpv ==="
# mpv from SourceForge (使用直接链接)
MPV_URL="https://sourceforge.net/projects/mpv-player-windows/files/64bit-v3/mpv-x86_64-20240317-git-1a1e45a.7z/download"
curl -L --max-time 120 -o mpv-x86_64.7z "$MPV_URL" 2>&1 || echo "mpv 下载失败"

if [ -f mpv-x86_64.7z ] && [ $(stat -f%z mpv-x86_64.7z 2>/dev/null || stat -c%s mpv-x86_64.7z 2>/dev/null) -gt 100000 ]; then
    7z x -y mpv-x86_64.7z 2>/dev/null || true
    rm -f mpv-x86_64.7z
    echo "mpv 解压完成"
else
    echo "mpv 下载失败或文件太小，跳过"
fi

echo "=== 下载 ffmpeg ==="
# ffmpeg from gyan.dev
FFMPEG_URL="https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
curl -L --max-time 180 -o ffmpeg.zip "$FFMPEG_URL" 2>&1 || echo "ffmpeg 下载失败"

if [ -f ffmpeg.zip ] && [ $(stat -f%z ffmpeg.zip 2>/dev/null || stat -c%s ffmpeg.zip 2>/dev/null) -gt 1000000 ]; then
    unzip -o ffmpeg.zip 2>/dev/null || true
    # 移动到根目录
    find . -name "ffmpeg.exe" -exec cp {} . \;
    find . -name "ffprobe.exe" -exec cp {} . \;
    rm -rf ffmpeg.zip ffmpeg-*
    echo "ffmpeg 解压完成"
else
    echo "ffmpeg 下载失败或文件太小，跳过"
fi

echo "=== 完成 ==="
ls -la *.exe 2>/dev/null || echo "没有找到 exe 文件"
