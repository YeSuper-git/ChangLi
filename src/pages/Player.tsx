import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getCurrentWindow, currentMonitor, Window } from '@tauri-apps/api/window';
import { LogicalSize, LogicalPosition } from '@tauri-apps/api/dpi';
import { invoke } from '@tauri-apps/api/core';
import { getPlayHistory, getVideo, getVideoSeriesDetail, updatePlayHistory } from '../utils/api';
import { useLibraryStore } from '../store/libraryStore';
import type { Video, VideoSeries, PlayHistory } from '../utils/api';
import appIcon from '../assets/brand/app-icon.png';
import { init, destroy, observeProperties, setVideoMarginRatio } from 'tauri-plugin-mpv-api';
import { mpvCommand, mpvSetProperty } from '../utils/mpv-bridge';
import { usePreviewThumb } from '../hooks/usePreviewThumb';
import { addMemoryCleanupListener, getJsHeapUsageRatio } from '../utils/memoryCleanup';
import { navigateToLibraryReady } from '../utils/libraryNavigation';

const OBSERVED_PROPERTIES = [
  'pause',
  'time-pos',
  'duration',
  'volume',
  'speed',
  'dwidth',
  'dheight',
] as const;

const Player: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(Boolean(id));
  const [autoPlayCountdown, setAutoPlayCountdown] = useState<number | null>(null);
  const [pipHovered, setPipHovered] = useState(false);
  const [error, setError] = useState('');
  const [currentVideo, setCurrentVideo] = useState<Video | null>(null);
  const [series, setSeries] = useState<VideoSeries | null>(null);
  const [episodes, setEpisodes] = useState<Video[]>([]);
  const [playHistory, setPlayHistory] = useState<PlayHistory[]>([]);
  
  // 播放器状态
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // FFmpeg preview hook — must be before callbacks that reference it
  const { thumbnailUrl, hoverTime, hoverX, onHover: previewOnHover, onLeave: previewOnLeave } = usePreviewThumb({
    fileId: currentVideo ? String(currentVideo.id) : '',
    filePath: currentVideo?.file_path || '',
    duration,
  });
  const [volume, setVolume] = useState(() => {
    try { return parseInt(localStorage.getItem('changli-player-volume') || '80', 10) || 80; } catch { return 80; }
  });
  const [speed, setSpeed] = useState(1);
  
  // UI 状态
  const [showHeader, setShowHeader] = useState(true);
  const [showFooter, setShowFooter] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPiP, setIsPiP] = useState(false);
  const [episodeListExpanded, setEpisodeListExpanded] = useState(false);
  const episodeHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showResumeNotice, setShowResumeNotice] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  const [cursorVisible, setCursorVisible] = useState(true);
  const [hasVideoFrame, setHasVideoFrame] = useState(false);
  const cursorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const [draggingTime, setDraggingTime] = useState<number | null>(null);
  
  // Refs
  const progressBarRef = useRef<HTMLDivElement>(null);
  const draggingProgressRef = useRef(false);
  const stageDraggedRef = useRef(false);
  const mpvInitialized = useRef(false);
  const mpvOperationLock = useRef(Promise.resolve());
  const mpvCommandQueueRef = useRef(Promise.resolve());
  const switchingVideoRef = useRef(false);
  const isPlayingRef = useRef(false);
  const isMountedRef = useRef(true);
  const observedVideoSizeRef = useRef<{ width?: number; height?: number }>({});
  const windowRatioAdjustedRef = useRef(false);
  const lastWindowSizeRef = useRef<{ width: number; height: number } | null>(null);
  const customResizeRef = useRef({ active: false, raf: 0, inFlight: false, pending: null as { width: number; height: number } | null });
  const pipOriginalState = useRef<{ size: LogicalSize; position: LogicalPosition } | null>(null);
  // preview refs removed — using usePreviewThumb hook

  const getCurrentVideoRatio = useCallback(() => {
    const videoW = observedVideoSizeRef.current.width;
    const videoH = observedVideoSizeRef.current.height;
    if (!videoW || !videoH || videoW <= 0 || videoH <= 0) return 16 / 9;
    return Math.max(0.45, Math.min(3.2, videoW / videoH));
  }, []);

  const runMpvCommand = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const next = mpvCommandQueueRef.current.then(task, task);
    mpvCommandQueueRef.current = next.then(() => undefined, () => undefined);
    return next;
  }, []);

  const cleanupPlayerMemory = useCallback((reason = 'manual') => {
    previewOnLeave();
    if (cursorTimerRef.current) {
      clearTimeout(cursorTimerRef.current);
      cursorTimerRef.current = null;
    }
    if (episodeHoverTimerRef.current) {
      clearTimeout(episodeHoverTimerRef.current);
      episodeHoverTimerRef.current = null;
    }
    if (customResizeRef.current.raf) {
      cancelAnimationFrame(customResizeRef.current.raf);
      customResizeRef.current.raf = 0;
    }
    customResizeRef.current.pending = null;

    // drop-buffers 只释放 mpv 可重建的 demux/解码缓存；失败静默忽略，避免影响播放。
    // 播放中只响应后台/手动清理，普通周期清理只在暂停/空闲时触发。
    if (!mpvInitialized.current || switchingVideoRef.current) return;
    if (isPlayingRef.current && reason === 'periodic') return;
    runMpvCommand(() => mpvCommand('drop-buffers')).catch(() => undefined);
  }, [previewOnLeave, runMpvCommand]);

  const handleObservedVideoSize = useCallback((name: 'dwidth' | 'dheight', value: unknown) => {
    if (!isMountedRef.current) return;
    const numData = Number(value);
    if (!Number.isFinite(numData) || numData <= 0) return;

    if (name === 'dwidth') observedVideoSizeRef.current.width = numData;
    if (name === 'dheight') observedVideoSizeRef.current.height = numData;

    const videoW = observedVideoSizeRef.current.width;
    const videoH = observedVideoSizeRef.current.height;
    if (videoW && videoH && videoW > 0 && videoH > 0) setHasVideoFrame(true);

    if (windowRatioAdjustedRef.current) return;
    if (!videoW || !videoH || videoW <= 0 || videoH <= 0) return;

    const win = getCurrentWindow();
    win.outerSize().then((size) => {
      if (windowRatioAdjustedRef.current) return;
      const scale = window.devicePixelRatio || 1;
      const currentW = size.width / scale;
      const currentH = size.height / scale;
      const currentRatio = currentW / Math.max(1, currentH);
      const videoRatio = Math.max(0.45, Math.min(3.2, videoW / videoH));
      const ratioDelta = Math.abs(currentRatio - videoRatio) / videoRatio;
      if (ratioDelta < 0.08) {
        windowRatioAdjustedRef.current = true;
        return;
      }
      const newH = Math.max(360, Math.round(currentW / videoRatio));
      if (Math.abs(newH - currentH) < 48 || newH > 2000) {
        windowRatioAdjustedRef.current = true;
        return;
      }
      windowRatioAdjustedRef.current = true;
      win.setSize(new LogicalSize(currentW, newH)).catch(() => {});
    }).catch(() => {});
  }, []);

  // 透明 WebView 让 libmpv 视频层可见，避免 WebView/CSS 背景盖住画面
  useEffect(() => {
    document.documentElement.classList.add('changli-player-html');
    document.body.classList.add('changli-player-body');
    return () => {
      document.documentElement.classList.remove('changli-player-html');
      document.body.classList.remove('changli-player-body');
    };
  }, []);

  useEffect(() => {
    const unregister = addMemoryCleanupListener((reason) => cleanupPlayerMemory(reason));
    const interval = window.setInterval(() => {
      if (!isPlayingRef.current) cleanupPlayerMemory('periodic');
    }, 3 * 60 * 1000);
    const pressureInterval = window.setInterval(() => {
      const ratio = getJsHeapUsageRatio();
      if (ratio !== null && ratio >= 0.72) cleanupPlayerMemory('memory-pressure');
    }, 60 * 1000);
    const onHidden = () => {
      if (document.visibilityState === 'hidden') cleanupPlayerMemory('background');
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      unregister();
      window.clearInterval(interval);
      window.clearInterval(pressureInterval);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [cleanupPlayerMemory]);

  // 初始化 mpv
  useEffect(() => {
    if (!id) return;

    const initMpv = async () => {
      // 通过锁串行化所有 mpv 操作，避免 destroy/init 竞态
      mpvOperationLock.current = mpvOperationLock.current.then(async () => {
        try {
          setLoading(!mpvInitialized.current);
          setError('');
          setHasVideoFrame(false);

        // 获取视频信息
        const currentVideo = await getVideo(parseInt(id));
        if (!currentVideo) {
          setError('视频不存在');
          return;
        }
        setCurrentVideo(currentVideo);

        if (currentVideo.series_id) {
          const [seriesData, seriesVideos] = await getVideoSeriesDetail(currentVideo.series_id);
          setSeries(seriesData);
          setEpisodes(seriesVideos);
        } else {
          setSeries(null);
          setEpisodes([currentVideo]);
        }

        const history = await getPlayHistory();
        setPlayHistory(history);
        const previousPosition = history.find((item) => item.video_id === currentVideo.id)?.last_position ?? 0;
        if (previousPosition > 5) {
          setShowResumeNotice(true);
          window.setTimeout(() => setShowResumeNotice(false), 5000);
        }

        // 已经打开播放器时，切换分集只替换 mpv 当前文件，不销毁/重建播放器窗口。
        // 这样选集播放不会再次出现透明空窗闪一下。
        if (mpvInitialized.current) {
          windowRatioAdjustedRef.current = false;
          observedVideoSizeRef.current = { width: 0, height: 0 };
          setCurrentTime(0);
          setDuration(0);
          switchingVideoRef.current = true;
          try {
            await runMpvCommand(() => mpvCommand('loadfile', [currentVideo.file_path, 'replace']));
          } catch (loadErr) {
            console.error('[Player] loadfile 失败:', loadErr);
            setError('加载视频失败，请确认视频文件仍然存在');
            setLoading(false);
            switchingVideoRef.current = false;
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 300));
          if (!observedVideoSizeRef.current.width || !observedVideoSizeRef.current.height) {
            setHasVideoFrame(true);
          }
          const subtitlePath = currentVideo.subtitle;
          if (subtitlePath) {
            await runMpvCommand(() => mpvCommand('sub-add', [subtitlePath, 'auto'])).catch(() => undefined);
          }
          if (previousPosition > 5) {
            await runMpvCommand(() => mpvCommand('seek', [String(previousPosition), 'absolute'])).catch(() => undefined);
            setCurrentTime(previousPosition);
          }
          await runMpvCommand(() => mpvSetProperty('pause', false)).catch(() => undefined);
          switchingVideoRef.current = false;
          isPlayingRef.current = true;
          setIsPlaying(true);
          setLoading(false);
          return;
        }

        // 平台检测
        const isWindows = navigator.platform.includes('Win') || navigator.userAgent.includes('Windows');

        // 初始化 mpv — 用 Rust 后端查找 mpv.exe（检查实际文件是否存在）
        let mpvPath: string | undefined;
        try {
          mpvPath = await invoke<string>('find_mpv_path');
          console.log('[Player] find_mpv_path:', mpvPath);
        } catch (e) {
          console.error('[Player] find_mpv_path failed:', e);
          // 后端找不到，报错给用户
          throw new Error(typeof e === 'string' ? e : 'mpv.exe 未找到');
        }

        // Windows/Linux: 用 tauri-plugin-mpv 正常 init
        let playerWid: string | undefined;
        try {
          const wid = await invoke<number>('get_player_wid');
          playerWid = String(wid);
          console.log('[Player] player WID:', playerWid);
        } catch (e) {
          console.warn('[Player] get_player_wid failed:', e);
        }

        try {
          await init({
            ...(mpvPath ? { path: mpvPath } : {}),
            showMpvOutput: true,
            args: [
              '--vo=gpu',
              '--hwdec=no',
              ...(isWindows ? ['--gpu-api=d3d11', '--gpu-context=d3d11'] : []),
              '--keep-open=yes',
              '--force-window=no',
              '--osc=no',
              '--osd-level=0',
              '--video-sync=audio',
              '--log-file=mpv.log',
              ...(playerWid ? [`--wid=${playerWid}`] : []),
            ],
            observedProperties: OBSERVED_PROPERTIES,
          });
        } catch (initErr) {
          console.error('[Player] init 失败:', initErr);
          try {
            await init({
              showMpvOutput: true,
              args: [
                '--vo=gpu',
                '--hwdec=no',
                ...(isWindows ? ['--gpu-api=d3d11', '--gpu-context=d3d11'] : []),
                '--keep-open=yes',
                '--force-window=no',
                '--osc=no',
                '--osd-level=0',
                '--video-sync=audio',
                '--log-file=mpv.log',
                ...(playerWid ? [`--wid=${playerWid}`] : []),
              ],
              observedProperties: OBSERVED_PROPERTIES,
            });
          } catch (retryErr) {
            console.error('[Player] init 重试失败:', retryErr);
            throw retryErr;
          }
        }

        await runMpvCommand(() => setVideoMarginRatio({ top: 0, right: 0, bottom: 0, left: 0 })).catch(() => undefined);

        mpvInitialized.current = true;

        await new Promise(resolve => setTimeout(resolve, 500));

        // 全平台监听插件属性变化；macOS/Windows 都由同一套 mpv 状态驱动 UI。
        await observeProperties(OBSERVED_PROPERTIES, ({ name, data }: { name: string; data?: unknown }) => {
          if (!isMountedRef.current) return;
          try {
            switch (name) {
            case 'pause':
              {
                const playing = !data;
                isPlayingRef.current = playing;
                setIsPlaying(playing);
              }
              break;
            case 'time-pos':
              setCurrentTime((data as number) ?? 0);
              break;
            case 'duration':
              setDuration((data as number) ?? 0);
              break;
            case 'volume':
              setVolume((data as number) ?? 80);
              break;
            case 'speed':
              setSpeed((data as number) ?? 1);
              break;
            case 'dwidth':
            case 'dheight':
              handleObservedVideoSize(name, data);
              break;
          }
          } catch { /* ignore observer errors */ }
        });

        // 加载视频
        try {
          await runMpvCommand(() => mpvCommand('loadfile', [currentVideo.file_path, 'replace']));
        } catch (loadErr) {
          console.error('[Player] loadfile 失败:', loadErr);
          setError('加载视频失败，请确认视频文件仍然存在');
          setLoading(false);
          return;
        }
        const subtitlePath = currentVideo.subtitle;
        if (subtitlePath) {
          await runMpvCommand(() => mpvCommand('sub-add', [subtitlePath, 'auto'])).catch(() => undefined);
        }
        if (previousPosition > 5) {
          // 等待 mpv 加载文件后再 seek，避免 seek 被忽略
          await new Promise((resolve) => setTimeout(resolve, 800));
          await runMpvCommand(() => mpvCommand('seek', [String(previousPosition), 'absolute'])).catch(() => undefined);
          setCurrentTime(previousPosition);
        }
        await runMpvCommand(() => mpvSetProperty('pause', false)).catch(() => undefined);
        isPlayingRef.current = true;
        setIsPlaying(true);
        
        setLoading(false);
      } catch (err) {
        console.error('[Player] 初始化失败:', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        setError(`播放器启动失败: ${errMsg}`);
        setLoading(false);
        // 初始化失败时显示错误（不自动关闭）
      }
      }); // end mpvOperationLock.then
    };

    initMpv();

    return () => {
      // 不在这里 destroy — 由下次 init 或组件卸载时处理
      // 避免 destroy/init 竞态导致闪退
    };
  }, [id, runMpvCommand, handleObservedVideoSize]);

  // 组件卸载时清理 mpv — 延迟 destroy，等 mpv 完全退出后再销毁窗口
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      cleanupPlayerMemory('unmount');
      mpvOperationLock.current = mpvOperationLock.current.then(async () => {
        if (mpvInitialized.current) {
          try {
            await runMpvCommand(() => mpvCommand('quit')).catch(() => {});
            await new Promise(resolve => setTimeout(resolve, 800));
            await runMpvCommand(() => destroy()).catch(() => {});
          } catch { /* ignore */ }
          mpvInitialized.current = false;
        }
      }).catch(() => {});
    };
  }, [runMpvCommand, cleanupPlayerMemory]);

  // 保存音量到本地
  useEffect(() => {
    try { localStorage.setItem('changli-player-volume', String(Math.round(volume))); } catch { /* ignore */ }
  }, [volume]);

  // 播放/暂停
  const togglePlay = useCallback(async () => {
    if (!mpvInitialized.current || !isMountedRef.current) return;
    try {
      const nextPaused = isPlayingRef.current;
      isPlayingRef.current = !nextPaused;
      setIsPlaying(!nextPaused);
      await runMpvCommand(() => mpvSetProperty('pause', nextPaused));
      if (nextPaused) {
        window.setTimeout(() => cleanupPlayerMemory('paused'), 500);
      }
    } catch (err) {
      if (isMountedRef.current) {
        isPlayingRef.current = !isPlayingRef.current;
        setIsPlaying(isPlayingRef.current);
      }
      console.error('[Player] 切换播放状态失败:', err);
    }
  }, [runMpvCommand, cleanupPlayerMemory]);

  // 跳转
  const seek = useCallback(async (time: number) => {
    if (!mpvInitialized.current || !isMountedRef.current) return;
    try {
      await runMpvCommand(() => mpvCommand('seek', [String(time), 'absolute']));
    } catch (err) {
      console.error('[Player] 跳转失败:', err);
    }
  }, [runMpvCommand]);

  // 设置音量
  const changeVolume = useCallback(async (vol: number) => {
    try {
      await runMpvCommand(() => mpvSetProperty('volume', Math.max(0, Math.min(100, vol))));
    } catch (err) {
      console.error('[Player] 设置音量失败:', err);
    }
  }, [runMpvCommand]);

  // 设置倍速
  const changeSpeed = useCallback(async (spd: number) => {
    try {
      await runMpvCommand(() => mpvSetProperty('speed', spd));
    } catch (err) {
      console.error('[Player] 设置倍速失败:', err);
    }
  }, [runMpvCommand]);

  // 切换全屏
  const toggleFullscreen = useCallback(async () => {
    try {
      const newFullscreen = !isFullscreen;
      const win = getCurrentWindow();
      if (newFullscreen) {
        // 进入全屏：记住当前是否最大化，直接设全屏
        const wasMaximized = await win.isMaximized().catch(() => false);
        await win.setFullscreen(true);
        setIsFullscreen(true);
        // 保存最大化状态以便退出时恢复
        if (wasMaximized) {
          (window as any).__changli_wasMaximized = true;
        }
      } else {
        // 退出全屏
        await win.setFullscreen(false);
        setIsFullscreen(false);
        // 恢复最大化
        if ((window as any).__changli_wasMaximized) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          await win.maximize().catch(() => undefined);
          setIsWindowMaximized(true);
          (window as any).__changli_wasMaximized = false;
        } else {
          setIsWindowMaximized(false);
        }
      }
    } catch (err) {
      console.error('[Player] 切换全屏失败:', err);
    }
  }, [isFullscreen]);

  const playerWindow = getCurrentWindow();

  const runPlayerWindowAction = useCallback((action: () => Promise<void>, name: string) => {
    action().catch((error) => console.error(`[Player] ${name}失败:`, error));
  }, []);

  const handlePlayerWindowDrag = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button,select,input,.changli-player-actions,.changli-player-controls,.changli-player-side,.changli-player-badge,.changli-player-center-play,.changli-player-stage')) return;
    playerWindow.startDragging().catch((error) => console.error('[Player] 拖动窗口失败:', error));
  }, [playerWindow]);

  const stopWindowButtonMouseDown = useCallback((event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  }, []);

  const handlePlayerMinimize = useCallback(() => {
    runPlayerWindowAction(() => playerWindow.minimize(), '最小化');
  }, [playerWindow, runPlayerWindowAction]);

  const handlePlayerToggleMaximize = useCallback(() => {
    runPlayerWindowAction(async () => {
      if (isFullscreen) {
        await playerWindow.setFullscreen(false);
        setIsFullscreen(false);
      }
      await playerWindow.toggleMaximize();
      setIsWindowMaximized(await playerWindow.isMaximized());
    }, '最大化');
  }, [isFullscreen, playerWindow, runPlayerWindowAction]);

  const handleToggleAlwaysOnTop = useCallback(() => {
    runPlayerWindowAction(async () => {
      const next = !isAlwaysOnTop;
      await playerWindow.setAlwaysOnTop(next);
      setIsAlwaysOnTop(next);
    }, '置顶');
  }, [isAlwaysOnTop, playerWindow, runPlayerWindowAction]);

  useEffect(() => {
    playerWindow.setResizable(false).catch(() => undefined);
    return () => {
      if (customResizeRef.current.raf) window.cancelAnimationFrame(customResizeRef.current.raf);
      customResizeRef.current.active = false;
    };
  }, [playerWindow]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    playerWindow.isMaximized().then(setIsWindowMaximized).catch((error) => console.error('[Player] 获取最大化状态失败:', error));

    // 用 Tauri outerSize() 同步视口高度，绕过 window.innerHeight 在透明 WebView 下可能返回 0 的问题
    const applyViewportHeight = (heightPx: number) => {
      try {
        const h = `${Math.round(heightPx)}px`;
        document.documentElement.style.height = h;
        document.body.style.height = h;
        document.getElementById('root')?.style.setProperty('height', h);
        const el = document.querySelector('.changli-player-window') as HTMLElement | null;
        if (el) el.style.height = h;
      } catch { /* ignore */ }
    };
    playerWindow.outerSize().then((size) => {
      const scale = window.devicePixelRatio || 1;
      applyViewportHeight(size.height / scale);
    }).catch(() => {});

    // debounce onResized：只同步视口高度和最大化状态，不再调 setSize（mpv --wid 嵌入后自行处理 WM_SIZE）
    let resizeDebounceTimer = 0;
    playerWindow.onResized(async () => {
      if (resizeDebounceTimer) window.clearTimeout(resizeDebounceTimer);
      resizeDebounceTimer = window.setTimeout(async () => {
        resizeDebounceTimer = 0;
        try {
          const [maximized, size] = await Promise.all([
            playerWindow.isMaximized().catch(() => false),
            playerWindow.outerSize().catch(() => null),
          ]);
          setIsWindowMaximized(maximized);
          if (size) {
            const scale = window.devicePixelRatio || 1;
            lastWindowSizeRef.current = { width: size.width / scale, height: size.height / scale };
            applyViewportHeight(size.height / scale);
          }
        } catch { /* ignore resize sync errors */ }
      }, 100);
    }).then((fn) => {
      unlisten = fn;
    }).catch((error) => console.error('[Player] 监听窗口大小失败:', error));
    return () => {
      if (resizeDebounceTimer) window.clearTimeout(resizeDebounceTimer);
      unlisten?.();
    };
  }, [getCurrentVideoRatio, isFullscreen, isPiP, playerWindow]);

  const startAspectResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (isFullscreen || isWindowMaximized) return;

    const grip = event.currentTarget;
    grip.setPointerCapture(event.pointerId);

    const startX = event.screenX;
    const startY = event.screenY;
    const startW = lastWindowSizeRef.current?.width || window.innerWidth || 1280;
    const startH = lastWindowSizeRef.current?.height || window.innerHeight || 720;
    const ratio = getCurrentVideoRatio();
    const minW = isPiP ? 360 : 520;
    const minH = Math.round(minW / ratio);
    let latest = { width: startW, height: startH };

    const syncViewport = (h: number) => {
      const hStr = `${Math.round(h)}px`;
      document.documentElement.style.height = hStr;
      document.body.style.height = hStr;
      document.getElementById('root')?.style.setProperty('height', hStr);
      const el = document.querySelector('.changli-player-window') as HTMLElement | null;
      if (el) el.style.height = hStr;
    };

    const scheduleSize = (size: { width: number; height: number }) => {
      const state = customResizeRef.current;
      state.pending = size;
      if (state.raf || state.inFlight) return;

      state.raf = window.requestAnimationFrame(() => {
        state.raf = 0;
        const target = state.pending;
        state.pending = null;
        if (!target || !state.active) return;

        state.inFlight = true;
        playerWindow.setSize(new LogicalSize(target.width, target.height))
          .catch(() => undefined)
          .finally(() => {
            state.inFlight = false;
            if (state.active && state.pending) {
              scheduleSize(state.pending);
            }
          });
      });
    };

    customResizeRef.current.active = true;

    const onMove = (moveEvent: PointerEvent) => {
      if (!customResizeRef.current.active) return;
      moveEvent.preventDefault();
      const dx = moveEvent.screenX - startX;
      const dy = moveEvent.screenY - startY;
      const widthFromX = startW + dx;
      const widthFromY = (startH + dy) * ratio;
      const useVertical = Math.abs(dy * ratio) > Math.abs(dx);
      const desiredW = useVertical ? widthFromY : widthFromX;
      const width = Math.max(minW, Math.round(desiredW));
      const height = Math.max(minH, Math.round(width / ratio));
      latest = { width, height };
      lastWindowSizeRef.current = latest;
      syncViewport(height);
      scheduleSize(latest);
    };

    const finish = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      customResizeRef.current.active = false;
      if (customResizeRef.current.raf) {
        window.cancelAnimationFrame(customResizeRef.current.raf);
        customResizeRef.current.raf = 0;
      }
      customResizeRef.current.pending = null;
      playerWindow.setSize(new LogicalSize(latest.width, latest.height)).catch(() => undefined).finally(() => {
        syncViewport(latest.height);
      });
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  }, [getCurrentVideoRatio, isFullscreen, isPiP, isWindowMaximized, playerWindow]);

  const handlePlayerClose = useCallback(() => {
    runPlayerWindowAction(async () => {
      try {
        const mainWindow = await Window.getByLabel('main').catch(() => null);
        if (mainWindow) {
          await mainWindow.unminimize().catch(() => undefined);
          await mainWindow.setAlwaysOnTop(true).catch(() => undefined);
          await mainWindow.setFocus().catch(() => undefined);
          await new Promise((resolve) => window.setTimeout(resolve, 120));
          await mainWindow.setAlwaysOnTop(false).catch(() => undefined);
        }
      } catch { /* 主窗口操作失败不影响关闭 */ }
      await playerWindow.close();
    }, '关闭');
  }, [playerWindow, runPlayerWindowAction]);

  // 切换画中画
  const togglePiP = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      const newPiP = !isPiP;
      if (newPiP) {
        if (isFullscreen) {
          await win.setFullscreen(false);
          setIsFullscreen(false);
        }
        // 保存当前窗口大小和位置
        const currentSize = await win.outerSize();
        const currentPos = await win.outerPosition();
        pipOriginalState.current = {
          size: new LogicalSize(currentSize.width, currentSize.height),
          position: new LogicalPosition(currentPos.x, currentPos.y),
        };

        // 进入画中画：缩小窗口到右下角并置顶
        const screen = await currentMonitor();
        const videoRatio = getCurrentVideoRatio();
        const pipW = videoRatio >= 1 ? 480 : Math.max(270, Math.round(480 * videoRatio));
        const pipH = videoRatio >= 1 ? Math.max(270, Math.round(480 / videoRatio)) : 480;
        if (screen) {
          const scale = screen.scaleFactor;
          const screenW = screen.size.width / scale;
          const screenH = screen.size.height / scale;
          const margin = 20;
          await win.setSize(new LogicalSize(pipW, pipH));
          await win.setPosition(new LogicalPosition(
            screenW - pipW - margin,
            screenH - pipH - margin,
          ));
        } else {
          await win.setSize(new LogicalSize(pipW, pipH));
        }
        await win.setAlwaysOnTop(true);
        setIsAlwaysOnTop(true);
        setIsPiP(true);
      } else {
        // 退出画中画：恢复窗口
        await win.setAlwaysOnTop(false);
        setIsAlwaysOnTop(false);
        if (pipOriginalState.current) {
          await win.setSize(pipOriginalState.current.size);
          await win.setPosition(pipOriginalState.current.position);
          pipOriginalState.current = null;
        } else {
          await win.setSize(new LogicalSize(1280, 720));
        }
        setIsPiP(false);
      }
    } catch (err) {
      console.error('[Player] 切换画中画失败:', err);
    }
  }, [getCurrentVideoRatio, isFullscreen, isPiP]);

  // 视频边距：选集面板现在是覆盖式，不再需要调整视频边距

  const closePiP = useCallback(() => {
    if (!isPiP) return;
    togglePiP();
  }, [isPiP, togglePiP]);
  const getProgressTimeFromClientX = useCallback((clientX: number) => {
    if (!progressBarRef.current || !duration) return null;
    const rect = progressBarRef.current.getBoundingClientRect();
    const x = Math.min(rect.width, Math.max(0, clientX - rect.left));
    const percent = rect.width > 0 ? x / rect.width : 0;
    return { time: percent * duration, x };
  }, [duration]);

  const handleProgressBarHover = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (draggingProgressRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const progress = getProgressTimeFromClientX(e.clientX);
    if (!progress) return;
    previewOnHover(e.clientX, rect, progress.time);
  }, [getProgressTimeFromClientX, previewOnHover]);

  // 进度条鼠标离开
  const handleProgressBarLeave = useCallback(() => {
    previewOnLeave();
  }, [previewOnLeave]);

  // 进度条拖拽
  const handleProgressPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const progress = getProgressTimeFromClientX(e.clientX);
    if (!progress) return;
    e.preventDefault();
    e.stopPropagation();
    draggingProgressRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraggingTime(progress.time);
    setCurrentTime(progress.time);
    seek(progress.time);
  }, [getProgressTimeFromClientX, seek]);

  const handleProgressPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingProgressRef.current) return;
    const progress = getProgressTimeFromClientX(e.clientX);
    if (!progress) return;
    e.preventDefault();
    e.stopPropagation();
    setDraggingTime(progress.time);
    setCurrentTime(progress.time);
  }, [getProgressTimeFromClientX]);

  const finishProgressDrag = useCallback((clientX: number) => {
    if (!draggingProgressRef.current) return;
    const progress = getProgressTimeFromClientX(clientX);
    draggingProgressRef.current = false;
    setDraggingTime(null);
    if (progress) {
      setCurrentTime(progress.time);
      seek(progress.time);
    }
  }, [getProgressTimeFromClientX, seek]);

  const handleProgressPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    finishProgressDrag(e.clientX);
  }, [finishProgressDrag]);

  const handleProgressPointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    draggingProgressRef.current = false;
    setDraggingTime(null);
  }, []);

  // 格式化时间
  const formatTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handlePlayerMouseMove = useCallback((event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    const overFooterControls = Boolean(target.closest('.changli-player-controls'));
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const rightBottomResizeSafeZone = x >= rect.width - 56 && y >= rect.height * 0.8;
    const nearTop = y <= 60;
    const nearBottom = y >= rect.height - 100;
    if (overFooterControls) {
      setShowHeader(false);
      setShowFooter(true);
    } else if (rightBottomResizeSafeZone) {
      setShowHeader(false);
      setShowFooter(false);
    } else if (nearTop) {
      setShowHeader(true);
      setShowFooter(false);
    } else if (nearBottom) {
      setShowHeader(false);
      setShowFooter(true);
    } else {
      setShowHeader(false);
      setShowFooter(false);
    }
    // 全屏时鼠标 2s 无操作隐藏光标
    setCursorVisible(true);
    if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
    cursorTimerRef.current = setTimeout(() => setCursorVisible(false), 2000);
  }, []);

  // 播放状态变化时：播放中隐藏导航栏，暂停时也保持当前状态（不强制展开）

  const markSeriesDirty = useLibraryStore(s => s.markSeriesDirty);

  const savePlaybackProgress = useCallback(async () => {
    if (!currentVideo || currentTime < 1) return;
    try {
      await updatePlayHistory(currentVideo.id, currentTime, duration || currentVideo.duration);
      markSeriesDirty();
    } catch (err) {
      console.error('[Player] 保存播放进度失败:', err);
    }
  }, [currentVideo, currentTime, duration]);

  useEffect(() => {
    if (!currentVideo) return;
    const timer = window.setInterval(() => {
      void savePlaybackProgress();
    }, 5000);
    return () => {
      window.clearInterval(timer);
      void savePlaybackProgress();
    };
  }, [currentVideo, savePlaybackProgress]);

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seek(Math.max(0, currentTime - 10));
          break;
        case 'ArrowRight':
          e.preventDefault();
          seek(Math.min(duration, currentTime + 10));
          break;
        case 'ArrowUp':
          e.preventDefault();
          changeVolume(volume + 5);
          break;
        case 'ArrowDown':
          e.preventDefault();
          changeVolume(volume - 5);
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'Escape':
          if (isFullscreen) {
            toggleFullscreen();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, currentTime, duration, volume, isFullscreen, togglePlay, seek, changeVolume, toggleFullscreen]);

  // 倍速选项
  const speedOptions = [1, 1.5, 2, 3];

  const sortedEpisodes = [...episodes].sort((a, b) => {
    const seasonA = a.season ?? 0;
    const seasonB = b.season ?? 0;
    if (seasonA !== seasonB) return seasonA - seasonB;
    const episodeA = a.episode_number ?? Number.MAX_SAFE_INTEGER;
    const episodeB = b.episode_number ?? Number.MAX_SAFE_INTEGER;
    if (episodeA !== episodeB) return episodeA - episodeB;
    return a.file_name.localeCompare(b.file_name);
  });
  const activeIndex = sortedEpisodes.findIndex((episode) => episode.id === currentVideo?.id);
  const activeEpisode = activeIndex >= 0 ? sortedEpisodes[activeIndex] : currentVideo;
  const displayTitle = series?.title || currentVideo?.series_title || currentVideo?.file_name || 'ChangLi Player';
  const episodeWord = '话';
  const activeEpisodeLabel = activeEpisode?.episode_number
    ? `${activeEpisode.season && activeEpisode.season > 0 && activeEpisode.season !== 999 ? `第${activeEpisode.season}季 ` : ''}第${activeEpisode.episode_number}${episodeWord}`
    : activeEpisode?.file_name || '正在播放';
  const displayTime = draggingTime ?? currentTime;
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (displayTime / duration) * 100)) : 0;
  const currentTimeText = formatTime(displayTime);
  const durationText = duration > 0 ? formatTime(duration) : '--:--';
  const nextEpisode = activeIndex >= 0 ? sortedEpisodes[activeIndex + 1] : null;
  const seasonSummary = activeEpisode?.season && activeEpisode.season > 0 && activeEpisode.season !== 999
    ? `第${activeEpisode.season}季 · ${sortedEpisodes.length}${episodeWord} · 当前${activeEpisodeLabel.replace(/^第\d+季 /, '')}`
    : `${sortedEpisodes.length || 1}${episodeWord} · 当前${activeEpisodeLabel}`;
  // 自动播放下一集：最后15秒通知，倒计时结束后自动播放
  useEffect(() => {
    if (!nextEpisode || duration <= 0) {
      setAutoPlayCountdown(null);
      return;
    }
    const remaining = duration - currentTime;
    if (remaining > 0 && remaining <= 15 && autoPlayCountdown === null) {
      setAutoPlayCountdown(15);
    }
  }, [currentTime, duration, nextEpisode]);

  useEffect(() => {
    if (autoPlayCountdown === null || autoPlayCountdown <= 0) {
      if (autoPlayCountdown === 0 && nextEpisode) {
        playEpisode(nextEpisode);
        setAutoPlayCountdown(null);
      }
      return;
    }
    const timer = setTimeout(() => setAutoPlayCountdown((c) => (c !== null ? c - 1 : null)), 1000);
    return () => clearTimeout(timer);
  }, [autoPlayCountdown, nextEpisode]);

  const cancelAutoPlay = () => setAutoPlayCountdown(null);

  const playEpisode = (episode: Video | null) => {
    if (!episode || episode.id === currentVideo?.id) return;
    navigate(`/player/${episode.id}`, { replace: true });
  };

  if (loading) {
    return (
      <div className="changli-player-loading">
        <div className="changli-player-loading-card">
          <div className="changli-player-spinner" />
          <span>正在打开播放器</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="changli-player-loading">
        <div className="changli-player-error-card">
          <div>{error}</div>
          <button type="button" onClick={() => navigateToLibraryReady(navigate, '/library')} className="changli-player-textbtn">返回视频库</button>
        </div>
      </div>
    );
  }

  return (
    <section
      className={`changli-player-window ${hasVideoFrame ? 'has-video-frame' : 'is-waiting-video'} ${isFullscreen ? 'is-fullscreen' : ''} ${isPiP ? 'is-pip' : ''} ${isFullscreen && !cursorVisible ? 'cursor-hidden' : ''}`}
      onMouseEnter={() => isPiP && setPipHovered(true)}
      onMouseDown={handlePlayerWindowDrag}
      onMouseMove={handlePlayerMouseMove}
      onMouseLeave={() => { isPiP && setPipHovered(false); if (isPlaying) { setShowHeader(false); setShowFooter(false); } }}
    >
      <header className={`changli-player-titlebar ${showHeader ? 'show' : 'hide'}`}>
        <div className="changli-player-brand">
          <img src={appIcon} alt="长离" />
          <span>ChangLi Player</span>
        </div>
        <div className="changli-player-meta">
          <div className="changli-player-title">{displayTitle} - {activeEpisodeLabel}</div>
        </div>
        <div className="changli-player-actions" onMouseDown={stopWindowButtonMouseDown}>
          <button type="button" className={`changli-player-winbtn ${isAlwaysOnTop ? 'is-pinned' : ''}`} aria-label="置顶" onClick={handleToggleAlwaysOnTop}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="m15.99 4.95l.53-.53zm3.082 3.086l-.531.53zM8.738 19.429l-.53.53zm-4.116-4.12l.53-.53zm12.945-.315l-.264-.702zm-1.917.72l.264.703zM8.332 8.383l-.704-.258zm.695-1.896l.704.258zm-3.182 4.188l.2.723zm1.457-.539l-.439-.609zm.374-.345l.57.487zm6.575 6.59l.491.568zm-.87 1.821l-.724-.199zm.536-1.454l-.61-.438zM2.718 12.755l-.75.005zm.212-.803l-.65-.374zm8.375 9.391l.001-.75zm.788-.208l-.371-.652zm-.396-19.099l.162.732zM1.47 21.47a.75.75 0 0 0 1.062 1.06zm5.715-3.598a.75.75 0 0 0-1.061-1.06zM15.459 5.48l3.082 3.086l1.061-1.06L16.52 4.42zM9.269 18.9l-4.117-4.12l-1.06 1.06l4.116 4.12zm8.034-4.607l-1.917.72l.528 1.405l1.917-.72zM9.036 8.64l.695-1.896l-1.409-.516l-.694 1.896zm-2.992 2.756c.712-.196 1.253-.334 1.696-.652l-.877-1.218c-.172.125-.397.198-1.217.424zm1.584-3.272c-.293.8-.385 1.018-.523 1.18l1.142.973c.353-.415.535-.944.79-1.637zm.112 2.62q.281-.203.507-.467l-1.142-.973a1.4 1.4 0 0 1-.242.222zm7.646 4.268c-.689.26-1.214.445-1.626.801l.982 1.135c.16-.14.377-.233 1.172-.531zM14.104 18.4c.225-.819.298-1.043.422-1.216l-1.219-.875c-.317.443-.454.983-.65 1.693zm-.344-2.586q-.256.22-.453.495l1.22.875q.093-.132.215-.236zm-8.608-1.036c-.646-.647-1.084-1.087-1.368-1.444c-.286-.359-.315-.514-.316-.583l-1.5.009c.004.582.293 1.07.642 1.508c.35.44.861.95 1.481 1.57zm.494-4.828c-.846.234-1.542.424-2.063.634c-.52.208-1.012.49-1.302.994l1.3.748c.034-.06.136-.18.56-.35s1.022-.337 1.903-.58zm-2.178 2.8a.84.84 0 0 1 .112-.424l-1.3-.748a2.34 2.34 0 0 0-.312 1.182zm4.74 7.21c.624.624 1.137 1.139 1.578 1.49c.441.352.932.642 1.518.643l.002-1.5c-.07 0-.225-.029-.585-.316c-.36-.286-.802-.727-1.452-1.378zm4.45-1.958c-.245.888-.412 1.49-.583 1.917c-.172.428-.293.53-.353.564l.743 1.303c.509-.29.792-.786 1.002-1.309c.21-.524.402-1.225.637-2.077zm-1.354 4.091c.407 0 .807-.105 1.161-.307l-.743-1.303a.84.84 0 0 1-.416.11zm7.237-13.527c1.064 1.064 1.8 1.803 2.25 2.413c.444.598.495.917.441 1.167l1.466.317c.19-.878-.16-1.647-.701-2.377c-.534-.72-1.366-1.551-2.395-2.58zm-.71 7.13c1.361-.511 2.463-.923 3.246-1.358c.795-.44 1.431-.996 1.621-1.875l-1.466-.317c-.054.25-.232.52-.883.88c-.663.369-1.638.737-3.046 1.266zM16.52 4.42c-1.036-1.037-1.872-1.876-2.595-2.414c-.734-.544-1.508-.897-2.39-.702l.324 1.464c.25-.055.569-.005 1.171.443c.613.455 1.358 1.197 2.429 2.27zM9.73 6.744c.522-1.423.886-2.41 1.251-3.08c.36-.66.628-.84.878-.896l-.323-1.464c-.882.194-1.435.84-1.872 1.642c-.431.792-.837 1.906-1.342 3.282zM2.53 22.53l4.654-4.658l-1.061-1.06l-4.654 4.658z"/></svg>
          </button>
          <button type="button" className="changli-player-winbtn" aria-label="最小化" onClick={handlePlayerMinimize}><span /></button>
          <button type="button" className={`changli-player-winbtn ${isWindowMaximized ? 'is-maximized' : ''}`} aria-label="最大化" onClick={handlePlayerToggleMaximize}><span /></button>
          <button type="button" className="changli-player-winbtn close" aria-label="关闭" onClick={handlePlayerClose}><span /></button>
        </div>
      </header>

      {isPiP && pipHovered && (
        <div className="changli-player-pip-actions" onMouseDown={stopWindowButtonMouseDown}>
          <button type="button" className={`changli-player-pip-icon ${isAlwaysOnTop ? 'active' : ''}`} onClick={handleToggleAlwaysOnTop}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="m15.99 4.95l.53-.53zm3.082 3.086l-.531.53zM8.738 19.429l-.53.53zm-4.116-4.12l.53-.53zm12.945-.315l-.264-.702zm-1.917.72l.264.703zM8.332 8.383l-.704-.258zm.695-1.896l.704.258zm-3.182 4.188l.2.723zm1.457-.539l-.439-.609zm.374-.345l.57.487zm6.575 6.59l.491.568zm-.87 1.821l-.724-.199zm.536-1.454l-.61-.438zM2.718 12.755l-.75.005zm.212-.803l-.65-.374zm8.375 9.391l.001-.75zm.788-.208l-.371-.652zm-.396-19.099l.162.732zM1.47 21.47a.75.75 0 0 0 1.062 1.06zm5.715-3.598a.75.75 0 0 0-1.061-1.06zM15.459 5.48l3.082 3.086l1.061-1.06L16.52 4.42zM9.269 18.9l-4.117-4.12l-1.06 1.06l4.116 4.12zm8.034-4.607l-1.917.72l.528 1.405l1.917-.72zM9.036 8.64l.695-1.896l-1.409-.516l-.694 1.896zm-2.992 2.756c.712-.196 1.253-.334 1.696-.652l-.877-1.218c-.172.125-.397.198-1.217.424zm1.584-3.272c-.293.8-.385 1.018-.523 1.18l1.142.973c.353-.415.535-.944.79-1.637zm.112 2.62q.281-.203.507-.467l-1.142-.973a1.4 1.4 0 0 1-.242.222zm7.646 4.268c-.689.26-1.214.445-1.626.801l.982 1.135c.16-.14.377-.233 1.172-.531zM14.104 18.4c.225-.819.298-1.043.422-1.216l-1.219-.875c-.317.443-.454.983-.65 1.693zm-.344-2.586q-.256.22-.453.495l1.22.875q.093-.132.215-.236zm-8.608-1.036c-.646-.647-1.084-1.087-1.368-1.444c-.286-.359-.315-.514-.316-.583l-1.5.009c.004.582.293 1.07.642 1.508c.35.44.861.95 1.481 1.57zm.494-4.828c-.846.234-1.542.424-2.063.634c-.52.208-1.012.49-1.302.994l1.3.748c.034-.06.136-.18.56-.35s1.022-.337 1.903-.58zm-2.178 2.8a.84.84 0 0 1 .112-.424l-1.3-.748a2.34 2.34 0 0 0-.312 1.182zm4.74 7.21c.624.624 1.137 1.139 1.578 1.49c.441.352.932.642 1.518.643l.002-1.5c-.07 0-.225-.029-.585-.316c-.36-.286-.802-.727-1.452-1.378zm4.45-1.958c-.245.888-.412 1.49-.583 1.917c-.172.428-.293.53-.353.564l.743 1.303c.509-.29.792-.786 1.002-1.309c.21-.524.402-1.225.637-2.077zm-1.354 4.091c.407 0 .807-.105 1.161-.307l-.743-1.303a.84.84 0 0 1-.416.11zm7.237-13.527c1.064 1.064 1.8 1.803 2.25 2.413c.444.598.495.917.441 1.167l1.466.317c.19-.878-.16-1.647-.701-2.377c-.534-.72-1.366-1.551-2.395-2.58zm-.71 7.13c1.361-.511 2.463-.923 3.246-1.358c.795-.44 1.431-.996 1.621-1.875l-1.466-.317c-.054.25-.232.52-.883.88c-.663.369-1.638.737-3.046 1.266zM16.52 4.42c-1.036-1.037-1.872-1.876-2.595-2.414c-.734-.544-1.508-.897-2.39-.702l.324 1.464c.25-.055.569-.005 1.171.443c.613.455 1.358 1.197 2.429 2.27zM9.73 6.744c.522-1.423.886-2.41 1.251-3.08c.36-.66.628-.84.878-.896l-.323-1.464c-.882.194-1.435.84-1.872 1.642c-.431.792-.837 1.906-1.342 3.282zM2.53 22.53l4.654-4.658l-1.061-1.06l-4.654 4.658z"/></svg>
          </button>
          <button type="button" className="changli-player-pip-icon" onClick={closePiP}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><g><path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4"/><rect width="10" height="7" x="12" y="13" rx="2"/></g></svg>
          </button>
          <button type="button" className="changli-player-pip-icon" onClick={handlePlayerClose} aria-label="关闭播放器">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
      )}

      <main className="changli-player-main">
        <div
          className="changli-player-stage"
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            const startX = e.screenX;
            const startY = e.screenY;
            stageDraggedRef.current = false;
            const onMove = (me: MouseEvent) => {
              if (Math.abs(me.screenX - startX) > 5 || Math.abs(me.screenY - startY) > 5) {
                stageDraggedRef.current = true;
                window.removeEventListener('mousemove', onMove);
                playerWindow.startDragging().catch(() => {});
              }
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', () => window.removeEventListener('mousemove', onMove), { once: true });
          }}
          onClick={() => {
            if (stageDraggedRef.current) return;
            togglePlay();
          }}
        >
          <div className="changli-player-video-art" />
          {showResumeNotice && (
            <div className="changli-player-resume-notice">继续观看 · 已看到{activeEpisodeLabel}</div>
          )}
        </div>

        {/* 选集侧边栏：鼠标靠近右侧展开，离开收起 */}
        <div
          className="changli-player-hover-zone"
          onMouseEnter={() => {
            if (episodeHoverTimerRef.current) clearTimeout(episodeHoverTimerRef.current);
            setEpisodeListExpanded(true);
          }}
          onMouseLeave={() => {
            episodeHoverTimerRef.current = setTimeout(() => setEpisodeListExpanded(false), 300);
          }}
        />
        <aside
          className={`changli-player-side ${episodeListExpanded ? 'open' : ''}`}
          onMouseEnter={() => {
            if (episodeHoverTimerRef.current) clearTimeout(episodeHoverTimerRef.current);
            setEpisodeListExpanded(true);
          }}
          onMouseLeave={() => {
            episodeHoverTimerRef.current = setTimeout(() => setEpisodeListExpanded(false), 300);
          }}
        >
          <div className="changli-player-side-head">
            <strong>选集</strong>
            <span>{seasonSummary}</span>
          </div>
          <div className="changli-player-episodes">
            {(() => {
              const seasons = new Map<number, Video[]>();
              for (const ep of sortedEpisodes) {
                const s = ep.season ?? 0;
                if (!seasons.has(s)) seasons.set(s, []);
                seasons.get(s)!.push(ep);
              }
              const hasMultipleSeasons = seasons.size > 1;
              const entries = hasMultipleSeasons ? [...seasons.entries()].sort(([a], [b]) => a - b) : [[0, sortedEpisodes] as const];

              return entries.map(([seasonNum, eps]) => (
                <React.Fragment key={seasonNum}>
                  {hasMultipleSeasons && (
                    <div className="changli-player-season-header">
                      {seasonNum > 0 && seasonNum !== 999 ? `第${seasonNum}季` : '未分季'}
                    </div>
                  )}
                  {eps.map((episode) => {
                    const active = episode.id === currentVideo?.id;
                    const label = episode.episode_number ? `第${episode.episode_number}${episodeWord}` : episode.file_name;
                    const history = playHistory.find((item) => item.video_id === episode.id);
                    const lastPos = history?.last_position ?? 0;
                    const hasProgress = lastPos > 5;
                    return (
                      <button
                        type="button"
                        key={episode.id}
                        onClick={() => playEpisode(episode)}
                        className={`changli-player-episode ${active ? 'active' : ''}`}
                      >
                        <span className="changli-player-episode-label">{label}</span>
                        {hasProgress && !active && (
                          <span className="changli-player-episode-time">{formatTime(lastPos)}</span>
                        )}
                        {active && (
                          <span className="changli-player-episode-time active">{currentTimeText}</span>
                        )}
                      </button>
                    );
                  })}
                </React.Fragment>
              ));
            })()}
          </div>
        </aside>
      </main>

      <footer className={`changli-player-controls ${showFooter ? 'show' : 'hide'}`}>
        <div className="changli-player-progress">
          <span>{currentTimeText}</span>
          <div
            ref={progressBarRef}
            className="changli-player-bar"
            onPointerDown={handleProgressPointerDown}
            onPointerMove={handleProgressPointerMove}
            onPointerUp={handleProgressPointerUp}
            onPointerCancel={handleProgressPointerCancel}
            onMouseMove={handleProgressBarHover}
            onMouseLeave={handleProgressBarLeave}
          >
            <span style={{ width: `${progressPercent}%` }} />
            <i style={{ left: `${progressPercent}%` }} />
            {hoverTime !== null && (
              <div className="changli-player-preview" style={{ left: `${hoverX}px` }}>
                {thumbnailUrl ? <img src={thumbnailUrl} alt="预览" /> : <div>{formatTime(hoverTime)}</div>}
                <small>{formatTime(hoverTime)}</small>
              </div>
            )}
          </div>
          <span>{durationText}</span>
        </div>

        {/* 自动播放下一集通知 */}
        {autoPlayCountdown !== null && autoPlayCountdown > 0 && nextEpisode && (
          <div className="changli-player-autoplay-notice">
            <span>{autoPlayCountdown}秒后自动播放下一集：{nextEpisode.episode_number ? `第${nextEpisode.episode_number}话` : nextEpisode.file_name}</span>
            <button type="button" onClick={cancelAutoPlay}>取消</button>
          </div>
        )}

        <div className="changli-player-bottom">
          <div className="changli-player-left-controls">
            <button type="button" className="changli-player-round primary" aria-label={isPlaying ? '暂停' : '播放'} onClick={togglePlay}><span className={isPlaying ? 'pause-icon' : 'play-icon'} /></button>
            <button type="button" className="changli-player-round" aria-label="后退10秒" onClick={() => seek(Math.max(0, currentTime - 10))}><span className="back-icon" /></button>
            <button type="button" className="changli-player-round next" aria-label="下一集" disabled={!nextEpisode} onClick={() => playEpisode(nextEpisode)}><span className="next-icon" /></button>
            <button type="button" className="changli-player-round" aria-label="前进10秒" onClick={() => seek(Math.min(duration, currentTime + 10))}><span className="forward-icon" /></button>
            {isPiP && (
              <button type="button" className="changli-player-round speed-pip" aria-label="切换小窗倍速" onClick={() => changeSpeed(speed === 2 ? 1 : 2)}>
                {speed === 2 ? '2X' : '1X'}
              </button>
            )}
          </div>

          <div className="changli-player-right-controls">
            <div className="changli-speed-menu">
              <button type="button" className="changli-player-textbtn speed-trigger" onClick={() => setSpeedMenuOpen((open) => !open)}>{speed}x</button>
              {speedMenuOpen && (
                <div className="changli-speed-options">
                  {speedOptions.map((spd) => (
                    <button key={spd} type="button" className={speed === spd ? 'active' : ''} onClick={() => { changeSpeed(spd); setSpeedMenuOpen(false); }}>{spd}x</button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" className="changli-player-textbtn" onClick={() => changeVolume(volume === 0 ? 80 : 0)}>音量 {Math.round(volume)}%</button>
            <input
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={(e) => changeVolume(parseInt(e.target.value))}
              className="changli-player-volume"
              aria-label="音量"
            />
            <button type="button" className="changli-player-textbtn advanced" onClick={togglePiP}>{isPiP ? '退出小窗' : '小窗'}</button>
            <button type="button" className="changli-player-textbtn advanced" onClick={toggleFullscreen}>{isFullscreen ? '退出全屏' : '全屏'}</button>
          </div>
        </div>
      </footer>
      {!isFullscreen && !isWindowMaximized && (
        <div
          className="changli-player-resize-grip"
          onPointerDown={startAspectResize}
          aria-label="按视频比例拉伸播放器"
        />
      )}
    </section>
  );
};

export default Player;
