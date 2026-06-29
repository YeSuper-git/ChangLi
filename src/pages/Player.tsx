import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getCurrentWindow, currentMonitor } from '@tauri-apps/api/window';
import { LogicalSize, LogicalPosition } from '@tauri-apps/api/dpi';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getVideo } from '../utils/api';
import { init, destroy, setProperty, command, observeProperties } from 'tauri-plugin-libmpv-api';
import type { MpvObservableProperty } from 'tauri-plugin-libmpv-api';

const OBSERVED_PROPERTIES = [
  ['pause', 'flag'],
  ['time-pos', 'double', 'none'],
  ['duration', 'double', 'none'],
  ['volume', 'double', 'none'],
  ['speed', 'double', 'none'],
] as const satisfies MpvObservableProperty[];

const Player: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState('');
  
  // 播放器状态
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(80);
  const [speed, setSpeed] = useState(1);
  
  // UI 状态
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [isPiP, setIsPiP] = useState(false);
  
  // 悬浮预览
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  
  // Refs
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const mpvInitialized = useRef(false);
  const isPlayingRef = useRef(false);
  const pipOriginalState = useRef<{ size: LogicalSize; position: LogicalPosition } | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewSeqRef = useRef(0);

  // 初始化 mpv
  useEffect(() => {
    if (!id || mpvInitialized.current) return;

    const initMpv = async () => {
      try {
        setLoading(true);
        setError('');

        // 获取视频信息
        const currentVideo = await getVideo(parseInt(id));
        if (!currentVideo) {
          setError('视频不存在');
          return;
        }

        // 初始化 mpv
        await init({
          initialOptions: {
            'vo': 'gpu',
            'hwdec': 'auto-safe',
            'keep-open': 'yes',
            'force-window': 'yes',
            'hwdec-codecs': 'all',
            'gpu-api': 'auto',
          },
          observedProperties: OBSERVED_PROPERTIES,
        });

        mpvInitialized.current = true;

        // 监听属性变化
        await observeProperties(OBSERVED_PROPERTIES, ({ name, data }) => {
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
          }
        });

        // 加载视频
        await command('loadfile', [currentVideo.file_path, 'replace']);
        
        setLoading(false);
      } catch (err) {
        console.error('[Player] 初始化失败:', err);
        setError(String(err));
        setLoading(false);
      }
    };

    initMpv();

    return () => {
      if (mpvInitialized.current) {
        destroy().catch(console.error);
        mpvInitialized.current = false;
      }
    };
  }, [id]);

  // 播放/暂停
  const togglePlay = useCallback(async () => {
    try {
      await setProperty('pause', !isPlayingRef.current);
    } catch (err) {
      console.error('[Player] 切换播放状态失败:', err);
    }
  }, []);

  // 跳转
  const seek = useCallback(async (time: number) => {
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
      await getCurrentWindow().setFullscreen(newFullscreen);
      setIsFullscreen(newFullscreen);
    } catch (err) {
      console.error('[Player] 切换全屏失败:', err);
    }
  }, [isFullscreen]);

  // 切换置顶
  const togglePin = useCallback(async () => {
    try {
      const newPinned = !isPinned;
      await getCurrentWindow().setAlwaysOnTop(newPinned);
      setIsPinned(newPinned);
    } catch (err) {
      console.error('[Player] 切换置顶失败:', err);
    }
  }, [isPinned]);

  // 切换画中画
  const togglePiP = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      const newPiP = !isPiP;
      if (newPiP) {
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
        setIsPinned(true);
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
        setIsPinned(false);
      }
    } catch (err) {
      console.error('[Player] 切换画中画失败:', err);
    }
  }, [isPiP]);

  // 进度条鼠标悬浮
  const handleProgressBarHover = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || !duration) return;
    
    const rect = progressBarRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = x / rect.width;
    const time = percent * duration;
    
    setHoverTime(time);
    setHoverX(x);

    // 防抖生成预览帧
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
    }
    const seq = ++previewSeqRef.current;
    previewTimerRef.current = setTimeout(async () => {
      try {
        // 先跳转到目标时间
        await command('seek', [time, 'absolute']);
        // 等待帧渲染
        await new Promise(r => setTimeout(r, 200));
        // 检查是否还是最新的请求
        if (seq !== previewSeqRef.current) return;
        // 截图到临时文件
        const screenshotPath = `/tmp/changli_preview_${seq}.jpg`;
        await command('screenshot-to-file', [screenshotPath, 'window']);
        if (seq !== previewSeqRef.current) return;
        setThumbnailUrl(convertFileSrc(screenshotPath));
      } catch {
        // 截图失败时清空缩略图
        if (seq === previewSeqRef.current) {
          setThumbnailUrl(null);
        }
      }
    }, 300);
  }, [duration]);

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

  // 控制栏自动隐藏
  useEffect(() => {
    if (!isPlaying) {
      setShowControls(true);
      return;
    }

    if (controlsTimerRef.current) {
      clearTimeout(controlsTimerRef.current);
    }

    controlsTimerRef.current = setTimeout(() => {
      setShowControls(false);
    }, 3000);

    return () => {
      if (controlsTimerRef.current) {
        clearTimeout(controlsTimerRef.current);
      }
    };
  }, [isPlaying, currentTime]);

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
  const speedOptions = [1, 1.5, 2, 3, 5, 8, 10];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-black">
        <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-black">
        <div className="text-red-500 text-lg mb-4">{error}</div>
        <Link to="/library" className="text-blue-400 hover:text-blue-300">
          返回视频库
        </Link>
      </div>
    );
  }

  return (
    <div 
      className="relative w-full h-screen bg-black"
      onMouseMove={() => setShowControls(true)}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      {/* 视频容器 */}
      <div className="absolute inset-0" onClick={togglePlay}>
        {/* mpv 渲染区域 */}
      </div>

      {/* 控制栏 */}
      <div 
        className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* 进度条 */}
        <div 
          ref={progressBarRef}
          className="relative w-full h-1.5 bg-gray-600 rounded-full cursor-pointer group mb-4"
          onClick={handleProgressBarClick}
          onMouseMove={handleProgressBarHover}
          onMouseLeave={handleProgressBarLeave}
        >
          {/* 已播放进度 */}
          <div 
            className="absolute top-0 left-0 h-full bg-blue-500 rounded-full"
            style={{ width: `${(currentTime / duration) * 100}%` }}
          />
          
          {/* 拖拽点 */}
          <div 
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-blue-500 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ left: `${(currentTime / duration) * 100}%` }}
          />

          {/* 悬浮预览 */}
          {hoverTime !== null && (
            <div 
              className="absolute bottom-6 transform -translate-x-1/2 bg-gray-900 rounded-lg overflow-hidden shadow-lg"
              style={{ left: `${hoverX}px` }}
            >
              {thumbnailUrl ? (
                <img src={thumbnailUrl} alt="预览" className="w-32 h-18 object-cover" />
              ) : (
                <div className="w-32 h-18 bg-gray-800 flex items-center justify-center">
                  <span className="text-white text-xs">{formatTime(hoverTime)}</span>
                </div>
              )}
              <div className="text-white text-xs text-center py-1 bg-gray-900">
                {formatTime(hoverTime)}
              </div>
            </div>
          )}
        </div>

        {/* 控制按钮 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* 播放/暂停 */}
            <button 
              onClick={togglePlay}
              className="text-white hover:text-blue-400 transition-colors"
            >
              {isPlaying ? (
                <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              ) : (
                <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            {/* 时间显示 */}
            <span className="text-white text-sm">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center gap-4">
            {/* 音量控制 */}
            <div className="flex items-center gap-2">
              <button 
                onClick={() => changeVolume(volume === 0 ? 80 : 0)}
                className="text-white hover:text-blue-400 transition-colors"
              >
                {volume === 0 ? (
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                  </svg>
                )}
              </button>
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(e) => changeVolume(parseInt(e.target.value))}
                className="w-20 h-1 bg-gray-600 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full"
              />
            </div>

            {/* 倍速选择 */}
            <select
              value={speed}
              onChange={(e) => changeSpeed(parseFloat(e.target.value))}
              className="bg-gray-800 text-white text-sm px-2 py-1 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
            >
              {speedOptions.map((spd) => (
                <option key={spd} value={spd}>
                  {spd}x
                </option>
              ))}
            </select>

            {/* 画中画 */}
            <button 
              onClick={togglePiP}
              className={`text-white hover:text-blue-400 transition-colors ${isPiP ? 'text-blue-400' : ''}`}
              title="画中画"
            >
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z" />
              </svg>
            </button>

            {/* 置顶 */}
            <button 
              onClick={togglePin}
              className={`text-white hover:text-blue-400 transition-colors ${isPinned ? 'text-blue-400' : ''}`}
              title="置顶"
            >
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17 4v7l2 3v2h-6v5l-1 1-1-1v-5H5v-2l2-3V4c0-1.1.9-2 2-2h6c1.1 0 2 .9 2 2z" />
              </svg>
            </button>

            {/* 全屏 */}
            <button 
              onClick={toggleFullscreen}
              className="text-white hover:text-blue-400 transition-colors"
              title="全屏"
            >
              {isFullscreen ? (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 返回按钮 */}
      <div className={`absolute top-4 left-4 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
        <button 
          onClick={() => navigate(-1)}
          className="text-white hover:text-blue-400 transition-colors"
        >
          <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default Player;
