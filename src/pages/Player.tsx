import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getVideos, getWatchProgress, updateWatchProgress, playVideo } from '../utils/api';
import type { Video } from '../utils/api';
import { convertFileSrc } from '@tauri-apps/api/tauri';

const Player: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const systemPlayerOpenedRef = useRef(false);
  const [video, setVideo] = useState<Video | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(100);
  const [speed, setSpeed] = useState(1);
  const [showEpisodeList, setShowEpisodeList] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [videoSrc, setVideoSrc] = useState<string>('');
  const [playError, setPlayError] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      loadVideo(parseInt(id));
    }
  }, [id]);

  useEffect(() => {
    if (video) {
      // 将本地文件绝对路径转换为 Tauri asset URL，video 元素才能读取本地文件。
      const src = convertFileSrc(video.file_path);
      console.log('[Player] video.file_path:', video.file_path, 'videoSrc:', src);
      setVideoSrc(src);
      setPlayError(null);
      systemPlayerOpenedRef.current = false;
    }
  }, [video]);

  const loadVideo = async (videoId: number) => {
    try {
      const videosList = await getVideos();
      setVideos(videosList);
      
      const currentVideo = videosList.find(v => v.id === videoId);
      setVideo(currentVideo || null);
      
      if (currentVideo) {
        // 加载观看进度
        const progress = await getWatchProgress(videoId, 1);
        if (progress) {
          setCurrentTime(progress.position);
          setDuration(progress.duration);
        }
      }
    } catch (error) {
      console.error('加载视频失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePlay = async () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        await videoRef.current.play().catch(async (error) => {
          console.error('视频播放失败:', error);
          await openSystemPlayerFallback('内置播放器暂不可用，已切换为 Windows 11 系统播放器模式打开。');
          throw error;
        });
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      // 恢复播放进度
      if (currentTime > 0) {
        videoRef.current.currentTime = currentTime;
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseInt(e.target.value);
    setVolume(vol);
    if (videoRef.current) {
      videoRef.current.volume = vol / 100;
    }
  };

  const handleSpeedChange = (spd: number) => {
    setSpeed(spd);
    if (videoRef.current) {
      videoRef.current.playbackRate = spd;
    }
    setShowSpeedMenu(false);
  };

  const handleEnded = async () => {
    setIsPlaying(false);
    // 保存播放进度
    if (video && duration > 0) {
      try {
        await updateWatchProgress(video.id, 1, duration, duration);
      } catch (error) {
        console.error('保存播放进度失败:', error);
      }
    }
  };

  const handlePause = async () => {
    // 保存播放进度
    if (video && currentTime > 0) {
      try {
        await updateWatchProgress(video.id, 1, currentTime, duration);
      } catch (error) {
        console.error('保存播放进度失败:', error);
      }
    }
  };

  const openSystemPlayerFallback = async (message: string) => {
    if (!video || systemPlayerOpenedRef.current) return;
    systemPlayerOpenedRef.current = true;
    setPlayError(message);
    try {
      await playVideo(video.id);
    } catch (error) {
      console.error('打开系统播放器失败:', error);
      setPlayError('系统播放器打开失败，请确认视频文件仍存在。');
      systemPlayerOpenedRef.current = false;
    }
  };

  const handleOpenSystemPlayer = async () => {
    await openSystemPlayerFallback('已使用系统播放器打开视频。');
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-black">
        <div className="text-white">加载中...</div>
      </div>
    );
  }

  if (!video) {
    return (
      <div className="flex items-center justify-center h-full bg-black">
        <div className="text-white">视频不存在</div>
      </div>
    );
  }

  return (
    <div className="relative bg-black" style={{ minHeight: 'calc(100vh - 160px)' }}>
      {/* 视频播放器 */}
      <video
        ref={videoRef}
        src={videoSrc}
        className="w-full object-contain bg-black"
        style={{ minHeight: 'calc(100vh - 160px)', maxHeight: 'calc(100vh - 160px)' }}
        controls
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onPause={() => {
          setIsPlaying(false);
          handlePause();
        }}
        onClick={handlePlay}
        onPlay={() => setIsPlaying(true)}
        onError={(event) => {
          console.error('视频元素加载失败:', event.currentTarget.error, 'src:', videoSrc);
          openSystemPlayerFallback('内置播放器无法直接加载该文件，已切换为 Windows 11 系统播放器模式打开。');
        }}
      />

      {playError && (
        <div className="absolute top-20 left-4 right-4 rounded-xl bg-red-500/90 text-white px-4 py-3 text-sm">
          {playError}
        </div>
      )}

      {/* 控制栏 */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
        {/* 进度条 */}
        <div className="mb-4">
          <input
            type="range"
            min="0"
            max={duration || 100}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        {/* 控制按钮 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* 播放/暂停 */}
            <button
              onClick={handlePlay}
              className="text-white text-2xl hover:text-blue-400 transition-colors"
            >
              {isPlaying ? '⏸' : '▶️'}
            </button>
            
            {/* 时间显示 */}
            <span className="text-white text-sm">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
            
            {/* 音量 */}
            <div className="flex items-center gap-2">
              <span className="text-white text-sm">🔊</span>
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={handleVolumeChange}
                className="w-20"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* 倍速 */}
            <div className="relative">
              <button
                onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                className="text-white hover:text-blue-400 transition-colors"
              >
                {speed}x
              </button>
              {showSpeedMenu && (
                <div className="absolute bottom-full right-0 mb-2 bg-black/90 rounded-lg p-2">
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((spd) => (
                    <button
                      key={spd}
                      onClick={() => handleSpeedChange(spd)}
                      className={`block w-full px-4 py-2 text-left rounded ${
                        speed === spd ? 'bg-blue-500' : 'hover:bg-white/10'
                      } text-white`}
                    >
                      {spd}x
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            {/* 系统播放器 */}
            <button
              onClick={handleOpenSystemPlayer}
              className="text-white hover:text-blue-400 transition-colors"
              title="使用系统播放器打开"
            >
              📺
            </button>
            
            {/* 选集列表 */}
            <button
              onClick={() => setShowEpisodeList(!showEpisodeList)}
              className="text-white hover:text-blue-400 transition-colors"
            >
              📋
            </button>
            
            {/* 全屏 */}
            <button className="text-white hover:text-blue-400 transition-colors">
              ⛶
            </button>
          </div>
        </div>
      </div>

      {/* 视频信息 */}
      <div className="absolute top-4 left-4">
        <h2 className="text-white text-lg font-semibold">{video.file_name}</h2>
        <div className="flex gap-2 text-gray-300 text-sm mt-1">
          {video.resolution && <span>{video.resolution}</span>}
          {video.file_size && <span>{(video.file_size / 1024 / 1024 / 1024).toFixed(1)} GB</span>}
        </div>
      </div>

      {/* 选集列表 */}
      {showEpisodeList && (
        <div className="absolute right-0 top-0 bottom-0 w-80 bg-black/95 overflow-y-auto">
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold">选集</h3>
              <button
                onClick={() => setShowEpisodeList(false)}
                className="text-white hover:text-blue-400"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2">
              {videos.map((v, index) => (
                <Link
                  key={v.id}
                  to={`/player/${v.id}`}
                  className={`block p-3 rounded-lg ${
                    v.id === video.id
                      ? 'bg-blue-500'
                      : 'bg-white/10 hover:bg-white/20'
                  } transition-colors`}
                >
                  <div className="text-white font-medium">第 {index + 1} 集</div>
                  <div className="text-gray-300 text-sm">{v.file_name}</div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Player;
