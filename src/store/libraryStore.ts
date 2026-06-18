import { create } from 'zustand';
import {
  getActors,
  getTags,
  getStandaloneVideos,
  getVideoSeriesList,
} from '../utils/api';
import type { Actor, Tag, Video, VideoSeries } from '../utils/api';

interface LibraryState {
  videos: Video[];
  series: VideoSeries[];
  actors: Actor[];
  tags: Tag[];
  loading: boolean;
  loaded: boolean;
  loadAll: () => Promise<void>;
  refreshVideos: () => Promise<void>;
  refreshSeries: () => Promise<void>;
  refreshActors: () => Promise<void>;
  refreshTags: () => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  videos: [],
  series: [],
  actors: [],
  tags: [],
  loading: false,
  loaded: false,

  loadAll: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const [videos, series, actors, tags] = await Promise.all([
        getStandaloneVideos(),
        getVideoSeriesList(),
        getActors(),
        getTags(),
      ]);
      set({ videos, series, actors, tags, loaded: true });
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
}));
