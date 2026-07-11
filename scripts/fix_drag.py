"""替换拖拽为上下移动按钮"""
with open('src/pages/SeriesDetail.tsx', 'r') as f:
    content = f.read()

# 1. 替换 drag 函数为上下移动函数
old_drag = """  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    setDraggedIndex(index);
  };
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    const newVideos = [...videos];
    const [removed] = newVideos.splice(draggedIndex, 1);
    newVideos.splice(index, 0, removed);
    setVideos(newVideos);
    setDraggedIndex(index);
  };
  const handleDragEnd = () => {
    setDraggedIndex(null);
  };"""

new_move = """  // 上下移动
  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const newVideos = [...videos];
    [newVideos[index - 1], newVideos[index]] = [newVideos[index], newVideos[index - 1]];
    setVideos(newVideos);
  };
  const handleMoveDown = (index: number) => {
    if (index === videos.length - 1) return;
    const newVideos = [...videos];
    [newVideos[index], newVideos[index + 1]] = [newVideos[index + 1], newVideos[index]];
    setVideos(newVideos);
  };"""

content = content.replace(old_drag, new_move)

# 2. 替换拖拽手柄为上下移动按钮
old_handle = """              <div
                className="drag-handle cursor-grab active:cursor-grabbing p-1 rounded bg-white/80 hover:bg-white"
                draggable={true}
                onDragStart={(e) => {
                  e.stopPropagation();
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', String(videos.indexOf(video)));
                  onDragStart?.(e, videos.indexOf(video));
                }}
                onDragOver={(e) => { e.stopPropagation(); onDragOver?.(e, videos.indexOf(video)); }}
                onDragEnd={(e) => { e.stopPropagation(); onDragEnd?.(); }}
              >
                <svg className="w-3 h-3 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" /></svg>
              </div>"""

new_handle = """              <div className="flex flex-col gap-0.5">
                <button className="w-5 h-5 flex items-center justify-center rounded bg-white/80 hover:bg-white text-gray-500 disabled:opacity-30" onClick={(e) => { e.stopPropagation(); onMoveUp?.(videos.indexOf(video)); }} disabled={videos.indexOf(video) === 0}>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                </button>
                <button className="w-5 h-5 flex items-center justify-center rounded bg-white/80 hover:bg-white text-gray-500 disabled:opacity-30" onClick={(e) => { e.stopPropagation(); onMoveDown?.(videos.indexOf(video)); }} disabled={videos.indexOf(video) === videos.length - 1}>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>
              </div>"""

content = content.replace(old_handle, new_handle)

# 3. 给 VideoGrid 添加 onMoveUp/onMoveDown props
# 在 interface VideoGridProps 中添加
content = content.replace(
    "onDragStart?: (e: React.DragEvent, index: number) => void;",
    "onDragStart?: (e: React.DragEvent, index: number) => void;\n  onMoveUp?: (index: number) => void;\n  onMoveDown?: (index: number) => void;"
)

# 在 VideoGrid 解构中添加
content = content.replace(
    "  onDragStart,\n  onDragOver,",
    "  onDragStart,\n  onDragOver,\n  onMoveUp,\n  onMoveDown,"
)

# 在 VideoGrid 调用中添加 props
# 找到编辑模式的 VideoGrid（有 selectMode={true} 或 selectMode={selectMode}）
content = content.replace(
    "          onDragEnd={handleDragEnd}\n          draggedIndex={draggedIndex}",
    "          onDragEnd={handleDragEnd}\n          draggedIndex={draggedIndex}\n          onMoveUp={handleMoveUp}\n          onMoveDown={handleMoveDown}"
)

# 4. 移除拖拽相关的 CSS
content = content.replace("  -webkit-user-drag: element;\n", "")

with open('src/pages/SeriesDetail.tsx', 'w') as f:
    f.write(content)

print("done")
