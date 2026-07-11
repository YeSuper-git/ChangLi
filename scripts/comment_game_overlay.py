"""精确注释掉游戏覆盖 section"""
with open('src/pages/Settings.tsx', 'r') as f:
    lines = f.readlines()

# 找到游戏覆盖 section 的开始和结束
start = None
end = None
brace_count = 0
in_section = False

for i, line in enumerate(lines):
    if '{/* 游戏覆盖' in line:
        start = i
        in_section = True
        # 找到 {!isMac && ( 的位置
        for j in range(i, min(i+5, len(lines))):
            if '{!isMac && (' in lines[j]:
                start = j
                break
        brace_count = 0
        continue
    
    if in_section:
        # 计算括号
        brace_count += lines[j].count('(') - lines[j].count(')')
        if brace_count <= 0 and '{!isMac' not in lines[j]:
            # 找到对应的 )} 闭合
            if ')}' in lines[j]:
                end = j
                break

if start is not None and end is not None:
    print(f"注释掉行 {start+1} 到 {end+1}")
    # 注释掉整个 section
    for i in range(start, end + 1):
        lines[i] = '      {/* ' + lines[i].strip() + ' */}\n' if lines[i].strip() else '\n'
else:
    print(f"未找到: start={start}, end={end}")

with open('src/pages/Settings.tsx', 'w') as f:
    f.writelines(lines)

print("done")
