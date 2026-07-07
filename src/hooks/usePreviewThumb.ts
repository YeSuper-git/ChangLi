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
 * - hover 时直接用 asset: 协议加载缓存文件
 * - 预抽未完成时兜底调 get_preview_thumb 实时抽一张
 * - 视频关闭/切换时 abort 旧任务（地雷1修复）
 * - 前端缓存带时间戳防止 asset 缓存失效（地雷3修复）
 */
export function usePreviewThumb({ fileId, filePath, duration }: UsePreviewThumbOptions): UsePreviewThumbReturn {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const debounceTimer = useRef(0);
  const seqRef = useRef(0);
  const thumbDirRef = useRef<string | null>(null);
  const prebuildVersion = useRef(0);
  // 前端缓存：index → asset URL（带版本号）
  const cacheRef = useRef<Map<number, string>>(new Map());
  const currentFileId = useRef<string>('');

  // 打开视频时触发预抽（暂时禁用：FFmpeg 批量预抽占满 CPU 导致卡顿）
  useEffect(() => {
    // 取消旧视频的预抽
    if (currentFileId.current && currentFileId.current !== fileId) {
      invoke('abort_prebuild_cmd', { fileId: currentFileId.current }).catch(() => {});
    }
    currentFileId.current = fileId;
    prebuildVersion.current++;
    cacheRef.current.clear();
    thumbDirRef.current = null;

    // TODO: 预抽需要限制并发和 CPU 优先级，暂时禁用
    // if (!fileId || !filePath || !duration || duration <= 0) return;
    // invoke<string>('prebuild_thumbnails', { ... })

    return () => {
      invoke('abort_prebuild_cmd', { fileId }).catch(() => {});
    };
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
      const ver = prebuildVersion.current;

      // 1. 先检查前端缓存
      if (cacheRef.current.has(idx)) {
        setThumbnailUrl(cacheRef.current.get(idx)!);
        return;
      }

      // 2. 如果预抽目录已知，用 asset 协议加载
      if (thumbDir) {
        // 地雷3修复：URL 带版本号，防止 asset 缓存失效
        const assetUrl = `${convertFileSrc(`${thumbDir}/${idx}.jpg`)}?v=${ver}`;
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
          const assetUrl = `${convertFileSrc(path)}?v=${ver}`;
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
