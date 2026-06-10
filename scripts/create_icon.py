#!/usr/bin/env python3
from PIL import Image, ImageDraw

# 创建 1024x1024 图标
size = 1024
img = Image.new('RGB', (size, size), color='#2563eb')
draw = ImageDraw.Draw(img)

# 绘制播放按钮
center = size // 2
triangle_size = size // 3
points = [
    (center - triangle_size // 3, center - triangle_size // 2),
    (center - triangle_size // 3, center + triangle_size // 2),
    (center + triangle_size // 2, center)
]
draw.polygon(points, fill='white')

# 保存
img.save('src-tauri/icons/icon.png')
print('Icon created successfully')
