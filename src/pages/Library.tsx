import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  getVideoSeriesByTag,
  getVideoSeriesByActor,
  scanVideos,
  deleteVideoSeries,
  rescanSingleSeriesMetadata,
  switchSeriesType,
} from '../utils/api';
import type { VideoSeries } from '../utils/api';
import { open } from '@tauri-apps/api/dialog';
import { SmartPoster } from '../utils/media';
import { useSecondConfirm } from '../utils/useSecondConfirm';
import FloatingActions from '../components/FloatingActions';
import { useLibraryStore } from '../store/libraryStore';

const Library: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { tags, actors, series: storeSeries, favorites, watchedIds, refreshSeries, sortBy, sortOrder, setSortBy, toggleSortOrder } = useLibraryStore();
  const [scanning, setScanning] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeTagId, setActiveTagId] = useState<number | null>(() => {
    const t = searchParams.get('tag');
    return t ? parseInt(t) : null;
  });
  const [typeFilter, setTypeFilter] = useState<'all' | 'series' | 'video'>(() => {
    return (searchParams.get('type') as 'all' | 'series' | 'video') || 'all';
  });
  const [favoriteFilter, setFavoriteFilter] = useState(() => searchParams.get('favorite') === '1');
  const [watchedFilter, setWatchedFilter] = useState(() => searchParams.get('watched') === '1');
  const [chineseSubFilter, setChineseSubFilter] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ type: 'series'; id: number; name: string; x: number; y: number } | null>(null);
  const [tagFilteredSeries, setTagFilteredSeries] = useState<VideoSeries[] | null>(null);
  const [activeActorId, setActiveActorId] = useState<number | null>(() => {
    const a = searchParams.get('actor');
    return a ? parseInt(a) : null;
  });
  const [actorFilteredSeries, setActorFilteredSeries] = useState<VideoSeries[] | null>(null);
  const { pendingKey, requestSecondConfirm, clearPending } = useSecondConfirm();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' } | null>(null);

  // Toast 自动消失
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // 同步筛选状态到 URL 参数
  const syncParams = useCallback((updates: Record<string, string | null>) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '' || value === 'all') {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 监听筛选状态变化，同步到 URL
  useEffect(() => {
    syncParams({
      tag: activeTagId !== null ? String(activeTagId) : null,
      actor: activeActorId !== null ? String(activeActorId) : null,
      type: typeFilter !== 'all' ? typeFilter : null,
      favorite: favoriteFilter ? '1' : null,
      watched: watchedFilter ? '1' : null,
    });
  }, [activeTagId, activeActorId, typeFilter, favoriteFilter, watchedFilter, syncParams]);

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
      setTagFilteredSeries(null);
    }
    if (activeActorId === null) {
      setActorFilteredSeries(null);
    }
  }, [storeSeries, activeTagId, activeActorId]);

  // 恢复标签筛选
  useEffect(() => {
    if (activeTagId !== null && tagFilteredSeries === null) {
      filterByTag(activeTagId);
    }
  }, [activeTagId]);

  // 恢复演员筛选
  useEffect(() => {
    if (activeActorId !== null && actorFilteredSeries === null) {
      filterByActor(activeActorId);
    }
  }, [activeActorId]);

  const filterByTag = async (tagId: number | null) => {
    if (tagId === null) {
      setActiveTagId(null);
      setTagFilteredSeries(null);
      return;
    }
    try {
      const series = await getVideoSeriesByTag(tagId);
      setTagFilteredSeries(series);
      setActiveTagId(tagId);
    } catch (error) {
      console.error('[Library] 按标签筛选失败:', error);
    }
  };

  const filterByActor = async (actorId: number | null) => {
    if (actorId === null) {
      setActiveActorId(null);
      setActorFilteredSeries(null);
      return;
    }
    try {
      const series = await getVideoSeriesByActor(actorId);
      setActorFilteredSeries(series);
      setActiveActorId(actorId);
    } catch (error) {
      console.error('[Library] 按演员筛选失败:', error);
    }
  };

  const handleActorClick = (actorId: number) => {
    filterByActor(activeActorId === actorId ? null : actorId);
  };

  const seriesList: VideoSeries[] = actorFilteredSeries ?? tagFilteredSeries ?? storeSeries;

  // 构建当前筛选状态的 URL 参数字符串
  const buildFilterSearch = () => {
    const params = new URLSearchParams();
    if (activeTagId !== null) params.set('tag', String(activeTagId));
    if (activeActorId !== null) params.set('actor', String(activeActorId));
    if (typeFilter !== 'all') params.set('type', typeFilter);
    if (favoriteFilter) params.set('favorite', '1');
    if (watchedFilter) params.set('watched', '1');
    const qs = params.toString();
    return qs ? `?${qs}` : '';
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
          const result = await scanVideos(selected as string);
          await refreshSeries();
          if (activeTagId !== null) {
            await filterByTag(activeTagId);
          }
          if (activeActorId !== null) {
            await filterByActor(activeActorId);
          }
          // 显示导入结果
          const { added, updated } = result;
          if (added > 0 && updated > 0) {
            setToast({ message: `添加成功，本次添加了 ${added} 部作品，更新了 ${updated} 部已有作品`, type: 'success' });
          } else if (added > 0) {
            setToast({ message: `添加成功，本次添加了 ${added} 部作品`, type: 'success' });
          } else if (updated > 0) {
            setToast({ message: `更新了 ${updated} 部已有作品`, type: 'info' });
          } else {
            setToast({ message: '未发现新作品', type: 'info' });
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


  const handleDeleteSeries = async (id: number) => {
    try {
      await deleteVideoSeries(id, true);
      setContextMenu(null);
      await refreshSeries();
      if (activeTagId !== null) {
        await filterByTag(activeTagId);
      }
      if (activeActorId !== null) {
        await filterByActor(activeActorId);
      }
    } catch (error) {
      console.error('[Library] 删除视频集失败:', error);
      alert('删除视频集失败: ' + String(error));
    }
  };

  const openContextMenu = (event: React.MouseEvent, type: 'series', id: number, name: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ type, id, name, x: event.clientX, y: event.clientY });
  };

  const handleEditContextItem = () => {
    if (!contextMenu) return;
    const filterSearch = buildFilterSearch();
    const target = `/series/${contextMenu.id}?edit=1`;
    setContextMenu(null);
    clearPending();
    navigate(target, { state: { from: '/library', backLabel: '返回视频', filterSearch } });
  };

  const handleRescanMetadata = async (seriesId: number) => {
    try {
      const matched = await rescanSingleSeriesMetadata(seriesId);
      setContextMenu(null);
      clearPending();
      await refreshSeries();
      if (activeTagId !== null) await filterByTag(activeTagId);
      if (activeActorId !== null) await filterByActor(activeActorId);
      setToast({ message: matched ? '元数据更新成功' : '未匹配到成人格式，未更新', type: matched ? 'success' : 'info' });
    } catch (error) {
      console.error('[Library] 重新扫描元数据失败:', error);
      setToast({ message: '重新扫描失败: ' + String(error), type: 'info' });
    }
  };

  const handleSwitchType = async (seriesId: number) => {
    try {
      await switchSeriesType(seriesId);
      setContextMenu(null);
      clearPending();
      await refreshSeries();
      setToast({ message: '类型已切换', type: 'success' });
    } catch (error) {
      console.error('[Library] 切换类型失败:', error);
      setToast({ message: '切换类型失败: ' + String(error), type: 'info' });
    }
  };

  const handleTagClick = (tagId: number | null) => {
    filterByTag(tagId);
  };

  const favoriteIds = React.useMemo(() => {
    const set = new Set<string>();
    for (const item of favorites) {
      if ('video_count' in item) set.add(`s-${(item as VideoSeries).id}`);
    }
    return set;
  }, [favorites]);

  const normalizedSearch = searchTerm.toLowerCase();
  const isAdult = (series: VideoSeries) => series.has_actor || series.display_type === 'adult';
  const filteredSeries = seriesList.filter((series) =>
    (series.title.toLowerCase().includes(normalizedSearch) ||
    (series.description || '').toLowerCase().includes(normalizedSearch)) && (!favoriteFilter || favoriteIds.has(`s-${series.id}`)) && (!watchedFilter || watchedIds.has(series.id)) && (!chineseSubFilter || series.has_chinese_sub === 1) && (typeFilter === 'all' || (typeFilter === 'series' && !isAdult(series)) || (typeFilter === 'video' && isAdult(series)))
  );

  const animeSeries = filteredSeries.filter(s => !isAdult(s));
  const adultSeries = filteredSeries.filter(s => isAdult(s));

  const toggleSelect = (key: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => {
    const allKeys = new Set<string>();
    filteredSeries.forEach(s => allKeys.add(`s-${s.id}`));
    setSelectedIds(allKeys);
  };

  const deselectAll = () => setSelectedIds(new Set());

  const handleBatchDelete = async () => {
    if (!confirm(`确定删除选中的 ${selectedIds.size} 个项目？`)) return;
    for (const key of selectedIds) {
      const [type, idStr] = key.split('-');
      const id = parseInt(idStr);
      if (type === 's') {
        await deleteVideoSeries(id, true);
      }
    }
    setSelectedIds(new Set());
    setSelectMode(false);
    await refreshSeries();
    if (activeTagId !== null) {
      await filterByTag(activeTagId);
    }
    if (activeActorId !== null) {
      await filterByActor(activeActorId);
    }
  };

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

      {actors.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-3">
          {actors.map((actor) => (
            <button
              key={actor.id}
              onClick={() => handleActorClick(actor.id)}
              className={`category-btn ${activeActorId === actor.id ? 'active' : ''}`}
            >
              {actor.name}
            </button>
          ))}
        </div>
      )}

      <div className="mb-6 flex gap-3 flex-wrap">
        <button onClick={() => setTypeFilter('all')} className={`category-btn ${typeFilter === 'all' ? 'active' : ''}`}>全部</button>
        <button onClick={() => { if (chineseSubFilter) return; setTypeFilter('series'); }} className={`category-btn ${typeFilter === 'series' ? 'active' : ''} ${chineseSubFilter ? 'opacity-50 cursor-not-allowed' : ''}`}>动漫</button>
        <button onClick={() => setTypeFilter('video')} className={`category-btn ${typeFilter === 'video' ? 'active' : ''}`}>成人</button>
        <button onClick={() => setFavoriteFilter(!favoriteFilter)} className={`category-btn ${favoriteFilter ? 'active' : ''}`}>已追番</button>
        <button onClick={() => setWatchedFilter(!watchedFilter)} className={`category-btn ${watchedFilter ? 'active' : ''}`}>已看完</button>
        <button onClick={() => { if (typeFilter === 'series') return; setChineseSubFilter(!chineseSubFilter); }} className={`category-btn ${chineseSubFilter ? 'active' : ''} ${typeFilter === 'series' ? 'opacity-50 cursor-not-allowed' : ''}`}>中文字幕</button>
      </div>

      <div className="mb-10">
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="搜索视频或视频集..."
            className="search-input flex-1"
          />
          <button
            onClick={() => {
              if (selectMode) {
                setSelectMode(false);
                setSelectedIds(new Set());
              } else {
                setSelectMode(true);
              }
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${selectMode ? 'bg-blue-500 text-white border-blue-500' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
          >
            {selectMode ? '取消选择' : '选择'}
          </button>
        </div>
      </div>

      {selectMode && (
        <div className="mb-4 flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2">
          <div className="flex items-center gap-3">
            <button
              onClick={selectedIds.size === filteredSeries.length ? deselectAll : selectAll}
              className="px-3 py-1.5 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-100"
            >
              {selectedIds.size === filteredSeries.length ? '取消全选' : '全选'}
            </button>
            <span className="text-sm text-gray-500">已选 {selectedIds.size} 项</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleBatchDelete}
              disabled={selectedIds.size === 0}
              className="px-3 py-1.5 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              删除选中{selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
            </button>
            <button
              onClick={() => { setSelectMode(false); setSelectedIds(new Set()); }}
              className="px-3 py-1.5 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-100"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {typeFilter !== 'video' && animeSeries.length > 0 && (
        <div className="mb-12">
          <div className="grid grid-cols-4 md:grid-cols-5 gap-5 auto-rows-max">
            {animeSeries.map((series) => (
              <div
                key={series.id}
                onClick={() => { if (!selectMode) {
                  const filterSearch = buildFilterSearch();
                  navigate(`/series/${series.id}`, { state: { from: `/library${filterSearch}`, backLabel: '返回视频' } });
                }}}
                onContextMenu={(event) => openContextMenu(event, 'series', series.id, series.title)}
                className={`cursor-pointer group ${selectMode && selectedIds.has(`s-${series.id}`) ? 'ring-2 ring-blue-500 rounded-xl' : ''}`}
              >
                <div className="card relative w-full aspect-[3/4] overflow-hidden">
                  {selectMode && (
                    <div
                      className="absolute top-2 left-2 z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center cursor-pointer transition-colors"
                      style={{
                        backgroundColor: selectedIds.has(`s-${series.id}`) ? '#3b82f6' : 'white',
                        borderColor: selectedIds.has(`s-${series.id}`) ? '#3b82f6' : '#d1d5db',
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleSelect(`s-${series.id}`);
                      }}
                    >
                      {selectedIds.has(`s-${series.id}`) && (
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  )}
                  <SmartPoster src={series.poster_data_url} alt={series.title} posterOrientation={series.poster_orientation} />
                  <div className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-black/50 to-transparent"></div>
                  <div className="absolute bottom-2 right-2 text-white text-xs drop-shadow-lg">
                    {series.status === 'completed' ? `全${series.video_count}话` : `更新至第${series.video_count}话`}
                  </div>
                </div>
                <div className="mt-2">
                  <h3 className="text-sm font-medium text-zinc-900 truncate group-hover:text-blue-600" title={series.code ? `[${series.code}] ${series.title}` : series.title}>
                    {series.code ? `[${series.code}] ${series.title}` : series.title}
                  </h3>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {series.is_watched ? '已看完' : series.last_watched_episode ? `看到第${series.last_watched_episode}话` : '尚未观看'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {typeFilter !== 'series' && adultSeries.length > 0 && (
        <div className="mb-12">
          <div className="grid grid-cols-3 md:grid-cols-4 gap-5 auto-rows-max">
            {adultSeries.map((series) => (
              <div
                key={series.id}
                onClick={() => { if (!selectMode) {
                  const filterSearch = buildFilterSearch();
                  navigate(`/series/${series.id}`, { state: { from: `/library${filterSearch}`, backLabel: '返回视频' } });
                }}}
                onContextMenu={(event) => openContextMenu(event, 'series', series.id, series.title)}
                className={`cursor-pointer group ${selectMode && selectedIds.has(`s-${series.id}`) ? 'ring-2 ring-blue-500 rounded-xl' : ''}`}
              >
                <div className="card relative w-full aspect-video overflow-hidden">
                  {selectMode && (
                    <div
                      className="absolute top-2 left-2 z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center cursor-pointer transition-colors"
                      style={{
                        backgroundColor: selectedIds.has(`s-${series.id}`) ? '#3b82f6' : 'white',
                        borderColor: selectedIds.has(`s-${series.id}`) ? '#3b82f6' : '#d1d5db',
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleSelect(`s-${series.id}`);
                      }}
                    >
                      {selectedIds.has(`s-${series.id}`) && (
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  )}
                  <SmartPoster src={series.poster_data_url} alt={series.title} posterOrientation={series.poster_orientation} />
                  <div className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-black/50 to-transparent"></div>
                  {series.has_chinese_sub === 1 && (
                    <span className="absolute bottom-2 left-2 bg-orange-500 text-white text-xs px-1.5 py-0.5 rounded-sm">
                      中字
                    </span>
                  )}
                  <div className="absolute bottom-2 right-2 text-white text-xs drop-shadow-lg">
                    {series.status === 'completed' ? `全${series.video_count}部` : `更新至第${series.video_count}部`}
                  </div>
                </div>
                <div className="mt-2">
                  <h3 className="text-sm font-medium text-zinc-900 truncate group-hover:text-blue-600" title={series.code ? `[${series.code}] ${series.title}` : series.title}>
                    {series.code ? `[${series.code}] ${series.title}` : series.title}
                  </h3>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {series.is_watched ? '已看完' : series.last_watched_episode ? `看到第${series.last_watched_episode}部` : '尚未观看'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}


      {filteredSeries.length === 0 && (
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
            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            onClick={() => handleRescanMetadata(contextMenu.id)}
          >
            重新扫描元数据
          </button>
          <button
            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            onClick={() => {
              const key = `switch-${contextMenu.id}`;
              requestSecondConfirm(key, () => handleSwitchType(contextMenu.id));
            }}
          >
            {pendingKey === `switch-${contextMenu.id}` ? '确认切换' : '切换类型'}
          </button>
          <button
            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
            onClick={() => {
              const key = `${contextMenu.type}-${contextMenu.id}`;
              requestSecondConfirm(key, () => handleDeleteSeries(contextMenu.id));
            }}
          >
            {pendingKey === `${contextMenu.type}-${contextMenu.id}` ? '再次点击确认删除' : '删除'}
          </button>
        </div>
      )}
    </div>

    {/* Toast 提示 */}
    {toast && (
      <div className="fixed top-4 right-4 z-50 bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3 text-sm" style={{ animation: 'fadeIn 0.3s ease-in' }}>
        {toast.message}
      </div>
    )}

    <FloatingActions onRefresh={async () => { await refreshSeries(); }} refreshLabel="刷新视频" />
    </>
  );
};

export default Library;
