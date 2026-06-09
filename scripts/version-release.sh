#!/bin/bash
# 长离 - 版本发布脚本
# 用法: ./scripts/version-release.sh <change-description> [version-type]

set -e

CHANGE_DESCRIPTION=$1
VERSION_TYPE=${2:-patch}

if [ -z "$CHANGE_DESCRIPTION" ]; then
    echo "用法: $0 <change-description> [version-type]"
    echo "version-type: major/minor/patch (默认 patch)"
    exit 1
fi

# 获取当前版本
CURRENT_VERSION=$(grep '"version"' package.json | head -1 | awk -F: '{ print $2 }' | sed 's/[",]//g' | tr -d '[:space:]')
echo "当前版本: $CURRENT_VERSION"

# 计算新版本
IFS='.' read -r -a VERSION_PARTS <<< "$CURRENT_VERSION"
MAJOR=${VERSION_PARTS[0]}
MINOR=${VERSION_PARTS[1]}
PATCH=${VERSION_PARTS[2]}

case $VERSION_TYPE in
    major)
        MAJOR=$((MAJOR + 1))
        MINOR=0
        PATCH=0
        ;;
    minor)
        MINOR=$((MINOR + 1))
        PATCH=0
        ;;
    patch)
        PATCH=$((PATCH + 1))
        ;;
    *)
        echo "无效的版本类型: $VERSION_TYPE"
        exit 1
        ;;
esac

NEW_VERSION="$MAJOR.$MINOR.$PATCH"
echo "新版本: $NEW_VERSION"

# 更新 package.json
sed -i '' "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" package.json

# 更新 Cargo.toml
sed -i '' "s/version = \"$CURRENT_VERSION\"/version = \"$NEW_VERSION\"/" src-tauri/Cargo.toml

# 更新 tauri.conf.json
sed -i '' "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" src-tauri/tauri.conf.json

# 提交更改
git add .
git commit -m "release: v$NEW_VERSION - $CHANGE_DESCRIPTION"

# 创建标签
git tag -a "v$NEW_VERSION" -m "v$NEW_VERSION: $CHANGE_DESCRIPTION"

# 推送
git push
git push --tags

echo ""
echo "=========================================="
echo "版本 v$NEW_VERSION 发布成功！"
echo "=========================================="
echo ""
echo "GitHub Actions 将自动触发构建..."
echo "版本信息: v$NEW_VERSION: $CHANGE_DESCRIPTION"
