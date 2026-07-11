import {
  addCategorySeriesByPaths,
  addVideosToSeries,
  deleteVideoSeriesBatch,
  deleteVideosBatch,
} from './api';
import type { CategoryUpdateResult } from './api';
import { notify } from './notify';
import { useLibraryStore } from '../store/libraryStore';

export type CategoryUpdateSelectionSnapshot = {
  newSeriesNames: string[];
  seriesUpdates: Array<{
    seriesId: number;
    selected: boolean;
    newVideoPaths: string[];
    missingVideoIds: number[];
  }>;
  missingSeriesKeys: string[];
};

type RunnerState = {
  operation: 'updating' | null;
  categoryKey: string | null;
};

const state: RunnerState = { operation: null, categoryKey: null };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach(listener => listener());
}

export function getCategoryUpdateRunnerState(): RunnerState {
  return { ...state };
}

export function subscribeCategoryUpdateRunner(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getMissingSeriesKey = (series: { id?: number | null; name: string }) => series.id != null ? `id:${series.id}` : `name:${series.name}`;

export async function runCategoryUpdateTask(
  categoryKey: string,
  result: CategoryUpdateResult,
  selection: CategoryUpdateSelectionSnapshot,
): Promise<void> {
  if (state.operation) {
    notify({ message: '已有更新正在执行，请稍后再试', type: 'info' });
    return;
  }

  state.operation = 'updating';
  state.categoryKey = categoryKey;
  emit();

  try {
    const selectedNewNames = new Set(selection.newSeriesNames);
    const selectedNewSeries = result.new_series.filter(s => selectedNewNames.has(s.name));
    if (selectedNewSeries.length > 0) {
      const selectedNewSeriesPaths = selectedNewSeries
        .map(s => s.folder_path)
        .filter((path): path is string => typeof path === 'string' && path.length > 0);
      if (selectedNewSeriesPaths.length > 0) {
        await addCategorySeriesByPaths(categoryKey, selectedNewSeriesPaths);
      }
    }

    const selectedUpdateMap = new Map(selection.seriesUpdates.map(item => [item.seriesId, item]));
    const missingVideoIds: number[] = [];
    let totalNewEps = 0;
    let totalMissEps = 0;

    for (const su of result.series_updates) {
      const selected = selectedUpdateMap.get(su.series_id);
      if (!selected || !selected.selected) continue;

      const newVideoPathSet = new Set(selected.newVideoPaths);
      const selectedNewVideoPaths = su.new_videos
        .filter(video => newVideoPathSet.has(video.file_path))
        .map(video => video.file_path);
      if (selectedNewVideoPaths.length > 0) {
        await addVideosToSeries(su.series_id, selectedNewVideoPaths);
        totalNewEps += selectedNewVideoPaths.length;
      }

      const missingVideoIdSet = new Set(selected.missingVideoIds);
      const selectedMissingIds = su.missing_videos
        .filter(video => missingVideoIdSet.has(video.id))
        .map(video => video.id);
      missingVideoIds.push(...selectedMissingIds);
      totalMissEps += selectedMissingIds.length;
    }

    if (missingVideoIds.length > 0) {
      await deleteVideosBatch(missingVideoIds);
    }

    const missingSeriesKeySet = new Set(selection.missingSeriesKeys);
    const missingSeriesIds = result.missing_series
      .filter(series => missingSeriesKeySet.has(getMissingSeriesKey(series)))
      .map(series => series.id)
      .filter((id): id is number => typeof id === 'number');
    if (missingSeriesIds.length > 0) {
      await deleteVideoSeriesBatch(missingSeriesIds);
    }

    await useLibraryStore.getState().refreshSeries();

    const parts: string[] = [];
    if (selectedNewSeries.length > 0) parts.push(`添加 ${selectedNewSeries.length} 个新发现的视频集`);
    if (totalNewEps > 0) parts.push(`添加 ${totalNewEps} 个新发现的视频`);
    if (totalMissEps > 0) parts.push(`移除 ${totalMissEps} 个本地已删除的视频记录`);
    if (missingSeriesIds.length > 0) parts.push(`移除 ${missingSeriesIds.length} 个本地已删除的视频集`);
    notify({ message: parts.length > 0 ? parts.join('，') : '更新完成', type: 'success' });
  } catch (error) {
    console.error('[CategoryUpdateRunner] 更新失败:', error);
    notify({ message: '更新失败，请稍后重试', type: 'error' });
  } finally {
    state.operation = null;
    state.categoryKey = null;
    emit();
  }
}
