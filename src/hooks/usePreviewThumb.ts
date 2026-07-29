import { useState, useRef, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { addMemoryCleanupListener } from '../utils/memoryCleanup';

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
  onImageError: () => void;
}

/**
 * 缩略图预览 hook（PotPlayer 风格）
 * - 打开视频时触发 prebuild_thumbnails 后台预抽帧
 * - hover 时使用后端返回的 data URL，避免 Windows WebView2 的 asset scope 拒绝本地缓存
 * - 预抽未完成时兜底调 get_preview_thumb 实时抽一张
 * - 视频关闭/切换时 abort 旧任务（地雷1修复）
 * - data URL 按时间片缓存在内存中，切换视频时整体清空
 */
export function usePreviewThumb({ fileId, filePath, duration }: UsePreviewThumbOptions): UsePreviewThumbReturn {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const debounceTimer = useRef(0);
  const seqRef = useRef(0);
  // 前端缓存：index → JPEG data URL
  const cacheRef = useRef<Map<number, string>>(new Map());
  const currentFileId = useRef<string>('');

  // 打开视频时触发预抽（暂时禁用：FFmpeg 批量预抽占满 CPU 导致卡顿）
  useEffect(() => {
    // 取消旧视频的预抽
    if (currentFileId.current && currentFileId.current !== fileId) {
      invoke('abort_prebuild_cmd', { fileId: currentFileId.current }).catch(() => {});
    }
    currentFileId.current = fileId;
    cacheRef.current.clear();

    // TODO: 预抽需要限制并发和 CPU 优先级，暂时禁用
    // if (!fileId || !filePath || !duration || duration <= 0) return;
    // invoke<string>('prebuild_thumbnails', { ... })

    return () => {
      invoke('abort_prebuild_cmd', { fileId }).catch(() => {});
    };
  }, [fileId, filePath, duration]);

  useEffect(() => {
    return addMemoryCleanupListener(() => {
      if (debounceTimer.current) window.clearTimeout(debounceTimer.current);
      seqRef.current++;
      cacheRef.current.clear();
      setThumbnailUrl(null);
      setHoverTime(null);
    });
  }, []);

  const onHover = useCallback((clientX: number, progressRect: DOMRect, time: number) => {
    const mySeq = ++seqRef.current;
    setHoverTime(time);
    setHoverX(clientX - progressRect.left);

    if (debounceTimer.current) window.clearTimeout(debounceTimer.current);
    debounceTimer.current = window.setTimeout(async () => {
      if (seqRef.current !== mySeq) return;

      const idx = Math.floor(time / 5);
      // 1. 先检查前端缓存
      if (cacheRef.current.has(idx)) {
        setThumbnailUrl(cacheRef.current.get(idx)!);
        return;
      }

      // 2. 后端读取缓存或实时抽帧，并直接返回 WebView 可显示的 data URL。
      try {
        const dataUrl = await invoke<string>('get_preview_thumb', {
          fileId,
          filePath,
          time,
        });
        if (seqRef.current !== mySeq) return;
        if (dataUrl) {
          cacheRef.current.set(idx, dataUrl);
          setThumbnailUrl(dataUrl);
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

  const onImageError = useCallback(() => {
    if (hoverTime !== null) {
      cacheRef.current.delete(Math.floor(hoverTime / 5));
    }
    setThumbnailUrl(null);
  }, [hoverTime]);

  return { thumbnailUrl, hoverTime, hoverX, onHover, onLeave, onImageError };
}
