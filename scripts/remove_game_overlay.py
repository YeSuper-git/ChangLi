"""安全删除游戏覆盖：只删 section + state，不碰其他代码"""
with open('src/pages/Settings.tsx', 'r') as f:
    content = f.read()

# 1. 删除 gameOverlay state
content = content.replace(
    '  const [gameOverlayDisabled, setGameOverlayState] = useState(false);\n',
    ''
)
content = content.replace(
    '  const [gameOverlayLoading, setGameOverlayLoading] = useState(false);\n',
    ''
)

# 2. 删除游戏覆盖 section（精确匹配从注释到下一个 { 注释之前）
import re
# 匹配从 {/* 游戏覆盖 到下一个 {/* 之前的闭合 )}
pattern = r'\s*\{/\* 游戏覆盖.*?\n\s*\{/\*'
match = re.search(pattern, content, re.DOTALL)
if match:
    content = content[:match.start()] + '\n' + content[match.end():]

# 3. 清理 Promise.all 中的 overlay 相关（但保持结构不变）
content = content.replace(
    "    const [sitesList, tagsList, storage, catsList, fieldsList, overlayDisabled] = await Promise.all([\n      getSites(), getTags(), getStorageInfo(), getAllCategories(), getAllActorFields(), getGameOverlayDisabled().catch(() => false)\n    ]);",
    "    const [sitesList, tagsList, storage, catsList, fieldsList] = await Promise.all([\n      getSites(), getTags(), getStorageInfo(), getAllCategories(), getAllActorFields()\n    ]);"
)
content = content.replace(
    '    setGameOverlayState(overlayDisabled);\n',
    ''
)

# 4. 清理导入
content = content.replace(', setGameOverlayDisabled', '')
content = content.replace(', getGameOverlayDisabled', '')
content = content.replace('setGameOverlayDisabled, ', '')
content = content.replace('getGameOverlayDisabled, ', '')

with open('src/pages/Settings.tsx', 'w') as f:
    f.write(content)

print("done")
