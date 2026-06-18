import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getStandaloneVideosByTag,
  getVideoSeriesByTag,
  getSeriesPlaybackVideo,
  scanVideos,
  deleteVideo,
  deleteVideoSeries,
  playVideo,
} from '../utils/api';
import type { Video, VideoSeries } from '../utils/api';
import { open } from '@tauri-apps/api/dialog';
import { SmartPoster, videoPosterDataUrl } from '../utils/media';
import { useSecondConfirm } from '../utils/useSecondConfirm';
import ScrollToTop from '../components/ScrollToTop';
import { useLibraryStore } from '../store/libraryStore';

const Library: React.FC = () => {
  const navigate = useNavigate();
  const { tags, videos: storeVideos, series: storeSeries, refreshVideos, refreshSeries } = useLibraryStore();
  const [videos, setVideos] = useState<Video[]>([]);
  const [seriesList, setSeriesList] = useState<VideoSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTagId, setActiveTagId] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | 'series' | 'video'>('all');
  const [contextMenu, setContextMenu] = useState<{ type: 'video' | 'series'; id: number; name: string; x: number; y: number } | null>(null);
  const { pendingKey, requestSecondConfirm, clearPending } = useSecondConfirm();

  useEffect(() => {
    loadLibrary(null);
  }, []);

  useEffect(() => {
    const closeMenu = () => {
      setContextMenu(null);
      clearPending();
    };
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  const loadLibrary = async (tagId: number | null = activeTagId) => {
    try {
      if (tagId) {
        const [videosList, series] = await Promise.all([
          getStandaloneVideosByTag(tagId),
          getVideoSeriesByTag(tagId),
        ]);
        setVideos(videosList);
        setSeriesList(series);
      } else {
        setVideos(storeVideos);
        setSeriesList(storeSeries);
      }
      setActiveTagId(tagId);
    } catch (error) {
      console.error('[Library] 加载视频失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const importPath = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择要添加的视频文件夹',
      });

      if (selected) {
        setScanning(true);
        try {
          await scanVideos(selected as string);
          await refreshVideos();
          await refreshSeries();
          await loadLibrary(activeTagId);
        } catch (error) {
          console.error('[Library] 导入失败:', error);
          alert('导入失败: ' + String(error));
        } finally {
          setScanning(false);
        }
      }
    } catch (error) {
      console.error('[Library] 打开选择器失败:', error);
    }
  };

  const handleDeleteVideo = async (id: number) => {
    try {
      await deleteVideo(id);
      setContextMenu(null);
      await refreshVideos();
      await loadLibrary(activeTagId);
    } catch (error) {
      console.error('[Library] 删除失败:', error);
      alert('删除失败: ' + String(error));
    }
  };

  const handleDeleteSeries = async (id: number) => {
    try {
      await deleteVideoSeries(id, true);
      setContextMenu(null);
      await refreshVideos();
      await refreshSeries();
      await loadLibrary(activeTagId);
    } catch (error) {
      console.error('[Library] 删除视频集失败:', error);
      alert('删除视频集失败: ' + String(error));
    }
  };

  const openContextMenu = (event: React.MouseEvent, type: 'video' | 'series', id: number, name: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ type, id, name, x: event.clientX, y: event.clientY });
  };

  const handleEditContextItem = () => {
    if (!contextMenu) return;
    const target = contextMenu.type === 'video'
      ? `/video/${contextMenu.id}?edit=1`
      : `/series/${contextMenu.id}?edit=1`;
    setContextMenu(null);
    clearPending();
    navigate(target, { state: { from: '/library', backLabel: '返回视频' } });
  };

  const handlePlayVideo = async (id: number, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await playVideo(id);
    } catch (error) {
      console.error('[Library] 播放失败:', error);
      alert('播放失败: ' + String(error));
    }
  };

  const handlePlaySeries = async (seriesId: number, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      const targetVideo = await getSeriesPlaybackVideo(seriesId);
      if (!targetVideo) {
        alert('这个视频集里还没有可播放的视频');
        return;
      }
      await playVideo(targetVideo.id);
    } catch (error) {
      console.error('[Library] 播放视频集失败:', error);
      alert('播放视频集失败: ' + String(error));
    }
  };

  const handleTagClick = (tagId: number | null) => {
    setLoading(true);
    loadLibrary(tagId);
  };

  const normalizedSearch = searchTerm.toLowerCase();
  const filteredVideos = videos.filter((video) =>
    video.file_name.toLowerCase().includes(normalizedSearch)
  );
  const filteredSeries = seriesList.filter((series) =>
    series.title.toLowerCase().includes(normalizedSearch) ||
    (series.description || '').toLowerCase().includes(normalizedSearch)
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  return (
    <>
    <div>
      <div className="flex items-center justify-between mb-10">
        <h1 className="text-3xl font-bold">视频</h1>
        <div className="flex gap-3">
          <button
            onClick={importPath}
            disabled={scanning}
            className="px-6 py-3 bg-gray-900 text-white rounded-xl font-medium hover:bg-gray-800 disabled:opacity-50"
          >
            {scanning ? '添加中...' : '添加'}
          </button>
        </div>
      </div>

      <div className="mb-6 flex gap-3 flex-wrap">
        <button onClick={() => handleTagClick(null)} className={`category-btn ${activeTagId === null ? 'active' : ''}`}>全部</button>
        {tags.map((tag) => (
          <button
            key={tag.id}
            onClick={() => handleTagClick(tag.id)}
            className={`category-btn ${activeTagId === tag.id ? 'active' : ''}`}
          >
            {tag.name}
          </button>
        ))}
      </div>

      <div className="mb-6 flex gap-3 flex-wrap">
        <button onClick={() => setTypeFilter('all')} className={`category-btn ${typeFilter === 'all' ? 'active' : ''}`}>全部</button>
        <button onClick={() => setTypeFilter('series')} className={`category-btn ${typeFilter === 'series' ? 'active' : ''}`}>视频集</button>
        <button onClick={() => setTypeFilter('video')} className={`category-btn ${typeFilter === 'video' ? 'active' : ''}`}>单视频</button>
      </div>

      <div className="mb-10">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="搜索视频或视频集..."
          className="search-input"
        />
      </div>

      {typeFilter !== 'video' && filteredSeries.length > 0 && (
        <div className="mb-12">
          <h2 className="text-xl font-semibold mb-4">视频集</h2>
          <div className="grid grid-cols-4 md:grid-cols-5 gap-5 auto-rows-max">
            {filteredSeries.map((series) => (
              <div
                key={series.id}
                onClick={() => navigate(`/series/${series.id}`, { state: { from: '/library', backLabel: '返回视频' } })}
                onContextMenu={(event) => openContextMenu(event, 'series', series.id, series.title)}
                className="card block cursor-pointer"
              >
                <div className={`${series.poster_orientation === 'portrait' ? 'aspect-[2/3]' : 'aspect-video'} bg-gradient-to-br from-gray-100 to-gray-200 relative overflow-hidden`}>
                  <SmartPoster src={series.poster_data_url} alt={series.title} posterOrientation={series.poster_orientation} />
                  <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-full">
                    {series.status === 'completed' ? `${series.video_count}集全` : `更新至${series.video_count}集`}
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="font-semibold text-gray-900 text-sm mb-2 line-clamp-2 hover:text-blue-600">
                    {series.title}
                  </h3>
                  {series.description && <p className="text-xs text-gray-500 line-clamp-2 mb-3">{series.description}</p>}
                  <div className="flex gap-2">
                    <button onClick={(event) => handlePlaySeries(series.id, event)} className="flex-1 action-btn action-btn-primary text-center">播放</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {typeFilter !== 'series' && filteredVideos.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">单视频</h2>
          <div className="grid grid-cols-4 md:grid-cols-5 gap-5 auto-rows-max">
            {filteredVideos.map((video) => {
              const thumbnailDataUrl = videoPosterDataUrl(video);
              const isPortrait = video.poster_orientation === 'portrait';
              return (
                <div
                  key={video.id}
                  onClick={() => navigate(`/video/${video.id}`, { state: { from: '/library', backLabel: '返回视频' } })}
                  onContextMenu={(event) => openContextMenu(event, 'video', video.id, video.file_name)}
                  className="card cursor-pointer"
                >
                  <div className={`${isPortrait ? 'aspect-[2/3]' : 'aspect-video'} bg-gradient-to-br from-gray-100 to-gray-200 relative overflow-hidden`}>
                    <SmartPoster
                      src={thumbnailDataUrl}
                      alt={video.file_name}
                      width={video.width}
                      height={video.height}
                    />
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold text-gray-900 text-sm mb-2 line-clamp-2 hover:text-blue-600">
                      {video.file_name}
                    </h3>
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
                      <span>{video.file_size ? `${(video.file_size / 1024 / 1024 / 1024).toFixed(1)} GB` : ''}</span>
                      <span>{video.resolution || ''}</span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={(event) => handlePlayVideo(video.id, event)} className="flex-1 action-btn action-btn-primary text-center">播放</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {filteredSeries.length === 0 && filteredVideos.length === 0 && (
        <div className="text-center py-16">
          <p className="text-gray-500 text-lg mb-4">{searchTerm ? '没有找到匹配的视频' : '暂无视频'}</p>
          {!searchTerm && <p className="text-gray-400 text-sm">点击"添加"选择文件夹添加视频</p>}
        </div>
      )}

      {contextMenu && (
        <div
          className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-xl py-2 min-w-40"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            onClick={handleEditContextItem}
          >
            编辑
          </button>
          <button
            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
            onClick={() => {
              const key = `${contextMenu.type}-${contextMenu.id}`;
              requestSecondConfirm(key, () => contextMenu.type === 'video'
                ? handleDeleteVideo(contextMenu.id)
                : handleDeleteSeries(contextMenu.id));
            }}
          >
            {pendingKey === `${contextMenu.type}-${contextMenu.id}` ? '再次点击确认删除' : '删除'}
          </button>
        </div>
      )}
    </div>

    <ScrollToTop />
    </>
  );
};

export default Library;
