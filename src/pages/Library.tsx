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
import ConfirmDialog from '../components/ConfirmDialog';
import { useLibraryStore } from '../store/libraryStore';
import { notify } from '../utils/notify';

const Library: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { series: storeSeries, favorites, watchedIds, refreshSeries } = useLibraryStore();
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
  const [scopeAll, setScopeAll] = useState(() => searchParams.get('scope') === 'all');
  const [mainCategory, setMainCategory] = useState<string>(() => {
    return searchParams.get('cat') || '';
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<{ id: number; name: string; created_at: string }[]>([]);
  const [actors, setActors] = useState<{ id: number; name: string; work_count: number; [k: string]: any }[]>([]);

  // 加载大类配置。未准备好前先不渲染真实页面，避免跳转后标题/筛选/卡片分批冒出来。
  useEffect(() => {
    let cancelled = false;
    window.scrollTo(0, 0);
    getAllCategories()
      .then((data) => {
        if (cancelled) return;
        setCategories(data);
        if (!searchParams.get('cat')) {
          const sorted = [...data].sort((a, b) => a.sort_order - b.sort_order);
          if (sorted.length > 0) setMainCategory(sorted[0].key);
        }
      })
      .catch((err) => console.error('[Library] 加载大类配置失败:', err))
    return () => { cancelled = true; };
  }, []);

  // 按大类加载标签和演员。一次性落状态，避免筛选栏分批抖动。
  const loadCategoryFilters = useCallback(async () => {
    if (scopeAll) {
      setTags([]);
      setActors([]);
      return;
    }
    if (!mainCategory) {
      setTags([]);
      setActors([]);
      return;
    }
    try {
      const [nextTags, nextActors] = await Promise.all([
        getTagsByCategory(mainCategory).catch(() => []),
        getActorsByCategory(mainCategory).catch(() => []),
      ]);
      setTags(nextTags);
      setActors(nextActors);
    } catch (error) {
      console.error('[Library] 加载筛选失败:', error);
    }
  }, [mainCategory, scopeAll]);

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
  const [tagExpanded, setTagExpanded] = useState(false);
  const [actorExpanded, setActorExpanded] = useState(false);
  const tagsRef = useRef<HTMLDivElement>(null);
  const actorsRef = useRef<HTMLDivElement>(null);
  const [typeSwitchSeriesId, setTypeSwitchSeriesId] = useState<number | null>(null);
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false);
  const [typeSwitchConfirm, setTypeSwitchConfirm] = useState<{ seriesId: number; categoryName: string; categoryKey: string } | null>(null);

  // 按数量判断是否需要展开按钮（首帧即确定，无跳动）
  const tagsNeedsExpand = tags.length > 5;
  const actorsNeedsExpand = actors.length > 5;


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
      scope: scopeAll ? 'all' : null,
      cat: !scopeAll && mainCategory !== 'anime' ? mainCategory : null,
    });
  }, [activeTagId, activeActorId, typeFilter, favoriteFilter, watchedFilter, mainCategory, scopeAll, syncParams]);

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

  useEffect(() => {
    if (!scopeAll) return;
    setActiveTagId(null);
    setTagFilteredSeries(null);
    setActiveActorId(null);
    setActorFilteredSeries(null);
  }, [scopeAll]);

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
    if (scopeAll) params.set('scope', 'all');
    if (!scopeAll && mainCategory !== 'anime') params.set('cat', mainCategory);
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
            notify({ message: `添加成功，本次添加了 ${added} 部作品，更新了 ${updated} 部已有作品`, type: 'success' });
          } else if (added > 0) {
            notify({ message: `添加成功，本次添加了 ${added} 部作品`, type: 'success' });
          } else if (updated > 0) {
            notify({ message: `更新了 ${updated} 部已有作品`, type: 'info' });
          } else {
            notify({ message: '未发现新作品', type: 'info' });
          }
        } catch (error) {
          console.error('[Library] 导入失败:', error);
          notify({ message: '导入失败: ' + String(error), type: 'error' });
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
      notify({ message: '删除视频集失败: ' + String(error), type: 'error' });
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
      notify({ message: matched ? '元数据更新成功' : '未匹配到格式，未更新', type: matched ? 'success' : 'info' });
    } catch (error) {
      console.error('[Library] 重新扫描元数据失败:', error);
      notify({ message: '重新扫描失败: ' + String(error), type: 'info' });
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
      notify({ message: `已切换到${typeSwitchConfirm.categoryName}`, type: 'success' });
    } catch (error) {
      console.error('[Library] 切换类型失败:', error);
      notify({ message: '切换类型失败: ' + String(error), type: 'info' });
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
        notify({ message: `扫描完成，添加了 ${added} 部，更新了 ${updated} 部`, type: 'success' });
      } else if (added > 0) {
        notify({ message: `扫描完成，添加了 ${added} 部`, type: 'success' });
      } else if (updated > 0) {
        notify({ message: `扫描完成，更新了 ${updated} 部`, type: 'info' });
      } else {
        notify({ message: '扫描完成，未发现新作品', type: 'info' });
      }
    } catch (error) {
      console.error('[Library] 一键扫描失败:', error);
      notify({ message: '扫描失败: ' + String(error), type: 'info' });
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
  const getSeriesCategory = useCallback((series: VideoSeries) => {
    return categories.find(c => c.key === series.display_type)
      || categories.find(c => !series.display_type && !series.has_actor && c.key === 'anime')
      || categories.find(c => series.has_actor && c.key === 'adult')
      || null;
  }, [categories]);
  const getSeriesFeatures = useCallback((series: VideoSeries): CategoryFeatures | null => {
    const category = getSeriesCategory(series);
    return category ? parseCategoryFeatures(category.features) : null;
  }, [getSeriesCategory]);
  const currentFeatures = useMemo(() => currentCategory ? parseCategoryFeatures(currentCategory.features) : null, [currentCategory]);

  // fallback: 当 categories 未加载时使用默认值
  const features = scopeAll ? {
    tags: false,
    actors: false,
    tracking: true,
    chinese_sub: false,
    episode: '部',
  } as CategoryFeatures : currentFeatures || {
    tags: mainCategory === 'anime',
    actors: mainCategory === 'adult',
    tracking: mainCategory === 'anime',
    chinese_sub: mainCategory === 'adult',
    episode: mainCategory === 'anime' ? ('话' as string) : ('部' as string),
  } as CategoryFeatures;
  const isPortrait = scopeAll ? true : currentCategory ? currentCategory.card_layout === 'portrait' : mainCategory === 'anime';
  const categoryDisplayName = scopeAll ? '我的追番' : currentCategory?.name || (mainCategory === 'anime' ? '动漫' : '影视');
  const epWord = features.episode || '部';

  const filteredSeries = seriesList.filter((series) => {
    const matchesText = series.title.toLowerCase().includes(normalizedSearch)
      || (series.description || '').toLowerCase().includes(normalizedSearch);
    const matchesCategory = scopeAll
      || series.display_type === mainCategory
      || (!series.display_type && mainCategory === 'anime');

    return matchesText
      && (!favoriteFilter || favoriteIds.has(`s-${series.id}`))
      && (!watchedFilter || watchedIds.has(series.id))
      && (!chineseSubFilter || series.has_chinese_sub === 1)
      && matchesCategory;
  });

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

  const doBatchDelete = async () => {
    setBatchDeleteConfirm(false);
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

  const handleBatchDelete = async () => {
    setBatchDeleteConfirm(true);
  };

  return (
    <>
    <div className="changli-page changli-library-instant">
      <div className="changli-page-header">
        <div className="flex items-center gap-4">
          {scopeAll && (
            <h1 className="changli-heading-xl cursor-default transition-all">我的追番</h1>
          )}
          {[...categories].sort((a, b) => a.sort_order - b.sort_order).map((cat) => (
            <h1
              key={cat.key}
              className={`cursor-pointer transition-all ${!scopeAll && mainCategory === cat.key ? 'changli-heading-xl' : 'text-2xl font-bold text-gray-400 hover:text-gray-600'}`}
              onClick={() => {
                setScopeAll(false);
                setMainCategory(cat.key);
                setActiveActorId(null);
                setActorFilteredSeries(null);
                setActiveTagId(null);
                setTagFilteredSeries(null);
              }}
            >
              {cat.name}
            </h1>
          ))}
          {categories.length === 0 && (
            <>
              <h1 className="changli-heading-xl cursor-pointer transition-all">动漫</h1>
              <h1 className="text-2xl font-bold cursor-pointer transition-all text-gray-400">影视</h1>
            </>
          )}
        </div>
        <div className="flex gap-3">
          {!scopeAll && currentCategory?.scan_path && (
            <button
              onClick={() => setScanConfirm(true)}
              disabled={categoryScanning}
              className="action-btn action-btn-primary disabled:opacity-50"
            >
              {categoryScanning ? '扫描中...' : '一键扫描'}
            </button>
          )}
          <button
            onClick={importPath}
            disabled={scanning}
            className="action-btn action-btn-primary disabled:opacity-50"
          >
            {scanning ? '添加中...' : '添加'}
          </button>
        </div>
      </div>

      <div className="changli-filter-panel mb-8">
        {features.tags && (
          <>
            <div className="changli-filter-group">
              <div className="changli-filter-label">标签</div>
              <div ref={tagsRef} className={`changli-filter-row ${tagExpanded ? 'is-expanded' : 'is-collapsed'}`}>
                <button onClick={() => handleTagClick(null)} className={`changli-filter-pill ${activeTagId === null ? 'active' : ''}`}>全部标签</button>
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    onClick={() => handleTagClick(tag.id)}
                    className={`changli-filter-pill ${activeTagId === tag.id ? 'active' : ''}`}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
              {tagsNeedsExpand && (
                <button
                  onClick={() => setTagExpanded(!tagExpanded)}
                  className="changli-filter-more"
                >
                  {tagExpanded ? '收起 ↑' : '展开 ↓'}
                </button>
              )}
            </div>
            <div className="changli-filter-divider" />
          </>
        )}
        {features.actors && (
          <>
            <div className="changli-filter-group">
              <div className="changli-filter-label">演员</div>
              <div ref={actorsRef} className={`changli-filter-row ${actorExpanded ? 'is-expanded' : 'is-collapsed'}`}>
                <button onClick={() => filterByActor(null)} className={`changli-filter-pill ${activeActorId === null ? 'active' : ''}`}>全部演员</button>
                {actors.map((actor) => (
                  <button
                    key={actor.id}
                    onClick={() => handleActorClick(actor.id)}
                    className={`changli-filter-pill ${activeActorId === actor.id ? 'active' : ''}`}
                  >
                    {actor.name}
                  </button>
                ))}
              </div>
              {actorsNeedsExpand && (
                <button
                  onClick={() => setActorExpanded(!actorExpanded)}
                  className="changli-filter-more"
                >
                  {actorExpanded ? '收起 ↑' : '展开 ↓'}
                </button>
              )}
            </div>
            <div className="changli-filter-divider" />
          </>
        )}
        <div className="changli-filter-group">
          <div className="changli-filter-label">状态</div>
          <div className="changli-filter-row is-expanded">
            {features.tracking ? (
              <>
                <button onClick={() => { setFavoriteFilter(false); setWatchedFilter(false); setChineseSubFilter(false); }} className={`changli-filter-pill ${!favoriteFilter && !watchedFilter && !chineseSubFilter ? 'active' : ''}`}>全部</button>
                <button onClick={() => setFavoriteFilter(!favoriteFilter)} className={`changli-filter-pill ${favoriteFilter ? 'active' : ''}`}>已追番</button>
                <button onClick={() => setWatchedFilter(!watchedFilter)} className={`changli-filter-pill ${watchedFilter ? 'active' : ''}`}>已看完</button>
                {features.chinese_sub && (
                  <button onClick={() => setChineseSubFilter(!chineseSubFilter)} className={`changli-filter-pill ${chineseSubFilter ? 'active' : ''}`}>中文字幕</button>
                )}
              </>
            ) : (
              <>
                <button onClick={() => { setFavoriteFilter(false); setWatchedFilter(false); setChineseSubFilter(false); }} className={`changli-filter-pill ${!favoriteFilter && !watchedFilter && !chineseSubFilter ? 'active' : ''}`}>全部</button>
                {features.chinese_sub && (
                  <button onClick={() => setChineseSubFilter(!chineseSubFilter)} className={`changli-filter-pill ${chineseSubFilter ? 'active' : ''}`}>中文字幕</button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="changli-toolbar mb-10 p-3">
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
            className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${selectMode ? 'bg-gradient-to-r from-[#fb5b7b] to-[#ff8a4c] text-white border-transparent shadow-sm' : 'border-gray-200 text-gray-700 hover:bg-gray-50 hover:-translate-y-0.5'}`}
          >
            {selectMode ? '取消选择' : '选择'}
          </button>
        </div>
      </div>

      {selectMode && (
        <div className="changli-toolbar mb-4 flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={selectedIds.size === filteredSeries.length ? deselectAll : selectAll}
              className="action-btn"
            >
              {selectedIds.size === filteredSeries.length ? '取消全选' : '全选'}
            </button>
            <span className="text-sm text-gray-500">已选 {selectedIds.size} 项</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleBatchDelete}
              disabled={selectedIds.size === 0}
              className="action-btn action-btn-danger disabled:opacity-40 disabled:cursor-not-allowed"
            >
              删除选中{selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
            </button>
            <button
              onClick={() => { setSelectMode(false); setSelectedIds(new Set()); }}
              className="action-btn"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {filteredSeries.length > 0 && (
        <div className="mb-12">
          <div className={`grid gap-5 auto-rows-max ${scopeAll ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5' : isPortrait ? 'grid-cols-4 md:grid-cols-5' : 'grid-cols-3 md:grid-cols-4'}`}>
            {filteredSeries.map((series) => {
              const itemCategory = getSeriesCategory(series);
              const itemFeatures = getSeriesFeatures(series) || features;
              const itemIsPortrait = scopeAll ? itemCategory?.card_layout === 'portrait' : isPortrait;
              const itemEpWord = itemFeatures.episode || epWord;

              return (
                <div
                  key={series.id}
                  onClick={() => { if (!selectMode) {
                    const filterSearch = buildFilterSearch();
                    navigate(`/series/${series.id}`, { state: { from: `/library${filterSearch}`, backLabel: `返回${categoryDisplayName}`, seriesSnapshot: series } });
                  }}}
                  onContextMenu={(event) => openContextMenu(event, 'series', series.id, series.title)}
                  className={`cursor-pointer group ${selectMode && selectedIds.has(`s-${series.id}`) ? 'ring-2 ring-rose-400 ring-offset-2 ring-offset-white rounded-2xl' : ''}`}
                >
                  <div className={`card relative w-full overflow-hidden transition-shadow duration-200 group-hover:shadow-xl ${itemIsPortrait ? 'aspect-[3/4]' : 'aspect-video'}`}>
                    {selectMode && (
                      <div
                        className="absolute top-2 left-2 z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center cursor-pointer transition-colors"
                        style={{
                          backgroundColor: selectedIds.has(`s-${series.id}`) ? '#fb5b7b' : 'white',
                          borderColor: selectedIds.has(`s-${series.id}`) ? '#fb5b7b' : '#d1d5db',
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
                    {itemFeatures.chinese_sub && series.has_chinese_sub === 1 && (
                      <span className="absolute bottom-2 left-2 changli-brand-badge text-xs font-bold px-2 py-0.5">
                        中字
                      </span>
                    )}
                    <div className="absolute bottom-2 right-2 text-white text-xs drop-shadow-lg">
                      {series.status === 'completed' || !itemFeatures.tracking ? `全${series.video_count}${itemEpWord}` : `更新至第${series.video_count}${itemEpWord}`}
                    </div>
                  </div>
                  <div className="mt-2">
                    <h3 className="text-sm font-semibold text-zinc-900 truncate group-hover:text-rose-600" title={series.code ? `[${series.code}] ${series.title}` : series.title}>
                      {series.code ? `[${series.code}] ${series.title}` : series.title}
                    </h3>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {series.is_watched ? '已看完' : series.last_watched_episode ? `看到第${series.last_watched_episode}${itemEpWord}` : '尚未观看'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}


      {filteredSeries.length === 0 && (
        <div className="changli-empty-state">
          <p className="text-gray-500 text-lg mb-4">{searchTerm ? '没有找到匹配的视频' : `暂无${categoryDisplayName}`}</p>
          {!searchTerm && <p className="text-gray-400 text-sm">点击"添加"选择文件夹添加视频</p>}
        </div>
      )}

      {contextMenu && (
        <div
          className="changli-context-menu fixed z-50 py-2 w-fit"
          style={{ left: contextMenu.x + 160 > window.innerWidth ? contextMenu.x - 160 : contextMenu.x, top: contextMenu.y + 200 > window.innerHeight ? contextMenu.y - 200 : contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="changli-menu-item"
            onClick={handleEditContextItem}
          >
            编辑
          </button>
          <button
            className="changli-menu-item"
            onClick={() => handleRescanMetadata(contextMenu.id)}
          >
            重新扫描元数据
          </button>
          <button
            className="changli-menu-item"
            onClick={() => {
              
              handleSwitchType(contextMenu.id);
            }}
          >
            切换类型
          </button>
          <button
            className="changli-menu-item changli-menu-item-danger"
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

    <ConfirmDialog
      open={batchDeleteConfirm}
      title="批量删除"
      message={`确定删除选中的 ${selectedIds.size} 个项目？此操作不可恢复。`}
      confirmText="确认删除"
      danger
      onConfirm={doBatchDelete}
      onCancel={() => setBatchDeleteConfirm(false)}
    />

    {/* 一键扫描确认弹窗 */}
    {scanConfirm && (
      <div className="changli-modal-backdrop">
        <div className="changli-modal-panel">
          <p className="text-gray-900 text-base mb-6">
            确定对「{categoryDisplayName}」执行一键扫描？<br />
            <span className="text-sm text-gray-500">扫描路径：{currentCategory?.scan_path}</span>
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleCategoryScan}
              className="action-btn action-btn-primary flex-1 text-sm"
            >
              确认扫描
            </button>
            <button
              onClick={() => setScanConfirm(false)}
              className="action-btn flex-1 text-sm"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    )}

    {/* 切换类型 - 大类选择弹窗 */}
    {typeSwitchSeriesId !== null && (
      <div className="changli-modal-backdrop" onClick={() => setTypeSwitchSeriesId(null)}>
        <div className="changli-modal-panel !w-[min(100%,360px)]" onClick={e => e.stopPropagation()}>
          <h3 className="text-lg font-bold text-gray-900 mb-4">切换到</h3>
          <div className="space-y-2 mb-4">
            {categories.filter(c => c.key !== mainCategory).map(cat => (
              <button
                key={cat.key}
                className="changli-list-option"
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
      <div className="changli-modal-backdrop">
        <div className="changli-modal-panel">
          <p className="text-gray-900 text-base mb-6">
            确定切换到「{typeSwitchConfirm.categoryName}」？
          </p>
          <div className="flex gap-3">
            <button
              onClick={doSwitchType}
              className="action-btn action-btn-primary flex-1 text-sm"
            >
              确认
            </button>
            <button
              onClick={() => setTypeSwitchConfirm(null)}
              className="action-btn flex-1 text-sm"
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
