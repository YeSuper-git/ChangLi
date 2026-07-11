import React, { useState, useEffect, useCallback } from 'react';
import {
  getAllSubscriptions,
  deleteSubscription,
  checkSubscriptionUpdates,
  getVideoSeriesList,
} from '../utils/api';
import type { BangumiSubscription, SubscriptionDownload, VideoSeries } from '../utils/api';
import { SubscriptionBindModal } from '../components/SubscriptionManager';
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

/// 从订阅标题提取网站名（"-" 前面的部分）
function extractSiteName(title: string): string {
  const idx = title.indexOf(' - ');
  if (idx > 0) return title.substring(0, idx).trim();
  return '其他';
}

const Subscriptions: React.FC = () => {
  const [subscriptions, setSubscriptions] = useState<BangumiSubscription[]>([]);
  const [seriesMap, setSeriesMap] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showBindModal, setShowBindModal] = useState(false);

  // 按网站分组的展开状态
  const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set());
  // 每个订阅的更新展开状态
  const [expandedSubs, setExpandedSubs] = useState<Set<number>>(new Set());
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
      // 默认展开所有网站
      const sites = new Set(subs.map(s => extractSiteName(s.title || s.rss_url)));
      setExpandedSites(sites);
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

  const toggleSite = (site: string) => {
    setExpandedSites(prev => {
      const next = new Set(prev);
      if (next.has(site)) next.delete(site); else next.add(site);
      return next;
    });
  };


  const handleCheckUpdates = async (sub: BangumiSubscription) => {
    setCheckingId(sub.id);
    try {
      const items = await checkSubscriptionUpdates(sub.id);
      await loadData();

      if (items.length > 0) {
        setNewEpisodes(items);
        setExpandedSubs(prev => new Set([...prev, sub.id]));
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
    const displayName = sub.title?.replace(/^[^-]+\s*-\s*/, '') || sub.title;
    if (!window.confirm(`确定取消订阅「${displayName}」？`)) return;
    try {
      await deleteSubscription(sub.id);
      notify({ message: '订阅已删除', type: 'info' });
      loadData();
    } catch {
      notify({ message: '删除订阅失败', type: 'error' });
    }
  };

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const handleCopyMagnet = async (key: string, magnetLink: string) => {
    try {
      await navigator.clipboard.writeText(magnetLink);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {}
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

  // 按网站分组
  const siteGroups: Record<string, BangumiSubscription[]> = {};
  for (const sub of subscriptions) {
    const site = extractSiteName(sub.title || sub.rss_url);
    if (!siteGroups[site]) siteGroups[site] = [];
    siteGroups[site].push(sub);
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
          <p className="text-gray-400 text-sm mt-2">点击上方"添加订阅"按钮，绑定 RSS 番组</p>
          <button
            onClick={() => setShowBindModal(true)}
            className="action-btn action-btn-primary mt-6"
          >
            添加第一个订阅
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(siteGroups).map(([site, subs]) => {
            const isExpanded = expandedSites.has(site);
            return (
              <div key={site} className="changli-panel overflow-hidden">
                {/* 网站标题栏 */}
                <button
                  onClick={() => toggleSite(site)}
                  className="w-full flex items-center justify-between px-6 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <svg
                      className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="text-sm font-medium text-gray-700">{site}</span>
                    <span className="text-xs text-gray-400">({subs.length})</span>
                  </div>
                </button>

                {/* 该网站下的订阅列表 */}
                {isExpanded && (
                  <div className="border-t border-gray-100 divide-y divide-gray-50">
                    {subs.map((sub) => {
                      const displayName = sub.title?.replace(/^[^-]+\s*-\s*/, '') || sub.title;
                      return (
                        <div key={sub.id} className="px-6 py-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-medium text-gray-900 truncate">
                                  {displayName}
                                </span>
                              </div>
                              <div className="space-y-0.5">
                                {sub.series_id && seriesMap.has(sub.series_id) && (
                                  <div className="text-xs text-gray-500">
                                    关联：{seriesMap.get(sub.series_id)}
                                  </div>
                                )}
                                <div className="text-xs text-gray-400">
                                  上次检查：{formatTimeAgo(sub.last_check_at)}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                              <button
                                onClick={() => handleCheckUpdates(sub)}
                                disabled={checkingId === sub.id}
                                className="action-btn text-xs px-3 py-1 disabled:opacity-50"
                              >
                                {checkingId === sub.id ? (
                                  <span className="flex items-center gap-1">
                                    <img src={loadingIcon} alt="" className="w-3 h-3 animate-spin" />
                                    检查中...
                                  </span>
                                ) : '检查更新'}
                              </button>
                              <button
                                onClick={() => handleDelete(sub)}
                                className="action-btn action-btn-danger text-xs px-3 py-1"
                              >
                                取消订阅
                              </button>
                            </div>
                          </div>

                          {/* 展开的更新列表 */}
                          {expandedSubs.has(sub.id) && newEpisodes.length > 0 && (
                            <div className="mt-3 space-y-1.5 border-t border-gray-100 pt-3">
                              {newEpisodes.map((ep, idx) => (
                                <div key={ep.id} className="flex items-center justify-between p-2 bg-rose-50 rounded-lg">
                                  <div className="flex-1 min-w-0">
                                    <div className="text-xs text-gray-900 truncate">{ep.title}</div>
                                    <div className="text-[10px] text-gray-400 mt-0.5">
                                      {ep.file_size ? (ep.file_size < 1024*1024*1024 ? (ep.file_size/1024/1024).toFixed(0) + ' MB' : (ep.file_size/1024/1024/1024).toFixed(1) + ' GB') : ''}
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => handleCopyMagnet(sub.id + '_' + idx, ep.magnet_link || ep.torrent_url || '')}
                                    className={copiedKey === sub.id + '_' + idx
                                      ? "ml-2 px-2 py-0.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded"
                                      : "ml-2 px-2 py-0.5 text-xs font-medium text-rose-600 bg-white border border-rose-200 rounded hover:bg-rose-50 transition-colors"
                                    }
                                  >
                                    {copiedKey === sub.id + '_' + idx ? '复制成功' : '复制磁力'}
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
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
    </div>
  );
};

export default Subscriptions;
