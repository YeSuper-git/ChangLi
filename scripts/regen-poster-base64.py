#!/usr/bin/env python3
"""重新生成 poster_base64（1200px）— 用于旧数据升级"""
import sqlite3
import sys
from pathlib import Path

try:
    from PIL import Image
    import base64
    import io
except ImportError:
    print("需要安装 Pillow: pip install Pillow")
    sys.exit(1)

DB_PATH = Path.home() / "Library/Application Support/changli/changli.db"
MAX_WIDTH = 1200

def regen(db_path=DB_PATH, max_width=MAX_WIDTH):
    conn = sqlite3.connect(str(db_path))
    rows = conn.execute(
        "SELECT id, title, poster FROM video_series WHERE poster IS NOT NULL AND poster != ''"
    ).fetchall()

    updated = 0
    for series_id, title, poster_path in rows:
        p = Path(poster_path)
        if not p.exists():
            print(f"  跳过 [{series_id}] {title}: 文件不存在 {poster_path}")
            continue

        try:
            img = Image.open(p)
            if img.width > max_width:
                ratio = max_width / img.width
                img = img.resize((max_width, int(img.height * ratio)), Image.LANCZOS)
            
            buf = io.BytesIO()
            img.convert("RGB").save(buf, format="JPEG", quality=85)
            b64 = base64.b64encode(buf.getvalue()).decode()
            
            conn.execute(
                "UPDATE video_series SET poster_base64 = ? WHERE id = ?",
                (b64, series_id),
            )
            updated += 1
            print(f"  更新 [{series_id}] {title}: {img.width}px")
        except Exception as e:
            print(f"  失败 [{series_id}] {title}: {e}")

    conn.commit()
    conn.close()
    print(f"\n完成：更新了 {updated}/{len(rows)} 条记录")

if __name__ == "__main__":
    regen()
