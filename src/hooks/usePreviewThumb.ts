import { useState, useRef, useCallback, useEffect } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';

interface UsePreviewThumbOptions {
  fileId: string;
  filePath: string;
  duration: number;
}

interface UsePreviewThumbReturn {
  thumbnailUrl: string | null;
  hoverTime: number | null;
  hoverX: number;
  onHover: (clientX: number, progressRect: DOMRect, time: number) => void;
  onLeave: () => void;
}

/**
 * 缩略图预览 hook（PotPlayer 风格）
 * - 打开视频时触发 prebuild_thumbnails 后台预抽帧
 * - hover 时直接用 <img src=asset://...> 加载缓存文件
 * - 预抽未完成时兜底调 get_preview_thumb 实时抽一张
 */
export function usePreviewThumb({ fileId, filePath, duration }: UsePreviewThumbOptions): UsePreviewThumbReturn {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const debounceTimer = useRef(0);
  const seqRef = useRef(0);
  const thumbDirRef = useRef<string | null>(null);
  const prebuildDone = useRef(false);
  // 前端缓存：index → asset URL
  const cacheRef = useRef<Map<number, string>>(new Map());

  // 打开视频时触发预抽
  useEffect(() => {
    if (!fileId || !filePath || !duration || duration <= 0) return;
    prebuildDone.current = false;
    cacheRef.current.clear();
    thumbDirRef.current = null;

    invoke<string>('prebuild_thumbnails', {
      fileId,
      filePath,
      duration,
      intervalSec: 5,
    }).then((dir) => {
      thumbDirRef.current = dir;
      // 预抽是异步的，标记完成需要等一下
      // 但前端可以直接开始用 asset 协议加载（文件存在就显示）
    }).catch(() => {});
  }, [fileId, filePath, duration]);

  const onHover = useCallback((clientX: number, progressRect: DOMRect, time: number) => {
    const mySeq = ++seqRef.current;
    setHoverTime(time);
    setHoverX(clientX - progressRect.left);

    if (debounceTimer.current) window.clearTimeout(debounceTimer.current);
    debounceTimer.current = window.setTimeout(async () => {
      if (seqRef.current !== mySeq) return;

      const idx = Math.floor(time / 5);
      const thumbDir = thumbDirRef.current;

      // 1. 先检查前端缓存
      if (cacheRef.current.has(idx)) {
        setThumbnailUrl(cacheRef.current.get(idx)!);
        return;
      }

      // 2. 如果预抽目录已知，尝试用 asset 协议加载
      if (thumbDir) {
        const assetUrl = convertFileSrc(`${thumbDir}/${idx}.jpg`);
        // 先设置 URL，让 <img> 尝试加载
        // 如果文件不存在（预抽未完成），img 会 onerror
        cacheRef.current.set(idx, assetUrl);
        setThumbnailUrl(assetUrl);
        return;
      }

      // 3. 兜底：实时抽一张
      try {
        const path = await invoke<string>('get_preview_thumb', {
          fileId,
          filePath,
          time,
        });
        if (seqRef.current !== mySeq) return;
        if (path) {
          const assetUrl = convertFileSrc(path);
          cacheRef.current.set(idx, assetUrl);
          setThumbnailUrl(assetUrl);
        } else {
          setThumbnailUrl(null);
        }
      } catch {
        if (seqRef.current === mySeq) setThumbnailUrl(null);
      }
    }, 150);
  }, [fileId, filePath]);

  const onLeave = useCallback(() => {
    if (debounceTimer.current) window.clearTimeout(debounceTimer.current);
    seqRef.current++;
    setHoverTime(null);
    setThumbnailUrl(null);
  }, []);

  return { thumbnailUrl, hoverTime, hoverX, onHover, onLeave };
}
