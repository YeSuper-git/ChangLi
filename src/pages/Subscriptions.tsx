import React, { useState, useEffect, useCallback } from 'react';
import {
  getAllSubscriptions,
  deleteSubscription,
  checkSubscriptionUpdates,
  getVideoSeriesList,
} from '../utils/api';
import type { BangumiSubscription, SubscriptionDownload, VideoSeries } from '../utils/api';
import { SubscriptionBindModal, NewEpisodeModal } from '../components/SubscriptionManager';
import { notify } from '../utils/notify';
import loadingIcon from '../assets/icons/loading.svg';

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return '从未';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} 小时前`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD} 天前`;
}

const Subscriptions: React.FC = () => {
  const [subscriptions, setSubscriptions] = useState<BangumiSubscription[]>([]);
  const [seriesMap, setSeriesMap] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showBindModal, setShowBindModal] = useState(false);

  // New episode modal state
  const [showNewEpisodes, setShowNewEpisodes] = useState(false);
  const [newEpisodes, setNewEpisodes] = useState<SubscriptionDownload[]>([]);

  // Per-subscription checking state
  const [checkingId, setCheckingId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [subs, seriesList] = await Promise.all([
        getAllSubscriptions(),
        getVideoSeriesList(),
      ]);
      setSubscriptions(subs);
      const map = new Map<number, string>();
      seriesList.forEach((s: VideoSeries) => map.set(s.id, s.title));
      setSeriesMap(map);
    } catch (err) {
      console.error('[Subscriptions] 加载订阅列表失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
    loadData();
  }, [loadData]);

  const handleCheckUpdates = async (sub: BangumiSubscription) => {
    setCheckingId(sub.id);
    try {
      const items = await checkSubscriptionUpdates(sub.id);
      // Refresh list to update last_check_at
      await loadData();

      if (items.length > 0) {
        setNewEpisodes(items);
        setShowNewEpisodes(true);
        notify({ message: `发现 ${items.length} 个新剧集`, type: 'success' });
      } else {
        notify({ message: '暂无新剧集更新', type: 'info' });
      }
    } catch (err) {
      console.error('[Subscriptions] 检查更新失败:', err);
      notify({ message: '检查更新失败', type: 'error' });
    } finally {
      setCheckingId(null);
    }
  };

  const handleDelete = async (sub: BangumiSubscription) => {
    try {
      await deleteSubscription(sub.id);
      notify({ message: '订阅已删除', type: 'info' });
      loadData();
    } catch {
      notify({ message: '删除订阅失败', type: 'error' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 flex items-center gap-2">
          <img src={loadingIcon} alt="加载中" className="w-6 h-6" />
          加载中...
        </div>
      </div>
    );
  }

  return (
    <div className="changli-page">
      <div className="changli-page-header">
        <h1 className="changli-heading-xl">订阅管理</h1>
        <button
          onClick={() => setShowBindModal(true)}
          className="action-btn action-btn-primary text-sm"
        >
          + 添加订阅
        </button>
      </div>

      {subscriptions.length === 0 ? (
        <div className="changli-empty-state">
          <p className="text-gray-500 text-lg">暂无订阅</p>
          <p className="text-gray-400 text-sm mt-2">点击上方"添加订阅"按钮，绑定 Bangumi 番组</p>
          <button
            onClick={() => setShowBindModal(true)}
            className="action-btn action-btn-primary mt-6"
          >
            添加第一个订阅
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {subscriptions.map((sub) => (
            <div
              key={sub.id}
              className="changli-panel p-6 transition-transform duration-200 hover:-translate-y-0.5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold text-gray-900 truncate">
                      {sub.title}
                    </h3>
                    <span
                      className={`tag ${
                        sub.enabled
                          ? 'status-completed'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {sub.enabled ? '已启用' : '已禁用'}
                    </span>
                  </div>

                  <div className="space-y-1">
                    {sub.series_id && seriesMap.has(sub.series_id) && (
                      <div className="text-sm text-gray-600">
                        <span className="text-gray-400">关联视频集：</span>
                        {seriesMap.get(sub.series_id)}
                      </div>
                    )}
                    <div className="text-sm text-gray-500 truncate">
                      <span className="text-gray-400">RSS：</span>
                      <span className="font-mono text-xs">{sub.rss_url}</span>
                    </div>
                    <div className="text-sm text-gray-500">
                      <span className="text-gray-400">上次检查：</span>
                      {formatTimeAgo(sub.last_check_at)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleCheckUpdates(sub)}
                    disabled={checkingId === sub.id}
                    className="action-btn text-xs px-3 py-1.5 disabled:opacity-50"
                  >
                    {checkingId === sub.id ? (
                      <span className="flex items-center gap-1">
                        <img src={loadingIcon} alt="" className="w-3 h-3 animate-spin" />
                        检查中...
                      </span>
                    ) : (
                      '检查更新'
                    )}
                  </button>
                  <button
                    onClick={() => handleDelete(sub)}
                    className="action-btn action-btn-danger text-xs px-3 py-1.5"
                  >
                    取消订阅
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <SubscriptionBindModal
        open={showBindModal}
        onClose={() => setShowBindModal(false)}
        onBind={() => {
          setShowBindModal(false);
          loadData();
        }}
      />

      <NewEpisodeModal
        open={showNewEpisodes}
        episodes={newEpisodes}
        onClose={() => setShowNewEpisodes(false)}
      />
    </div>
  );
};

export default Subscriptions;
