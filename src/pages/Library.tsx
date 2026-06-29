import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  getVideoSeriesByTag,
  getVideoSeriesByActor,
  scanVideos,
  deleteVideoSeries,
  rescanSingleSeriesMetadata,
  switchSeriesTypeTo,
  getAllCategories,
  parseCategoryFeatures,
  scanCategory,
  getTagsByCategory,
  getActorsByCategory,
} from '../utils/api';
import type { VideoSeries, Category, CategoryFeatures } from '../utils/api';
import { open } from '@tauri-apps/plugin-dialog';
import { SmartPoster } from '../utils/media';
import { useSecondConfirm } from '../utils/useSecondConfirm';
import FloatingActions from '../components/FloatingActions';
import { useLibraryStore } from '../store/libraryStore';

const Library: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { series: storeSeries, favorites, watchedIds, refreshSeries, sortBy, sortOrder, setSortBy, toggleSortOrder } = useLibraryStore();
  const [scanning, setScanning] = useState(false);
  const [categoryScanning, setCategoryScanning] = useState(false);
  const [scanConfirm, setScanConfirm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeTagId, setActiveTagId] = useState<number | null>(() => {
    const t = searchParams.get('tag');
    return t ? parseInt(t) : null;
  });
  const [typeFilter] = useState<'all' | 'series' | 'video'>(() => {
    return (searchParams.get('type') as 'all' | 'series' | 'video') || 'all';
  });
  const [mainCategory, setMainCategory] = useState<string>(() => {
    return searchParams.get('cat') || 'anime';
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<{ id: number; name: string; created_at: string }[]>([]);
  const [actors, setActors] = useState<{ id: number; name: string; work_count: number; [k: string]: any }[]>([]);

  // 加载大类配置
  useEffect(() => {
    getAllCategories()
      .then(setCategories)
      .catch((err) => console.error('[Library] 加载大类配置失败:', err));
  }, []);

  // 按大类加载标签和演员
  const loadCategoryFilters = useCallback(() => {
    getTagsByCategory(mainCategory).then(setTags).catch(() => setTags([]));
    getActorsByCategory(mainCategory).then(setActors).catch(() => setActors([]));
  }, [mainCategory]);

  useEffect(() => {
    loadCategoryFilters();
  }, [loadCategoryFilters]);
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
  const [tagExpanded, setTagExpanded] = useState(false);
  const [actorExpanded, setActorExpanded] = useState(false);
  const [typeSwitchSeriesId, setTypeSwitchSeriesId] = useState<number | null>(null);
  const [typeSwitchConfirm, setTypeSwitchConfirm] = useState<{ seriesId: number; categoryName: string; categoryKey: string } | null>(null);
  const tagsRef = useRef<HTMLDivElement>(null);
  const actorsRef = useRef<HTMLDivElement>(null);
  const [tagsNeedsExpand, setTagsNeedsExpand] = useState(false);
  const [actorsNeedsExpand, setActorsNeedsExpand] = useState(false);

  // 检测筛选按钮区域是否超过一行
  useEffect(() => {
    const checkOverflow = () => {
      if (tagsRef.current) {
        setTagsNeedsExpand(tagsRef.current.scrollHeight > tagsRef.current.clientHeight + 2);
      }
      if (actorsRef.current) {
        setActorsNeedsExpand(actorsRef.current.scrollHeight > actorsRef.current.clientHeight + 2);
      }
    };
    checkOverflow();
    // 窗口 resize 时重新检测
    window.addEventListener('resize', checkOverflow);
    return () => window.removeEventListener('resize', checkOverflow);
  }, [tags, actors, mainCategory]);

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
      cat: mainCategory !== 'anime' ? mainCategory : null,
    });
  }, [activeTagId, activeActorId, typeFilter, favoriteFilter, watchedFilter, mainCategory, syncParams]);

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
    if (mainCategory !== 'anime') params.set('cat', mainCategory);
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
      setToast({ message: matched ? '元数据更新成功' : '未匹配到格式，未更新', type: matched ? 'success' : 'info' });
    } catch (error) {
      console.error('[Library] 重新扫描元数据失败:', error);
      setToast({ message: '重新扫描失败: ' + String(error), type: 'info' });
    }
  };

  const handleSwitchType = async (seriesId: number) => {
    setTypeSwitchSeriesId(seriesId);
  };

  const handleSwitchTypeTo = async (seriesId: number, categoryKey: string, categoryName: string) => {
    setTypeSwitchConfirm({ seriesId, categoryName, categoryKey });
    setTypeSwitchSeriesId(null);
    setContextMenu(null);
    clearPending();
  };

  const doSwitchType = async () => {
    if (!typeSwitchConfirm) return;
    try {
      await switchSeriesTypeTo(typeSwitchConfirm.seriesId, typeSwitchConfirm.categoryKey);
      setTypeSwitchConfirm(null);
      await refreshSeries();
      if (activeTagId !== null) await filterByTag(activeTagId);
      if (activeActorId !== null) await filterByActor(activeActorId);
      setToast({ message: `已切换到${typeSwitchConfirm.categoryName}`, type: 'success' });
    } catch (error) {
      console.error('[Library] 切换类型失败:', error);
      setToast({ message: '切换类型失败: ' + String(error), type: 'info' });
      setTypeSwitchConfirm(null);
    }
  };

  const handleCategoryScan = async () => {
    setScanConfirm(false);
    setCategoryScanning(true);
    try {
      const result = await scanCategory(mainCategory);
      await refreshSeries();
      if (activeTagId !== null) await filterByTag(activeTagId);
      if (activeActorId !== null) await filterByActor(activeActorId);
      const { added, updated } = result;
      if (added > 0 && updated > 0) {
        setToast({ message: `扫描完成，添加了 ${added} 部，更新了 ${updated} 部`, type: 'success' });
      } else if (added > 0) {
        setToast({ message: `扫描完成，添加了 ${added} 部`, type: 'success' });
      } else if (updated > 0) {
        setToast({ message: `扫描完成，更新了 ${updated} 部`, type: 'info' });
      } else {
        setToast({ message: '扫描完成，未发现新作品', type: 'info' });
      }
    } catch (error) {
      console.error('[Library] 一键扫描失败:', error);
      setToast({ message: '扫描失败: ' + String(error), type: 'info' });
    } finally {
      setCategoryScanning(false);
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
  const currentCategory = useMemo(() => categories.find(c => c.key === mainCategory), [categories, mainCategory]);
  const currentFeatures = useMemo(() => currentCategory ? parseCategoryFeatures(currentCategory.features) : null, [currentCategory]);

  // fallback: 当 categories 未加载时使用默认值
  const features = currentFeatures || {
    tags: mainCategory === 'anime',
    actors: mainCategory === 'adult',
    tracking: mainCategory === 'anime',
    chinese_sub: mainCategory === 'adult',
    episode: mainCategory === 'anime' ? ('话' as string) : ('部' as string),
  } as CategoryFeatures;
  const isPortrait = currentCategory ? currentCategory.card_layout === 'portrait' : mainCategory === 'anime';
  const categoryDisplayName = currentCategory?.name || (mainCategory === 'anime' ? '动漫' : '影视');
  const epWord = features.episode || '部';

  const filteredSeries = seriesList.filter((series) =>
    (series.title.toLowerCase().includes(normalizedSearch) ||
    (series.description || '').toLowerCase().includes(normalizedSearch)) && (!favoriteFilter || favoriteIds.has(`s-${series.id}`)) && (!watchedFilter || watchedIds.has(series.id)) && (!chineseSubFilter || series.has_chinese_sub === 1) && (series.display_type === mainCategory || (!series.display_type && mainCategory === 'anime'))
  );

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
        <div className="flex items-center gap-4">
          {[...categories].sort((a, b) => a.sort_order - b.sort_order).map((cat) => (
            <h1
              key={cat.key}
              className={`font-bold cursor-pointer transition-all ${mainCategory === cat.key ? 'text-4xl' : 'text-2xl text-gray-400'}`}
              onClick={() => { setMainCategory(cat.key); setActiveActorId(null); setActorFilteredSeries(null); setActiveTagId(null); setTagFilteredSeries(null); }}
            >
              {cat.name}
            </h1>
          ))}
          {categories.length === 0 && (
            <>
              <h1 className="font-bold cursor-pointer transition-all text-4xl">动漫</h1>
              <h1 className="font-bold cursor-pointer transition-all text-2xl text-gray-400">影视</h1>
            </>
          )}
        </div>
        <div className="flex gap-3">
          {currentCategory?.scan_path && (
            <button
              onClick={() => setScanConfirm(true)}
              disabled={categoryScanning}
              className="px-6 py-3 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 disabled:opacity-50"
            >
              {categoryScanning ? '扫描中...' : '一键扫描'}
            </button>
          )}
          <button
            onClick={importPath}
            disabled={scanning}
            className="px-6 py-3 bg-gray-900 text-white rounded-xl font-medium hover:bg-gray-800 disabled:opacity-50"
          >
            {scanning ? '添加中...' : '添加'}
          </button>
        </div>
      </div>

      <div className="mb-6 flex justify-between items-start">
        <div className="flex flex-col gap-3 flex-1 min-w-0">
          {features.tags && (
            <div className="flex items-center gap-2">
              <div ref={tagsRef} className={`flex gap-3 flex-wrap overflow-hidden ${!tagExpanded ? 'max-h-[40px]' : ''}`}>
                <button onClick={() => handleTagClick(null)} className={`category-btn ${activeTagId === null ? 'active' : ''}`}>标签</button>
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
              {tagsNeedsExpand && (
                <button
                  onClick={() => setTagExpanded(!tagExpanded)}
                  className="category-btn active flex-shrink-0"
                >
                  {tagExpanded ? '收起 ↑' : '展开 ↓'}
                </button>
              )}
            </div>
          )}
          {features.actors && (
            <div className="flex items-center gap-2">
              <div ref={actorsRef} className={`flex gap-3 flex-wrap overflow-hidden ${!actorExpanded ? 'max-h-[40px]' : ''}`}>
                <button onClick={() => filterByActor(null)} className={`category-btn ${activeActorId === null ? 'active' : ''}`}>演员</button>
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
              {actorsNeedsExpand && (
                <button
                  onClick={() => setActorExpanded(!actorExpanded)}
                  className="category-btn active flex-shrink-0"
                >
                  {actorExpanded ? '收起 ↑' : '展开 ↓'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mb-6 flex gap-3 flex-wrap">
        {features.tracking ? (
          <>
            <button onClick={() => { setFavoriteFilter(false); setWatchedFilter(false); setChineseSubFilter(false); }} className={`category-btn ${!favoriteFilter && !watchedFilter && !chineseSubFilter ? 'active' : ''}`}>全部</button>
            <button onClick={() => setFavoriteFilter(!favoriteFilter)} className={`category-btn ${favoriteFilter ? 'active' : ''}`}>已追番</button>
            <button onClick={() => setWatchedFilter(!watchedFilter)} className={`category-btn ${watchedFilter ? 'active' : ''}`}>已看完</button>
            {features.chinese_sub && (
              <button onClick={() => setChineseSubFilter(!chineseSubFilter)} className={`category-btn ${chineseSubFilter ? 'active' : ''}`}>中文字幕</button>
            )}
          </>
        ) : (
          <>
            <button onClick={() => { setFavoriteFilter(false); setWatchedFilter(false); setChineseSubFilter(false); }} className={`category-btn ${!favoriteFilter && !watchedFilter && !chineseSubFilter ? 'active' : ''}`}>全部</button>
            {features.chinese_sub && (
              <button onClick={() => setChineseSubFilter(!chineseSubFilter)} className={`category-btn ${chineseSubFilter ? 'active' : ''}`}>中文字幕</button>
            )}
          </>
        )}
      </div>

      <div className="mb-6 flex gap-3 flex-wrap">
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'created_at' | 'title')}
          className="category-btn"
        >
          <option value="created_at">添加时间</option>
          <option value="title">名称</option>
        </select>
        <button
          onClick={() => toggleSortOrder()}
          className="category-btn"
        >
          {sortOrder === 'desc' ? '降序 ↓' : '升序 ↑'}
        </button>
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

      {filteredSeries.length > 0 && (
        <div className="mb-12">
          <div className={`grid gap-5 auto-rows-max ${isPortrait ? 'grid-cols-4 md:grid-cols-5' : 'grid-cols-3 md:grid-cols-4'}`}>
            {filteredSeries.map((series) => (
              <div
                key={series.id}
                onClick={() => { if (!selectMode) {
                  const filterSearch = buildFilterSearch();
                  navigate(`/series/${series.id}`, { state: { from: `/library${filterSearch}`, backLabel: `返回${categoryDisplayName}` } });
                }}}
                onContextMenu={(event) => openContextMenu(event, 'series', series.id, series.title)}
                className={`cursor-pointer group ${selectMode && selectedIds.has(`s-${series.id}`) ? 'ring-2 ring-blue-500 rounded-xl' : ''}`}
              >
                <div className={`card relative w-full overflow-hidden ${isPortrait ? 'aspect-[3/4]' : 'aspect-video'}`}>
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
                  {features.chinese_sub && series.has_chinese_sub === 1 && (
                    <span className="absolute bottom-2 left-2 bg-orange-500 text-white text-xs px-1.5 py-0.5 rounded-sm">
                      中字
                    </span>
                  )}
                  <div className="absolute bottom-2 right-2 text-white text-xs drop-shadow-lg">
                    {series.status === 'completed' ? `全${series.video_count}${epWord}` : `更新至第${series.video_count}${epWord}`}
                  </div>
                </div>
                <div className="mt-2">
                  <h3 className="text-sm font-medium text-zinc-900 truncate group-hover:text-blue-600" title={series.code ? `[${series.code}] ${series.title}` : series.title}>
                    {series.code ? `[${series.code}] ${series.title}` : series.title}
                  </h3>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {series.is_watched ? '已看完' : series.last_watched_episode ? `看到第${series.last_watched_episode}${epWord}` : '尚未观看'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}


      {filteredSeries.length === 0 && (
        <div className="text-center py-16">
          <p className="text-gray-500 text-lg mb-4">{searchTerm ? '没有找到匹配的视频' : `暂无${categoryDisplayName}`}</p>
          {!searchTerm && <p className="text-gray-400 text-sm">点击"添加"选择文件夹添加视频</p>}
        </div>
      )}

      {contextMenu && (
        <div
          className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-xl py-2 w-fit"
          style={{ left: contextMenu.x + 160 > window.innerWidth ? contextMenu.x - 160 : contextMenu.x, top: contextMenu.y + 200 > window.innerHeight ? contextMenu.y - 200 : contextMenu.y }}
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
              
              handleSwitchType(contextMenu.id);
            }}
          >
            切换类型
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

    {/* 一键扫描确认弹窗 */}
    {scanConfirm && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl">
          <p className="text-gray-900 text-base mb-6">
            确定对「{categoryDisplayName}」执行一键扫描？<br />
            <span className="text-sm text-gray-500">扫描路径：{currentCategory?.scan_path}</span>
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleCategoryScan}
              className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm font-medium"
            >
              确认扫描
            </button>
            <button
              onClick={() => setScanConfirm(false)}
              className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    )}

    {/* 切换类型 - 大类选择弹窗 */}
    {typeSwitchSeriesId !== null && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setTypeSwitchSeriesId(null)}>
        <div className="bg-white rounded-2xl p-6 min-w-64 shadow-xl" onClick={e => e.stopPropagation()}>
          <h3 className="text-lg font-bold text-gray-900 mb-4">切换到</h3>
          <div className="space-y-2 mb-4">
            {categories.filter(c => c.key !== mainCategory).map(cat => (
              <button
                key={cat.key}
                className="w-full text-left px-4 py-3 rounded-lg hover:bg-gray-100 transition-colors text-sm"
                onClick={() => handleSwitchTypeTo(typeSwitchSeriesId, cat.key, cat.name)}
              >
                {cat.name}
              </button>
            ))}
          </div>
          <button
            className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
            onClick={() => setTypeSwitchSeriesId(null)}
          >
            取消
          </button>
        </div>
      </div>
    )}

    {/* 切换类型确认弹窗 */}
    {typeSwitchConfirm && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl">
          <p className="text-gray-900 text-base mb-6">
            确定切换到「{typeSwitchConfirm.categoryName}」？
          </p>
          <div className="flex gap-3">
            <button
              onClick={doSwitchType}
              className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm font-medium"
            >
              确认
            </button>
            <button
              onClick={() => setTypeSwitchConfirm(null)}
              className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    )}

    <FloatingActions onRefresh={async () => { await refreshSeries(); }} refreshLabel="刷新" />
    </>
  );
};

export default Library;
