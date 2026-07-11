import React, { useState, useEffect } from 'react';
import {
  detectRssUrl,
  fetchRss,
  extractKeywordsFromRss,
  createSubscription,
  getSubscriptionBySeries,
  checkSubscriptionUpdates,
  deleteSubscription,
  updateSubscriptionKeywords,
  getVideoSeriesList,
  getSites,
} from '../utils/api';
import type { BangumiSubscription, SubscriptionDownload, VideoSeries, Site } from '../utils/api';
import { notify } from '../utils/notify';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import loadingIcon from '../assets/icons/loading.svg';

// ==================== Types ====================

interface SubscriptionManagerProps {
  /** Series ID to bind subscription to (if in series context) */
  seriesId?: number;
  /** Site ID (if in site context) */
  siteId?: number;
  /** Called after subscription is created/updated */
  onSubscriptionChange?: () => void;
}

type KeywordGroup = {
  category: string;
  keywords: string[];
};

// ==================== Utility ====================

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes === 0) return '未知';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
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

// ==================== Subscription Bind Modal ====================

interface BindModalProps {
  open: boolean;
  onClose: () => void;
  onBind: (subscription: BangumiSubscription) => void;
  initialSeriesId?: number;
  initialSiteId?: number;
}

export const SubscriptionBindModal: React.FC<BindModalProps> = ({ open, onClose, onBind, initialSeriesId, initialSiteId }) => {
  const [bangumiUrl, setBangumiUrl] = useState('');
  const [detectedRssUrl, setDetectedRssUrl] = useState('');
  const [rssTitle, setRssTitle] = useState('');
  const [keywordGroups, setKeywordGroups] = useState<KeywordGroup[]>([]);
  const [selectedKeywords, setSelectedKeywords] = useState<Record<string, Set<string>>>({});
  const [seriesList, setSeriesList] = useState<VideoSeries[]>([]);
  const [sitesList, setSitesList] = useState<Site[]>([]);
  const [selectedSeriesId, setSelectedSeriesId] = useState<number | null>(initialSeriesId ?? null);
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(initialSiteId ?? null);

  // Step tracking
  const [step, setStep] = useState<'input' | 'keywords' | 'done'>('input');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      // Load series and sites list
      Promise.all([getVideoSeriesList(), getSites()]).then(([s, st]) => {
        setSeriesList(s);
        setSitesList(st);
      }).catch(() => {});
    }
  }, [open]);

  const handleDetectRss = async () => {
    if (!bangumiUrl.trim()) return;
    setLoading(true);
    setError('');
    setDetectedRssUrl('');
    setRssTitle('');
    setKeywordGroups([]);
    setSelectedKeywords({});

    try {
      // Step 1: Detect RSS URL
      const rssUrl = await detectRssUrl(bangumiUrl.trim());
      setDetectedRssUrl(rssUrl);

      // Step 2: Fetch RSS to get title
      const rssData = await fetchRss(rssUrl);
      setRssTitle(rssData.title || '');

      // Step 3: Extract keywords
      const keywords = await extractKeywordsFromRss(rssUrl);
      const groups: KeywordGroup[] = Object.entries(keywords).map(([category, kws]) => ({
        category,
        keywords: kws,
      }));
      setKeywordGroups(groups);

      // Pre-select all keywords
      const initialSelected: Record<string, Set<string>> = {};
      for (const group of groups) {
        initialSelected[group.category] = new Set(group.keywords);
      }
      setSelectedKeywords(initialSelected);

      setStep('keywords');
    } catch (err: any) {
      console.error('检测 RSS 失败:', err);
      setError(err?.message || '检测失败，请检查 URL 是否正确');
    } finally {
      setLoading(false);
    }
  };

  const toggleKeyword = (category: string, keyword: string) => {
    setSelectedKeywords(prev => {
      const next = { ...prev };
      if (!next[category]) next[category] = new Set();
      const set = new Set(next[category]);
      if (set.has(keyword)) set.delete(keyword);
      else set.add(keyword);
      next[category] = set;
      return next;
    });
  };

  const handleCreate = async () => {
    if (!selectedSeriesId) {
      setError('请选择要关联的视频集');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const preferences = JSON.stringify(
        Object.entries(selectedKeywords).flatMap(([category, set]) =>
          Array.from(set).map(kw => [category, kw, true] as [string, string, boolean])
        )
      );

      const sub = await createSubscription(
        selectedSeriesId,
        selectedSiteId,
        bangumiUrl.trim(),
        detectedRssUrl,
        rssTitle || bangumiUrl.trim(),
        preferences,
        'clipboard' // Phase 1: clipboard only
      );

      // Save keywords to DB
      const allKeywords: [string, string, boolean][] = [];
      for (const [category, set] of Object.entries(selectedKeywords)) {
        for (const kw of set) {
          allKeywords.push([category, kw, true]);
        }
      }
      if (allKeywords.length > 0) {
        await updateSubscriptionKeywords(sub.id, allKeywords);
      }

      notify({ message: '订阅创建成功', type: 'success' });
      onBind(sub);
      onClose();
    } catch (err: any) {
      console.error('创建订阅失败:', err);
      setError(err?.message || '创建订阅失败');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="changli-modal-backdrop" onClick={onClose}>
      <div className="changli-modal-panel !w-[min(100%,560px)] !p-0" onClick={e => e.stopPropagation()}>
        <div className="changli-modal-header">
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-500">订阅管理</p>
          <h2 className="mt-1 text-2xl font-bold text-gray-900">绑定 Bangumi 订阅</h2>
          <p className="mt-2 text-sm text-gray-500">
            输入番组页面地址，自动检测 RSS 并提取关键词偏好
          </p>
        </div>

        <div className="changli-modal-body max-h-[60vh] overflow-y-auto">
          {step === 'input' && (
            <div className="space-y-4">
              <div>
                <label className="changli-form-label">番组页面地址</label>
                <input
                  type="text"
                  value={bangumiUrl}
                  onChange={e => setBangumiUrl(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleDetectRss(); }}
                  className="changli-input"
                  placeholder="如：https://mikanani.kas.pub/Home/Bangumi/4042"
                  autoFocus
                />
                <p className="text-xs text-gray-400 mt-1">支持 Mikan 等主流番组网站</p>
              </div>

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
              )}

              {loading && (
                <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                  <img src={loadingIcon} alt="加载中" className="w-4 h-4 animate-spin" />
                  <span>正在检测 RSS 地址...</span>
                </div>
              )}
            </div>
          )}

          {step === 'keywords' && (
            <div className="space-y-4">
              {/* RSS Info */}
              <div className="rounded-xl border border-gray-100 bg-[#f8f9fc] p-3">
                <div className="text-sm font-medium text-gray-900">{rssTitle || '未获取标题'}</div>
                <div className="text-xs text-gray-400 mt-1 break-all">{detectedRssUrl}</div>
              </div>

              {/* Series Selection */}
              <div>
                <label className="changli-form-label">关联视频集</label>
                <select
                  value={selectedSeriesId ?? ''}
                  onChange={e => setSelectedSeriesId(e.target.value ? Number(e.target.value) : null)}
                  className="changli-input"
                >
                  <option value="">请选择视频集</option>
                  {seriesList.map(s => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </select>
              </div>

              {/* Site Selection */}
              <div>
                <label className="changli-form-label">来源网站（可选）</label>
                <select
                  value={selectedSiteId ?? ''}
                  onChange={e => setSelectedSiteId(e.target.value ? Number(e.target.value) : null)}
                  className="changli-input"
                >
                  <option value="">不指定</option>
                  {sitesList.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              {/* Keywords */}
              {keywordGroups.length > 0 && (
                <div>
                  <label className="changli-form-label">关键词偏好</label>
                  <p className="text-xs text-gray-400 mb-2">取消选择不需要的关键词</p>
                  <div className="space-y-3">
                    {keywordGroups.map(group => (
                      <div key={group.category}>
                        <div className="text-xs font-medium text-gray-500 mb-1.5">{group.category}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {group.keywords.map(kw => {
                            const isSelected = selectedKeywords[group.category]?.has(kw) ?? false;
                            return (
                              <button
                                key={kw}
                                type="button"
                                onClick={() => toggleKeyword(group.category, kw)}
                                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                                  isSelected
                                    ? 'bg-gradient-to-r from-[#fb5b7b] to-[#ff8a4c] border-transparent text-white'
                                    : 'bg-white border-gray-200 text-gray-500 hover:border-rose-200'
                                }`}
                              >
                                {kw}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
              )}
            </div>
          )}
        </div>

        <div className="changli-modal-footer">
          {step === 'input' ? (
            <>
              <button onClick={onClose} className="action-btn flex-1">取消</button>
              <button
                onClick={handleDetectRss}
                disabled={!bangumiUrl.trim() || loading}
                className="action-btn action-btn-primary flex-1 disabled:opacity-50"
              >
                {loading ? '检测中...' : '检测 RSS'}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setStep('input')} className="action-btn flex-1">返回</button>
              <button
                onClick={handleCreate}
                disabled={!selectedSeriesId || loading}
                className="action-btn action-btn-primary flex-1 disabled:opacity-50"
              >
                {loading ? '创建中...' : '创建订阅'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ==================== New Episode Notification Modal ====================

interface NewEpisodeModalProps {
  open: boolean;
  episodes: SubscriptionDownload[];
  onClose: () => void;
}

export const NewEpisodeModal: React.FC<NewEpisodeModalProps> = ({ open, episodes, onClose }) => {
  const handleCopyMagnet = async (magnetLink: string) => {
    try {
      await navigator.clipboard.writeText(magnetLink);
      notify({ message: '磁力链接已复制到剪贴板', type: 'success' });
    } catch {
      notify({ message: '复制失败，请手动复制', type: 'error' });
    }
  };

  const handleOpenExternal = async (magnetLink: string) => {
    try {
      await openExternal(magnetLink);
    } catch {
      notify({ message: '无法打开外部下载器', type: 'error' });
    }
  };

  if (!open || episodes.length === 0) return null;

  return (
    <div className="changli-modal-backdrop" onClick={onClose}>
      <div className="changli-modal-panel !w-[min(100%,600px)] !p-0" onClick={e => e.stopPropagation()}>
        <div className="changli-modal-header">
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-500">新剧集更新</p>
          <h2 className="mt-1 text-2xl font-bold text-gray-900">
            发现 {episodes.length} 个新剧集
          </h2>
        </div>

        <div className="changli-modal-body max-h-[50vh] overflow-y-auto">
          <div className="space-y-2">
            {episodes.map(ep => (
              <div key={ep.id} className="rounded-2xl border border-gray-100 bg-[#f8f9fc] p-3">
                <div className="text-sm font-semibold text-gray-900 line-clamp-2">{ep.title}</div>
                {ep.file_size && (
                  <div className="text-xs text-gray-400 mt-1">{formatBytes(ep.file_size)}</div>
                )}
                {ep.pub_date && (
                  <div className="text-xs text-gray-400 mt-0.5">发布于 {new Date(ep.pub_date).toLocaleString('zh-CN')}</div>
                )}
                <div className="flex gap-2 mt-2">
                  {ep.magnet_link && (
                    <>
                      <button
                        onClick={() => handleCopyMagnet(ep.magnet_link!)}
                        className="action-btn text-xs px-3 py-1"
                      >
                        复制磁力链接
                      </button>
                      <button
                        onClick={() => handleOpenExternal(ep.magnet_link!)}
                        className="action-btn action-btn-primary text-xs px-3 py-1"
                      >
                        打开外部下载器
                      </button>
                    </>
                  )}
                  {!ep.magnet_link && ep.torrent_url && (
                    <button
                      onClick={() => handleOpenExternal(ep.torrent_url!)}
                      className="action-btn action-btn-primary text-xs px-3 py-1"
                    >
                      下载种子文件
                    </button>
                  )}
                  {!ep.magnet_link && !ep.torrent_url && (
                    <span className="text-xs text-gray-400">无可用下载链接</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="changli-modal-footer">
          <button onClick={onClose} className="action-btn flex-1">关闭</button>
        </div>
      </div>
    </div>
  );
};

// ==================== Main Component ====================

const SubscriptionManager: React.FC<SubscriptionManagerProps> = ({ seriesId, siteId, onSubscriptionChange }) => {
  const [subscription, setSubscription] = useState<BangumiSubscription | null>(null);
  const [showBindModal, setShowBindModal] = useState(false);
  const [showNewEpisodes, setShowNewEpisodes] = useState(false);
  const [newEpisodes, setNewEpisodes] = useState<SubscriptionDownload[]>([]);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [loadingSub, setLoadingSub] = useState(false);

  // Load existing subscription for this series
  useEffect(() => {
    if (seriesId) {
      setLoadingSub(true);
      getSubscriptionBySeries(seriesId)
        .then(setSubscription)
        .catch(() => setSubscription(null))
        .finally(() => setLoadingSub(false));
    }
  }, [seriesId]);

  const handleCheckUpdates = async () => {
    if (!subscription) return;
    setCheckingUpdates(true);
    try {
      const items = await checkSubscriptionUpdates(subscription.id);
      // Refresh subscription to update last_check_at
      const updated = await getSubscriptionBySeries(seriesId!);
      setSubscription(updated);

      if (items.length > 0) {
        setNewEpisodes(items);
        setShowNewEpisodes(true);
        notify({ message: `发现 ${items.length} 个新剧集`, type: 'success' });
      } else {
        notify({ message: '暂无新剧集更新', type: 'info' });
      }
    } catch (err: any) {
      console.error('检查更新失败:', err);
      notify({ message: '检查更新失败', type: 'error' });
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleBind = (sub: BangumiSubscription) => {
    setSubscription(sub);
    onSubscriptionChange?.();
  };

  const handleDelete = async () => {
    if (!subscription) return;
    try {
      await deleteSubscription(subscription.id);
      setSubscription(null);
      notify({ message: '订阅已删除', type: 'info' });
      onSubscriptionChange?.();
    } catch {
      notify({ message: '删除订阅失败', type: 'error' });
    }
  };

  // If no series context, just render the bind button
  if (!seriesId) {
    return (
      <>
        <button
          onClick={() => setShowBindModal(true)}
          className="action-btn text-sm"
        >
          订阅
        </button>
        <SubscriptionBindModal
          open={showBindModal}
          onClose={() => setShowBindModal(false)}
          onBind={handleBind}
          initialSiteId={siteId}
        />
      </>
    );
  }

  // siteId 模式：只显示订阅按钮
  if (siteId && !seriesId) {
    return (
      <>
        <button
          onClick={() => setShowBindModal(true)}
          className="action-btn text-xs px-3 py-1"
        >
          订阅
        </button>
        {showBindModal && (
          <SubscriptionBindModal
            open={showBindModal}
            onClose={() => setShowBindModal(false)}
            onBind={(sub) => {
              setSubscription(sub);
              setShowBindModal(false);
              notify({ message: '订阅创建成功', type: 'success' });
            }}
            initialSiteId={siteId}
          />
        )}
      </>
    );
  }

  return (
    <>
      {loadingSub ? (
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <img src={loadingIcon} alt="" className="w-3 h-3 animate-spin" />
          加载订阅...
        </div>
      ) : subscription ? (
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
            已订阅
          </div>
          <span className="text-xs text-gray-400">
            上次检查: {formatTimeAgo(subscription.last_check_at)}
          </span>
          <button
            onClick={handleCheckUpdates}
            disabled={checkingUpdates}
            className="action-btn text-xs px-3 py-1 disabled:opacity-50"
          >
            {checkingUpdates ? '检查中...' : '检查更新'}
          </button>
          <button
            onClick={handleDelete}
            className="action-btn action-btn-danger text-xs px-3 py-1"
          >
            取消订阅
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowBindModal(true)}
          className="action-btn text-xs px-3 py-1"
        >
          关联订阅
        </button>
      )}

      <SubscriptionBindModal
        open={showBindModal}
        onClose={() => setShowBindModal(false)}
        onBind={handleBind}
        initialSeriesId={seriesId}
        initialSiteId={siteId}
      />

      <NewEpisodeModal
        open={showNewEpisodes}
        episodes={newEpisodes}
        onClose={() => setShowNewEpisodes(false)}
      />
    </>
  );
};

export default SubscriptionManager;
