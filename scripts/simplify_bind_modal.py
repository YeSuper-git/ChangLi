"""简化订阅绑定：按标题前缀分组 + 自动推荐"""
import re
from collections import defaultdict

with open('src/components/SubscriptionManager.tsx', 'r') as f:
    content = f.read()

# 1. 在 RssItem 接口后添加 RssGroup 接口
content = content.replace(
    '''interface BindModalProps {''',
    '''interface RssGroup {
  prefix: string;           // 标题前缀（去掉集数）
  items: RssItem[];         // 该组的所有条目
  count: number;            // 集数
  recommended: boolean;     // 是否推荐
}

interface BindModalProps {'''
)

# 2. 替换 state：用 rssGroups 替代 rssItems/selectedItems
content = content.replace(
    '''  const [rssItems, setRssItems] = useState<RssItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());''',
    '''  const [rssGroups, setRssGroups] = useState<RssGroup[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());'''
)

# 3. 替换 handleDetectRss
old_detect = '''  const handleDetectRss = async () => {
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
    return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
  };'''

new_detect = '''  const handleDetectRss = async () => {
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

      // 按标题前缀分组
      const groups = groupRssItems(rssData.items || []);
      setRssGroups(groups);

      // 默认选中推荐的
      const recommendedGuids = new Set(groups.filter(g => g.recommended).map(g => g.prefix));
      setSelectedGroups(recommendedGuids);

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

  const formatSize = (bytes: number | null) => {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(0) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
  };'''

content = content.replace(old_detect, new_detect)

# 4. 添加 groupRssItems 函数（在 SubscriptionBindModal 之前）
group_func = '''
/// 从 RSS 标题中提取前缀（去掉集数部分）
/// 例: "[ANi] Test - 02 [1080P]" → "[ANi] Test - [1080P]"
function extractTitlePrefix(title: string): string {
  // 去掉集数部分：匹配 " - 01", " - 02", " Ep01" 等
  return title.replace(/\\s*[-–—]\\s*\\d+\\s*$/, '')
             .replace(/\\s+Ep?\\d+\\s*$/i, '')
             .replace(/\\s+#\\d+\\s*$/, '')
             .trim();
}

/// 判断是否是推荐版本（简中、无修、无限制）
function isRecommended(title: string): boolean {
  const lower = title.toLowerCase();
  // 简中优先
  if (lower.includes('chs') || lower.includes('简中') || lower.includes('简体')) return true;
  // 无修/无限制
  if (lower.includes('无修') || lower.includes('无限制') || lower.includes('uncensored') || lower.includes('uncut')) return true;
  return false;
}

/// 按标题前缀分组 RSS 条目
function groupRssItems(items: RssItem[]): RssGroup[] {
  const map = new Map<string, RssItem[]>();
  
  for (const item of items) {
    const prefix = extractTitlePrefix(item.title);
    if (!map.has(prefix)) map.set(prefix, []);
    map.get(prefix)!.push(item);
  }

  const groups: RssGroup[] = [];
  for (const [prefix, groupItems] of map) {
    // 检查是否有推荐版本
    const recommended = groupItems.some(item => isRecommended(item.title));
    groups.push({
      prefix,
      items: groupItems,
      count: groupItems.length,
      recommended,
    });
  }

  // 排序：推荐的在前，然后按集数降序
  groups.sort((a, b) => {
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
    return b.count - a.count;
  });

  return groups;
}
'''

# 在 SubscriptionBindModal 之前插入
content = content.replace(
    'export const SubscriptionBindModal:',
    group_func + 'export const SubscriptionBindModal:'
)

# 5. 替换 modal 渲染中的 episodes step
old_episodes = '''          {step === 'episodes' && (
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
          )}'''

new_episodes = '''          {step === 'episodes' && (
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
                  <label className="changli-form-label mb-0">选择要订阅的版本</label>
                  <div className="flex gap-2">
                    <button onClick={() => setSelectedGroups(new Set(rssGroups.map(g => g.prefix)))} className="text-xs text-rose-500 hover:text-rose-600">全选</button>
                    <button onClick={() => setSelectedGroups(new Set())} className="text-xs text-gray-400 hover:text-gray-500">全不选</button>
                  </div>
                </div>
                <div className="max-h-[300px] overflow-y-auto space-y-2">
                  {rssGroups.map(group => (
                    <label
                      key={group.prefix}
                      className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                        selectedGroups.has(group.prefix)
                          ? 'border-rose-200 bg-rose-50/50'
                          : 'border-gray-100 bg-white hover:border-gray-200'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedGroups.has(group.prefix)}
                        onChange={() => toggleGroup(group.prefix)}
                        className="mt-0.5 rounded border-gray-300 text-rose-500 focus:ring-rose-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 truncate">{group.prefix}</span>
                          {group.recommended && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">推荐</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">更新 {group.count} 集</div>
                      </div>
                    </label>
                  ))}
                </div>
                <div className="text-xs text-gray-400 mt-2">已选 {selectedGroups.size} / {rssGroups.length} 个版本</div>
              </div>

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
              )}
            </div>
          )}'''

content = content.replace(old_episodes, new_episodes)

# 6. 更新 handleCreate：收集选中的所有 guid
old_create = '''  const handleCreate = async () => {
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
  };'''

new_create = '''  const handleCreate = async () => {
    if (!selectedSeriesId) {
      setError('请选择要关联的视频集');
      return;
    }
    setLoading(true);
    setError('');

    try {
      // 收集选中组的所有 guid 作为已知条目
      const knownGuids: string[] = [];
      for (const group of rssGroups) {
        if (selectedGroups.has(group.prefix)) {
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
        JSON.stringify({ selectedPrefixes: Array.from(selectedGroups), knownGuids }),
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
  };'''

content = content.replace(old_create, new_create)

with open('src/components/SubscriptionManager.tsx', 'w') as f:
    f.write(content)

print("done")
