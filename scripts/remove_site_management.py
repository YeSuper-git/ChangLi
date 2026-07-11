"""精确删除网站管理相关代码"""
with open('src/pages/Settings.tsx', 'r') as f:
    lines = f.readlines()

new_lines = []
skip_until_next_section = False
in_site_section = False
brace_count = 0
skip_modal = False

i = 0
while i < len(lines):
    line = lines[i]
    
    # 跳过网站管理 section
    if '{/* 网站管理 */}' in line:
        # 找到 section 结束
        j = i
        depth = 0
        while j < len(lines):
            if '<section' in lines[j]:
                depth += 1
            if '</section>' in lines[j]:
                depth -= 1
                if depth == 0:
                    i = j + 1
                    break
            j += 1
        continue
    
    # 跳过添加网站弹窗
    if '{/* 添加网站弹窗 */}' in line:
        j = i
        depth = 0
        while j < len(lines):
            if 'showAddModal && (' in lines[j]:
                depth += 1
            if depth > 0:
                depth += lines[j].count('(') - lines[j].count(')')
                if depth <= 0:
                    i = j + 1
                    break
            j += 1
        continue
    
    # 跳过 showAddModal state
    if 'const [showAddModal' in line:
        continue
    if 'const [newSite' in line:
        continue
    
    # 跳过 handleAddSite 函数
    if 'const handleAddSite' in line:
        j = i
        while j < len(lines):
            if lines[j].strip() == '};' and j > i:
                i = j + 1
                break
            j += 1
        continue
    
    # 跳过 loadSites 函数
    if 'const loadSites' in line:
        j = i
        while j < len(lines):
            if lines[j].strip() == '};' and j > i:
                i = j + 1
                break
            j += 1
        continue
    
    new_lines.append(line)
    i += 1

with open('src/pages/Settings.tsx', 'w') as f:
    f.writelines(new_lines)

print("done")
