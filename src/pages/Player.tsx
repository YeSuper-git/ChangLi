import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getVideos, getWatchProgress } from '../utils/api';
import type { Video } from '../utils/api';

const Player: React.FC = () => {
  const { id } = useParams<{ id: string }>();
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

  useEffect(() => {
    if (id) {
      loadVideo(parseInt(id));
    }
  }, [id]);

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

  const handlePlay = () => {
    setIsPlaying(!isPlaying);
  };

  const handleVolumeChange = (vol: number) => {
    setVolume(vol);
  };

  const handleSpeedChange = (spd: number) => {
    setSpeed(spd);
    setShowSpeedMenu(false);
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
    <div className="flex flex-col h-screen bg-black">
      {/* 视频区域 */}
      <div className="flex-1 flex items-center justify-center relative">
        <div className="text-6xl text-white/20">▶️</div>
        
        {/* 返回按钮 */}
        <div className="absolute top-4 left-4">
          <Link
            to="/library"
            className="flex items-center gap-2 px-4 py-2 bg-black/60 text-white rounded-lg hover:bg-black/80 transition-colors"
          >
            <span>←</span>
            <span>返回</span>
          </Link>
        </div>

        {/* 视频信息 */}
        <div className="absolute top-4 right-4 text-white text-right">
          <h2 className="text-lg font-semibold">{video.file_name}</h2>
          <div className="text-sm text-gray-300">
            {video.resolution && <span>{video.resolution}</span>}
            {video.duration && <span className="ml-2">{formatTime(video.duration)}</span>}
          </div>
        </div>
      </div>

      {/* 控制栏 */}
      <div className="bg-gradient-to-t from-black/90 to-transparent p-6">
        {/* 进度条 */}
        <div className="mb-4">
          <div className="flex items-center gap-4">
            <span className="text-white text-sm w-16">{formatTime(currentTime)}</span>
            <div className="flex-1 h-2 bg-white/20 rounded-full cursor-pointer relative">
              <div
                className="absolute top-0 left-0 h-full bg-blue-500 rounded-full"
                style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg"
                style={{ left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
              />
            </div>
            <span className="text-white text-sm w-16">{formatTime(duration)}</span>
          </div>
        </div>

        {/* 控制按钮 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* 上一集 */}
            <button className="text-white hover:text-blue-400 transition-colors">
              ⏮
            </button>
            
            {/* 播放/暂停 */}
            <button
              onClick={handlePlay}
              className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center hover:bg-white/30 transition-colors"
            >
              {isPlaying ? '⏸' : '▶️'}
            </button>
            
            {/* 下一集 */}
            <button className="text-white hover:text-blue-400 transition-colors">
              ⏭
            </button>
            
            {/* 音量 */}
            <div className="flex items-center gap-2">
              <button className="text-white hover:text-blue-400 transition-colors">
                {volume === 0 ? '🔇' : volume < 50 ? '🔉' : '🔊'}
              </button>
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(e) => handleVolumeChange(parseInt(e.target.value))}
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
            
            {/* 字幕 */}
            <button className="text-white hover:text-blue-400 transition-colors">
              CC
            </button>
            
            {/* 画面比例 */}
            <button className="text-white hover:text-blue-400 transition-colors">
              ⬜
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
