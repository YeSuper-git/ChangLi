import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog';
import loadingIcon from '../assets/icons/loading.svg';
import {
  clearPlayHistory,
  deletePlayHistory,
  getRecentWatchItems,
  openPlayerWindow,
  type RecentWatchItem,
} from '../utils/api';
import { SeriesPoster, SmartPoster, videoPosterDataUrl } from '../utils/media';
import { notify } from '../utils/notify';
import { useLibraryStore } from '../store/libraryStore';

type DeleteTarget = { type: 'item'; item: RecentWatchItem } | { type: 'all' } | null;

function parseHistoryDate(value: string): Date {
  const source = value.trim();
  const normalized = source.includes('T') ? source : `${source.replace(' ', 'T')}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? new Date(source) : parsed;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateHeading(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const key = dateKey(date);
  if (key === dateKey(today)) return '今天';
  if (key === dateKey(yesterday)) return '昨天';
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return '00:00';
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function episodeLabel(item: RecentWatchItem): string {
  const episode = item.video.episode_number;
  const season = item.video.season;
  if (!episode) return item.video.file_name;
  if (season === 999) return `剧场版 ${episode}`;
  if (season && season > 0) return `第 ${season} 季 · 第 ${episode} 集`;
  return `第 ${episode} 集`;
}

const WatchHistory: React.FC = () => {
  const navigate = useNavigate();
  const refreshSeries = useLibraryStore(state => state.refreshSeries);
  const [items, setItems] = useState<RecentWatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    getRecentWatchItems(10_000)
      .then(setItems)
      .catch(error => {
        console.error('[WatchHistory] 加载观看历史失败:', error);
        notify({ message: '观看历史加载失败，请稍后重试', type: 'error' });
      })
      .finally(() => setLoading(false));
  }, []);

  const groups = useMemo(() => {
    const grouped = new Map<string, { date: Date; items: RecentWatchItem[] }>();
    for (const item of items) {
      const date = parseHistoryDate(item.last_played);
      const key = dateKey(date);
      const group = grouped.get(key) || { date, items: [] };
      group.items.push(item);
      grouped.set(key, group);
    }
    return [...grouped.values()];
  }, [items]);

  const playItem = async (item: RecentWatchItem) => {
    try {
      await openPlayerWindow(item.video.id);
    } catch (error) {
      console.error('[WatchHistory] 打开播放器失败:', error);
      notify({ message: '打开播放失败，请确认视频文件仍然存在', type: 'error' });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      if (deleteTarget.type === 'all') {
        await clearPlayHistory();
        setItems([]);
        notify({ message: '观看历史已清空', type: 'success' });
      } else {
        await deletePlayHistory(deleteTarget.item.history_id);
        setItems(current => current.filter(item => item.history_id !== deleteTarget.item.history_id));
        notify({ message: '观看记录已删除', type: 'success' });
      }
      await refreshSeries().catch(() => undefined);
      setDeleteTarget(null);
    } catch (error) {
      console.error('[WatchHistory] 删除观看历史失败:', error);
      notify({ message: '删除观看历史失败，请稍后重试', type: 'error' });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="changli-page">
      <div className="changli-page-header">
        <div>
          <button type="button" onClick={() => navigate('/')} className="changli-back-link mb-5">
            <span className="changli-back-icon">‹</span>
            <span>返回首页</span>
          </button>
          <h1 className="changli-heading-xl">观看历史</h1>
          <p className="changli-muted mt-2 text-sm">按日期回顾最近播放过的视频</p>
        </div>
        {items.length > 0 && (
          <button type="button" className="action-btn action-btn-danger" onClick={() => setDeleteTarget({ type: 'all' })}>
            清空历史
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex min-h-64 items-center justify-center gap-2 text-gray-500">
          <span>正在加载观看历史</span><img src={loadingIcon} alt="" className="h-6 w-6" />
        </div>
      ) : groups.length === 0 ? (
        <div className="changli-empty-state">
          <p className="text-gray-500">暂无观看历史</p>
          <p className="mt-2 text-sm text-gray-400">播放过的视频会按日期显示在这里</p>
        </div>
      ) : (
        <div className="space-y-10">
          {groups.map(group => (
            <section key={dateKey(group.date)}>
              <div className="mb-4 flex items-center gap-3">
                <h2 className="text-xl font-bold text-gray-900">{dateHeading(group.date)}</h2>
                <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-semibold text-gray-500 shadow-sm">
                  {group.items.length} 条
                </span>
              </div>
              <div className="changli-panel divide-y divide-gray-100 overflow-hidden">
                {group.items.map(item => {
                  const playedAt = parseHistoryDate(item.last_played);
                  const total = item.total_duration || item.video.duration || 0;
                  const progress = total > 0 ? Math.min(100, Math.max(0, item.last_position / total * 100)) : 0;
                  const title = item.series?.title || item.video.file_name;
                  return (
                    <article
                      key={item.history_id}
                      className="group flex cursor-pointer items-center gap-5 p-4 transition-colors hover:bg-white/65"
                      onClick={() => void playItem(item)}
                    >
                      <div className="relative aspect-video w-48 flex-none overflow-hidden rounded-xl bg-gray-100 shadow-sm">
                        {item.series ? (
                          <SeriesPoster series={item.series} alt={title} posterOrientation={item.series.poster_orientation} />
                        ) : (
                          <SmartPoster src={videoPosterDataUrl(item.video)} alt={title} />
                        )}
                        <div className="absolute inset-x-0 bottom-0 h-1 bg-black/20">
                          <div className="h-full bg-gradient-to-r from-rose-500 to-orange-400" style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-base font-bold text-gray-900 group-hover:text-rose-600" title={title}>{title}</h3>
                        <p className="mt-1 truncate text-sm text-gray-500" title={episodeLabel(item)}>{episodeLabel(item)}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
                          <span>{formatClock(playedAt)}</span>
                          <span>看到 {formatDuration(item.last_position)} / {formatDuration(total)}</span>
                        </div>
                      </div>
                      <div className="flex flex-none items-center gap-2">
                        <button
                          type="button"
                          className="action-btn action-btn-primary text-sm"
                          onClick={event => { event.stopPropagation(); void playItem(item); }}
                        >
                          继续观看
                        </button>
                        <button
                          type="button"
                          className="action-btn action-btn-danger text-sm"
                          onClick={event => { event.stopPropagation(); setDeleteTarget({ type: 'item', item }); }}
                        >
                          删除
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={deleteTarget?.type === 'all' ? '清空观看历史' : '删除观看记录'}
        message={deleteTarget?.type === 'all'
          ? '确定清空全部观看历史吗？该操作不会删除本地视频文件。'
          : `确定删除「${deleteTarget?.item.series?.title || deleteTarget?.item.video.file_name || ''}」的观看记录吗？`}
        confirmText={deleting ? '删除中…' : deleteTarget?.type === 'all' ? '确认清空' : '确认删除'}
        danger
        onConfirm={confirmDelete}
        onCancel={() => { if (!deleting) setDeleteTarget(null); }}
      />
    </div>
  );
};

export default WatchHistory;
