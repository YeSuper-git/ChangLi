import { create } from 'zustand';
import {
  getActors,
  getTags,
  getStandaloneVideos,
  getVideoSeriesList,
  getFavoriteVideos,
  getFavoriteSeries,
  toggleFavorite as apiToggleFavorite,
} from '../utils/api';
import type { Actor, Tag, Video, VideoSeries } from '../utils/api';

export type FavoriteItem = Video | VideoSeries;

interface LibraryState {
  videos: Video[];
  series: VideoSeries[];
  actors: Actor[];
  tags: Tag[];
  favorites: FavoriteItem[];
  loading: boolean;
  loaded: boolean;
  sortBy: 'created_at' | 'title';
  sortOrder: 'asc' | 'desc';
  loadAll: () => Promise<void>;
  refreshVideos: () => Promise<void>;
  refreshSeries: () => Promise<void>;
  refreshActors: () => Promise<void>;
  refreshTags: () => Promise<void>;
  loadFavorites: () => Promise<void>;
  toggleFavorite: (id: number, type: 'video' | 'series') => Promise<void>;
  setSortBy: (sortBy: 'created_at' | 'title') => void;
  setSortOrder: (sortOrder: 'asc' | 'desc') => void;
  toggleSortOrder: () => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  videos: [],
  series: [],
  actors: [],
  tags: [],
  favorites: [],
  loading: false,
  loaded: false,
  sortBy: 'created_at',
  sortOrder: 'desc',

  loadAll: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const { sortBy, sortOrder } = get();
      const [videos, series, actors, tags, favVideos, favSeries] = await Promise.all([
        getStandaloneVideos(sortBy, sortOrder),
        getVideoSeriesList(sortBy, sortOrder),
        getActors(),
        getTags(),
        getFavoriteVideos(),
        getFavoriteSeries(),
      ]);
      const favorites: FavoriteItem[] = [...favSeries, ...favVideos];
      set({ videos, series, actors, tags, favorites, loaded: true });
    } catch (error) {
      console.error('[LibraryStore] loadAll failed:', error);
    } finally {
      set({ loading: false });
    }
  },

  refreshVideos: async () => {
    try {
      const { sortBy, sortOrder } = get();
      const videos = await getStandaloneVideos(sortBy, sortOrder);
      set({ videos });
    } catch (error) {
      console.error('[LibraryStore] refreshVideos failed:', error);
    }
  },

  refreshSeries: async () => {
    try {
      const { sortBy, sortOrder } = get();
      const series = await getVideoSeriesList(sortBy, sortOrder);
      set({ series });
    } catch (error) {
      console.error('[LibraryStore] refreshSeries failed:', error);
    }
  },

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
    } catch (error) {
      console.error('[LibraryStore] refreshTags failed:', error);
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

  toggleFavorite: async (id: number, type: 'video' | 'series') => {
    try {
      await apiToggleFavorite(id, type);
      // Reload favorites after toggling
      await get().loadFavorites();
    } catch (error) {
      console.error('[LibraryStore] toggleFavorite failed:', error);
    }
  },

  setSortBy: (sortBy: 'created_at' | 'title') => {
    set({ sortBy });
  },

  setSortOrder: (sortOrder: 'asc' | 'desc') => {
    set({ sortOrder });
  },

  toggleSortOrder: () => {
    set((state) => ({ sortOrder: state.sortOrder === 'desc' ? 'asc' : 'desc' }));
  },
}));
