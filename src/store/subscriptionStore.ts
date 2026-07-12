import { create } from 'zustand';
import { getAllSubscriptions } from '../utils/api';
import type { BangumiSubscription } from '../utils/api';

interface SubscriptionState {
  subscriptions: BangumiSubscription[];
  loaded: boolean;
  dirty: boolean;
  load: () => Promise<void>;
  markDirty: () => void;
}

export const useSubscriptionStore = create<SubscriptionState>((set) => ({
  subscriptions: [],
  loaded: false,
  dirty: true,

  load: async () => {
    try {
      const subs = await getAllSubscriptions();
      set({ subscriptions: subs, loaded: true, dirty: false });
    } catch (err) {
      console.error('[SubscriptionStore] load failed:', err);
    }
  },

  markDirty: () => set({ dirty: true }),
}));
