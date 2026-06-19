import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  const [searchParams] = useSearchParams();
  const { tags, videos: storeVideos, series: storeSeries, favorites, refreshVideos, refreshSeries, sortBy, sortOrder, setSortBy, toggleSortOrder } = useLibraryStore();
  const [scanning, setScanning] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTagId, setActiveTagId] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | 'series' | 'video'>('all');
  const [favoriteFilter, setFavoriteFilter] = useState(() => searchParams.get('favorite') === '1');
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

  const favoriteIds = React.useMemo(() => {
    const set = new Set<string>();
    for (const item of favorites) {
      if ('video_count' in item) set.add(`s-${(item as VideoSeries).id}`);
      else set.add(`v-${(item as Video).id}`);
    }
    return set;
  }, [favorites]);

  const normalizedSearch = searchTerm.toLowerCase();
  const filteredVideos = videos.filter((video) =>
    video.file_name.toLowerCase().includes(normalizedSearch) && (!favoriteFilter || favoriteIds.has(`v-${video.id}`))
  );
  const filteredSeries = seriesList.filter((series) =>
    (series.title.toLowerCase().includes(normalizedSearch) ||
    (series.description || '').toLowerCase().includes(normalizedSearch)) && (!favoriteFilter || favoriteIds.has(`s-${series.id}`))
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

      <div className="mb-6 flex justify-between items-center">
        <div className="flex gap-3 flex-wrap">
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
        <div className="flex items-center gap-2">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'created_at' | 'title')}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="created_at">添加时间</option>
            <option value="title">名称</option>
          </select>
          <button
            onClick={() => toggleSortOrder()}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 focus:outline-none"
          >
            {sortOrder === 'desc' ? '↓' : '↑'}
          </button>
        </div>
      </div>

      <div className="mb-6 flex gap-3 flex-wrap">
        <button onClick={() => setTypeFilter('all')} className={`category-btn ${typeFilter === 'all' ? 'active' : ''}`}>全部</button>
        <button onClick={() => setTypeFilter('series')} className={`category-btn ${typeFilter === 'series' ? 'active' : ''}`}>视频集</button>
        <button onClick={() => setTypeFilter('video')} className={`category-btn ${typeFilter === 'video' ? 'active' : ''}`}>单视频</button>
        <button onClick={() => setFavoriteFilter(!favoriteFilter)} className={`category-btn ${favoriteFilter ? 'active' : ''}`}>已追番</button>
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
                className="cursor-pointer group"
              >
                <div className="card relative w-full aspect-[3/4] overflow-hidden">
                  <SmartPoster src={series.poster_data_url} alt={series.title} posterOrientation={series.poster_orientation} />
                  <div className="absolute bottom-2 right-2 text-white text-xs drop-shadow-lg">
                    {series.status === 'completed' ? `全${series.video_count}话` : `更新至第${series.video_count}话`}
                  </div>
                </div>
                <div className="mt-2">
                  <h3 className="text-sm font-medium text-zinc-900 truncate group-hover:text-blue-600" title={series.title}>
                    {series.title}
                  </h3>
                  <div className="text-xs text-zinc-500 mt-0.5">
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
                  <div className="relative w-full aspect-video overflow-hidden">
                    <SmartPoster
                      src={thumbnailDataUrl}
                      alt={video.file_name}
                      posterOrientation={video.poster_orientation}
                      width={video.width}
                      height={video.height}
                    />
                    {video.duration && (
                      <div className="absolute bottom-2 right-2 text-white text-xs drop-shadow-lg">
                        {Math.floor(video.duration / 60)}分钟
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <h3 className="text-sm font-medium text-zinc-900 line-clamp-2 group-hover:text-blue-600">
                      {video.file_name}
                    </h3>
                    <div className="text-xs text-zinc-500 mt-1">
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
