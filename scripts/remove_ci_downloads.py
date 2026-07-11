"""移除 CI 中的 mpv/ffmpeg 下载步骤"""
with open('.github/workflows/build.yml', 'r') as f:
    lines = f.readlines()

# 找到需要移除的步骤范围
remove_ranges = []
i = 0
while i < len(lines):
    line = lines[i]
    # 找到步骤名
    if line.strip().startswith('- name:'):
        step_name = line.strip().replace('- name:', '').strip()
        if step_name in ['Bundle mpv player runtime', 'Download libmpv-wrapper', 'Download ffmpeg']:
            start = i
            # 找到下一个步骤或文件结尾
            j = i + 1
            while j < len(lines):
                if lines[j].strip().startswith('- name:') or (lines[j].strip().startswith('- ') and not lines[j].startswith(' ')):
                    break
                j += 1
            remove_ranges.append((start, j))
            i = j
            continue
    i += 1

# 从后往前删除
for start, end in reversed(remove_ranges):
    del lines[start:end]

with open('.github/workflows/build.yml', 'w') as f:
    f.writelines(lines)

print(f"removed {len(remove_ranges)} steps")
