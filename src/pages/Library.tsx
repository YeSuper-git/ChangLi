import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  getVideoSeriesByTag,
  getVideoSeriesByActor,
  scanVideos,
  deleteVideoSeries,
  rescanSingleSeriesMetadata,
  checkCategoryUpdates,
  switchSeriesTypeTo,
  formatSeriesWatchLabel,
  formatSeriesEpisodeCountLabel,
  parseCategoryFeatures,
  getTagsByCategory,
  getActorsByCategory,
  getTagColor,
  toggleWatched,
  openSeriesInFileManager,
  createEmptyVideoSeries,
} from '../utils/api';
import type { VideoSeries, Category, CategoryFeatures, Tag, Actor, CategoryUpdateResult } from '../utils/api';
import { open } from '@tauri-apps/plugin-dialog';
import { seriesPosterSrc, SmartPoster } from '../utils/media';
import { useSecondConfirm } from '../utils/useSecondConfirm';
import FloatingActions from '../components/FloatingActions';
import ConfirmDialog from '../components/ConfirmDialog';
import ScanLogicModal, { isScanLogicSeen, markScanLogicSeen } from '../components/ScanLogicModal';
import { useLibraryStore } from '../store/libraryStore';
import { notify } from '../utils/notify';
import {
  getCategoryUpdateRunnerState,
  runCategoryUpdateTask,
  subscribeCategoryUpdateRunner,
} from '../utils/categoryUpdateRunner';


const categoryFilterCache = new Map<string, { tags: Tag[]; actors: Actor[] }>();
const tagSeriesCache = new Map<number, VideoSeries[]>();
const actorSeriesCache = new Map<number, VideoSeries[]>();
export const clearLibraryFilterCaches = () => {
  categoryFilterCache.clear();
  tagSeriesCache.clear();
  actorSeriesCache.clear();
};

const Library: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { series: storeSeries, favorites, watchedIds, categories: storeCategories, refreshSeries, refreshCategories, seriesDirty, toggleFavorite } = useLibraryStore();
  const [scanning, setScanning] = useState(false);
  const [showNewSeriesModal, setShowNewSeriesModal] = useState(false);
  const [newSeriesTitle, setNewSeriesTitle] = useState('');
  const [creatingSeries, setCreatingSeries] = useState(false);
  const [categoryScanning, setCategoryScanning] = useState(false);
  const [categoryOperation, setCategoryOperation] = useState<'checking' | 'updating' | null>(() => getCategoryUpdateRunnerState().operation);
  const [scanConfirm, setScanConfirm] = useState(false);
  const [showScanLogicModal, setShowScanLogicModal] = useState(false);
  const [addButtonContextMenu, setAddButtonContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [categoryUpdateResult, setCategoryUpdateResult] = useState<CategoryUpdateResult | null>(null);

  // 点击外部关闭添加按钮右键菜单
  useEffect(() => {
    if (!addButtonContextMenu) return;
    const close = () => setAddButtonContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [addButtonContextMenu]);
  // 检查更新选中状态：new_series: Set<name>, series_updates: Map<series_id, {selected: bool, newVideos: Set<filePath>, missingVideos: Set<id>}>
  const getMissingSeriesKey = (series: { id?: number | null; name: string }) => series.id != null ? `id:${series.id}` : `name:${series.name}`;
  // 切换单个新发现视频集的选中状态
  const toggleNewSeries = (name: string) => {
    setUpdateSelection(prev => {
      if (!prev) return prev;
      const next = { ...prev, newSeries: new Set(prev.newSeries) };
      if (next.newSeries.has(name)) next.newSeries.delete(name);
      else next.newSeries.add(name);
      return next;
    });
  };
  // 切换单个series_update的整体选中
  const toggleSeriesUpdate = (seriesId: number) => {
    setUpdateSelection(prev => {
      if (!prev) return prev;
      const next = { ...prev, seriesUpdates: new Map(prev.seriesUpdates) };
      const su = next.seriesUpdates.get(seriesId);
      if (su) next.seriesUpdates.set(seriesId, { ...su, selected: !su.selected });
      return next;
    });
  };
  // 切换单个新视频的选中
  const toggleNewVideo = (seriesId: number, filePath: string) => {
    setUpdateSelection(prev => {
      if (!prev) return prev;
      const next = { ...prev, seriesUpdates: new Map(prev.seriesUpdates) };
      const su = next.seriesUpdates.get(seriesId);
      if (su) {
        const nv = new Set(su.newVideos);
        if (nv.has(filePath)) nv.delete(filePath); else nv.add(filePath);
        next.seriesUpdates.set(seriesId, { ...su, newVideos: nv });
      }
      return next;
    });
  };
  // 切换单个已移除视频的选中
  const toggleMissingVideo = (seriesId: number, videoId: number) => {
    setUpdateSelection(prev => {
      if (!prev) return prev;
      const next = { ...prev, seriesUpdates: new Map(prev.seriesUpdates) };
      const su = next.seriesUpdates.get(seriesId);
      if (su) {
        const mv = new Set(su.missingVideos);
        if (mv.has(videoId)) mv.delete(videoId); else mv.add(videoId);
        next.seriesUpdates.set(seriesId, { ...su, missingVideos: mv });
      }
      return next;
    });
  };
  // 切换单个已移除视频集的选中
  const toggleMissingSeries = (key: string) => {
    setUpdateSelection(prev => {
      if (!prev) return prev;
      const next = { ...prev, missingSeries: new Set(prev.missingSeries) };
      if (next.missingSeries.has(key)) next.missingSeries.delete(key);
      else next.missingSeries.add(key);
      return next;
    });
  };

  const [updateSelection, setUpdateSelection] = useState<{
    newSeries: Set<string>;
    seriesUpdates: Map<number, { selected: boolean; newVideos: Set<string>; missingVideos: Set<number> }>;
    missingSeries: Set<string>;
  } | null>(null);
  const hasInitialCatParamRef = useRef(searchParams.has('cat'));
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get('q') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(searchTerm);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 200);
    return () => clearTimeout(timer);
  }, [searchTerm]);
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
  const [categories, setCategories] = useState<Category[]>(() => storeCategories);
  const [tags, setTags] = useState<{ id: number; name: string; created_at: string }[]>([]);
  const [actors, setActors] = useState<{ id: number; name: string; work_count: number; [k: string]: any }[]>([]);
  const defaultCategoryKey = useMemo(() => {
    return [...categories].sort((a, b) => a.sort_order - b.sort_order)[0]?.key || 'anime';
  }, [categories]);

  // 播放/扫描/删除后只在进入视频页时补刷新一次；搜索输入和筛选 URL 同步不触发刷新。
  useEffect(() => {
    // 滚动恢复已由 Layout 组件的 useLayoutEffect 统一处理（基于 mainRef 的 scrollTop），
    // 此处不再使用 sessionStorage + window.scrollTo（因为实际滚动容器是 <main> 而非 window）。
    if (seriesDirty) {
      refreshSeries().catch(() => {});
    }
  }, []);

  // 大类配置由 App 启动时预加载进 store；视频页首帧先用 store 快照，避免标题/筛选区闪现。
  useEffect(() => {
    if (storeCategories.length > 0) {
      setCategories(storeCategories);
      if (!hasInitialCatParamRef.current && !mainCategory) {
        const sorted = [...storeCategories].sort((a, b) => a.sort_order - b.sort_order);
        if (sorted.length > 0) setMainCategory(sorted[0].key);
      }
      return;
    }
    let cancelled = false;
    refreshCategories()
      .then(() => {
        if (!cancelled) {
          const next = useLibraryStore.getState().categories;
          setCategories(next);
          if (!hasInitialCatParamRef.current && !mainCategory) {
            const sorted = [...next].sort((a, b) => a.sort_order - b.sort_order);
            if (sorted.length > 0) setMainCategory(sorted[0].key);
          }
        }
      })
      .catch((err) => console.error('[Library] 加载大类配置失败:', err));
    return () => { cancelled = true; };
  }, [storeCategories, refreshCategories, mainCategory]);

  // 按大类加载标签和演员。缓存分类筛选数据，返回视频页时首帧直接复用，避免筛选栏卡顿。
  const loadCategoryFilters = useCallback(async () => {
    if (scopeAll || !mainCategory) {
      setTags([]);
      setActors([]);
      return;
    }
    const cached = categoryFilterCache.get(mainCategory);
    if (cached) {
      setTags(cached.tags);
      setActors(cached.actors);
      return;
    }
    try {
      const [nextTags, nextActors] = await Promise.all([
        getTagsByCategory(mainCategory).catch(() => []),
        getActorsByCategory(mainCategory).catch(() => []),
      ]);
      categoryFilterCache.set(mainCategory, { tags: nextTags, actors: nextActors });
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
  const [unfinishedFilter, setUnfinishedFilter] = useState(() => searchParams.get('unfinished') === '1');
  const [emptyFilter, setEmptyFilter] = useState(() => searchParams.get('empty') === '1');
  const [chineseSubFilter, setChineseSubFilter] = useState(false);
  const [ongoingFilter, setOngoingFilter] = useState(false);
  const [completedFilter, setCompletedFilter] = useState(false);
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

  // store 更新时清除标签/演员筛选缓存，避免筛选列表和 store 数据不同步
  const storeSeriesRef = useRef(storeSeries);
  useEffect(() => {
    if (storeSeries !== storeSeriesRef.current) {
      storeSeriesRef.current = storeSeries;
      tagSeriesCache.clear();
      actorSeriesCache.clear();
      if (activeTagId !== null) setTagFilteredSeries(null);
      if (activeActorId !== null) setActorFilteredSeries(null);
    }
  }, [storeSeries, activeTagId, activeActorId]);

  useEffect(() => {
    const syncCategoryUpdateState = () => {
      const runnerState = getCategoryUpdateRunnerState();
      setCategoryOperation(prev => runnerState.operation || (prev === 'checking' ? 'checking' : null));
      setCategoryScanning(prev => Boolean(runnerState.operation) || (categoryOperation === 'checking' ? prev : false));
    };
    syncCategoryUpdateState();
    return subscribeCategoryUpdateRunner(syncCategoryUpdateState);
  }, [categoryOperation]);
  const [typeSwitchSeriesId, setTypeSwitchSeriesId] = useState<number | null>(null);
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false);
  const [batchSwitchCategoryOpen, setBatchSwitchCategoryOpen] = useState(false);
  const [batchSwitchConfirm, setBatchSwitchConfirm] = useState<{ categoryName: string; categoryKey: string } | null>(null);
  const [typeSwitchConfirm, setTypeSwitchConfirm] = useState<{ seriesId: number; categoryName: string; categoryKey: string } | null>(null);

  // 按数量判断是否需要展开按钮（首帧即确定，无跳动）
  const tagsNeedsExpand = tags.length > 5;
  const actorsNeedsExpand = actors.length > 5;


  // 同步筛选状态到 URL 参数；值没变时不触发 replace，避免无意义的路由更新。
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
      return next.toString() === prev.toString() ? prev : next;
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
      unfinished: unfinishedFilter ? '1' : null,
      empty: emptyFilter ? '1' : null,
      scope: scopeAll ? 'all' : null,
      cat: !scopeAll && mainCategory && mainCategory !== defaultCategoryKey ? mainCategory : null,
      q: debouncedSearch.trim() ? debouncedSearch.trim() : null,
    });
  }, [activeTagId, activeActorId, typeFilter, favoriteFilter, watchedFilter, unfinishedFilter, emptyFilter, mainCategory, scopeAll, debouncedSearch, defaultCategoryKey, syncParams]);

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
  }, [activeTagId, tagFilteredSeries]);

  // 恢复演员筛选
  useEffect(() => {
    if (activeActorId !== null && actorFilteredSeries === null) {
      filterByActor(activeActorId);
    }
  }, [activeActorId, actorFilteredSeries]);

  const filterByTag = async (tagId: number | null) => {
    if (tagId === null) {
      setActiveTagId(null);
      setTagFilteredSeries(null);
      return;
    }
    const cached = tagSeriesCache.get(tagId);
    if (cached) {
      setTagFilteredSeries(cached);
      setActiveTagId(tagId);
      return;
    }
    try {
      const series = await getVideoSeriesByTag(tagId);
      tagSeriesCache.set(tagId, series);
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
    const cached = actorSeriesCache.get(actorId);
    if (cached) {
      setActorFilteredSeries(cached);
      setActiveActorId(actorId);
      return;
    }
    try {
      const series = await getVideoSeriesByActor(actorId);
      actorSeriesCache.set(actorId, series);
      setActorFilteredSeries(series);
      setActiveActorId(actorId);
    } catch (error) {
      console.error('[Library] 按演员筛选失败:', error);
    }
  };

  const handleActorClick = (actorId: number) => {
    filterByActor(activeActorId === actorId ? null : actorId);
  };

  const seriesList: VideoSeries[] = (() => {
    // 双重筛选：标签和演员同时激活时取交集
    if (tagFilteredSeries && actorFilteredSeries) {
      const actorIds = new Set(actorFilteredSeries.map(s => s.id));
      return tagFilteredSeries.filter(s => actorIds.has(s.id));
    }
    return actorFilteredSeries ?? tagFilteredSeries ?? storeSeries;
  })();

  // 构建当前筛选状态的 URL 参数字符串
  const buildFilterSearch = () => {
    const params = new URLSearchParams();
    if (activeTagId !== null) params.set('tag', String(activeTagId));
    if (activeActorId !== null) params.set('actor', String(activeActorId));
    if (typeFilter !== 'all') params.set('type', typeFilter);
    if (favoriteFilter) params.set('favorite', '1');
    if (watchedFilter) params.set('watched', '1');
    if (scopeAll) params.set('scope', 'all');
    if (!scopeAll && mainCategory && mainCategory !== defaultCategoryKey) params.set('cat', mainCategory);
    if (searchTerm.trim()) params.set('q', searchTerm.trim());
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
          clearLibraryFilterCaches();
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
          notify({ message: '导入失败，请确认文件夹仍然存在并可访问', type: 'error' });
        } finally {
          setScanning(false);
        }
      }
    } catch (error) {
      console.error('[Library] 打开选择器失败:', error);
    }
  };


  const handleDeleteSeries = async (id: number) => {
    setContextMenu(null);
    clearPending();
    // 乐观更新：立即从列表移除
    const prev = useLibraryStore.getState().series;
    useLibraryStore.setState({ series: prev.filter((s: any) => s.id !== id) });
    try {
      clearLibraryFilterCaches();
      await deleteVideoSeries(id, true);
    } catch (error) {
      console.error('[Library] 删除视频集失败:', error);
      notify({ message: '删除视频集失败，请稍后重试', type: 'error' });
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

  const handleOpenSeriesInFileManager = async (seriesId: number) => {
    setContextMenu(null);
    try {
      await openSeriesInFileManager(seriesId);
    } catch (err) {
      console.error('[Library] 打开视频集源文件位置失败:', err);
      notify({ message: '打开源文件位置失败，请确认文件夹仍然存在', type: 'error' });
    }
  };

  const handleRescanMetadata = async (seriesId: number) => {
    setContextMenu(null);
    clearPending();
    try {
      clearLibraryFilterCaches();
      const matched = await rescanSingleSeriesMetadata(seriesId);
      refreshSeries().catch(() => {});
      notify({ message: matched ? '信息已更新' : '未识别到可更新的信息', type: matched ? 'success' : 'info' });
    } catch (error) {
      console.error('[Library] 检查更新失败:', error);
      notify({ message: '重新识别失败，请确认本地文件夹仍然存在', type: 'error' });
    }
  };

  const handleSwitchType = async (seriesId: number) => {
    setTypeSwitchSeriesId(seriesId);
  };

  const handleCreateSeries = async () => {
    if (!newSeriesTitle.trim() || creatingSeries) return;
    setCreatingSeries(true);
    try {
      const series = await createEmptyVideoSeries(newSeriesTitle.trim(), mainCategory);
      setShowNewSeriesModal(false);
      setNewSeriesTitle('');
      refreshSeries().catch(() => {});
      notify({ message: `已创建「${newSeriesTitle.trim()}」`, type: 'success' });
      navigate(`/series/${series.id}`);
    } catch (error) {
      console.error('[Library] 创建视频集失败:', error);
      notify({ message: '创建视频集失败', type: 'error' });
    } finally {
      setCreatingSeries(false);
    }
  };

  const handleSwitchTypeTo = async (seriesId: number, categoryKey: string, categoryName: string) => {
    setTypeSwitchConfirm({ seriesId, categoryName, categoryKey });
    setTypeSwitchSeriesId(null);
    setContextMenu(null);
    clearPending();
  };

  const doSwitchType = async () => {
    if (!typeSwitchConfirm) return;
    const name = typeSwitchConfirm.categoryName;
    setTypeSwitchConfirm(null);
    try {
      clearLibraryFilterCaches();
      await switchSeriesTypeTo(typeSwitchConfirm.seriesId, typeSwitchConfirm.categoryKey);
      refreshSeries().catch(() => {});
      notify({ message: `已移动到「${name}」`, type: 'success' });
    } catch (error) {
      console.error('[Library] 移动分类失败:', error);
      notify({ message: '移动分类失败，请稍后重试', type: 'error' });
    }
  };

  const handleCategoryScan = async () => {
    setScanConfirm(false);
    setCategoryScanning(true);
    setCategoryOperation('checking');
    try {
      const result = await checkCategoryUpdates(mainCategory);
      const hasChanges = result.new_series.length > 0
        || result.missing_series.length > 0
        || result.series_updates.some(su => su.new_videos.length > 0 || su.missing_videos.length > 0);
      if (!hasChanges) {
        setCategoryUpdateResult(null);
        setUpdateSelection(null);
        notify({ message: '没有发现新增或本地已删除的资源', type: 'info' });
        return;
      }
      setCategoryUpdateResult(result);
      setUpdateSelection({
        newSeries: new Set(result.new_series.map(s => s.name)),
        seriesUpdates: new Map(result.series_updates.map(su => [su.series_id, {
          selected: true,
          newVideos: new Set(su.new_videos.map(v => v.file_path)),
          missingVideos: new Set(su.missing_videos.map(v => v.id)),
        }])),
        missingSeries: new Set(result.missing_series.map(s => getMissingSeriesKey(s))),
      });
    } catch (error) {
      console.error('[Library] 检查更新失败:', error);
      notify({ message: '检查更新失败，请确认本地文件夹仍然存在', type: 'error' });
    } finally {
      setCategoryScanning(false);
      setCategoryOperation(null);
    }
  };

  const handleConfirmCategoryUpdates = () => {
    if (!categoryUpdateResult || !updateSelection) return;
    clearLibraryFilterCaches();
    const result = categoryUpdateResult;
    const selection = {
      newSeriesNames: Array.from(updateSelection.newSeries),
      seriesUpdates: Array.from(updateSelection.seriesUpdates.entries()).map(([seriesId, value]) => ({
        seriesId,
        selected: value.selected,
        newVideoPaths: Array.from(value.newVideos),
        missingVideoIds: Array.from(value.missingVideos),
      })),
      missingSeriesKeys: Array.from(updateSelection.missingSeries),
    };
    setCategoryUpdateResult(null);
    setUpdateSelection(null);
    setCategoryScanning(true);
    setCategoryOperation('updating');
    void runCategoryUpdateTask(mainCategory, result, selection);
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

  const normalizedSearch = debouncedSearch.toLowerCase().trim();
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
  const contentMotionKey = [scopeAll ? 'all' : mainCategory, activeTagId ?? 'tag-all', activeActorId ?? 'actor-all', favoriteFilter ? 'fav' : 'fav-all', watchedFilter ? 'watched' : unfinishedFilter ? 'unfinished' : 'watched-all', emptyFilter ? 'empty' : 'empty-all', chineseSubFilter ? 'sub' : 'sub-all', ongoingFilter ? 'ongoing' : completedFilter ? 'completed' : 'status-all', ].join('|');
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
      && (!unfinishedFilter || !watchedIds.has(series.id))
      && (!emptyFilter || series.video_count === 0)
      && (!chineseSubFilter || series.has_chinese_sub === 1)
      && (!ongoingFilter || series.status !== 'completed')
      && (!completedFilter || series.status === 'completed')
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
    const seriesIds = [...selectedIds].filter(k => k.startsWith('s-')).map(k => parseInt(k.split('-')[1]));
    // 乐观更新：立即从本地移除
    setSelectedIds(new Set());
    setSelectMode(false);
    clearLibraryFilterCaches();
    try {
      await Promise.all(seriesIds.map(id => deleteVideoSeries(id, true)));
      refreshSeries().catch(() => {});
    } catch (error) {
      refreshSeries().catch(() => {});
    }
  };

  const handleBatchDelete = async () => {
    setBatchDeleteConfirm(true);
  };

  const doBatchSwitch = async () => {
    if (!batchSwitchConfirm) return;
    const name = batchSwitchConfirm.categoryName;
    const count = [...selectedIds].filter(k => k.startsWith('s-')).length;
    setBatchSwitchConfirm(null);
    setSelectedIds(new Set());
    setSelectMode(false);
    clearLibraryFilterCaches();
    const seriesIds = [...selectedIds].filter(k => k.startsWith('s-')).map(k => parseInt(k.split('-')[1]));
    try {
      await Promise.all(seriesIds.map(id => switchSeriesTypeTo(id, batchSwitchConfirm.categoryKey).catch(() => {})));
      refreshSeries().catch(() => {});
    } catch (error) {
      refreshSeries().catch(() => {});
    }
    notify({ message: `已将 ${count} 个视频集移动到「${name}」`, type: 'success' });
  };

  return (
    <>
    <div className="changli-page changli-library-instant">
      <div className="changli-page-header" data-tutorial="library-categories">
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
                setFavoriteFilter(false);
                setWatchedFilter(false);
                setUnfinishedFilter(false);
                setEmptyFilter(false);
                setChineseSubFilter(false);
                setSearchTerm('');
              }}
            >
              {cat.name}
            </h1>
          ))}
          {categories.length === 0 && (
            <h1 className="text-3xl font-bold text-gray-400">暂无分类</h1>
          )}
        </div>
        <div className="flex gap-3">
          {categories.length === 0 ? (
            <button
              onClick={() => navigate('/settings?openCategoryModal=true')}
              className="action-btn action-btn-primary"
              title="在设置中创建新分类"
              data-tutorial="new-category"
            >
              新建分类
            </button>
          ) : (
            <div className="flex gap-2" data-tutorial="action-buttons">
              {!scopeAll && (
                <button
                  onClick={() => setScanConfirm(true)}
                  disabled={categoryScanning || !currentCategory?.scan_path}
                  className={`action-btn disabled:opacity-50 ${currentCategory?.scan_path ? 'action-btn-primary' : 'action-btn-secondary'}`}
                  title={currentCategory?.scan_path ? '扫描文件夹检查新视频和移除的视频' : '当前分类未配置扫描路径，如需使用请前往设置 → 分类配置进行设置'}
                  data-tutorial="scan-update"
                >
                  {categoryOperation === 'updating' ? '更新中...' : categoryScanning ? '检查中...' : '全量检查更新'}
                </button>
              )}
              <button
                onClick={() => {
                  if (!isScanLogicSeen()) {
                    setShowScanLogicModal(true);
                  } else {
                    importPath();
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setAddButtonContextMenu({ x: e.clientX, y: e.clientY });
                }}
                disabled={scanning}
                className="action-btn action-btn-primary disabled:opacity-50"
                data-tutorial="add-videos"
              >
                {scanning ? '添加中...' : '添加'}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="changli-filter-panel mb-8" data-tutorial="library-filters">
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
                    className={`changli-filter-pill ${activeTagId === tag.id ? 'active' : `${getTagColor(tag.id).bg} ${getTagColor(tag.id).text}`}`}
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
            <button onClick={() => { setFavoriteFilter(false); setWatchedFilter(false); setUnfinishedFilter(false); setEmptyFilter(false); setChineseSubFilter(false); setOngoingFilter(false); setCompletedFilter(false); }} className={`changli-filter-pill ${!favoriteFilter && !watchedFilter && !unfinishedFilter && !emptyFilter && !chineseSubFilter && !ongoingFilter && !completedFilter ? 'active' : ''}`}>全部</button>
            {features.tracking && (
              <button onClick={() => setFavoriteFilter(!favoriteFilter)} className={`changli-filter-pill ${favoriteFilter ? 'active' : ''}`}>已追番</button>
            )}
            {features.watched && (
              <>
                <button onClick={() => { setUnfinishedFilter(!unfinishedFilter); setWatchedFilter(false); }} className={`changli-filter-pill ${unfinishedFilter ? 'active' : ''}`}>未看完</button>
                <button onClick={() => { setWatchedFilter(!watchedFilter); setUnfinishedFilter(false); }} className={`changli-filter-pill ${watchedFilter ? 'active' : ''}`}>已看完</button>
              </>
            )}
            <button onClick={() => setEmptyFilter(!emptyFilter)} className={`changli-filter-pill ${emptyFilter ? 'active' : ''}`}>暂无资源</button>
            {features.chinese_sub && (
              <button onClick={() => setChineseSubFilter(!chineseSubFilter)} className={`changli-filter-pill ${chineseSubFilter ? 'active' : ''}`}>中文字幕</button>
            )}
            {features.status && (
              <>
                <button onClick={() => { setOngoingFilter(!ongoingFilter); setCompletedFilter(false); }} className={`changli-filter-pill ${ongoingFilter ? 'active' : ''}`}>连载中</button>
                <button onClick={() => { setCompletedFilter(!completedFilter); setOngoingFilter(false); }} className={`changli-filter-pill ${completedFilter ? 'active' : ''}`}>已完结</button>
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
            onClick={() => setShowNewSeriesModal(true)}
            className="px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 hover:-translate-y-0.5 transition-all"
          >
            新增视频集
          </button>
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

      <div className="px-4 mb-3">
        <span className="text-xs text-gray-400">共 {filteredSeries.length} 个视频</span>
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
              onClick={() => setBatchSwitchCategoryOpen(true)}
              disabled={selectedIds.size === 0}
              className="action-btn disabled:opacity-40 disabled:cursor-not-allowed"
            >
              移动到其他分类{selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
            </button>
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

      <div key={contentMotionKey} className="changli-library-content-motion">
      {filteredSeries.length > 0 && (
        <div className="mb-12" data-tutorial="library-grid">
          <div className={`auto-rows-max ${scopeAll ? 'changli-auto-grid-mixed' : isPortrait ? 'changli-auto-grid-series' : 'changli-auto-grid-video'}`}>
            {filteredSeries.map((series) => {
              const itemCategory = getSeriesCategory(series);
              const itemFeatures = getSeriesFeatures(series) || features;
              const itemIsPortrait = scopeAll ? itemCategory?.card_layout === 'portrait' : isPortrait;
              const itemEpWord = itemFeatures.episode || epWord;

              return (
                <div
                  key={series.id}
                  data-tutorial={series.id === 1 ? 'video-card' : undefined}
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
                    <SmartPoster src={seriesPosterSrc(series)} alt={series.title} posterOrientation={series.poster_orientation} />
                    <div className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-black/50 to-transparent"></div>
                    {itemFeatures.chinese_sub && series.has_chinese_sub === 1 && (
                      <span className="absolute bottom-2 left-2 changli-brand-badge text-xs font-bold px-2 py-0.5">
                        中字
                      </span>
                    )}
                    <div className="absolute bottom-2 right-2 text-white text-xs drop-shadow-lg">
                      {formatSeriesEpisodeCountLabel(series, itemEpWord, itemFeatures.status)}
                    </div>
                  </div>
                  <div className="mt-2">
                    <h3 className="text-sm font-semibold text-zinc-900 truncate group-hover:text-rose-600" title={series.code ? `[${series.code}] ${series.title}` : series.title}>
                      {series.code ? `[${series.code}] ${series.title}` : series.title}
                    </h3>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {series.video_count > 0 ? formatSeriesWatchLabel(series, itemEpWord) : ''}
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

      </div>

      {contextMenu && (() => {
        const series = storeSeries.find(s => s.id === contextMenu.id);
        const isFav = series ? favorites.some(f => 'video_count' in f && f.id === series.id) : false;
        const isWatched = series ? watchedIds.has(series.id) : false;
        return (
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
            onClick={() => handleOpenSeriesInFileManager(contextMenu.id)}
          >
            以文件资源管理器打开
          </button>
          <button
            className="changli-menu-item"
            onClick={() => {
              const id = contextMenu.id;
              const name = contextMenu.name;
              setContextMenu(null);
              toggleFavorite(id, 'series').then(() => {
                refreshSeries();
                notify({ message: isFav ? `已取消「${name}」的追番` : `已将「${name}」添加到追番`, type: 'success' });
              }).catch(() => {
                notify({ message: '操作失败，请稍后重试', type: 'error' });
              });
            }}
          >
            {isFav ? '取消该追番' : '添加到追番'}
          </button>
          <button
            className="changli-menu-item"
            onClick={() => {
              const id = contextMenu.id;
              const name = contextMenu.name;
              setContextMenu(null);
              toggleWatched(id).then(() => {
                refreshSeries();
                notify({ message: isWatched ? `已取消「${name}」的已看完标记` : `已将「${name}」标记为已看完`, type: 'success' });
              }).catch(() => {
                notify({ message: '操作失败，请稍后重试', type: 'error' });
              });
            }}
          >
            {isWatched ? '取消已看完标记' : '标记为已看完'}
          </button>
          <button
            className="changli-menu-item"
            onClick={() => handleRescanMetadata(contextMenu.id)}
          >
            检查更新
          </button>
          <button
            className="changli-menu-item"
            onClick={() => {
              
              handleSwitchType(contextMenu.id);
            }}
          >
            移动到其他分类
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
        )
      })()}
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

    {/* 全量检查更新确认弹窗 */}
    {scanConfirm && (
      <div className="changli-modal-backdrop">
        <div className="changli-modal-panel">
          <p className="text-gray-900 text-base mb-6">
            确定对「{categoryDisplayName}」执行全量检查更新？<br />
            <span className="text-sm text-gray-500">扫描路径：{currentCategory?.scan_path}</span>
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleCategoryScan}
              className="action-btn action-btn-primary flex-1 text-sm"
            >
              开始检查
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

    {/* 分类更新确认弹窗 */}
    {categoryUpdateResult && updateSelection && (
      <div className="changli-modal-backdrop" onClick={() => { setCategoryUpdateResult(null); setUpdateSelection(null); }}>
        <div className="changli-modal-panel !w-[min(100%,600px)] !p-0" onClick={e => e.stopPropagation()}>
          <div className="changli-modal-header">
            <p className="text-xs font-semibold uppercase tracking-wide text-rose-500">检查更新</p>
            <h2 className="mt-1 text-2xl font-bold text-gray-900">发现变更</h2>
          </div>
          <div className="changli-modal-body max-h-[60vh] overflow-y-auto">
            {/* 新发现视频集 */}
            {categoryUpdateResult.new_series.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">新发现视频集 ({categoryUpdateResult.new_series.filter(s => updateSelection.newSeries.has(s.name)).length}/{categoryUpdateResult.new_series.length})</h3>
                <div className="space-y-2">
                  {categoryUpdateResult.new_series.map((s, idx) => {
                    const checked = updateSelection.newSeries.has(s.name);
                    return (
                      <div key={idx} className={`rounded-2xl border p-3 flex items-center gap-3 cursor-pointer transition-opacity ${checked ? 'border-green-200 bg-green-50/50' : 'border-gray-200 bg-gray-50/50 opacity-50'}`} onClick={() => toggleNewSeries(s.name)}>
                        <input type="checkbox" checked={checked} onChange={() => toggleNewSeries(s.name)} className="w-4 h-4 rounded accent-green-500 flex-shrink-0" onClick={e => e.stopPropagation()} />
                        <div className="text-sm font-semibold text-gray-900">{s.name} <span className="text-xs font-normal text-gray-500">{s.video_count} 个视频</span></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {/* 新发现视频 */}
            {categoryUpdateResult.series_updates.filter(su => su.new_videos.length > 0).length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">新发现视频</h3>
                <div className="space-y-2">
                  {categoryUpdateResult.series_updates.filter(su => su.new_videos.length > 0).map(su => {
                    const suSel = updateSelection.seriesUpdates.get(su.series_id);
                    const seriesChecked = suSel?.selected ?? false;
                    return (
                      <div key={su.series_id} className={`rounded-2xl border p-3 transition-opacity ${seriesChecked ? 'border-green-200 bg-green-50/50' : 'border-gray-200 bg-gray-50/50 opacity-50'}`}>
                        <div className="flex items-center gap-3 cursor-pointer" onClick={() => toggleSeriesUpdate(su.series_id)}>
                          <input type="checkbox" checked={seriesChecked} onChange={() => toggleSeriesUpdate(su.series_id)} className="w-4 h-4 rounded accent-green-500 flex-shrink-0" onClick={e => e.stopPropagation()} />
                          <div className="text-sm font-semibold text-gray-900">{su.series_title} <span className="text-xs font-normal text-gray-500">+{su.new_videos.length}</span></div>
                        </div>
                        {seriesChecked && suSel && (
                          <div className="mt-2 ml-7 space-y-1">
                            {su.new_videos.map(v => {
                              const vChecked = suSel.newVideos.has(v.file_path);
                              return (
                                <div key={v.file_path} className={`flex items-center gap-2 text-xs cursor-pointer ${vChecked ? 'text-gray-700' : 'text-gray-400 line-through'}`} onClick={() => toggleNewVideo(su.series_id, v.file_path)}>
                                  <input type="checkbox" checked={vChecked} onChange={() => toggleNewVideo(su.series_id, v.file_path)} className="w-3.5 h-3.5 rounded accent-green-500 flex-shrink-0" onClick={e => e.stopPropagation()} />
                                  <span className="truncate">{v.file_name}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {/* 已移除视频集 */}
            {categoryUpdateResult.missing_series.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">已移除视频集 ({categoryUpdateResult.missing_series.filter(s => updateSelection.missingSeries.has(getMissingSeriesKey(s))).length}/{categoryUpdateResult.missing_series.length})</h3>
                <div className="space-y-2">
                  {categoryUpdateResult.missing_series.map((s) => {
                    const key = getMissingSeriesKey(s);
                    const checked = updateSelection.missingSeries.has(key);
                    return (
                      <div key={key} className={`rounded-2xl border p-3 flex items-center gap-3 cursor-pointer transition-opacity ${checked ? 'border-red-200 bg-red-50/50' : 'border-gray-200 bg-gray-50/50 opacity-50'}`} onClick={() => toggleMissingSeries(key)}>
                        <input type="checkbox" checked={checked} onChange={() => toggleMissingSeries(key)} className="w-4 h-4 rounded accent-red-500 flex-shrink-0" onClick={e => e.stopPropagation()} />
                        <div>
                          <div className="text-sm font-semibold text-gray-900">{s.name} <span className="text-xs font-normal text-gray-500">{s.video_count} 个视频</span></div>
                          <div className="text-xs text-gray-400">本地文件夹已不存在</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {/* 已移除视频 */}
            {categoryUpdateResult.series_updates.filter(su => su.missing_videos.length > 0).length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">已移除视频</h3>
                <div className="space-y-2">
                  {categoryUpdateResult.series_updates.filter(su => su.missing_videos.length > 0).map(su => {
                    const suSel = updateSelection.seriesUpdates.get(su.series_id);
                    const seriesChecked = suSel?.selected ?? false;
                    return (
                      <div key={su.series_id} className={`rounded-2xl border p-3 transition-opacity ${seriesChecked ? 'border-red-200 bg-red-50/50' : 'border-gray-200 bg-gray-50/50 opacity-50'}`}>
                        <div className="flex items-center gap-3 cursor-pointer" onClick={() => toggleSeriesUpdate(su.series_id)}>
                          <input type="checkbox" checked={seriesChecked} onChange={() => toggleSeriesUpdate(su.series_id)} className="w-4 h-4 rounded accent-red-500 flex-shrink-0" onClick={e => e.stopPropagation()} />
                          <div className="text-sm font-semibold text-gray-900">{su.series_title} <span className="text-xs font-normal text-gray-500">-{su.missing_videos.length}</span></div>
                        </div>
                        {seriesChecked && suSel && (
                          <div className="mt-2 ml-7 space-y-1">
                            {su.missing_videos.map(v => {
                              const vChecked = suSel.missingVideos.has(v.id);
                              return (
                                <div key={v.id} className={`flex items-center gap-2 text-xs cursor-pointer ${vChecked ? 'text-gray-700' : 'text-gray-400 line-through'}`} onClick={() => toggleMissingVideo(su.series_id, v.id)}>
                                  <input type="checkbox" checked={vChecked} onChange={() => toggleMissingVideo(su.series_id, v.id)} className="w-3.5 h-3.5 rounded accent-red-500 flex-shrink-0" onClick={e => e.stopPropagation()} />
                                  <span className="truncate">{v.file_name}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="changli-modal-footer">
            <button onClick={handleConfirmCategoryUpdates} className="action-btn action-btn-primary flex-1">确认更新</button>
            <button onClick={() => { setCategoryUpdateResult(null); setUpdateSelection(null); }} className="action-btn flex-1">取消</button>
          </div>
        </div>
      </div>
    )}

    {/* 移动到其他分类 - 大类选择弹窗 */}
    {typeSwitchSeriesId !== null && (
      <div className="changli-modal-backdrop" onClick={() => { setTypeSwitchSeriesId(null); setContextMenu(null); }}>
        <div className="changli-modal-panel !w-[min(100%,360px)]" onClick={e => e.stopPropagation()}>
          <h3 className="text-lg font-bold text-gray-900 mb-4">选择要移动到哪个分类</h3>
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
            onClick={() => { setTypeSwitchSeriesId(null); setContextMenu(null); }}
          >
            取消
          </button>
        </div>
      </div>
    )}

    {/* 切换分类确认弹窗 */}
    {typeSwitchConfirm && (
      <div className="changli-modal-backdrop">
        <div className="changli-modal-panel">
          <p className="text-gray-900 text-base mb-6">
            确定移动到「{typeSwitchConfirm.categoryName}」？
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

    {/* 批量切换分类 - 大类选择弹窗 */}
    {batchSwitchCategoryOpen && (
      <div className="changli-modal-backdrop" onClick={() => setBatchSwitchCategoryOpen(false)}>
        <div className="changli-modal-panel !w-[min(100%,360px)]" onClick={e => e.stopPropagation()}>
          <h3 className="text-lg font-bold text-gray-900 mb-4">选择要移动到哪个分类</h3>
          <div className="space-y-2 mb-4">
            {categories.filter(c => c.key !== mainCategory).map(cat => (
              <button
                key={cat.key}
                className="changli-list-option"
                onClick={() => {
                  setBatchSwitchCategoryOpen(false);
                  setBatchSwitchConfirm({ categoryName: cat.name, categoryKey: cat.key });
                }}
              >
                {cat.name}
              </button>
            ))}
          </div>
          <button
            className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
            onClick={() => setBatchSwitchCategoryOpen(false)}
          >
            取消
          </button>
        </div>
      </div>
    )}

    {/* 批量切换分类确认弹窗 */}
    {batchSwitchConfirm && (
      <div className="changli-modal-backdrop">
        <div className="changli-modal-panel">
          <p className="text-gray-900 text-base mb-6">
            确定将选中的 {selectedIds.size} 个视频集移动到「{batchSwitchConfirm.categoryName}」？
          </p>
          <div className="flex gap-3">
            <button
              onClick={doBatchSwitch}
              className="action-btn action-btn-primary flex-1 text-sm"
            >
              确认
            </button>
            <button
              onClick={() => setBatchSwitchConfirm(null)}
              className="action-btn flex-1 text-sm"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    )}

    <FloatingActions onRefresh={async () => { await refreshSeries(); }} refreshLabel="刷新" />

    {showNewSeriesModal && (
      <div className="changli-modal-backdrop" onClick={() => { setShowNewSeriesModal(false); setNewSeriesTitle(''); }}>
        <div className="changli-modal-panel !w-[min(100%,400px)] !p-0" onClick={e => e.stopPropagation()}>
          <div className="changli-modal-header">
            <p className="text-xs font-semibold uppercase tracking-wide text-rose-500">创建</p>
            <h2 className="mt-1 text-xl font-bold text-gray-900">新增视频集</h2>
            <p className="mt-1.5 text-[13px] text-gray-500">输入视频集名称，稍后可导入视频文件</p>
          </div>
          <div className="changli-modal-body">
            <div className="relative">
              <input
                type="text"
                value={newSeriesTitle}
                onChange={(e) => setNewSeriesTitle(e.target.value)}
                placeholder="例如：令和的斑小姐"
                className="changli-input w-full"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newSeriesTitle.trim() && !creatingSeries) {
                    handleCreateSeries();
                  }
                }}
              />
              {newSeriesTitle && (
                <button
                  onClick={() => setNewSeriesTitle('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
          <div className="changli-modal-footer">
            <button
              onClick={() => { setShowNewSeriesModal(false); setNewSeriesTitle(''); }}
              className="action-btn text-sm px-4 py-2"
            >
              取消
            </button>
            <button
              onClick={handleCreateSeries}
              disabled={!newSeriesTitle.trim() || creatingSeries}
              className="action-btn action-btn-primary text-sm px-4 py-2 disabled:opacity-50"
            >
              {creatingSeries ? (
                <span className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  创建中...
                </span>
              ) : '创建'}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* 添加按钮右键菜单 */}
    {addButtonContextMenu && (() => {
      const menuWidth = 120;
      const menuHeight = 40;
      const x = addButtonContextMenu.x + menuWidth > window.innerWidth ? addButtonContextMenu.x - menuWidth : addButtonContextMenu.x;
      const y = addButtonContextMenu.y + menuHeight > window.innerHeight ? addButtonContextMenu.y - menuHeight : addButtonContextMenu.y;
      return (
      <div
        className="fixed z-[10001] bg-white rounded-xl shadow-xl border border-gray-100 py-1 min-w-[120px]"
        style={{ left: x, top: y }}
      >
        <button
          className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          onClick={() => {
            setAddButtonContextMenu(null);
            setShowScanLogicModal(true);
          }}
        >
          识别逻辑
        </button>
      </div>
      );
    })()}

    {/* 识别逻辑说明弹窗 */}
    <ScanLogicModal
      open={showScanLogicModal}
      onClose={() => setShowScanLogicModal(false)}
      onConfirm={() => {
        markScanLogicSeen();
        setShowScanLogicModal(false);
        importPath();
      }}
    />

    </>
  );
};

export default Library;
