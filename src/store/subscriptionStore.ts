import { create } from 'zustand';
import { getAllSubscriptions, getVideoSeriesList } from '../utils/api';
import type { BangumiSubscription, VideoSeries } from '../utils/api';

interface SubscriptionState {
  subscriptions: BangumiSubscription[];
  seriesMap: Record<number, string>;
  loaded: boolean;
  load: () => Promise<void>;
}

// 空对象引用，避免每次创建新 Map
const EMPTY_MAP: Record<number, string> = {};

export const useSubscriptionStore = create<SubscriptionState>((set) => ({
  subscriptions: [],
  seriesMap: EMPTY_MAP,
  loaded: false,

  load: async () => {
    try {
      const [subs, seriesList] = await Promise.all([
        getAllSubscriptions(),
        getVideoSeriesList(),
      ]);
      const map: Record<number, string> = {};
      seriesList.forEach((s: VideoSeries) => { map[s.id] = s.title; });
      set({ subscriptions: subs, seriesMap: map, loaded: true });
    } catch (err) {
      console.error('[SubscriptionStore] load failed:', err);
    }
  },
}));
