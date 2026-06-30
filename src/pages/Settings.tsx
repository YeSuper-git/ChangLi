import React, { useState, useEffect } from 'react';
import { getSites, addSite, deleteSite, getTags, addTag, deleteTag, getStorageInfo, openDataDir, deleteVideosByCategory, rescanCategoryMetadata, getAllCategories, createCategory, updateCategory, deleteCategory, parseCategoryFeatures, scanCategory, getAllActorFields, updateActorField, createActorField, deleteActorField, getPresetTemplates, getExtensionPresetTemplates, enablePresetTemplate, disablePresetTemplate, reorderCategories } from '../utils/api';
import type { Site, Tag, StorageInfo, Category, CategoryFeatures, ActorField, PresetTemplate } from '../utils/api';
// confirm dialog removed — using custom React modal instead
import { useSecondConfirm } from '../utils/useSecondConfirm';
import { useLibraryStore } from '../store/libraryStore';
import loadingIcon from '../assets/icons/loading.svg';
import Switch from '../components/Switch';
import { open } from '@tauri-apps/plugin-dialog';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { notify } from '../utils/notify';
import { changelogData, currentVersion } from '../generated/versionInfo';

const Settings: React.FC = () => {
  const [sites, setSites] = useState<Site[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSite, setNewSite] = useState({ name: '', url: '', parser_type: 'auto', config: '{}' });
  const [newTagName, setNewTagName] = useState('');
  const { pendingKey, requestSecondConfirm } = useSecondConfirm();

  useEffect(() => {
    window.scrollTo(0, 0);
    loadSettingsData();
  }, []);

  const loadSettingsData = async () => {
    try {
      const [sitesList, tagsList, storage, catsList, fieldsList] = await Promise.all([getSites(), getTags(), getStorageInfo(), getAllCategories(), getAllActorFields()]);
      setSites(sitesList);
      setTags(tagsList);
      setStorageInfo(storage);
      setCategories(catsList);
      setActorFields(fieldsList);
      // 加载扩展预设模板
      try {
        const templates = await getExtensionPresetTemplates();
        setPresetTemplates(templates);
        const allTemplates = await getPresetTemplates();
        setAllPresetTemplates(allTemplates);
        const map: Record<string, boolean> = {};
        for (const t of templates) {
          map[t.key] = fieldsList.some((f: ActorField) => f.field_key === t.key && f.enabled);
        }
        setPresetEnabledMap(map);
      } catch {}
    } catch (error) {
      console.error('加载设置失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadSites = async () => {
    const sitesList = await getSites();
    setSites(sitesList);
  };

  const loadTags = async () => {
    const tagsList = await getTags();
    setTags(tagsList);
  };

  const handleAddSite = async () => {
    if (!newSite.name.trim() || !newSite.url.trim()) return;
    
    try {
      await addSite({
        name: newSite.name,
        url: newSite.url,
        parser_type: newSite.parser_type,
        config: JSON.parse(newSite.config)
      });
      setShowAddModal(false);
      setNewSite({ name: '', url: '', parser_type: 'auto', config: '{}' });
      loadSites();
    } catch (error) {
      console.error('添加网站失败:', error);
    }
  };

  const handleDeleteSite = async (id: number) => {
    try {
      await deleteSite(id);
      loadSites();
    } catch (error) {
      console.error('删除网站失败:', error);
    }
  };

  const handleAddTag = async () => {
    const name = newTagName.trim();
    if (!name) return;

    try {
      await addTag(name);
      setNewTagName('');
      loadTags();
    } catch (error) {
      console.error('添加标签失败:', error);
    }
  };

  const handleDeleteTag = async (id: number) => {
    try {
      await deleteTag(id);
      loadTags();
    } catch (error) {
      console.error('删除标签失败:', error);
    }
  };

  const [deleteCatConfirm, setDeleteCatConfirm] = useState<string | null>(null);
  const [rescanningCategory, setRescanningCategory] = useState<string | null>(null);
  const [rescanConfirm, setRescanConfirm] = useState<string | null>(null);
  const refreshSeries = useLibraryStore((s) => s.refreshSeries);

  const doDeleteCategory = async (key: string) => {
    try {
      await deleteVideosByCategory(key);
      await refreshSeries();
    } catch (error) {
      console.error('删除大类视频失败:', error);
      notify({ message: '删除失败: ' + String(error), type: 'error' });
    } finally {
    }
  };

  const handleRescanCategory = async (key: string) => {
    setRescanningCategory(key);
    try {
      const result = await rescanCategoryMetadata(key);
      notify({ message: `扫描完成，更新了 ${result[0]} 部，跳过 ${result[1]} 部`, type: 'success' });
    } catch (error) {
      console.error('重新扫描大类元数据失败:', error);
      notify({ message: '扫描失败: ' + String(error), type: 'info' });
    } finally {
      setRescanningCategory(null);
    }
  };

  // ==================== 大类管理 ====================
  const [categories, setCategories] = useState<Category[]>([]);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categoryForm, setCategoryForm] = useState({
    key: '',
    name: '',
    card_layout: 'auto' as 'portrait' | 'landscape' | 'auto',
    features: { tags: true, actors: true, tracking: true, chinese_sub: true, episode: '话' } as CategoryFeatures,
    scan_path: '' as string,
  });
  const [categoryDeleteConfirm, setCategoryDeleteConfirm] = useState<string | null>(null);
  const [scanAfterCreate, setScanAfterCreate] = useState(false);

  const loadCategories = async () => {
    try {
      const list = await getAllCategories();
      setCategories(list);
    } catch (error) {
      console.error('加载大类失败:', error);
    }
  };


  const openAddCategory = () => {
    setEditingCategory(null);
    setCategoryForm({ key: Date.now().toString(36), name: '', card_layout: 'auto', features: { tags: true, actors: true, tracking: true, chinese_sub: true, episode: '话' }, scan_path: '' });
    setShowCategoryModal(true);
  };

  const openEditCategory = (cat: Category) => {
    setEditingCategory(cat);
    setCategoryForm({ key: cat.key, name: cat.name, card_layout: cat.card_layout, features: parseCategoryFeatures(cat.features), scan_path: cat.scan_path || '' });
    setShowCategoryModal(true);
  };

  const handleSaveCategory = async () => {
    const key = categoryForm.key.trim() || Date.now().toString(36);
    if (!categoryForm.name.trim()) return;
    try {
      const featuresStr = JSON.stringify(categoryForm.features);
      const scanPath = categoryForm.scan_path.trim() || null;
      if (editingCategory) {
        await updateCategory(key, categoryForm.name, categoryForm.card_layout, featuresStr, scanPath);
      } else {
        await createCategory(key, categoryForm.name, categoryForm.card_layout, featuresStr, scanPath);
        if (scanPath) {
          setScanAfterCreate(true);
        }
      }
      setShowCategoryModal(false);
      loadCategories();
    } catch (error) {
      console.error('保存大类失败:', error);
    }
  };

  const handleScanAfterCreate = async () => {
    setScanAfterCreate(false);
    try {
      const result = await scanCategory(categoryForm.key);
      notify({ message: `扫描完成：添加了 ${result.added} 部，更新了 ${result.updated} 部`, type: 'success' });
    } catch (error) {
      console.error('扫描失败:', error);
      notify({ message: '扫描失败: ' + String(error), type: 'error' });
    }
  };

  const selectScanPath = async () => {
    try {
      const selected = await open({ directory: true, title: '选择扫描目录' });
      if (selected) {
        setCategoryForm({ ...categoryForm, scan_path: selected as string });
      }
    } catch (error) {
      console.error('选择文件夹失败:', error);
    }
  };

  const handleDeleteCategory = async (key: string) => {
    try {
      await deleteCategory(key);
      loadCategories();
    } catch (error) {
      console.error('删除大类失败:', error);
    }
  };

  const handleMoveCategory = async (key: string, direction: 'up' | 'down') => {
    const idx = categories.findIndex(c => c.key === key);
    if (idx < 0) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === categories.length - 1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    const newCategories = [...categories];
    [newCategories[idx], newCategories[swapIdx]] = [newCategories[swapIdx], newCategories[idx]];
    try {
      await reorderCategories(newCategories.map(c => c.key));
      setCategories(newCategories);
    } catch (error) {
      console.error('大类排序失败:', error);
    }
  };

  // ==================== 演员字段管理 ====================
  const [actorFields, setActorFields] = useState<ActorField[]>([]);
  const [showFieldModal, setShowFieldModal] = useState(false);
  const [editingField, setEditingField] = useState<ActorField | null>(null);
  const [fieldForm, setFieldForm] = useState({ field_key: '', field_label: '', field_type: 'text', enabled: true, options: [] as string[] });
  const [fieldContextMenu, setFieldContextMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const [newOptionValue, setNewOptionValue] = useState('');
  const [presetTemplates, setPresetTemplates] = useState<PresetTemplate[]>([]);
  const [allPresetTemplates, setAllPresetTemplates] = useState<PresetTemplate[]>([]);
  const [presetEnabledMap, setPresetEnabledMap] = useState<Record<string, boolean>>({});
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [deleteFieldConfirm, setDeleteFieldConfirm] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [showChangelog, setShowChangelog] = useState(false);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!fieldContextMenu) return;
    const close = () => setFieldContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [fieldContextMenu]);

  const loadPresetTemplates = async () => {
    try {
      const templates = await getExtensionPresetTemplates();
      setPresetTemplates(templates);
      const allTemplates = await getPresetTemplates();
      setAllPresetTemplates(allTemplates);
      const map: Record<string, boolean> = {};
      for (const t of templates) {
        map[t.key] = actorFields.some(f => f.field_key === t.key && f.enabled);
      }
      setPresetEnabledMap(map);
    } catch (error) {
      console.error('加载预设模板失败:', error);
    }
  };

  const loadActorFields = async () => {
    try {
      const list = await getAllActorFields();
      setActorFields(list);
    } catch (error) {
      console.error('加载演员字段失败:', error);
    }
  };

  const openEditField = (field: ActorField) => {
    setEditingField(field);
    let opts: string[] = [];
    try { if (field.options) opts = JSON.parse(field.options); } catch {}
    setFieldForm({ field_key: field.field_key, field_label: field.field_label, field_type: field.field_type, enabled: field.enabled, options: opts });
    setShowFieldModal(true);
  };

  // 判断是否是预设模板字段
  const isPresetField = (fieldKey: string) => allPresetTemplates.some(t => t.key === fieldKey);

  const handleSaveField = async () => {
    try {
      const optionsStr = fieldForm.field_type === 'select' ? JSON.stringify(fieldForm.options) : null;
      if (editingField) {
        await updateActorField(fieldForm.field_key, fieldForm.field_label, fieldForm.field_type, optionsStr, null, fieldForm.enabled);
      } else {
        const autoKey = fieldForm.field_label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || Date.now().toString(36);
        await createActorField(autoKey, fieldForm.field_label, fieldForm.field_type, optionsStr, null);
      }
      setShowFieldModal(false);
      loadActorFields();
    } catch (error) {
      console.error('保存演员字段失败:', error);
    }
  };

  const handleDeleteField = async (fieldKey: string) => {
    try {
      await deleteActorField(fieldKey);
      loadActorFields();
    } catch (error) {
      console.error('删除演员字段失败:', error);
    }
  };

  const handleCheckUpdate = async () => {
    setUpdateStatus('检查中...');
    notify({ message: '正在检查更新...', type: 'info' });
    try {
      const update = await check();
      if (update) {
        setUpdateStatus(`发现新版本 ${update.version}，正在下载...`);
        notify({ message: `发现新版本 ${update.version}，正在下载...`, type: 'info' });
        await update.downloadAndInstall((progress) => {
          if (progress.event === 'Finished') {
            setUpdateStatus('下载完成，准备重启...');
            notify({ message: '下载完成，准备重启...', type: 'success' });
          }
        });
        await relaunch();
      } else {
        setUpdateStatus('已是最新版本');
        notify({ message: '已是最新版本', type: 'success' });
        setTimeout(() => setUpdateStatus(null), 3000);
      }
    } catch (error) {
      console.error('检查更新失败:', error);
      setUpdateStatus('检查更新失败');
      notify({ message: '检查更新失败: ' + String(error), type: 'error' });
      setTimeout(() => setUpdateStatus(null), 5000);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500 flex items-center gap-2"><img src={loadingIcon} alt="加载中" className="w-6 h-6 animate-spin" /></div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-10">
        <h1 className="text-3xl font-bold">设置</h1>
      </div>

      {/* 数据存储 */}
      <section className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">数据存储</h2>
            <p className="text-sm text-gray-500 mt-1">
              默认使用系统数据目录；如果程序同级存在 data 目录或 portable.flag，则自动切换为便携模式。
            </p>
          </div>
          <button
            onClick={() => openDataDir()}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800"
          >
            打开数据目录
          </button>
        </div>

        <div className="card p-6 space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500 w-24">当前模式</span>
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-gray-100 text-sm text-gray-800">
              {storageInfo?.mode === 'portable' ? '便携模式' : '系统数据目录'}
            </span>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-sm text-gray-500 w-24 shrink-0">数据目录</span>
            <code className="text-sm text-gray-800 break-all bg-gray-50 px-3 py-2 rounded-lg flex-1">
              {storageInfo?.data_dir || '加载中...'}
            </code>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-sm text-gray-500 w-24 shrink-0">数据库</span>
            <code className="text-sm text-gray-800 break-all bg-gray-50 px-3 py-2 rounded-lg flex-1">
              {storageInfo?.db_path || '加载中...'}
            </code>
          </div>
        </div>
      </section>



      {/* 标签管理 */}
      <section className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">标签管理</h2>
            <p className="text-sm text-gray-500 mt-1">标签入口已移动到设置中，可在这里统一新增和删除。</p>
          </div>
        </div>

        <div className="card p-6 mb-4">
          <div className="flex gap-3">
            <input
              type="text"
              value={newTagName}
              onChange={(event) => setNewTagName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleAddTag();
              }}
              placeholder="输入新标签名称"
              className="search-input flex-1"
            />
            <button
              onClick={handleAddTag}
              disabled={!newTagName.trim()}
              className="px-5 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
            >
              添加标签
            </button>
          </div>
        </div>

        {tags.length > 0 ? (
          <div className="flex flex-wrap gap-3">
            {tags.map((tag) => (
              <div key={tag.id} className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-full">
                <span className="text-sm text-gray-800">{tag.name}</span>
                <button
                  onClick={() => requestSecondConfirm(`settings-tag-${tag.id}`, () => handleDeleteTag(tag.id))}
                  className="text-gray-400 hover:text-red-500"
                  aria-label={`删除标签 ${tag.name}`}
                >
                  {pendingKey === `settings-tag-${tag.id}` ? '确认' : '✕'}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-10 text-gray-500">暂无标签</div>
        )}
      </section>

      {/* 网站管理 */}
      <section className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">网站管理</h2>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            添加网站
          </button>
        </div>
        
        {sites.length > 0 ? (
          <div className="space-y-4">
            {sites.map((site) => (
              <div key={site.id} className="card p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">{site.name}</h3>
                    <p className="text-sm text-gray-500 mt-1">{site.url}</p>
                    <p className="text-xs text-gray-400 mt-1">解析器: {site.parser_type}</p>
                  </div>
                  <button
                    onClick={() => requestSecondConfirm(`site-${site.id}`, () => handleDeleteSite(site.id))}
                    className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                  >
                    {pendingKey === `site-${site.id}` ? '再次确认删除' : '删除'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-4">暂无网站配置</p>
            <p className="text-gray-400 text-sm">添加网站后可以搜索在线资源</p>
          </div>
        )}
      </section>

      {/* 大类管理 */}
      <section className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">大类管理</h2>
            <p className="text-sm text-gray-500 mt-1">配置不同大类的卡片布局和功能开关</p>
          </div>
          <button
            onClick={openAddCategory}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            新增大类
          </button>
        </div>

        {categories.length > 0 ? (
          <div className="space-y-4">
            {categories.map((cat) => {
              const features = parseCategoryFeatures(cat.features);
              const layoutLabel = cat.card_layout === 'portrait' ? '竖版' : cat.card_layout === 'landscape' ? '横版' : '自动';
              const activeFeatures = Object.entries(features).filter(([, v]) => v).map(([k]) => {
                const labels: Record<string, string> = { tags: '标签', actors: '演员', tracking: '追番', chinese_sub: '中字', episode: '剧集单位' };
                return labels[k] || k;
              });
              return (
                <div key={cat.key} className="card p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900">{cat.name}</h3>
                      <p className="text-sm text-gray-500 mt-1">卡片方向: {layoutLabel}</p>
                      {cat.scan_path && (
                        <p className="text-xs text-gray-400 mt-1 truncate">扫描路径: {cat.scan_path}</p>
                      )}
                      {activeFeatures.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {activeFeatures.map((f) => (
                            <span key={f} className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-50 text-xs text-blue-700">{f}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 ml-4">
                      <button
                        onClick={() => handleMoveCategory(cat.key, 'up')}
                        disabled={categories.indexOf(cat) === 0}
                        className="px-3 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-medium"
                        title="上移"
                      >▲ 上移</button>
                      <button
                        onClick={() => handleMoveCategory(cat.key, 'down')}
                        disabled={categories.indexOf(cat) === categories.length - 1}
                        className="px-3 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-medium"
                        title="下移"
                      >▼ 下移</button>
                      <button
                        onClick={() => openEditCategory(cat)}
                        className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => setRescanConfirm(cat.key)}
                        disabled={rescanningCategory === cat.key}
                        className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50"
                      >
                        {rescanningCategory === cat.key ? '扫描中...' : '扫描元数据'}
                      </button>
                      <button
                        onClick={() => setDeleteCatConfirm(cat.key)}
                        className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                      >
                        删除视频
                      </button>
                      <button
                        onClick={() => setCategoryDeleteConfirm(cat.key)}
                        className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-4">暂无大类配置</p>
            <p className="text-gray-400 text-sm">点击"新增大类"添加</p>
          </div>
        )}
      </section>

      {/* 演员字段管理 */}
      <section className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">演员管理</h2>
            <p className="text-sm text-gray-500 mt-1">配置演员详情页显示的字段</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { loadPresetTemplates(); setShowPresetModal(true); }}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
            >
              扩展系统预设
            </button>
          </div>
        </div>

        {(() => {
          const presetKeySet = new Set(allPresetTemplates.map(t => t.key));
          const sorted = [...actorFields.filter(f => {
            if (f.field_key === 'name') return false;
            // 过滤掉已关闭的扩展预设模板记录
            if (presetKeySet.has(f.field_key) && !f.enabled) return false;
            return true;
          })].sort((a, b) => {
            const aPreset = presetKeySet.has(a.field_key) ? 0 : 1;
            const bPreset = presetKeySet.has(b.field_key) ? 0 : 1;
            return aPreset - bPreset;
          });
          return (
            <div className="grid grid-cols-4 gap-4">
              {sorted.map((field) => (
                <div key={field.field_key} className="card p-4 cursor-pointer flex flex-col items-center justify-center" onClick={() => openEditField(field)} onContextMenu={(e) => { e.preventDefault(); setFieldContextMenu({ key: field.field_key, x: e.clientX, y: e.clientY }); }}>
                  <h3 className="font-semibold text-gray-900 text-sm">{field.field_label}</h3>
                  {presetKeySet.has(field.field_key) && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-blue-50 text-[10px] text-blue-600 mt-1">预设</span>
                  )}
                  <p className="text-xs text-gray-500 mt-1">{field.field_type === 'text' ? '文本' : field.field_type === 'number' ? '数字' : field.field_type === 'date' ? '日期' : field.field_type === 'compound' ? '复合' : '选择'}</p>
                  <p className="text-xs mt-1">{field.enabled ? <span className="text-green-600">● 启用</span> : <span className="text-gray-400">○ 未启用</span>}</p>
                </div>
              ))}
            </div>
          );
        })()}
      </section>

      {/* 大类视频删除确认弹窗 */}
      {deleteCatConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl">
            <p className="text-gray-900 text-base mb-6">
              确定要删除「{categories.find(c => c.key === deleteCatConfirm)?.name || deleteCatConfirm}」下的所有视频吗？此操作不可恢复。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { doDeleteCategory(deleteCatConfirm); setDeleteCatConfirm(null); }}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm font-medium"
              >
                狠心删除
              </button>
              <button
                onClick={() => setDeleteCatConfirm(null)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium"
              >
                返回
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 添加网站弹窗 */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 w-96">
            <h2 className="text-2xl font-bold mb-6">添加网站</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">网站名称</label>
                <input
                  type="text"
                  value={newSite.name}
                  onChange={(e) => setNewSite({ ...newSite, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                  placeholder="如：动漫之家"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">网站地址</label>
                <input
                  type="text"
                  value={newSite.url}
                  onChange={(e) => setNewSite({ ...newSite, url: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                  placeholder="https://www.example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">解析器类型</label>
                <select
                  value={newSite.parser_type}
                  onChange={(e) => setNewSite({ ...newSite, parser_type: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  <option value="auto">自动检测</option>
                  <option value="custom">自定义</option>
                </select>
              </div>
            </div>
            <div className="flex gap-4 mt-8">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                取消
              </button>
              <button
                onClick={handleAddSite}
                className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 大类编辑/新增弹窗 */}
      {showCategoryModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 w-[480px] max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-6">{editingCategory ? '编辑大类' : '新增大类'}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">大类名称</label>
                <input
                  type="text"
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                  placeholder="如：动漫"
                />
              </div>
              {/* Key 不展示，由系统管理 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">卡片方向</label>
                <select
                  value={categoryForm.card_layout}
                  onChange={(e) => setCategoryForm({ ...categoryForm, card_layout: e.target.value as 'portrait' | 'landscape' | 'auto' })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  <option value="auto">自动</option>
                  <option value="portrait">竖版</option>
                  <option value="landscape">横版</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">默认扫描路径</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={categoryForm.scan_path}
                    onChange={(e) => setCategoryForm({ ...categoryForm, scan_path: e.target.value })}
                    className="flex-1 px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                    placeholder="留空则不启用一键扫描"
                  />
                  <button
                    type="button"
                    onClick={selectScanPath}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm"
                  >
                    选择文件夹
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">功能开关</label>
                <div className="space-y-3">
                  {([
                    { key: 'tags' as const, label: '标签', tip: '控制是否支持给视频集添加标签分类' },
                    { key: 'actors' as const, label: '演员', tip: '控制是否支持给视频集关联演员' },
                    { key: 'tracking' as const, label: '追番', tip: '控制是否支持追番/已看完功能' },
                    { key: 'chinese_sub' as const, label: '中文字幕', tip: '控制是否支持中文字幕标记' },
                  ]).map(({ key, label, tip }) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">{label}</span>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={!!categoryForm.features[key]}
                          onChange={(checked) => setCategoryForm({
                            ...categoryForm,
                            features: { ...categoryForm.features, [key]: checked }
                          })}
                          ariaLabel={`${label}开关`}
                        />
                        <span className="group relative">
                          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 text-gray-500 text-xs cursor-help">?</span>
                          <span className="absolute bottom-full right-0 mb-1 px-2 py-1 bg-gray-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">{tip}</span>
                        </span>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">剧集单位</span>
                    <div className="flex items-center gap-2">
                      <select
                      value={categoryForm.features.episode || '部'}
                      onChange={(e) => setCategoryForm({
                        ...categoryForm,
                        features: { ...categoryForm.features, episode: e.target.value }
                      })}
                      className="px-3 py-1 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                      >
                      <option value="话">话</option>
                      <option value="部">部</option>
                      <option value="集">集</option>
                      </select>
                      <span className="group relative">
                        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 text-gray-500 text-xs cursor-help">?</span>
                        <span className="absolute bottom-full right-0 mb-1 px-2 py-1 bg-gray-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">控制视频集的单位描述</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex gap-4 mt-8">
              <button
                onClick={() => setShowCategoryModal(false)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                取消
              </button>
              <button
                onClick={handleSaveCategory}
                disabled={!categoryForm.key.trim() || !categoryForm.name.trim()}
                className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
              >
                {editingCategory ? '保存' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 大类删除确认弹窗 */}
      {categoryDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl">
            <p className="text-gray-900 text-base mb-6">
              确定要删除大类「{categories.find(c => c.key === categoryDeleteConfirm)?.name || categoryDeleteConfirm}」吗？
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { handleDeleteCategory(categoryDeleteConfirm); setCategoryDeleteConfirm(null); }}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm font-medium"
              >
                确认删除
              </button>
              <button
                onClick={() => setCategoryDeleteConfirm(null)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 演员字段编辑/新增弹窗 */}
      {showFieldModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 w-96">
            <h2 className="text-2xl font-bold mb-6">{editingField ? '编辑字段' : '新增字段'}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">字段名称</label>
                <input
                  type="text"
                  value={fieldForm.field_label}
                  onChange={(e) => setFieldForm({ ...fieldForm, field_label: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                  placeholder="如：身高"
                />
              </div>
              {!(editingField && isPresetField(editingField.field_key)) && (
                <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">字段类型</label>
                <select
                  value={fieldForm.field_type}
                  onChange={(e) => setFieldForm({ ...fieldForm, field_type: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  <option value="text">文本</option>
                  <option value="number">数字</option>
                  <option value="date">日期</option>
                  <option value="select">选择</option>
                </select>
              </div>

              {editingField && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">启用</span>
                  <Switch
                    checked={fieldForm.enabled}
                    onChange={(checked) => setFieldForm({ ...fieldForm, enabled: checked })}
                    ariaLabel="演员字段启用开关"
                  />
                </div>
              )}
              {fieldForm.field_type === 'select' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">选项配置</label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {(fieldForm.options || []).map((opt, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded text-sm">
                        {opt}
                        <button onClick={() => { const newOpts = [...(fieldForm.options || [])]; newOpts.splice(i, 1); setFieldForm({ ...fieldForm, options: newOpts }); }} className="text-gray-400 hover:text-red-500">×</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input type="text" value={newOptionValue} onChange={(e) => setNewOptionValue(e.target.value)} placeholder="新选项" className="flex-1 px-3 py-2 border rounded-lg" onKeyDown={(e) => { if (e.key === 'Enter' && newOptionValue.trim()) { setFieldForm({ ...fieldForm, options: [...(fieldForm.options || []), newOptionValue.trim()] }); setNewOptionValue(''); } }} />
                    <button onClick={() => { if (newOptionValue.trim()) { setFieldForm({ ...fieldForm, options: [...(fieldForm.options || []), newOptionValue.trim()] }); setNewOptionValue(''); } }} className="px-3 py-2 bg-gray-100 rounded-lg">添加</button>
                  </div>
                </div>
              )}
                </>
              )}
              {editingField && isPresetField(editingField.field_key) && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">启用</span>
                  <Switch
                    checked={fieldForm.enabled}
                    onChange={(checked) => setFieldForm({ ...fieldForm, enabled: checked })}
                    ariaLabel="演员字段启用开关"
                  />
                </div>
              )}
            </div>
            <div className="flex gap-4 mt-8">
              <button
                onClick={() => setShowFieldModal(false)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                取消
              </button>
              <button
                onClick={handleSaveField}
                disabled={!fieldForm.field_label.trim()}
                className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
              >
                {editingField ? '保存' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 演员字段右键菜单 */}
      {fieldContextMenu && (
        <div className="fixed z-50 bg-white border rounded-xl shadow-xl py-2 w-fit" style={{ left: fieldContextMenu.x + 160 > window.innerWidth ? fieldContextMenu.x - 160 : fieldContextMenu.x, top: fieldContextMenu.y + 200 > window.innerHeight ? fieldContextMenu.y - 200 : fieldContextMenu.y }}>
          <button onClick={() => { openEditField(actorFields.find(f => f.field_key === fieldContextMenu.key)!); setFieldContextMenu(null); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">编辑</button>
          {!isPresetField(fieldContextMenu.key) && (
            <button onClick={() => { setDeleteFieldConfirm(fieldContextMenu.key); setFieldContextMenu(null); }} className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50">删除</button>
          )}
        </div>
      )}

      {/* 重新扫描元数据确认弹窗 */}
      {rescanConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl">
            <p className="text-gray-900 text-base mb-6">
              确定重新扫描该大类的所有视频元数据？
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { handleRescanCategory(rescanConfirm); setRescanConfirm(null); }}
                className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm font-medium"
              >
                确定
              </button>
              <button
                onClick={() => setRescanConfirm(null)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 演员字段删除确认弹窗 */}
      {deleteFieldConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl">
            <p className="text-gray-900 text-base mb-6">
              确定删除该字段？
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { handleDeleteField(deleteFieldConfirm); setDeleteFieldConfirm(null); }}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm font-medium"
              >
                确认删除
              </button>
              <button
                onClick={() => setDeleteFieldConfirm(null)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 扩展系统预设弹窗 */}
      {showPresetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-xl">
            <h2 className="text-xl font-bold mb-4">扩展系统预设</h2>
            <p className="text-sm text-gray-500 mb-4">启用后将在演员管理中显示对应字段</p>
            <div className="space-y-3">
              {presetTemplates.map((template) => {
                const enabled = presetEnabledMap[template.key] || false;
                return (
                  <div key={template.key} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <span className="text-sm font-medium text-gray-900">{actorFields.find(f => f.field_key === template.key)?.field_label || template.name}</span>
                    </div>
                    <Switch
                      checked={enabled}
                      onChange={async (checked) => {
                        try {
                          if (checked) {
                            await enablePresetTemplate(template.key);
                          } else {
                            await disablePresetTemplate(template.key);
                          }
                          // 刷新
                          const fieldsList = await getAllActorFields();
                          setActorFields(fieldsList);
                          const map: Record<string, boolean> = {};
                          for (const t of presetTemplates) {
                            map[t.key] = fieldsList.some((f: ActorField) => f.field_key === t.key && f.enabled);
                          }
                          setPresetEnabledMap(map);
                        } catch (error) {
                          console.error('切换预设模板失败:', error);
                        }
                      }}
                      ariaLabel={`${template.name}预设开关`}
                    />
                  </div>
                );
              })}
              {presetTemplates.length === 0 && (
                <p className="text-center text-gray-400 text-sm py-4">暂无扩展预设</p>
              )}
            </div>
            <div className="mt-6">
              <button
                onClick={() => setShowPresetModal(false)}
                className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新增大类后立即扫描确认弹窗 */}
      {scanAfterCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl">
            <p className="text-gray-900 text-base mb-6">
              大类已创建，是否立即扫描并添加？
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleScanAfterCreate}
                className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm font-medium"
              >
                立即扫描
              </button>
              <button
                onClick={() => setScanAfterCreate(false)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium"
              >
                稍后再说
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 检查更新 & 版本信息 */}
      <section className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">关于</h2>
            <p className="text-sm text-gray-500 mt-1">当前版本：v{currentVersion}</p>
          </div>
          <div className="flex gap-2 items-center">
            {updateStatus && (
              <span className="text-sm text-gray-500">{updateStatus}</span>
            )}
            <button
              onClick={handleCheckUpdate}
              disabled={updateStatus === '检查中...'}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
            >
              检查更新
            </button>
            <button
              onClick={() => setShowChangelog(true)}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
            >
              版本更新记录
            </button>
          </div>
        </div>
      </section>

      {/* 版本更新记录弹窗 */}
      {showChangelog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl w-[700px] max-h-[85vh] flex flex-col mx-4 shadow-xl">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold">版本更新记录</h2>
              <button onClick={() => setShowChangelog(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 p-6 space-y-2">
              {changelogData.map((entry) => {
                const isCurrent = entry.version === currentVersion;
                const isExpanded = expandedVersion === entry.version;
                return (
                  <div key={entry.version} className={`border rounded-lg ${isCurrent ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}>
                    <button
                      onClick={() => setExpandedVersion(isExpanded ? null : entry.version)}
                      className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <span className={`font-semibold text-sm ${isCurrent ? 'text-blue-700' : 'text-gray-900'}`}>v{entry.version}</span>
                        <span className="text-xs text-gray-500">{entry.date}</span>
                        {isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500 text-white">当前</span>}
                      </div>
                      <span className="text-gray-400 text-sm">{isExpanded ? '▲' : '▼'}</span>
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-4 space-y-3">
                        {entry.changes.map((group, gi) => (
                          <div key={gi}>
                            <p className="text-xs font-semibold text-gray-500 mb-1">{group.category}</p>
                            <ul className="space-y-1">
                              {group.items.map((item, ii) => (
                                <li key={ii} className="text-sm text-gray-700 flex items-start gap-2">
                                  <span className="text-gray-400 mt-0.5">•</span>
                                  <span>{item}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
