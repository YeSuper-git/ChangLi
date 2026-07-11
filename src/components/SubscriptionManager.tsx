import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
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

interface RssGroup {
  prefix: string;        // 显示标题（过滤后的简洁版）
  matchPattern: string;  // 匹配模式（原始标题去掉集数）
  items: RssItem[];
  count: number;
  recommended: boolean;
  priority: number;
}

interface BindModalProps {
  open: boolean;
  onClose: () => void;
  onBind: (subscription: BangumiSubscription) => void;
  initialSeriesId?: number;
}


/// 提取匹配模式：完整标题去掉集数（用于匹配RSS条目）
function extractMatchPattern(title: string): string {
  return title.replace(/\s*[-–—]\s*\d+[vV]?\d*\s*$/, '')
             .replace(/\s+Ep?\.?\s*\d+[vV]?\d*\s*$/i, '')
             .replace(/\s+#\d+\s*$/, '')
             .replace(/\s*第\d+集\s*$/, '')
             .replace(/\s*\d+话\s*$/, '')
             .replace(/\s*\d+話\s*$/, '')
             .replace(/\s*S\d+E\d+\s*$/, '')
             .trim();
}

/// 从标题中提取字幕组（第一个 [] 中的内容）
function extractSubtitleGroup(title: string): string {
  if (title.startsWith('[')) {
    const end = title.indexOf(']');
    if (end > 0) return title.substring(1, end).trim();
  }
  return '未知字幕组';
}

/// 从标题中提取关键版本信息（画质+语言+来源）
function extractVersionKey(title: string): string {
  const lower = title.toLowerCase();
  const parts: string[] = [];
  
  // 画质
  if (lower.includes('1080p') || lower.includes('1920x1080')) parts.push('1080p');
  else if (lower.includes('720p') || lower.includes('1280x720')) parts.push('720p');
  else if (lower.includes('480p')) parts.push('480p');
  else if (lower.includes('2160p') || lower.includes('4k')) parts.push('4k');
  
  // 语言
  if (lower.includes('chs') || lower.includes('简中') || lower.includes('简体') || lower.includes('[gb]')) parts.push('简中');
  else if (lower.includes('简繁') || lower.includes('简繁内封') || lower.includes('简／繁') || lower.includes('简/繁')) parts.push('简繁');
  else if (lower.includes('cht') || lower.includes('繁中') || lower.includes('繁体') || lower.includes('[big5]')) parts.push('繁中');
  
  // 来源
  if (lower.includes('baha')) parts.push('Baha');
  else if (lower.includes('cr ') || lower.includes('[cr]')) parts.push('CR');
  else if (lower.includes('abema')) parts.push('ABEMA');
  
  // 容器
  if (lower.includes('[mp4]')) parts.push('MP4');
  else if (lower.includes('[mkv]')) parts.push('MKV');
  
  // 特殊版本
  if (lower.includes('无修') || lower.includes('uncensored')) parts.push('无修');
  if (lower.includes('放送版') || lower.includes('on-air')) parts.push('放送版');
  
  return parts.length > 0 ? parts.join(' ') : '默认';
}

/// 计算推荐优先级（0=不推荐, 1=简中/简繁, 2=无修+简繁, 3=无修+简中）
/// 输入格式: "[字幕组名] 标题内容"
function getRecommendationPriority(text: string): number {
  const lower = text.toLowerCase();
  const isCHS = lower.includes('chs') || lower.includes('简中') || lower.includes('简体') || lower.includes('[gb]');
  const isCHSorCHT = isCHS || lower.includes('简繁') || lower.includes('简繁内封') || lower.includes('简／繁') || lower.includes('简/繁');
  const isUncensored = lower.includes('无修') || lower.includes('无限制') || lower.includes('uncensored') || lower.includes('uncut') || lower.includes('年龄限制版');
  
  if (isUncensored && isCHS) return 3;      // 无修 + 简中 = 最高
  if (isUncensored && isCHSorCHT) return 2;  // 无修 + 简繁 = 次高
  if (isCHS) return 1;                        // 纯简中
  if (isCHSorCHT) return 1;                   // 简繁
  return 0;                                   // 纯繁中不推荐
}

/// 按字幕组分组，组内按关键版本信息细分
function groupRssItems(items: RssItem[]): RssGroup[] {
  // 第一步：按字幕组分组
  const subtitleGroups = new Map<string, RssItem[]>();
  for (const item of items) {
    const group = extractSubtitleGroup(item.title);
    if (!subtitleGroups.has(group)) subtitleGroups.set(group, []);
    subtitleGroups.get(group)!.push(item);
  }

  const result: RssGroup[] = [];

  for (const [subtitleGroup, groupItems] of subtitleGroups) {
    // 第二步：在字幕组内，按关键版本信息分组
    const versionMap = new Map<string, RssItem[]>();
    for (const item of groupItems) {
      const versionKey = extractVersionKey(item.title);
      if (!versionMap.has(versionKey)) versionMap.set(versionKey, []);
      versionMap.get(versionKey)!.push(item);
    }

    for (const [versionKey, vItems] of versionMap) {
      const priority = Math.max(...vItems.map(item => getRecommendationPriority(`[${subtitleGroup}] ${item.title}`)));
      const recommended = priority > 0;
      // 生成匹配模式：取第一个条目的标题，去掉集数部分
      const matchPattern = extractMatchPattern(vItems[0].title);
      result.push({
        prefix: `[${subtitleGroup}] ${versionKey}`,
        matchPattern,
        items: vItems,
        count: vItems.length,
        recommended,
        priority,
      });
    }
  }

  // 排序：按优先级降序，然后按字幕组名字母序，集数多的在前
  result.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    if (a.prefix !== b.prefix) return a.prefix.localeCompare(b.prefix);
    return b.count - a.count;
  });

  // 只推荐最高优先级的那一个
  const maxPriority = Math.max(...result.map(g => g.priority));
  if (maxPriority > 0) {
    let foundFirst = false;
    for (const group of result) {
      if (group.priority === maxPriority && !foundFirst) {
        group.recommended = true;
        foundFirst = true;
      } else {
        group.recommended = false;
      }
    }
  }

  return result;
}

export const SubscriptionBindModal: React.FC<BindModalProps> = ({ open, onClose, onBind, initialSeriesId }) => {
  const [bangumiUrl, setBangumiUrl] = useState('');
  const [detectedRssUrl, setDetectedRssUrl] = useState('');
  const [rssTitle, setRssTitle] = useState('');
  const [rssGroups, setRssGroups] = useState<RssGroup[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [seriesSearch, setSeriesSearch] = useState('');
  const [showSeriesDropdown, setShowSeriesDropdown] = useState(false);
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
    setRssGroups([]);
    setSelectedGroups(new Set());

    try {
      const rssUrl = await detectRssUrl(bangumiUrl.trim());
      setDetectedRssUrl(rssUrl);

      const rssData = await fetchRss(rssUrl);
      setRssTitle(rssData.title || '');

      const groups = groupRssItems(rssData.items || []);
      setRssGroups(groups);

      const recommendedPrefixes = new Set(groups.filter(g => g.recommended).map(g => g.prefix));
      setSelectedGroups(recommendedPrefixes);

      setStep('episodes');
    } catch (err: any) {
      console.error('检测 RSS 失败:', err);
      setError(err?.message || '检测失败，请检查 URL 是否正确');
    } finally {
      setLoading(false);
    }
  };

  const toggleGroup = (prefix: string) => {
    setSelectedGroups(prev => {
      const next = new Set(prev);
      if (next.has(prefix)) next.delete(prefix);
      else next.add(prefix);
      return next;
    });
  };

  // 从 RSS 标题中提取番名用于自动匹配
  const extractAnimeName = (rssTitle: string): string => {
    // 去掉字幕组 [xxx]
    let name = rssTitle;
    if (name.startsWith('[')) {
      const end = name.indexOf(']');
      if (end > 0) name = name.substring(end + 1).trim();
    }
    // 去掉标签部分 [xxx] 和 (xxx)
    name = name.replace(/\[.*?\]/g, ' ').replace(/\(.*?\)/g, ' ').replace(/\{.*?\}/g, ' ');
    // 去掉集数
    name = name.replace(/\s*[-–—]\s*\d+\s*$/, '').replace(/\s+Ep?\.?\s*\d+\s*$/i, '');
    // 取前20个字符作为搜索关键词
    return name.trim().substring(0, 20);
  };

  // 自动匹配视频集
  const matchedSeries = (() => {
    const searchName = extractAnimeName(rssTitle);
    if (!searchName || seriesList.length === 0) return null;
    // 简单匹配：番名包含关系
    const match = seriesList.find(s => 
      s.title.includes(searchName) || searchName.includes(s.title)
    );
    return match || null;
  })();

  // 搜索过滤视频集
  const filteredSeries = seriesSearch.trim()
    ? seriesList.filter(s => s.title.toLowerCase().includes(seriesSearch.toLowerCase()))
    : seriesList;


  const handleCreate = async () => {
    if (!selectedSeriesId) {
      setError('请选择要关联的视频集');
      return;
    }
    setLoading(true);
    setError('');

    try {
      // 收集选中组的所有 guid 作为已知条目
      const knownGuids: string[] = [];
      const matchPatterns: Record<string, string> = {};
      for (const group of rssGroups) {
        if (selectedGroups.has(group.prefix)) {
          matchPatterns[group.prefix] = group.matchPattern;
          for (const item of group.items) {
            knownGuids.push(item.guid);
          }
        }
      }

      const sub = await createSubscription(
        selectedSeriesId,
        null,
        bangumiUrl.trim(),
        detectedRssUrl,
        rssTitle || bangumiUrl.trim(),
        JSON.stringify({ selectedPrefixes: Array.from(selectedGroups), matchPatterns, knownGuids }),
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

  // 步骤计算
  const currentStep = step === 'input' ? 1 : (selectedSeriesId ? 3 : 2);

  return (
    <div className="changli-modal-backdrop" onClick={onClose}>
      <div className="changli-modal-panel !w-[min(100%,560px)] !p-0 flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="changli-modal-header shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-500">订阅管理</p>
              <h2 className="mt-0.5 text-xl font-bold text-gray-900 tracking-tight">绑定 Bangumi 订阅</h2>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors text-lg leading-none"
              title="关闭"
            >×</button>
          </div>

          {/* ── Step Indicator ── */}
          <div className="flex items-center justify-center gap-0 mt-4">
            {([
              { num: 1, label: '输入地址' },
              { num: 2, label: '选择分组' },
              { num: 3, label: '确认绑定' },
            ] as const).map((s, i) => {
              const isActive = currentStep === s.num;
              const isDone = currentStep > s.num;
              return (
                <React.Fragment key={s.num}>
                  <div className="flex items-center gap-1.5">
                    <div
                      className={`flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold transition-all duration-300 ${
                        isActive
                          ? 'bg-rose-500 text-white shadow-md shadow-rose-200'
                          : isDone
                            ? 'bg-rose-100 text-rose-500'
                            : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      {isDone ? '✓' : s.num}
                    </div>
                    <span
                      className={`text-xs font-medium transition-colors duration-300 ${
                        isActive ? 'text-rose-600' : isDone ? 'text-rose-400' : 'text-gray-400'
                      }`}
                    >
                      {s.label}
                    </span>
                  </div>
                  {i < 2 && (
                    <div
                      className={`w-8 h-[1.5px] mx-1.5 rounded-full transition-colors duration-300 ${
                        isDone ? 'bg-rose-300' : 'bg-gray-200'
                      }`}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* ── Body ── */}
        <div className="changli-modal-body flex-1 overflow-y-auto min-h-0">

          {/* 全局错误提示（避免重复渲染） */}
          {error && step === 'input' && (
            <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700 flex items-center gap-2">
              <span className="shrink-0 text-red-400">!</span>
              {error}
            </div>
          )}

          {/* ── Step 1: 输入地址 ── */}
          {step === 'input' && (
            <div className="space-y-3">
              <div>
                <label className="changli-form-label text-[13px]">番组页面地址</label>
                <input
                  type="text"
                  value={bangumiUrl}
                  onChange={e => setBangumiUrl(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleDetectRss(); }}
                  className="changli-input"
                  placeholder="粘贴番组页面链接"
                  autoFocus
                />
                <p className="text-[11px] text-gray-400 mt-1">支持 Mikan 等主流番组网站</p>
              </div>

              {loading && (
                <div className="flex items-center gap-2 text-[13px] text-gray-500 py-1">
                  <img src={loadingIcon} alt="加载中" className="w-4 h-4" />
                  <span>正在检测 RSS 地址...</span>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2/3: 选择分组 & 确认绑定 ── */}
          {step === 'episodes' && (
            <div className="space-y-3">
              {/* RSS 信息卡片 */}
              <div className="rounded-xl border border-gray-100 bg-[#f8f9fc] p-2.5 flex items-start gap-3">
                <div className="shrink-0 w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center text-rose-500 text-sm">📡</div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-gray-900 truncate">{rssTitle || '未获取标题'}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5 break-all line-clamp-2">{detectedRssUrl}</div>
                </div>
              </div>

              {/* 关联视频集 — 紧凑 */}
              <div className="relative">
                <label className="changli-form-label text-[13px] mb-1.5">关联视频集</label>
                {selectedSeriesId ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-xl text-[13px] text-rose-700 truncate">
                      {seriesList.find(s => s.id === selectedSeriesId)?.title || '未知'}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedSeriesId(null)}
                      className="text-gray-400 hover:text-gray-600 text-[12px] shrink-0"
                    >更换</button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      value={seriesSearch}
                      onChange={e => {
                        setSeriesSearch(e.target.value);
                        setShowSeriesDropdown(true);
                        if (!e.target.value && matchedSeries) {
                          setSelectedSeriesId(matchedSeries.id);
                          setShowSeriesDropdown(false);
                        }
                      }}
                      onFocus={() => setShowSeriesDropdown(true)}
                      placeholder={matchedSeries ? `自动匹配: ${matchedSeries.title}` : '搜索视频集...'}
                      className="changli-input"
                    />
                    {matchedSeries && !seriesSearch && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSeriesId(matchedSeries.id);
                          setShowSeriesDropdown(false);
                        }}
                        className="mt-1 text-[11px] text-rose-500 hover:text-rose-600"
                      >
                        ✓ 自动匹配「{matchedSeries.title}」，点击选择
                      </button>
                    )}
                    {showSeriesDropdown && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-[160px] overflow-y-auto">
                        {filteredSeries.length === 0 ? (
                          <div className="px-3 py-2 text-[12px] text-gray-400">无匹配结果</div>
                        ) : (
                          filteredSeries.map(s => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => {
                                setSelectedSeriesId(s.id);
                                setShowSeriesDropdown(false);
                                setSeriesSearch('');
                              }}
                              className="w-full px-3 py-1.5 text-left text-[13px] hover:bg-rose-50 transition-colors"
                            >
                              {s.title}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* 分组选择 */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="changli-form-label text-[13px] mb-0">选择要订阅的版本</label>
                  <div className="flex gap-2">
                    <button onClick={() => setSelectedGroups(new Set(rssGroups.map(g => g.prefix)))} className="text-[11px] text-rose-500 hover:text-rose-600 font-medium">全选</button>
                    <button onClick={() => setSelectedGroups(new Set())} className="text-[11px] text-gray-400 hover:text-gray-500">全不选</button>
                  </div>
                </div>
                <div className="max-h-[240px] overflow-y-auto space-y-1.5 pr-1">
                  {rssGroups.map(group => (
                    <label
                      key={group.prefix}
                      className={`relative flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer transition-all duration-200 ${
                        selectedGroups.has(group.prefix)
                          ? 'border-rose-200 bg-rose-50/60 shadow-sm'
                          : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50/50'
                      }`}
                    >
                      {/* 推荐角标 */}
                      {group.recommended && (
                        <div className="absolute -top-1.5 -right-1.5 px-1.5 py-[1px] rounded-full bg-rose-500 text-white text-[9px] font-bold leading-[18px] shadow-sm shadow-rose-200">
                          推荐
                        </div>
                      )}
                      <input
                        type="checkbox"
                        checked={selectedGroups.has(group.prefix)}
                        onChange={() => toggleGroup(group.prefix)}
                        className="shrink-0 rounded border-gray-300 text-rose-500 focus:ring-rose-500 w-4 h-4"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-gray-900 truncate">{group.prefix}</div>
                        <div className="text-[11px] text-gray-400 mt-0.5">{group.count} 集</div>
                      </div>
                    </label>
                  ))}
                </div>
                <div className="text-[11px] text-gray-400 mt-1.5">
                  已选 {selectedGroups.size} / {rssGroups.length} 个版本
                </div>
              </div>

              {/* 步骤2内错误提示 */}
              {error && step === 'episodes' && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700 flex items-center gap-2">
                  <span className="shrink-0 text-red-400">!</span>
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer (fixed at bottom) ── */}
        <div className="changli-modal-footer shrink-0">
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
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const handleCopyMagnet = async (key: string, magnetLink: string) => {
    try {
      await navigator.clipboard.writeText(magnetLink);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {}
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
                        onClick={() => handleCopyMagnet(ep.guid, ep.magnet_link || ep.torrent_url || '')}
                        className={copiedKey === ep.guid
                          ? "text-xs px-3 py-1 font-medium text-green-700 bg-green-50 border border-green-200 rounded"
                          : "action-btn text-xs px-3 py-1"
                        }
                      >
                        {copiedKey === ep.guid ? '复制成功' : '复制磁力链接'}
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
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [newEpisodes, setNewEpisodes] = useState<any[]>([]);
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
      const updated = await getSubscriptionBySeries(seriesId!);
      setSubscription(updated);
      setNewEpisodes(items);
      setExpandedId(expandedId === subscription.id ? null : subscription.id);
      if (items.length > 0) {
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

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const handleCopyMagnet = async (key: string, magnetLink: string) => {
    try {
      await navigator.clipboard.writeText(magnetLink);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {}
  };

  const handleDelete = async () => {
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!subscription) return;
    setShowDeleteConfirm(false);
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
          <img src={loadingIcon} alt="" className="w-3 h-3" />
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

      {/* 展开的更新列表 */}
      {expandedId && newEpisodes.length > 0 && (() => {
        // 按字幕组+版本分组
        const groups: Record<string, any[]> = {};
        for (const ep of newEpisodes) {
          const title = ep.title || '';
          let subtitleGroup = '未知字幕组';
          if (title.startsWith('[')) {
            const end = title.indexOf(']');
            if (end > 0) subtitleGroup = title.substring(1, end);
          }
          // 提取版本关键词
          const lower = title.toLowerCase();
          const versionParts: string[] = [];
          if (lower.includes('1080p') || lower.includes('1920x1080')) versionParts.push('1080p');
          else if (lower.includes('720p')) versionParts.push('720p');
          if (lower.includes('chs') || lower.includes('简中') || lower.includes('简体')) versionParts.push('简中');
          else if (lower.includes('简繁') || lower.includes('简／繁')) versionParts.push('简繁');
          else if (lower.includes('cht') || lower.includes('繁中')) versionParts.push('繁中');
          if (lower.includes('baha')) versionParts.push('Baha');
          else if (lower.includes('cr ')) versionParts.push('CR');
          else if (lower.includes('abema')) versionParts.push('ABEMA');
          if (lower.includes('无修') || lower.includes('uncensored')) versionParts.push('无修');
          if (lower.includes('放送版') || lower.includes('on-air')) versionParts.push('放送版');
          const versionKey = versionParts.length > 0 ? versionParts.join(' ') : '默认';
          const groupKey = subtitleGroup + '|' + versionKey;
          if (!groups[groupKey]) groups[groupKey] = [];
          groups[groupKey].push(ep);
        }
        return (
          <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
            {Object.entries(groups).map(([key, items]) => {
              const [subtitleGroup, versionKey] = key.split('|');
              const totalSize = items.reduce((sum, ep) => sum + (ep.file_size || 0), 0);
              return (
                <div key={key} className="bg-rose-50 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-900">
                      [{subtitleGroup}] {versionKey}
                    </span>
                    <span className="text-xs text-gray-400">
                      {items.length} 集{totalSize > 0 ? ' · ' + (totalSize < 1024*1024*1024 ? (totalSize/1024/1024).toFixed(0) + ' MB' : (totalSize/1024/1024/1024).toFixed(1) + ' GB') : ''}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {items.map(ep => (
                      <div key={ep.id} className="flex items-center justify-between">
                        <span className="text-xs text-gray-600 truncate flex-1">{ep.title}</span>
                        <button
                          onClick={() => handleCopyMagnet(ep.guid, ep.magnet_link || ep.torrent_url || '')}
                          className={copiedKey === ep.guid ? "ml-2 px-2 py-0.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded" : "ml-2 px-2 py-0.5 text-xs font-medium text-rose-600 bg-white border border-rose-200 rounded hover:bg-rose-50 transition-colors"}
                        >
                          复制磁力
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* 展开的更新列表 */}
      {expandedId && newEpisodes.length > 0 && (() => {
        const groups: Record<string, any[]> = {};
        for (const ep of newEpisodes) {
          const title = ep.title || '';
          let sg = '未知字幕组';
          if (title.startsWith('[')) { const e = title.indexOf(']'); if (e > 0) sg = title.substring(1, e); }
          const l = title.toLowerCase();
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
        return (
          <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
            {Object.entries(groups).map(([key, items]) => (
              <div key={key} className="bg-rose-50 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-900">{key}</span>
                  <span className="text-xs text-gray-400">{items.length} 集</span>
                </div>
                <div className="space-y-1.5">
                  {items.map((ep: any) => (
                    <div key={ep.id} className="flex items-center justify-between">
                      <span className="text-xs text-gray-600 truncate flex-1">{ep.title}</span>
                      <button
                        onClick={() => handleCopyMagnet(ep.guid, ep.magnet_link || ep.torrent_url || '')}
                        className="ml-2 px-2 py-0.5 text-xs font-medium text-rose-600 bg-white border border-rose-200 rounded hover:bg-rose-50"
                      >
                        复制磁力
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {createPortal(
        <SubscriptionBindModal
          open={showBindModal}
          onClose={() => setShowBindModal(false)}
          onBind={handleBind}
          initialSeriesId={seriesId}
        />,
        document.body
      )}

      {/* 取消订阅确认弹窗 */}
      {showDeleteConfirm && createPortal(
        <div className="changli-modal-backdrop" onClick={() => setShowDeleteConfirm(false)}>
          <div className="changli-modal-panel !w-[min(100%,380px)] !p-0" onClick={e => e.stopPropagation()}>
            <div className="changli-modal-header">
              <h2 className="text-lg font-bold text-gray-900">取消订阅</h2>
            </div>
            <div className="changli-modal-body">
              <p className="text-sm text-gray-600">
                确定取消订阅「<span className="font-medium text-gray-900">{subscription?.title?.replace(/^[^-]+\s*-\s*/, '') || subscription?.title}</span>」？
              </p>
              <p className="text-xs text-gray-400 mt-2">取消后检查更新记录将被清除</p>
            </div>
            <div className="changli-modal-footer">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="action-btn text-sm px-4 py-2"
              >
                取消
              </button>
              <button
                onClick={() => { setShowDeleteConfirm(false); confirmDelete(); }}
                className="action-btn action-btn-danger text-sm px-4 py-2"
              >
                确认取消
              </button>
            </div>
          </div>
        </div>
, document.body)}
    </>
  );
};

export default SubscriptionManager;
