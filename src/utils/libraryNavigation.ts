import type { NavigateFunction } from 'react-router-dom';
import { useLibraryStore } from '../store/libraryStore';
import { preloadVideoSeriesPosters } from './media';

let preparePromise: Promise<void> | null = null;

export async function prepareLibraryPosters(): Promise<void> {
  if (preparePromise) return preparePromise;
  preparePromise = (async () => {
    const store = useLibraryStore.getState();
    if (!store.loaded && !store.loading) {
      await store.loadAll();
    }
    if (useLibraryStore.getState().seriesDirty) {
      await useLibraryStore.getState().refreshSeries();
    }
    const ids = useLibraryStore.getState().series.map(series => series.id);
    await preloadVideoSeriesPosters(ids, 8);
  })().finally(() => {
    preparePromise = null;
  });
  return preparePromise;
}

export async function navigateToLibraryReady(navigate: NavigateFunction, path = '/library'): Promise<void> {
  await prepareLibraryPosters();
  navigate(path);
}
