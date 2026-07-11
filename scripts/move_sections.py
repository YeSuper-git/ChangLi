with open('/private/tmp/changli-poster-repair-1783234185/src/pages/Settings.tsx', 'r') as f:
    content = f.read()

# 提取三个 section
cleanup_start = content.find('      {/* 清理缓存 */}')
env_start = content.find('      {/* 环境依赖 */}')
env_end = content.find('      {/* 网站管理 */}')
web_end = content.find('      {/* 分类配置 */}')

cleanup_section = content[cleanup_start:env_start].rstrip() + '\n\n'
env_section = content[env_start:env_end].rstrip() + '\n\n'
web_section = content[env_end:web_end].rstrip() + '\n\n'

# 删除原位置
new_content = content[:cleanup_start] + content[web_end:]

# 找演员配置 section 结束位置
actor_end_marker = '      {/* 分类视频删除确认弹窗 */}'
actor_end = new_content.find(actor_end_marker)
insert_pos = new_content.rfind('      </section>', 0, actor_end) + len('      </section>')

# 插入顺序：网站管理 → 清理缓存 → 环境依赖
new_content = new_content[:insert_pos] + '\n\n' + web_section + cleanup_section + env_section + new_content[insert_pos:]

with open('/private/tmp/changli-poster-repair-1783234185/src/pages/Settings.tsx', 'w') as f:
    f.write(new_content)

print("done")
