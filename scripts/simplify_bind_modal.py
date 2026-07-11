"""简化 SubscriptionBindModal：移除关键词选择，改为直接显示 RSS 条目列表"""
import re

with open('src/components/SubscriptionManager.tsx', 'r') as f:
    content = f.read()

# 1. 添加 RssItem 接口（在 BindModalProps 之前）
content = content.replace(
    'interface BindModalProps {',
    '''interface RssItem {
  guid: string;
  title: string;
  link: string;
  description: string;
  torrent_url: string | null;
  magnet_link: string | null;
  content_length: number | null;
  pub_date: string | null;
}

interface BindModalProps {'''
)

# 2. 替换 state 声明
content = content.replace(
    """  const [rssTitle, setRssTitle] = useState('');
  const [keywordGroups, setKeywordGroups] = useState<KeywordGroup[]>([]);
  const [selectedKeywords, setSelectedKeywords] = useState<Record<string, Set<string>>>({});""",
    """  const [rssTitle, setRssTitle] = useState('');
  const [rssItems, setRssItems] = useState<RssItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());"""
)

# 3. 替换 step 类型
content = content.replace("'input' | 'keywords' | 'done'", "'input' | 'episodes' | 'done'")

# 4. 替换 handleDetectRss
old_detect = """  const handleDetectRss = async () => {
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
  };"""

new_detect = """  const handleDetectRss = async () => {
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
  };"""

content = content.replace(old_detect, new_detect)

# 5. 移除 toggleKeyword
content = re.sub(r'  const toggleKeyword = \(category: string, keyword: string\) => \{.*?\};\n', '', content, flags=re.DOTALL)

# 6. 简化 handleCreate
old_create = """  const handleCreate = async () => {
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
  };"""

new_create = """  const handleCreate = async () => {
    if (!selectedSeriesId) {
      setError('请选择要关联的视频集');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const sub = await createSubscription(
        selectedSeriesId,
        selectedSiteId,
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
  };"""

content = content.replace(old_create, new_create)

# 7. 替换 modal 渲染（keywords step → episodes step）
old_keywords_step = """          {step === 'keywords' && (
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
          )}"""

new_episodes_step = """          {step === 'episodes' && (
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
          )}"""

content = content.replace(old_keywords_step, new_episodes_step)

# 8. 更新 footer 按钮文本
content = content.replace("{loading ? '检测中...' : '检测 RSS'}", "{loading ? '获取中...' : '获取 RSS'}")
content = content.replace("onClick={() => setStep('input')}", "onClick={() => setStep('input')}")

# 9. 移除未使用的导入
content = content.replace("extractKeywordsFromRss, ", "")
content = content.replace("updateSubscriptionKeywords, getSubscriptionKeywords, ", "")
content = content.replace("SubscriptionKeyword, ", "")

# 10. 移除 KeywordGroup 接口
content = re.sub(r'interface KeywordGroup \{[^}]*\}\n', '', content)

with open('src/components/SubscriptionManager.tsx', 'w') as f:
    f.write(content)

print("done")
