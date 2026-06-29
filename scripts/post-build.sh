#!/bin/bash
# macOS: 复制 libmpv 相关库到 app bundle 的 MacOS/lib/ 目录
APP_PATH="src-tauri/target/release/bundle/macos/ChangLi.app"
if [ -d "$APP_PATH" ]; then
  mkdir -p "$APP_PATH/Contents/MacOS/lib"
  cp src-tauri/lib/libmpv-wrapper.dylib "$APP_PATH/Contents/MacOS/lib/"
  # 复制系统 libmpv
  if [ -f "/opt/homebrew/lib/libmpv.dylib" ]; then
    cp /opt/homebrew/lib/libmpv.dylib "$APP_PATH/Contents/MacOS/lib/"
    cp /opt/homebrew/lib/libmpv.2.dylib "$APP_PATH/Contents/MacOS/lib/"
  fi
  echo "Copied libmpv libraries to MacOS/lib/"
fi
