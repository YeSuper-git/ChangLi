import React, { useState, useEffect, useCallback } from 'react';
import { useSubscriptionStore } from '../store/subscriptionStore';
import {
  deleteSubscription,
  checkSubscriptionUpdates,
} from '../utils/api';
import type { BangumiSubscription } from '../utils/api';
import { SubscriptionBindModal, SubscriptionEditModal } from '../components/SubscriptionManager';
import FloatingActions from '../components/FloatingActions';
import { notify } from '../utils/notify';
import loadingIcon from '../assets/icons/loading.svg';


const subscriptionColors = [
  { background: 'linear-gradient(135deg, #fff1f2 0%, #fff7f7 100%)', borderColor: '#fecdd3' },
  { background: 'linear-gradient(135deg, #fff7ed 0%, #fffaf5 100%)', borderColor: '#fed7aa' },
  { background: 'linear-gradient(135deg, #fefce8 0%, #fffdf2 100%)', borderColor: '#fde68a' },
  { background: 'linear-gradient(135deg, #ecfdf5 0%, #f5fffa 100%)', borderColor: '#a7f3d0' },
  { background: 'linear-gradient(135deg, #eff6ff 0%, #f7fbff 100%)', borderColor: '#bfdbfe' },
  { background: 'linear-gradient(135deg, #eef2ff 0%, #f8f9ff 100%)', borderColor: '#c7d2fe' },
  { background: 'linear-gradient(135deg, #faf5ff 0%, #fdfaff 100%)', borderColor: '#e9d5ff' },
  { background: 'linear-gradient(135deg, #fdf2f8 0%, #fff7fb 100%)', borderColor: '#fbcfe8' },
];

function colorIndex(seed: string | number): number {
  const text = String(seed);
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash % subscriptionColors.length;
}

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

function updateFingerprint(items: any[]): string {
  return items
    .map(item => String(item.guid || item.magnet_link || item.torrent_url || item.title || ''))
    .filter(Boolean)
    .sort()
    .join('|');
}

function isSameUpdateResult(prev: any[] | undefined, next: any[]): boolean {
  return Boolean(prev && prev.length === next.length && updateFingerprint(prev) === updateFingerprint(next));
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

function getSubscriptionVersionLabels(subscription: BangumiSubscription): string[] {
  try {
    const prefs = JSON.parse(subscription.preferences || '{}');
    const selectedPrefixes: unknown[] = Array.isArray(prefs.selectedPrefixes) ? prefs.selectedPrefixes : [];
    const labels = selectedPrefixes
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map(item => item.trim());
    return labels.length > 0 ? labels : ['全部版本'];
  } catch {
    return ['全部版本'];
  }
}

/// 从订阅标题提取网站名（"-" 前面的部分）
function extractSiteName(title: string): string {
  const idx = title.indexOf(' - ');
  if (idx > 0) return title.substring(0, idx).trim();
  return '其他';
}

const Subscriptions: React.FC = () => {
  const [subscriptions, setSubscriptions] = useState<BangumiSubscription[]>([]);
  const [showBindModal, setShowBindModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingSubscription, setEditingSubscription] = useState<BangumiSubscription | null>(null);

  // 按网站分组的展开状态
  const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set());
  // 每个订阅的更新展开状态
  const [expandedSubs, setExpandedSubs] = useState<Set<number>>(() => loadExpandedSubs());
  // 每个订阅的更新结果：subId -> episodes
  const [subUpdates, setSubUpdates] = useState<Map<number, any[]>>(() => loadSubUpdates());

  // Per-subscription checking state
  const [checkingId, setCheckingId] = useState<number | null>(null);
  const [checkingAll, setCheckingAll] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const store = useSubscriptionStore.getState();
      if (store.loaded && store.subscriptions.length > 0 && !store.dirty) {
        setSubscriptions(store.subscriptions);
        const sites = new Set(store.subscriptions.map(s => extractSiteName(s.title || s.rss_url)));
        setExpandedSites(sites);
        return;
      }
      await store.load();
      const { subscriptions: subs } = useSubscriptionStore.getState();
      setSubscriptions(subs);
      const sites = new Set(subs.map(s => extractSiteName(s.title || s.rss_url)));
      setExpandedSites(sites);
    } catch (err) {
      console.error('[Subscriptions] 加载订阅列表失败:', err);
    }
  }, []);

  useEffect(() => {
    const { subscriptions: cached, loaded } = useSubscriptionStore.getState();
    if (loaded && cached.length > 0) {
      setSubscriptions(cached);
      setExpandedSites(new Set(cached.map(s => extractSiteName(s.title || s.rss_url))));
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
      const previousItems = subUpdates.get(sub.id);
      const repeatedPositiveResult = items.length > 0 && isSameUpdateResult(previousItems, items);
      await loadData();

      setSubUpdates(prev => {
        const next = new Map(prev);
        next.set(sub.id, items);
        saveSubUpdates(next);
        return next;
      });
      setExpandedSubs(prev => { const next = new Set([...prev, sub.id]); saveExpandedSubs(next); return next; });
      if (items.length > 0 && !repeatedPositiveResult) {
        notify({ message: `已更新 ${items.length} 集`, type: 'success' });
      } else if (repeatedPositiveResult) {
        notify({ message: '检查成功，暂无更新', type: 'info' });
      } else if (items.length === 0) {
        notify({ message: '检查成功，暂无更新', type: 'info' });
      }
    } catch (err) {
      console.error('[Subscriptions] 检查更新失败:', err);
      notify({ message: '检查更新失败', type: 'error' });
    } finally {
      setCheckingId(null);
    }
  };

  const handleCheckAllUpdates = async () => {
    if (checkingAll || subscriptions.length === 0) return;
    setCheckingAll(true);
    setCheckingId(null);
    try {
      let totalPending = 0;
      let changedSubscriptions = 0;
      const nextUpdates = new Map(subUpdates);
      const nextExpanded = new Set(expandedSubs);

      for (const sub of subscriptions) {
        setCheckingId(sub.id);
        const items = await checkSubscriptionUpdates(sub.id);
        const previousItems = nextUpdates.get(sub.id);
        if (items.length > 0 && !isSameUpdateResult(previousItems, items)) {
          changedSubscriptions += 1;
        }
        nextUpdates.set(sub.id, items);
        if (items.length > 0) {
          totalPending += items.length;
          nextExpanded.add(sub.id);
        }
      }

      saveSubUpdates(nextUpdates);
      saveExpandedSubs(nextExpanded);
      setSubUpdates(nextUpdates);
      setExpandedSubs(nextExpanded);
      useSubscriptionStore.getState().markDirty();
      await loadData();

      if (changedSubscriptions > 0) {
        notify({ message: `发现了 ${changedSubscriptions} 个作品有更新`, type: 'success' });
      } else if (totalPending > 0) {
        notify({ message: '批量检查成功，暂无更新', type: 'info' });
      } else {
        notify({ message: '批量检查成功，暂无更新', type: 'info' });
      }
    } catch (err) {
      console.error('[Subscriptions] 一键检查失败:', err);
      notify({ message: '一键检查失败', type: 'error' });
    } finally {
      setCheckingId(null);
      setCheckingAll(false);
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

  // Phase 2: 内置 aria2 下载（暂未实现）

  // 不显示全屏 loading，直接显示内容

  // 按网站分组
  const siteGroups: Record<string, BangumiSubscription[]> = {};
  for (const sub of subscriptions) {
    const site = extractSiteName(sub.title || sub.rss_url);
    if (!siteGroups[site]) siteGroups[site] = [];
    siteGroups[site].push(sub);
  }

  return (
    <div className="changli-page subscriptions-page" data-tutorial="subscriptions-page">
      <div className="changli-page-header subscriptions-header">
        <div>
          <h1 className="changli-heading-xl">订阅管理</h1>
          <p className="subscriptions-header-desc">订阅番剧网站，智能获取下载链接</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCheckAllUpdates}
            disabled={checkingAll || subscriptions.length === 0}
            className="action-btn text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {checkingAll ? (
              <span className="flex items-center gap-1">
                检查中 <img src={loadingIcon} alt="" className="w-3 h-3" />
              </span>
            ) : '一键检查'}
          </button>
          <button
            onClick={() => setShowBindModal(true)}
            className="action-btn action-btn-primary text-sm"
          >
            + 添加订阅
          </button>
        </div>
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
        <div className="subscriptions-site-list">
          {Object.entries(siteGroups).map(([site, subs]) => {
            const isExpanded = expandedSites.has(site);
            return (
              <div key={site} className="changli-panel subscription-site-panel">
                {/* 网站标题栏 */}
                <button
                  onClick={() => toggleSite(site)}
                  className="subscription-site-toggle"
                >
                  <div className="flex items-center gap-2">
                    <svg
                      className={`subscription-arrow ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="subscription-site-name">{site}</span>
                    <span className="subscription-site-count">{subs.length} 个订阅</span>
                  </div>
                </button>

                {/* 该网站下的订阅列表 */}
                {isExpanded && (
                  <div className="subscription-card-list">
                    {subs.map((sub) => {
                      const displayName = sub.title?.replace(/^[^-]+\s*-\s*/, '') || sub.title;
                      const cardColor = subscriptionColors[colorIndex(sub.id || displayName || sub.rss_url)];
                      const versionLabels = getSubscriptionVersionLabels(sub);
                      return (
                        <div key={sub.id} className="subscription-card" style={cardColor}>
                          <div className="subscription-card-main">
                            <div className="flex-1 min-w-0">
                              <button
                                onClick={() => toggleSub(sub.id)}
                                className="subscription-title-button group"
                              >
                                <svg
                                  className={`subscription-arrow subscription-arrow-sm ${expandedSubs.has(sub.id) ? 'rotate-90' : ''}`}
                                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                                <span className="subscription-title-text">
                                  {displayName}
                                </span>
                              </button>
                              <div className="subscription-meta-list">
                                {sub.series_id && sub.series_title && (
                                  <div className="subscription-related-series">
                                    关联：{sub.series_title}
                                  </div>
                                )}
                                <div
                                  className="subscription-version-pill"
                                  title={versionLabels.join(' / ')}
                                >
                                  <span className="subscription-version-label">版本</span>
                                  <span className="subscription-version-value">
                                    {versionLabels.join(' / ')}
                                  </span>
                                </div>
                                <div className="subscription-check-time">
                                  上次检查：{formatTimeAgo(sub.last_check_at)}
                                </div>
                              </div>
                            </div>

                            <div className="subscription-card-actions">
                              <button
                                onClick={() => {
                                  setEditingSubscription(sub);
                                  setShowEditModal(true);
                                }}
                                className="action-btn text-xs px-3 py-1"
                              >
                                编辑
                              </button>
                              <button
                                onClick={() => handleCheckUpdates(sub)}
                                disabled={checkingAll || checkingId === sub.id}
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
                                <div className="subscription-empty-updates">
                                  暂无更新
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
                              <div className="subscription-updates-panel">
                                {Object.entries(groups).map(([gKey, gItems]) => (
                                  <div key={gKey} className="subscription-update-group">
                                    <div className="subscription-update-group-head">
                                      <span>{gKey}</span>
                                      <span>{gItems.length} 集</span>
                                    </div>
                                    <div className="subscription-update-items">
                                      {gItems.map((ep: any) => {
                                        const idx = globalIdx++;
                                        return (
                                          <div key={idx} className="subscription-update-item">
                                            <span className="subscription-update-title">{ep.title}</span>
                                            {ep.pub_date && (() => {
                                              try {
                                                const d = new Date(ep.pub_date);
                                                if (!isNaN(d.getTime())) {
                                                  const yyyy = d.getFullYear();
                                                  const mm = String(d.getMonth() + 1).padStart(2, '0');
                                                  const dd = String(d.getDate()).padStart(2, '0');
                                                  return <span className="subscription-update-date">{yyyy}/{mm}/{dd}</span>;
                                                }
                                              } catch {}
                                              return null;
                                            })()}
                                            <button
                                              onClick={() => handleCopyMagnet(sub.id + '_' + idx, ep.magnet_link || ep.torrent_url || '')}
                                              className={copiedKey === sub.id + '_' + idx
                                                ? "subscription-mini-btn is-copied"
                                                : "subscription-mini-btn"
                                              }
                                            >
                                              {copiedKey === sub.id + '_' + idx ? '已复制' : '复制磁力'}
                                            </button>
                                            <button
                                              disabled
                                              className="subscription-mini-btn is-disabled"
                                              title="下载功能开发中"
                                            >
                                              下载
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
        key={showBindModal ? 'open' : 'closed'}
        open={showBindModal}
        onClose={() => setShowBindModal(false)}
        onBind={() => {
          setShowBindModal(false);
          useSubscriptionStore.getState().markDirty();
          loadData();
        }}
      />

      <SubscriptionEditModal
        key={showEditModal && editingSubscription ? `edit-${editingSubscription.id}` : 'closed'}
        open={showEditModal}
        subscription={editingSubscription}
        onClose={() => { setShowEditModal(false); setEditingSubscription(null); }}
        onSave={() => {
          setShowEditModal(false);
          setEditingSubscription(null);
          useSubscriptionStore.getState().markDirty();
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
      <FloatingActions
        onRefresh={async () => {
          useSubscriptionStore.getState().markDirty();
          await loadData();
        }}
        refreshLabel="刷新订阅"
      />
    </div>
  );
};

export default Subscriptions;
