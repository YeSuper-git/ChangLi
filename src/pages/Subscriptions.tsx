import React, { useState, useEffect, useCallback } from 'react';
import { useSubscriptionStore } from '../store/subscriptionStore';
import {
  deleteSubscription,
  checkSubscriptionUpdates,
} from '../utils/api';
import type { BangumiSubscription } from '../utils/api';
import { SubscriptionBindModal } from '../components/SubscriptionManager';
import { notify } from '../utils/notify';
import loadingIcon from '../assets/icons/loading.svg';


/// 从 localStorage 读取检查更新结果
function loadSubUpdates(): Map<number, any[]> {
  try {
    const raw = localStorage.getItem('changli_sub_updates');
    if (!raw) return new Map();
    const obj = JSON.parse(raw);
    return new Map(Object.entries(obj).map(([k, v]) => [Number(k), v as any[]]));
  } catch { return new Map(); }
}

/// 保存检查更新结果到 localStorage
function saveSubUpdates(updates: Map<number, any[]>) {
  const obj: Record<string, any[]> = {};
  updates.forEach((v, k) => { if (v.length > 0) obj[k] = v; });
  localStorage.setItem('changli_sub_updates', JSON.stringify(obj));
}

/// 从 localStorage 读取展开状态
function loadExpandedSubs(): Set<number> {
  try {
    const raw = localStorage.getItem('changli_expanded_subs');
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch { return new Set(); }
}

/// 保存展开状态到 localStorage
function saveExpandedSubs(expanded: Set<number>) {
  localStorage.setItem('changli_expanded_subs', JSON.stringify([...expanded]));
}

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
  const [showBindModal, setShowBindModal] = useState(false);

  // 按网站分组的展开状态
  const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set());
  // 每个订阅的更新展开状态
  const [expandedSubs, setExpandedSubs] = useState<Set<number>>(() => loadExpandedSubs());
  // 每个订阅的更新结果：subId -> episodes
  const [subUpdates, setSubUpdates] = useState<Map<number, any[]>>(() => loadSubUpdates());

  // Per-subscription checking state
  const [checkingId, setCheckingId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    try {
      await useSubscriptionStore.getState().load();
      const { subscriptions: subs, seriesMap: map } = useSubscriptionStore.getState();
      setSubscriptions(subs);
      setSeriesMap(map);
      // 默认展开所有网站
      const sites = new Set(subs.map(s => extractSiteName(s.title || s.rss_url)));
      setExpandedSites(sites);
    } catch (err) {
      console.error('[Subscriptions] 加载订阅列表失败:', err);
    }
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
    // 先用缓存数据快速渲染
    const { subscriptions: cached, loaded } = useSubscriptionStore.getState();
    if (loaded && cached.length > 0) {
      setSubscriptions(cached);
      const map = useSubscriptionStore.getState().seriesMap;
      setSeriesMap(map);
      const sites = new Set(cached.map(s => extractSiteName(s.title || s.rss_url)));
      setExpandedSites(sites);
      // 有缓存就不触发 API 调用
      return;
    }
    // 无缓存才加载
    loadData();
  }, [loadData]);

  const toggleSite = (site: string) => {
    setExpandedSites(prev => {
      const next = new Set(prev);
      if (next.has(site)) next.delete(site); else next.add(site);
      return next;
    });
  };


  const toggleSub = (subId: number) => {
    setExpandedSubs(prev => {
      const next = new Set(prev);
      if (next.has(subId)) next.delete(subId); else next.add(subId);
      saveExpandedSubs(next);
      return next;
    });
  };

  const handleCheckUpdates = async (sub: BangumiSubscription) => {
    setCheckingId(sub.id);
    try {
      const items = await checkSubscriptionUpdates(sub.id);
      await loadData();

      setSubUpdates(prev => {
        const next = new Map(prev);
        next.set(sub.id, items);
        saveSubUpdates(next);
        return next;
      });
      setExpandedSubs(prev => { const next = new Set([...prev, sub.id]); saveExpandedSubs(next); return next; });
      if (items.length > 0) {
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
    setDeleteConfirm(sub);
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    const sub = deleteConfirm;
    setDeleteConfirm(null);
    try {
      await deleteSubscription(sub.id);
      setSubUpdates(prev => {
        const next = new Map(prev);
        next.delete(sub.id);
        saveSubUpdates(next);
        return next;
      });
      notify({ message: '订阅已删除', type: 'info' });
      loadData();
    } catch {
      notify({ message: '删除订阅失败', type: 'error' });
    }
  };

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<BangumiSubscription | null>(null);
  const handleCopyMagnet = async (key: string, magnetLink: string) => {
    try {
      await navigator.clipboard.writeText(magnetLink);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {}
  };

  const handleDownload = async (ep: any) => {
    const magnet = ep.magnet_link || ep.torrent_url;
    if (!magnet) {
      notify({ message: '无可用下载链接', type: 'error' });
      return;
    }
    // 预留：Phase 2 内置 aria2 下载
    // 暂时复制到剪贴板并提示
    try {
      await navigator.clipboard.writeText(magnet);
      notify({ message: '磁力链接已复制，请使用外部下载器打开', type: 'info' });
    } catch {
      notify({ message: '复制失败', type: 'error' });
    }
  };

  // 不显示全屏 loading，直接显示内容

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
                              <button
                                onClick={() => toggleSub(sub.id)}
                                className="flex items-center gap-1.5 mb-1 group"
                              >
                                <svg
                                  className={`w-3.5 h-3.5 text-gray-400 transition-transform ${expandedSubs.has(sub.id) ? 'rotate-90' : ''}`}
                                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                                <span className="text-sm font-medium text-gray-900 truncate group-hover:text-rose-600 transition-colors">
                                  {displayName}
                                </span>
                              </button>
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
                                    检查中 <img src={loadingIcon} alt="" className="w-3 h-3" />
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
                          {expandedSubs.has(sub.id) && (() => {
                            const episodes = subUpdates.get(sub.id) || [];
                            if (episodes.length === 0 && checkingId !== sub.id) {
                              return (
                                <div className="mt-3 text-xs text-gray-400 border-t border-gray-100 pt-3">
                                  暂无新剧集更新
                                </div>
                              );
                            }
                            if (episodes.length === 0) return null;
                            // 按字幕组+版本分组
                            const groups: Record<string, any[]> = {};
                            for (const ep of episodes) {
                              const t = ep.title || '';
                              let sg = '未知字幕组';
                              if (t.startsWith('[')) { const e = t.indexOf(']'); if (e > 0) sg = t.substring(1, e); }
                              const l = t.toLowerCase();
                              const vp: string[] = [];
                              if (l.includes('1080p') || l.includes('1920x1080')) vp.push('1080p');
                              else if (l.includes('720p')) vp.push('720p');
                              if (l.includes('chs') || l.includes('简中') || l.includes('简体')) vp.push('简中');
                              else if (l.includes('简繁') || l.includes('简／繁')) vp.push('简繁');
                              else if (l.includes('cht') || l.includes('繁中')) vp.push('繁中');
                              if (l.includes('baha')) vp.push('Baha');
                              else if (l.includes('cr ')) vp.push('CR');
                              else if (l.includes('abema')) vp.push('ABEMA');
                              if (l.includes('无修') || l.includes('uncensored')) vp.push('无修');
                              if (l.includes('放送版') || l.includes('on-air')) vp.push('放送版');
                              const gk = '[' + sg + '] ' + (vp.length > 0 ? vp.join(' ') : '默认');
                              if (!groups[gk]) groups[gk] = [];
                              groups[gk].push(ep);
                            }
                            let globalIdx = 0;
                            return (
                              <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                                {Object.entries(groups).map(([gKey, gItems]) => (
                                  <div key={gKey} className="bg-emerald-50 rounded-xl p-2.5">
                                    <div className="flex items-center justify-between mb-1.5">
                                      <span className="text-xs font-medium text-gray-700">{gKey}</span>
                                      <span className="text-[10px] text-gray-400">{gItems.length} 集</span>
                                    </div>
                                    <div className="space-y-1">
                                      {gItems.map((ep: any) => {
                                        const idx = globalIdx++;
                                        return (
                                          <div key={idx} className="flex items-center justify-between">
                                            <span className="text-[11px] text-gray-600 truncate flex-1">{ep.title}</span>
                                            <button
                                              onClick={() => handleCopyMagnet(sub.id + '_' + idx, ep.magnet_link || ep.torrent_url || '')}
                                              className={copiedKey === sub.id + '_' + idx
                                                ? "action-btn text-xs !bg-emerald-50 !text-emerald-700 !border-emerald-200"
                                                : "action-btn text-xs"
                                              }
                                            >
                                              {copiedKey === sub.id + '_' + idx ? '复制成功' : '复制磁力'}
                                            </button>
                                            <button
                                              onClick={() => handleDownload(ep)}
                                              className="action-btn action-btn-primary text-xs"
                                            >
                                              立即下载
                                            </button>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
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

      {/* 取消订阅确认弹窗 */}
      {deleteConfirm && (
        <div className="changli-modal-backdrop" onClick={() => setDeleteConfirm(null)}>
          <div className="changli-modal-panel !w-[min(100%,380px)] !p-0" onClick={e => e.stopPropagation()}>
            <div className="changli-modal-header">
              <h2 className="text-lg font-bold text-gray-900">取消订阅</h2>
            </div>
            <div className="changli-modal-body">
              <p className="text-sm text-gray-600">
                确定取消订阅「<span className="font-medium text-gray-900">{deleteConfirm.title?.replace(/^[^-]+\s*-\s*/, '') || deleteConfirm.title}</span>」？
              </p>
              <p className="text-xs text-gray-400 mt-2">取消后检查更新记录将被清除</p>
            </div>
            <div className="changli-modal-footer">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="action-btn text-sm px-4 py-2"
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                className="action-btn action-btn-danger text-sm px-4 py-2"
              >
                确认取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Subscriptions;
