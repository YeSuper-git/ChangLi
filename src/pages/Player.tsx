import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getVideo, playVideo } from '../utils/api';
import type { Video } from '../utils/api';

interface PlayerProps {
  embeddedWindow?: boolean;
}

const Player: React.FC<PlayerProps> = ({ embeddedWindow = false }) => {
  const { id } = useParams<{ id: string }>();
  const isPlayerWindow = embeddedWindow || getCurrentWindow().label === 'player';
  const [video, setVideo] = useState<Video | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [launching, setLaunching] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (id) {
      loadAndPlay(parseInt(id));
    }
  }, [id]);

  useEffect(() => {
    if (!isPlayerWindow) return;

    document.documentElement.classList.add('player-window-document');
    document.body.classList.add('player-window-document');
    const root = document.getElementById('root');
    root?.classList.add('player-window-document');

    const handleKeyDown = async (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        await getCurrentWindow().setFullscreen(false);
        setFullscreen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.documentElement.classList.remove('player-window-document');
      document.body.classList.remove('player-window-document');
      root?.classList.remove('player-window-document');
    };
  }, [isPlayerWindow]);

  const loadAndPlay = async (videoId: number) => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const currentVideo = await getVideo(videoId);
      setVideo(currentVideo);
      if (currentVideo) {
        await launchMpv(currentVideo.id, true);
      }
    } catch (err) {
      console.error('[Player] 加载或启动 mpv 失败:', err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const launchMpv = async (videoId: number, initial = false) => {
    setLaunching(true);
    setError('');
    try {
      await playVideo(videoId);
      setMessage(initial ? '已在独立播放窗口打开视频。' : '已复用独立播放窗口播放。');
    } catch (err) {
      console.error('[Player] 启动 mpv 失败:', err);
      setError(String(err));
    } finally {
      setLaunching(false);
    }
  };

  const toggleFullscreen = async () => {
    if (!isPlayerWindow) return;
    const next = !fullscreen;
    await getCurrentWindow().setFullscreen(next);
    setFullscreen(next);
  };

  if (isPlayerWindow) {
    return <div className="player-window-root player-window-embedded" onDoubleClick={toggleFullscreen} />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">正在准备独立播放窗口...</div>
      </div>
    );
  }

  if (!video) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500 text-lg mb-4">视频不存在</p>
        <Link to="/library" className="text-blue-500 hover:text-blue-600">返回视频</Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-16">
      <div className="card p-8 text-center">
        <div className="text-6xl mb-6">▶️</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">{video.file_name}</h1>
        <p className="text-gray-500 mb-8">
          ChangLi 会复用同一个无边框独立播放窗口，并通过 mpv 渲染本地视频。
        </p>

        {message && (
          <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {message}
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 text-left">
            <div className="font-medium mb-1">mpv 启动失败</div>
            <div>{error}</div>
          </div>
        )}

        <div className="flex justify-center gap-4">
          <button
            onClick={() => launchMpv(video.id)}
            disabled={launching}
            className="px-6 py-3 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 disabled:opacity-60"
          >
            {launching ? '启动中...' : '重新打开播放窗口'}
          </button>
          <Link
            to={`/video/${video.id}`}
            className="px-6 py-3 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200"
          >
            返回详情
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Player;
