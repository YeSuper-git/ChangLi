"""移除环境依赖 section"""
with open('src/pages/Settings.tsx', 'r') as f:
    content = f.read()

# 移除环境依赖 section（两个，macOS 和 Windows）
import re
# 删除从 {/* 环境依赖 到下一个 {/* 之间的所有内容
content = re.sub(r'\s*\{/\* 环境依赖.*?\n\s*\{/\*', '\n{/*', content, flags=re.DOTALL)

# 清理 import
content = content.replace(', checkEnvDependencies', '')
content = content.replace(', installDependency', '')

with open('src/pages/Settings.tsx', 'w') as f:
    f.write(content)

print("done")
