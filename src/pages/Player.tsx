import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getCurrentWindow, currentMonitor, Window } from '@tauri-apps/api/window';
import { LogicalSize, LogicalPosition } from '@tauri-apps/api/dpi';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getPlayHistory, getVideo, getVideoSeriesDetail, updatePlayHistory } from '../utils/api';
import { useLibraryStore } from '../store/libraryStore';
import type { Video, VideoSeries, PlayHistory } from '../utils/api';
import appIcon from '../assets/brand/app-icon.png';
import { init, destroy, setProperty, command, observeProperties, setVideoMarginRatio } from 'tauri-plugin-libmpv-api';
import type { MpvObservableProperty } from 'tauri-plugin-libmpv-api';

const OBSERVED_PROPERTIES = [
  ['pause', 'flag'],
  ['time-pos', 'double', 'none'],
  ['duration', 'double', 'none'],
  ['volume', 'double', 'none'],
  ['speed', 'double', 'none'],
  ['dwidth', 'int64', 'none'],
  ['dheight', 'int64', 'none'],
] as const satisfies MpvObservableProperty[];

const Player: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState('');
  const [currentVideo, setCurrentVideo] = useState<Video | null>(null);
  const [series, setSeries] = useState<VideoSeries | null>(null);
  const [episodes, setEpisodes] = useState<Video[]>([]);
  const [playHistory, setPlayHistory] = useState<PlayHistory[]>([]);
  
  // 播放器状态
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
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
  const [cursorVisible, setCursorVisible] = useState(true);
  const cursorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // 悬浮预览
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  
  // Refs
  const progressBarRef = useRef<HTMLDivElement>(null);
  const mpvInitialized = useRef(false);
  const mpvOperationLock = useRef(Promise.resolve());
  const isPlayingRef = useRef(false);
  const isMountedRef = useRef(true);
  const windowShownRef = useRef(false);
  const pipOriginalState = useRef<{ size: LogicalSize; position: LogicalPosition } | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewSeqRef = useRef(0);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  // 透明 WebView 让 libmpv 视频层可见，避免 WebView/CSS 背景盖住画面
  useEffect(() => {
    document.documentElement.classList.add('changli-player-html');
    document.body.classList.add('changli-player-body');
    return () => {
      document.documentElement.classList.remove('changli-player-html');
      document.body.classList.remove('changli-player-body');
    };
  }, []);

  // 初始化 mpv
  useEffect(() => {
    if (!id) return;

    const initMpv = async () => {
      // 通过锁串行化所有 mpv 操作，避免 destroy/init 竞态
      mpvOperationLock.current = mpvOperationLock.current.then(async () => {
        try {
          setLoading(true);
          setError('');

          // 先销毁旧实例（如果有），确保完全清理
          if (mpvInitialized.current) {
            try {
              await destroy();
            } catch { /* ignore destroy errors */ }
            mpvInitialized.current = false;
            await new Promise((resolve) => setTimeout(resolve, 300));
          }

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

        // 初始化 mpv
        await init({
          initialOptions: {
            'vo': 'gpu-next',
            'hwdec': 'd3d11va',
            'keep-open': 'yes',
            'force-window': 'yes',
            'hwdec-codecs': 'all',
            'gpu-api': 'd3d11',
            'osc': 'no',
            'osd-level': 0,
            // 防 overlay inject
            'video-sync': 'audio',
          },
          observedProperties: OBSERVED_PROPERTIES,
        });

        await setVideoMarginRatio({ top: 0, right: 0, bottom: 0, left: 0 }).catch(() => undefined);

        mpvInitialized.current = true;

        // 监听属性变化
        await observeProperties(OBSERVED_PROPERTIES, ({ name, data }) => {
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
                setCurrentTime(data ?? 0);
                break;
              case 'duration':
                setDuration(data ?? 0);
                break;
              case 'volume':
                setVolume(data ?? 80);
                break;
              case 'speed':
                setSpeed(data ?? 1);
                break;
              case 'dwidth':
              case 'dheight':
                // 视频尺寸变化时，按比例调整播放器窗口大小，首次调整后显示窗口
                if (name === 'dwidth' && data && data > 0 && isMountedRef.current) {
                  const win = getCurrentWindow();
                  const videoW = data as number;
                  win.outerSize().then((size) => {
                    const scale = window.devicePixelRatio || 1;
                    const currentW = size.width / scale;
                    const currentH = size.height / scale;
                    const targetH = Math.round(videoW * (currentH / currentW));
                    if (targetH > 200 && targetH < 2000) {
                      const newW = Math.round(Math.min(videoW, 1600));
                      const newH = Math.round(newW * (targetH / videoW));
                      win.setSize(new LogicalSize(newW, Math.max(360, newH))).then(() => {
                        if (!windowShownRef.current) {
                          windowShownRef.current = true;
                          win.show().catch(() => {});
                        }
                      }).catch(() => {});
                    } else if (!windowShownRef.current) {
                      windowShownRef.current = true;
                      win.show().catch(() => {});
                    }
                  }).catch(() => {});
                }
                break;
            }
          } catch { /* ignore observer errors */ }
        });

        // 加载视频
        try {
          await command('loadfile', [currentVideo.file_path, 'replace']);
        } catch (loadErr) {
          console.error('[Player] loadfile 失败:', loadErr);
          setError('加载视频失败: ' + String(loadErr));
          setLoading(false);
          return;
        }
        if (currentVideo.subtitle) {
          await command('sub-add', [currentVideo.subtitle, 'auto']).catch(() => undefined);
        }
        if (previousPosition > 5) {
          // 等待 mpv 加载文件后再 seek，避免 seek 被忽略
          await new Promise((resolve) => setTimeout(resolve, 800));
          await command('seek', [previousPosition, 'absolute']).catch(() => undefined);
          setCurrentTime(previousPosition);
        }
        await setProperty('pause', false).catch(() => undefined);
        isPlayingRef.current = true;
        setIsPlaying(true);
        
        setLoading(false);
      } catch (err) {
        console.error('[Player] 初始化失败:', err);
        setError(String(err));
        setLoading(false);
      }
      }); // end mpvOperationLock.then
    };

    initMpv();

    return () => {
      // 不在这里 destroy — 由下次 init 或组件卸载时处理
      // 避免 destroy/init 竞态导致闪退
    };
  }, [id]);

  // 组件卸载时清理 mpv — 通过锁串行化，避免和 init 竞态
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      // 通过锁确保 init 完成后再 destroy
      mpvOperationLock.current = mpvOperationLock.current.then(async () => {
        if (mpvInitialized.current) {
          try {
            await destroy();
          } catch { /* ignore */ }
          mpvInitialized.current = false;
        }
      }).catch(() => {});
    };
  }, []);

  // mpv 健康检查：检测播放中 mpv 是否崩溃
  useEffect(() => {
    if (!mpvInitialized.current) return;
    let failCount = 0;
    const timer = window.setInterval(async () => {
      if (!isMountedRef.current || !mpvInitialized.current) return;
      try {
        await command('get_property', ['time-pos']);
        failCount = 0;
      } catch {
        if (!isMountedRef.current) return;
        failCount++;
        if (failCount >= 3) {
          console.error('[Player] mpv 连续无响应，可能已崩溃');
          if (isMountedRef.current) {
            setError('播放器异常退出，请重新打开');
          }
          mpvInitialized.current = false;
          window.clearInterval(timer);
        }
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [currentVideo]);

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
      await setProperty('pause', nextPaused);
    } catch (err) {
      if (isMountedRef.current) {
        isPlayingRef.current = !isPlayingRef.current;
        setIsPlaying(isPlayingRef.current);
      }
      console.error('[Player] 切换播放状态失败:', err);
    }
  }, []);

  // 跳转
  const seek = useCallback(async (time: number) => {
    if (!mpvInitialized.current || !isMountedRef.current) return;
    try {
      await command('seek', [time, 'absolute']);
    } catch (err) {
      console.error('[Player] 跳转失败:', err);
    }
  }, []);

  // 设置音量
  const changeVolume = useCallback(async (vol: number) => {
    try {
      await setProperty('volume', Math.max(0, Math.min(100, vol)));
    } catch (err) {
      console.error('[Player] 设置音量失败:', err);
    }
  }, []);

  // 设置倍速
  const changeSpeed = useCallback(async (spd: number) => {
    try {
      await setProperty('speed', spd);
    } catch (err) {
      console.error('[Player] 设置倍速失败:', err);
    }
  }, []);

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
    if (target.closest('button,select,input,.changli-player-actions,.changli-player-controls,.changli-player-side,.changli-player-badge,.changli-player-center-play')) return;
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

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    playerWindow.isMaximized().then(setIsWindowMaximized).catch((error) => console.error('[Player] 获取最大化状态失败:', error));
    playerWindow.onResized(async () => {
      setIsWindowMaximized(await playerWindow.isMaximized());
    }).then((fn) => {
      unlisten = fn;
    }).catch((error) => console.error('[Player] 监听窗口大小失败:', error));
    return () => unlisten?.();
  }, [playerWindow]);

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
        if (screen) {
          const pipW = 480;
          const pipH = 270;
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
          await win.setSize(new LogicalSize(480, 270));
        }
        await win.setAlwaysOnTop(true);
        setIsPiP(true);
      } else {
        // 退出画中画：恢复窗口
        await win.setAlwaysOnTop(false);
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
  }, [isFullscreen, isPiP]);

  // 视频边距：选集面板现在是覆盖式，不再需要调整视频边距

  const closePiP = useCallback(() => {
    if (!isPiP) return;
    togglePiP();
  }, [isPiP, togglePiP]);
  const handleProgressBarHover = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || !duration) return;

    const rect = progressBarRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = x / rect.width;
    const time = percent * duration;

    setHoverTime(time);
    setHoverX(x);

    // 防抖生成预览帧：只更新悬停缩略图，不能 seek 主播放器。
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
    }
    const seq = ++previewSeqRef.current;
    previewTimerRef.current = setTimeout(async () => {
      try {
        if (!currentVideo?.file_path) return;
        let video = previewVideoRef.current;
        if (!video || video.dataset.src !== currentVideo.file_path) {
          video = document.createElement('video');
          video.dataset.src = currentVideo.file_path;
          video.src = convertFileSrc(currentVideo.file_path);
          video.muted = true;
          video.preload = 'auto';
          // 不设 crossOrigin — 本地文件用 Tauri asset protocol 不支持 CORS
          previewVideoRef.current = video;
        }
        if (video.readyState < 1) {
          await new Promise<void>((resolve, reject) => {
            const cleanup = () => {
              video?.removeEventListener('loadedmetadata', onLoaded);
              video?.removeEventListener('error', onError);
            };
            const onLoaded = () => { cleanup(); resolve(); };
            const onError = () => { cleanup(); reject(new Error('preview metadata load failed')); };
            video?.addEventListener('loadedmetadata', onLoaded, { once: true });
            video?.addEventListener('error', onError, { once: true });
          });
        }
        video.currentTime = Math.min(Math.max(time, 0), Math.max((video.duration || duration) - 0.1, 0));
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            video?.removeEventListener('seeked', onSeeked);
            video?.removeEventListener('error', onError);
          };
          const onSeeked = () => { cleanup(); resolve(); };
          const onError = () => { cleanup(); reject(new Error('preview seek failed')); };
          video?.addEventListener('seeked', onSeeked, { once: true });
          video?.addEventListener('error', onError, { once: true });
        });
        if (seq !== previewSeqRef.current) return;
        const canvas = document.createElement('canvas');
        const width = video.videoWidth || 160;
        const height = video.videoHeight || 90;
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d')?.drawImage(video, 0, 0, width, height);
        if (seq !== previewSeqRef.current) return;
        setThumbnailUrl(canvas.toDataURL('image/jpeg', 0.72));
      } catch {
        // 预览帧失败时退回当前视频缩略图，但不影响主播放器进度。
        if (seq === previewSeqRef.current) {
          setThumbnailUrl(currentVideo?.thumbnail_data_url || null);
        }
      }
    }, 300);
  }, [currentVideo, duration]);

  // 进度条鼠标离开
  const handleProgressBarLeave = useCallback(() => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    previewSeqRef.current++;
    setHoverTime(null);
    setThumbnailUrl(null);
  }, []);

  // 进度条点击
  const handleProgressBarClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || !duration) return;
    
    const rect = progressBarRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = x / rect.width;
    const time = percent * duration;
    
    seek(time);
  }, [duration, seek]);

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
    const rect = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const nearTop = y <= 60;
    const nearBottom = y >= rect.height - 100;
    if (nearTop) {
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
          seek(Math.max(0, currentTime - 5));
          break;
        case 'ArrowRight':
          e.preventDefault();
          seek(Math.min(duration, currentTime + 5));
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
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const currentTimeText = formatTime(currentTime);
  const durationText = duration > 0 ? formatTime(duration) : '--:--';
  const nextEpisode = activeIndex >= 0 ? sortedEpisodes[activeIndex + 1] : null;
  const seasonSummary = activeEpisode?.season && activeEpisode.season > 0 && activeEpisode.season !== 999
    ? `第${activeEpisode.season}季 · ${sortedEpisodes.length}${episodeWord} · 当前${activeEpisodeLabel.replace(/^第\d+季 /, '')}`
    : `${sortedEpisodes.length || 1}${episodeWord} · 当前${activeEpisodeLabel}`;
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
          <Link to="/library" className="changli-player-textbtn">返回视频库</Link>
        </div>
      </div>
    );
  }

  return (
    <section
      className={`changli-player-window ${isFullscreen ? 'is-fullscreen' : ''} ${isPiP ? 'is-pip' : ''} ${isFullscreen && !cursorVisible ? 'cursor-hidden' : ''}`}
      onMouseDown={handlePlayerWindowDrag}
      onMouseMove={handlePlayerMouseMove}
      onMouseLeave={() => { if (isPlaying) { setShowHeader(false); setShowFooter(false); } }}
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
          <button type="button" className="changli-player-winbtn" aria-label="最小化" onClick={handlePlayerMinimize}><span /></button>
          <button type="button" className={`changli-player-winbtn ${isWindowMaximized ? 'is-maximized' : ''}`} aria-label="最大化" onClick={handlePlayerToggleMaximize}><span /></button>
          <button type="button" className="changli-player-winbtn close" aria-label="关闭" onClick={handlePlayerClose}><span /></button>
        </div>
      </header>

      {isPiP && (
        <div className="changli-player-pip-actions" onMouseDown={stopWindowButtonMouseDown}>
          <button type="button" onClick={closePiP}>退出小窗</button>
          <button type="button" className="close" onClick={handlePlayerClose} aria-label="关闭播放器">×</button>
        </div>
      )}

      <main className="changli-player-main">
        <div className="changli-player-stage" onClick={togglePlay}>
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
            onClick={handleProgressBarClick}
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

        <div className="changli-player-bottom">
          <div className="changli-player-left-controls">
            <button type="button" className="changli-player-round primary" aria-label={isPlaying ? '暂停' : '播放'} onClick={togglePlay}><span className={isPlaying ? 'pause-icon' : 'play-icon'} /></button>
            <button type="button" className="changli-player-round" aria-label="后退10秒" onClick={() => seek(Math.max(0, currentTime - 10))}><span className="back-icon" /></button>
            <button type="button" className="changli-player-round next" aria-label="下一集" disabled={!nextEpisode} onClick={() => playEpisode(nextEpisode)}><span className="next-icon" /></button>
            <button type="button" className="changli-player-round" aria-label="前进10秒" onClick={() => seek(Math.min(duration, currentTime + 10))}><span className="forward-icon" /></button>
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
    </section>
  );
};

export default Player;
