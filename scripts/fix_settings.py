"""移除清理缓存section + 数据存储中添加缓存目录"""
with open('src/pages/Settings.tsx', 'r') as f:
    content = f.read()

import re

# 1. 删除清理缓存 section
content = re.sub(
    r'\{/\* 清理缓存 \*/\}\s*<section className="mb-12">.*?</section>\s*',
    '',
    content,
    flags=re.DOTALL
)

# 2. 在数据存储 section 中添加缓存目录展示
# 找到数据存储 section 的结束位置（在 storageInfo 后面）
old_storage = """      {/* 数据存储 */}
      <section className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">数据存储</h2>"""

new_storage = """      {/* 数据存储 */}
      <section className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">数据存储</h2>"""

# 在数据存储 section 末尾（</section> 之前）添加缓存目录
# 找到数据存储 section 的 </section>
storage_section_end = content.find('{/* 数据存储 */}')
if storage_section_end != -1:
    # 找到这个 section 的 </section>
    next_section = content.find('<section', storage_section_end + 10)
    if next_section != -1:
        # 在 </section> 前插入缓存目录
        section_end = content.rfind('</section>', storage_section_end, next_section)
        if section_end != -1:
            insert_pos = section_end
            cache_dir_ui = """
        
        {/* 缓存目录 */}
        <div className="mt-6 p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">更新缓存目录</p>
              <p className="text-xs text-gray-500 mt-1">检查更新时下载的安装包存放位置</p>
            </div>
            <button
              onClick={async () => {
                try {
                  await invoke('open_path', { path: await invoke('get_updates_dir') });
                } catch {
                  notify({ message: '无法打开缓存目录', type: 'error' });
                }
              }}
              className="action-btn text-xs"
            >
              打开目录
            </button>
          </div>
        </div>"""
            content = content[:insert_pos] + cache_dir_ui + content[insert_pos:]

# 3. 清理 import
content = content.replace(', cleanupOldInstallers', '')

with open('src/pages/Settings.tsx', 'w') as f:
    f.write(content)

print("done")
