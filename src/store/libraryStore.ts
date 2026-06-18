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
  loadAll: () => Promise<void>;
  refreshVideos: () => Promise<void>;
  refreshSeries: () => Promise<void>;
  refreshActors: () => Promise<void>;
  refreshTags: () => Promise<void>;
  loadFavorites: () => Promise<void>;
  toggleFavorite: (id: number, type: 'video' | 'series') => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  videos: [],
  series: [],
  actors: [],
  tags: [],
  favorites: [],
  loading: false,
  loaded: false,

  loadAll: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const [videos, series, actors, tags, favVideos, favSeries] = await Promise.all([
        getStandaloneVideos(),
        getVideoSeriesList(),
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
      const videos = await getStandaloneVideos();
      set({ videos });
    } catch (error) {
      console.error('[LibraryStore] refreshVideos failed:', error);
    }
  },

  refreshSeries: async () => {
    try {
      const series = await getVideoSeriesList();
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
}));
