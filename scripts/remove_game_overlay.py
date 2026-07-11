"""精确移除游戏覆盖功能"""
import re

with open('src/pages/Settings.tsx', 'r') as f:
    lines = f.readlines()

new_lines = []
skip_until_next_section = False
in_game_section = False

for i, line in enumerate(lines):
    # 跳过游戏覆盖 state 声明
    if 'const [gameOverlayDisabled' in line or 'const [gameOverlayLoading' in line:
        continue
    
    # 跳过 useEffect 中的 getGameOverlayDisabled
    if 'getGameOverlayDisabled' in line and 'useEffect' in lines[i-1]:
        # 跳到 useEffect 结束
        j = i
        while j < len(lines) and '}, []);' not in lines[j]:
            j += 1
        continue
    
    # 跳过游戏覆盖 section
    if '{/* 游戏覆盖' in line:
        in_game_section = True
        continue
    if in_game_section:
        if '{/*' in line and '游戏覆盖' not in line:
            in_game_section = False
        else:
            continue
    
    # 跳过 setGameOverlayDisabled 相关的导入
    if 'getGameOverlayDisabled' in line and 'import' in line:
        line = line.replace(', getGameOverlayDisabled', '').replace('getGameOverlayDisabled, ', '')
    if 'setGameOverlayDisabled' in line and 'import' in line:
        line = line.replace(', setGameOverlayDisabled', '').replace('setGameOverlayDisabled, ', '')
    
    new_lines.append(line)

with open('src/pages/Settings.tsx', 'w') as f:
    f.writelines(new_lines)

print("Settings.tsx: 游戏覆盖已精确移除")
