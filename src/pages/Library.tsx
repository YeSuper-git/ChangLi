import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getStandaloneVideosByTag,
  getVideoSeriesByTag,
  scanVideos,
  deleteVideo,
  deleteVideoSeries,
} from '../utils/api';
import type { Video, VideoSeries } from '../utils/api';
import { open } from '@tauri-apps/api/dialog';
import { SmartPoster, videoPosterDataUrl } from '../utils/media';
import { useSecondConfirm } from '../utils/useSecondConfirm';
import ScrollToTop from '../components/ScrollToTop';
import { useLibraryStore } from '../store/libraryStore';

const Library: React.FC = () => {
  const navigate = useNavigate();
  const { tags, videos: storeVideos, series: storeSeries, refreshVideos, refreshSeries, sortBy, sortOrder, setSortBy, toggleSortOrder } = useLibraryStore();
  const [scanning, setScanning] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTagId, setActiveTagId] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | 'series' | 'video'>('all');
  const [contextMenu, setContextMenu] = useState<{ type: 'video' | 'series'; id: number; name: string; x: number; y: number } | null>(null);
  const [tagFilteredVideos, setTagFilteredVideos] = useState<Video[] | null>(null);
  const [tagFilteredSeries, setTagFilteredSeries] = useState<VideoSeries[] | null>(null);
  const { pendingKey, requestSecondConfirm, clearPending } = useSecondConfirm();

  useEffect(() => {
    const closeMenu = () => {
      setContextMenu(null);
      clearPending();
    };
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  // 当 store 数据变化且当前无标签筛选时，清空 filtered 状态（避免 stale）
  useEffect(() => {
    if (activeTagId === null) {
      setTagFilteredVideos(null);
      setTagFilteredSeries(null);
    }
  }, [storeVideos, storeSeries, activeTagId]);

  const filterByTag = async (tagId: number | null) => {
    if (tagId === null) {
      setActiveTagId(null);
      setTagFilteredVideos(null);
      setTagFilteredSeries(null);
      return;
    }
    try {
      const [videosList, series] = await Promise.all([
        getStandaloneVideosByTag(tagId),
        getVideoSeriesByTag(tagId),
      ]);
      setTagFilteredVideos(videosList);
      setTagFilteredSeries(series);
      setActiveTagId(tagId);
    } catch (error) {
      console.error('[Library] 按标签筛选失败:', error);
    }
  };

  const videos: Video[] = tagFilteredVideos ?? storeVideos;
  const seriesList: VideoSeries[] = tagFilteredSeries ?? storeSeries;

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
          if (activeTagId !== null) {
            await filterByTag(activeTagId);
          }
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
      if (activeTagId !== null) {
        await filterByTag(activeTagId);
      }
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
      if (activeTagId !== null) {
        await filterByTag(activeTagId);
      }
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


  const handleTagClick = (tagId: number | null) => {
    filterByTag(tagId);
  };

  const normalizedSearch = searchTerm.toLowerCase();
  const filteredVideos = videos.filter((video) =>
    video.file_name.toLowerCase().includes(normalizedSearch)
  );
  const filteredSeries = seriesList.filter((series) =>
    series.title.toLowerCase().includes(normalizedSearch) ||
    (series.description || '').toLowerCase().includes(normalizedSearch)
  );

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

      <div className="flex items-center justify-between gap-4 p-4 bg-zinc-900 rounded-xl mb-10">
        {/* 左侧：标签 + 类型筛选 */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => handleTagClick(null)}
            className={`rounded-full px-5 py-1.5 text-sm transition-colors ${activeTagId === null ? 'bg-blue-600 text-white shadow-md' : 'bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700'}`}
          >
            全部
          </button>
          {tags.map((tag) => (
            <button
              key={tag.id}
              onClick={() => handleTagClick(tag.id)}
              className={`rounded-full px-5 py-1.5 text-sm transition-colors ${activeTagId === tag.id ? 'bg-blue-600 text-white shadow-md' : 'bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700'}`}
            >
              {tag.name}
            </button>
          ))}
          <span className="w-px h-5 bg-zinc-700 mx-1" />
          <button
            onClick={() => setTypeFilter('all')}
            className={`rounded-full px-5 py-1.5 text-sm transition-colors ${typeFilter === 'all' ? 'bg-blue-600 text-white shadow-md' : 'bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700'}`}
          >
            全部类型
          </button>
          <button
            onClick={() => setTypeFilter('series')}
            className={`rounded-full px-5 py-1.5 text-sm transition-colors ${typeFilter === 'series' ? 'bg-blue-600 text-white shadow-md' : 'bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700'}`}
          >
            视频集
          </button>
          <button
            onClick={() => setTypeFilter('video')}
            className={`rounded-full px-5 py-1.5 text-sm transition-colors ${typeFilter === 'video' ? 'bg-blue-600 text-white shadow-md' : 'bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700'}`}
          >
            单视频
          </button>
        </div>

        {/* 右侧：搜索框 + 排序 */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜索..."
              className="bg-zinc-800 border border-zinc-700 rounded-xl pl-10 pr-4 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 w-64 placeholder-zinc-500"
            />
          </div>
          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => { setSortBy(e.target.value as 'created_at' | 'title'); refreshVideos(); refreshSeries(); }}
              className="appearance-none bg-zinc-800 border border-zinc-700 rounded-lg pl-3 pr-8 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 w-40 hover:bg-zinc-700"
            >
              <option value="created_at">添加时间</option>
              <option value="title">名称</option>
            </select>
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-xs pointer-events-none">▼</span>
          </div>
          <button
            onClick={() => { toggleSortOrder(); refreshVideos(); refreshSeries(); }}
            className="p-1.5 bg-zinc-800 border border-zinc-700 rounded-lg hover:bg-zinc-700 text-white text-sm"
          >
            {sortOrder === 'desc' ? '↓' : '↑'}
          </button>
        </div>
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
                className="card cursor-pointer flex flex-col group"
              >
                <div className="relative w-full aspect-[2/3]">
                  <SmartPoster src={series.poster_data_url} alt={series.title} posterOrientation={series.poster_orientation} />
                  <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 via-black/40 to-transparent"></div>
                  <div className="absolute bottom-2 right-2 bg-black/60 rounded-md text-white text-xs px-2 py-0.5">
                    {series.status === 'completed' ? `全${series.video_count}话` : `更新至第${series.video_count}话`}
                  </div>
                </div>
                <div className="relative -mt-14 p-2 flex flex-col justify-end h-20">
                  <h3 className="font-medium text-white text-sm line-clamp-2 group-hover:text-blue-400">
                    {series.title}
                  </h3>
                  <div className="text-xs text-white/70 mt-1">
                    {series.last_watched_episode ? `看到第${series.last_watched_episode}话` : '尚未观看'}
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
              return (
                <div
                  key={video.id}
                  onClick={() => navigate(`/video/${video.id}`, { state: { from: '/library', backLabel: '返回视频' } })}
                  onContextMenu={(event) => openContextMenu(event, 'video', video.id, video.file_name)}
                  className="card cursor-pointer flex flex-col group"
                >
                  <div className="relative w-full aspect-video">
                    <SmartPoster
                      src={thumbnailDataUrl}
                      alt={video.file_name}
                      posterOrientation={video.poster_orientation}
                      width={video.width}
                      height={video.height}
                    />
                    <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 via-black/40 to-transparent"></div>
                    {video.duration && (
                      <div className="absolute bottom-2 right-2 bg-black/60 rounded-md text-white text-xs px-2 py-0.5">
                        {Math.floor(video.duration / 60)}分钟
                      </div>
                    )}
                  </div>
                  <div className="relative -mt-14 p-2 flex flex-col justify-end h-20">
                    <h3 className="font-medium text-white text-sm line-clamp-2 group-hover:text-blue-400">
                      {video.file_name}
                    </h3>
                    <div className="text-xs text-white/70 mt-1">
                      尚未观看
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
