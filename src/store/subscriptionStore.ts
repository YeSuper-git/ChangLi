import { create } from 'zustand';
import { getAllSubscriptions, getVideoSeriesList } from '../utils/api';
import type { BangumiSubscription, VideoSeries } from '../utils/api';

interface SubscriptionState {
  subscriptions: BangumiSubscription[];
  seriesMap: Map<number, string>;
  loaded: boolean;
  load: () => Promise<void>;
}

export const useSubscriptionStore = create<SubscriptionState>((set) => ({
  subscriptions: [],
  seriesMap: new Map(),
  loaded: false,

  load: async () => {
    try {
      const [subs, seriesList] = await Promise.all([
        getAllSubscriptions(),
        getVideoSeriesList(),
      ]);
      const map = new Map<number, string>();
      seriesList.forEach((s: VideoSeries) => map.set(s.id, s.title));
      set({ subscriptions: subs, seriesMap: map, loaded: true });
    } catch (err) {
      console.error('[SubscriptionStore] load failed:', err);
    }
  },
}));
