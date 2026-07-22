import { create } from 'zustand';
import {
  getActors,
  getTags,
  getVideoSeriesList,
  getFavoriteVideos,
  getFavoriteSeries,
  toggleFavorite as apiToggleFavorite,
  getAllCategories,
} from '../utils/api';
import type { Actor, Category, Tag, Video, VideoSeries } from '../utils/api';

export type FavoriteItem = Video | VideoSeries;

interface LibraryState {
  series: VideoSeries[];
  actors: Actor[];
  tags: Tag[];
  favorites: FavoriteItem[];
  categories: Category[];
  watchedIds: Set<number>;
  loading: boolean;
  loaded: boolean;
  seriesDirty: boolean;
  sortBy: 'created_at' | 'title';
  sortOrder: 'asc' | 'desc';
  loadAll: () => Promise<void>;
  refreshSeries: () => Promise<void>;
  markSeriesDirty: () => void;
  refreshActors: () => Promise<void>;
  refreshTags: () => Promise<void>;
  refreshCategories: () => Promise<void>;
  loadFavorites: () => Promise<void>;
  loadWatched: () => void;
  upsertSeriesLocal: (series: VideoSeries) => void;
  patchSeriesLocal: (id: number, patch: Partial<VideoSeries>) => void;
  removeSeriesLocal: (ids: number | number[]) => void;
  adjustSeriesVideoCountLocal: (id: number, delta: number) => void;
  toggleFavorite: (id: number, type: 'video' | 'series') => Promise<void>;
  setSortBy: (sortBy: 'created_at' | 'title') => void;
  setSortOrder: (sortOrder: 'asc' | 'desc') => void;
  toggleSortOrder: () => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  series: [],
  actors: [],
  tags: [],
  favorites: [],
  categories: [],
  watchedIds: new Set<number>(),
  loading: false,
  loaded: false,
  seriesDirty: false,
  sortBy: 'created_at',
  sortOrder: 'desc',

  loadAll: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const { sortBy, sortOrder } = get();
      const t0 = performance.now();
      const series = await getVideoSeriesList(sortBy, sortOrder);
      const t1 = performance.now();
      console.log(`[loadAll] getVideoSeriesList: ${(t1-t0).toFixed(0)}ms, ${series.length} items`);
      
      const actors = await getActors();
      const t2 = performance.now();
      console.log(`[loadAll] getActors: ${(t2-t1).toFixed(0)}ms, ${actors.length} items`);
      
      const [tags, categories, favVideos, favSeries] = await Promise.all([
        getTags(),
        getAllCategories(),
        getFavoriteVideos(),
        getFavoriteSeries(),
      ]);
      const t3 = performance.now();
      console.log(`[loadAll] others: ${(t3-t2).toFixed(0)}ms`);
      
      const favorites: FavoriteItem[] = [...favSeries, ...favVideos];
      const watchedIds = new Set<number>();
      for (const s of series) {
        if (s.is_watched === 1) watchedIds.add(s.id);
      }
      set({ series, actors, tags, categories, favorites, watchedIds, loaded: true });
      console.log(`[loadAll] total: ${(performance.now()-t0).toFixed(0)}ms`);
    } catch (error) {
      console.error('[LibraryStore] loadAll failed:', error);
    } finally {
      set({ loading: false });
    }
  },

  refreshSeries: async () => {
    try {
      const { sortBy, sortOrder } = get();
      const [series, favVideos, favSeries] = await Promise.all([
        getVideoSeriesList(sortBy, sortOrder),
        getFavoriteVideos(),
        getFavoriteSeries(),
      ]);
      const favorites: FavoriteItem[] = [...favSeries, ...favVideos];
      const watchedIds = new Set<number>();
      for (const s of series) {
        if (s.is_watched === 1) watchedIds.add(s.id);
      }
      set({ series, favorites, watchedIds, seriesDirty: false });
    } catch (error) {
      console.error('[LibraryStore] refreshSeries failed:', error);
    }
  },

  markSeriesDirty: () => set({ seriesDirty: true }),

  refreshActors: async () => {
    try {
      const actors = await getActors();
      set({ actors });
    } catch (error) {
      console.error('[LibraryStore] refreshActors failed:', error);
    }
  },

  refreshTags: async () => {
    try {
      const tags = await getTags();
      set({ tags });
      // 清除分类筛选缓存，防止标签编辑后视频页标签列表不更新
      try {
        const { clearLibraryFilterCaches } = await import('../pages/Library');
        clearLibraryFilterCaches();
      } catch {}
    } catch (error) {
      console.error('[LibraryStore] refreshTags failed:', error);
    }
  },

  refreshCategories: async () => {
    try {
      const categories = await getAllCategories();
      set({ categories });
    } catch (error) {
      console.error('[LibraryStore] refreshCategories failed:', error);
    }
  },

  loadFavorites: async () => {
    try {
      const [favVideos, favSeries] = await Promise.all([
        getFavoriteVideos(),
        getFavoriteSeries(),
      ]);
      const favorites: FavoriteItem[] = [...favSeries, ...favVideos];
      set({ favorites });
    } catch (error) {
      console.error('[LibraryStore] loadFavorites failed:', error);
    }
  },

  loadWatched: () => {
    const { series } = get();
    const watchedIds = new Set<number>();
    for (const s of series) {
      if (s.is_watched === 1) watchedIds.add(s.id);
    }
    set({ watchedIds });
  },

  upsertSeriesLocal: (series: VideoSeries) => {
    set((state) => {
      const exists = state.series.some((item) => item.id === series.id);
      const nextSeries = exists
        ? state.series.map((item) => item.id === series.id ? { ...item, ...series } : item)
        : [series, ...state.series];
      return { series: nextSeries };
    });
  },

  patchSeriesLocal: (id: number, patch: Partial<VideoSeries>) => {
    set((state) => {
      const nextSeries = state.series.map((item) => item.id === id ? { ...item, ...patch } : item);
      const nextFavorites = state.favorites.map((item) => (
        'video_count' in item && item.id === id ? { ...item, ...patch } : item
      ));
      const watchedIds = new Set(state.watchedIds);
      if (patch.is_watched !== undefined) {
        if (patch.is_watched === 1) watchedIds.add(id);
        else watchedIds.delete(id);
      }
      return { series: nextSeries, favorites: nextFavorites, watchedIds };
    });
  },

  removeSeriesLocal: (ids: number | number[]) => {
    const idSet = new Set(Array.isArray(ids) ? ids : [ids]);
    set((state) => ({
      series: state.series.filter((item) => !idSet.has(item.id)),
      favorites: state.favorites.filter((item) => !('video_count' in item && idSet.has(item.id))),
      watchedIds: new Set([...state.watchedIds].filter((id) => !idSet.has(id))),
    }));
  },

  adjustSeriesVideoCountLocal: (id: number, delta: number) => {
    const current = get().series.find((item) => item.id === id)?.video_count ?? 0;
    get().patchSeriesLocal(id, { video_count: Math.max(0, current + delta) });
  },

  toggleFavorite: async (id: number, type: 'video' | 'series') => {
    const { favorites } = get();
    // 乐观更新：先改本地状态
    const isCurrentlyFav = favorites.some(f => f.id === id && (type === 'series' ? 'video_count' in f : !('video_count' in f)));
    if (isCurrentlyFav) {
      set({ favorites: favorites.filter(f => !(f.id === id && (type === 'series' ? 'video_count' in f : !('video_count' in f)))) });
    }
    if (type === 'series') {
      get().patchSeriesLocal(id, { is_favorite: isCurrentlyFav ? 0 : 1 });
    }
    try {
      await apiToggleFavorite(id, type);
      // 后台静默同步
      get().loadFavorites().catch(() => {});
    } catch (error) {
      // 失败则回滚
      if (!isCurrentlyFav) {
        set({ favorites: favorites.filter(f => f.id !== id) });
      } else {
        set({ favorites });
      }
      if (type === 'series') {
        get().patchSeriesLocal(id, { is_favorite: isCurrentlyFav ? 1 : 0 });
      }
      console.error('[LibraryStore] toggleFavorite failed:', error);
    }
  },

  setSortBy: async (sortBy: 'created_at' | 'title') => {
    set({ sortBy });
    // 串行刷新，避免 SQLite 并发锁
    await get().refreshSeries();
  },

  setSortOrder: async (sortOrder: 'asc' | 'desc') => {
    set({ sortOrder });
    await get().refreshSeries();
  },

  toggleSortOrder: async () => {
    set((state) => ({ sortOrder: state.sortOrder === 'desc' ? 'asc' : 'desc' }));
    await get().refreshSeries();
  },
}));
