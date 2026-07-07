import { useState, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

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

export function usePreviewThumb({ fileId, filePath, duration }: UsePreviewThumbOptions): UsePreviewThumbReturn {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);
  const cacheRef = useRef<Map<string, string>>(new Map());

  const onHover = useCallback((clientX: number, progressRect: DOMRect, time: number) => {
    // Clear previous timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    const x = clientX - progressRect.left;
    setHoverTime(time);
    setHoverX(x);

    // Increment sequence to cancel old requests
    const seq = ++seqRef.current;

    // 300ms debounce
    timerRef.current = setTimeout(async () => {
      try {
        // Check frontend cache
        const bucket = Math.floor(time / 2);
        const cacheKey = `${fileId}-${bucket}`;
        const cached = cacheRef.current.get(cacheKey);
        if (cached) {
          if (seq === seqRef.current) {
            setThumbnailUrl(cached);
          }
          return;
        }

        // Call Rust FFmpeg service
        const b64 = await invoke<string>('get_preview_thumb', {
          fileId,
          filePath,
          time,
        });

        // Check if still relevant
        if (seq !== seqRef.current) return;

        if (b64) {
          const url = `data:image/png;base64,${b64}`;
          cacheRef.current.set(cacheKey, url);
          setThumbnailUrl(url);
        } else {
          setThumbnailUrl(null);
        }
      } catch {
        // Silent degradation - hide preview on error
        if (seq === seqRef.current) {
          setThumbnailUrl(null);
        }
      }
    }, 300);
  }, [fileId, filePath, duration]);

  const onLeave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    seqRef.current++;
    setHoverTime(null);
    setThumbnailUrl(null);
  }, []);

  return { thumbnailUrl, hoverTime, hoverX, onHover, onLeave };
}
