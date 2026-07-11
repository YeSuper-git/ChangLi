import React, { useState, useEffect } from 'react';
import {
  detectRssUrl,
  fetchRss,
  createSubscription,
  getSubscriptionBySeries,
  checkSubscriptionUpdates,
  deleteSubscription,
  getVideoSeriesList,
} from '../utils/api';
import type { BangumiSubscription, SubscriptionDownload, VideoSeries } from '../utils/api';
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

interface RssItem {
  guid: string;
  title: string;
  link: string;
  description: string;
  torrent_url: string | null;
  magnet_link: string | null;
  content_length: number | null;
  pub_date: string | null;
}

interface BindModalProps {
  open: boolean;
  onClose: () => void;
  onBind: (subscription: BangumiSubscription) => void;
  initialSeriesId?: number;
}

export const SubscriptionBindModal: React.FC<BindModalProps> = ({ open, onClose, onBind, initialSeriesId }) => {
  const [bangumiUrl, setBangumiUrl] = useState('');
  const [detectedRssUrl, setDetectedRssUrl] = useState('');
  const [rssTitle, setRssTitle] = useState('');
  const [rssItems, setRssItems] = useState<RssItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [seriesList, setSeriesList] = useState<VideoSeries[]>([]);
  const [selectedSeriesId, setSelectedSeriesId] = useState<number | null>(initialSeriesId ?? null);

  // Step tracking
  const [step, setStep] = useState<'input' | 'episodes' | 'done'>('input');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      // Load series and sites list
      Promise.all([getVideoSeriesList()]).then(([s]) => {
        setSeriesList(s);
        }).catch(() => {});
    }
  }, [open]);

  const handleDetectRss = async () => {
    if (!bangumiUrl.trim()) return;
    setLoading(true);
    setError('');
    setDetectedRssUrl('');
    setRssTitle('');
    setRssItems([]);
    setSelectedItems(new Set());

    try {
      const rssUrl = await detectRssUrl(bangumiUrl.trim());
      setDetectedRssUrl(rssUrl);

      const rssData = await fetchRss(rssUrl);
      setRssTitle(rssData.title || '');
      setRssItems(rssData.items || []);

      const allGuids = new Set((rssData.items || []).map(item => item.guid));
      setSelectedItems(allGuids);

      setStep('episodes');
    } catch (err: any) {
      console.error('检测 RSS 失败:', err);
      setError(err?.message || '检测失败，请检查 URL 是否正确');
    } finally {
      setLoading(false);
    }
  };

  const toggleItem = (guid: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(guid)) next.delete(guid);
      else next.add(guid);
      return next;
    });
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return '未知';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(0) + ' MB';
  };

  const handleCreate = async () => {
    if (!selectedSeriesId) {
      setError('请选择要关联的视频集');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const sub = await createSubscription(
        selectedSeriesId,
        null,
        bangumiUrl.trim(),
        detectedRssUrl,
        rssTitle || bangumiUrl.trim(),
        undefined,
        'clipboard'
      );

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

          {step === 'episodes' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-100 bg-[#f8f9fc] p-3">
                <div className="text-sm font-medium text-gray-900">{rssTitle || '未获取标题'}</div>
                <div className="text-xs text-gray-400 mt-1 break-all">{detectedRssUrl}</div>
              </div>

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

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="changli-form-label mb-0">可下载的集数 ({rssItems.length})</label>
                  <div className="flex gap-2">
                    <button onClick={() => setSelectedItems(new Set(rssItems.map(i => i.guid)))} className="text-xs text-rose-500 hover:text-rose-600">全选</button>
                    <button onClick={() => setSelectedItems(new Set())} className="text-xs text-gray-400 hover:text-gray-500">全不选</button>
                  </div>
                </div>
                <div className="max-h-[300px] overflow-y-auto space-y-2">
                  {rssItems.map(item => (
                    <label
                      key={item.guid}
                      className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                        selectedItems.has(item.guid)
                          ? 'border-rose-200 bg-rose-50/50'
                          : 'border-gray-100 bg-white hover:border-gray-200'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedItems.has(item.guid)}
                        onChange={() => toggleItem(item.guid)}
                        className="mt-0.5 rounded border-gray-300 text-rose-500 focus:ring-rose-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{item.title}</div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                          <span>{formatSize(item.content_length)}</span>
                          {item.pub_date && <span>{new Date(item.pub_date).toLocaleDateString('zh-CN')}</span>}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
                <div className="text-xs text-gray-400 mt-2">已选 {selectedItems.size} / {rssItems.length} 个</div>
              </div>

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
                {loading ? '获取中...' : '获取 RSS'}
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
