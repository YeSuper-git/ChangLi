import React, { useState, useEffect } from 'react';
import { getSites, addSite, deleteSite, getTags, addTag, deleteTag, getStorageInfo, openDataDir, deleteVideosByCategory, rescanCategoryMetadata, getAllCategories, createCategory, updateCategory, deleteCategory, parseCategoryFeatures, scanCategory, getAllActorFields, updateActorField, createActorField, deleteActorField } from '../utils/api';
import type { Site, Tag, StorageInfo, Category, CategoryFeatures, ActorField } from '../utils/api';
// confirm dialog removed — using custom React modal instead
import { useSecondConfirm } from '../utils/useSecondConfirm';
import { useLibraryStore } from '../store/libraryStore';
import loadingIcon from '../assets/icons/loading.svg';
import { open } from '@tauri-apps/plugin-dialog';

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
  const refreshSeries = useLibraryStore((s) => s.refreshSeries);

  const doDeleteCategory = async (key: string) => {
    try {
      await deleteVideosByCategory(key);
      await refreshSeries();
    } catch (error) {
      console.error('删除大类视频失败:', error);
      alert('删除失败: ' + String(error));
    } finally {
    }
  };

  const handleRescanCategory = async (key: string) => {
    setRescanningCategory(key);
    try {
      await rescanCategoryMetadata(key);
    } catch (error) {
      console.error('重新扫描大类元数据失败:', error);
      alert('扫描失败: ' + String(error));
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
      alert(`扫描完成：添加了 ${result.added} 部，更新了 ${result.updated} 部`);
    } catch (error) {
      console.error('扫描失败:', error);
      alert('扫描失败: ' + String(error));
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

  // ==================== 演员字段管理 ====================
  const [actorFields, setActorFields] = useState<ActorField[]>([]);
  const [showFieldModal, setShowFieldModal] = useState(false);
  const [editingField, setEditingField] = useState<ActorField | null>(null);
  const [fieldForm, setFieldForm] = useState({ field_key: '', field_label: '', field_type: 'text', enabled: true, options: [] as string[] });
  const [fieldContextMenu, setFieldContextMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const [newOptionValue, setNewOptionValue] = useState('');

  useEffect(() => {
    if (!fieldContextMenu) return;
    const close = () => setFieldContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [fieldContextMenu]);

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

  const openAddField = () => {
    setEditingField(null);
    setFieldForm({ field_key: '', field_label: '', field_type: 'text', enabled: true, options: [] });
    setShowFieldModal(true);
  };

  const handleSaveField = async () => {
    try {
      const optionsStr = fieldForm.field_type === 'select' ? JSON.stringify(fieldForm.options) : null;
      if (editingField) {
        await updateActorField(fieldForm.field_key, fieldForm.field_label, fieldForm.field_type, optionsStr, fieldForm.enabled);
      } else {
        await createActorField(fieldForm.field_key, fieldForm.field_label, fieldForm.field_type, optionsStr);
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500 flex items-center gap-2"><img src={loadingIcon} alt="加载中" className="w-6 h-6" /> 加载中...</div>
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
                const labels: Record<string, string> = { tags: '标签', actors: '演员', tracking: '追番', chinese_sub: '中字', episode: '单位' };
                return labels[k] || k;
              });
              return (
                <div key={cat.key} className="card p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900">{cat.name}</h3>
                      <p className="text-sm text-gray-500 mt-1">Key: {cat.key} · 卡片方向: {layoutLabel}</p>
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
                        onClick={() => openEditCategory(cat)}
                        className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => handleRescanCategory(cat.key)}
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
          <button
            onClick={openAddField}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            新增字段
          </button>
        </div>

        {actorFields.length > 0 ? (
          <div className="grid grid-cols-3 gap-4">
            {actorFields.map((field) => (
              <div key={field.field_key} className="card p-4 cursor-pointer" onContextMenu={(e) => { e.preventDefault(); setFieldContextMenu({ key: field.field_key, x: e.clientX, y: e.clientY }); }}>
                <h3 className="font-semibold text-gray-900 text-sm">{field.field_label}</h3>
                <p className="text-xs text-gray-500 mt-1">{field.field_type === 'text' ? '文本' : field.field_type === 'number' ? '数字' : field.field_type === 'date' ? '日期' : '选择'}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-4">暂无演员字段配置</p>
            <p className="text-gray-400 text-sm">点击"新增字段"添加</p>
          </div>
        )}
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
                <label className="block text-sm font-medium text-gray-700 mb-2">网站名称 *</label>
                <input
                  type="text"
                  value={newSite.name}
                  onChange={(e) => setNewSite({ ...newSite, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                  placeholder="如：动漫之家"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">网站地址 *</label>
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
                <label className="block text-sm font-medium text-gray-700 mb-2">大类名称 *</label>
                <input
                  type="text"
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                  placeholder="如：动漫"
                />
              </div>
              {editingCategory && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">唯一标识 Key</label>
                  <input
                    type="text"
                    value={categoryForm.key}
                    readOnly
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-gray-100 text-gray-500"
                  />
                </div>
              )}
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
                    { key: 'tags' as const, label: '标签' },
                    { key: 'actors' as const, label: '演员' },
                    { key: 'tracking' as const, label: '追番' },
                    { key: 'chinese_sub' as const, label: '中文字幕' },
                  ]).map(({ key, label }) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">{label}</span>
                      <button
                        type="button"
                        onClick={() => setCategoryForm({
                          ...categoryForm,
                          features: { ...categoryForm.features, [key]: !categoryForm.features[key] }
                        })}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${categoryForm.features[key] ? 'bg-blue-500' : 'bg-gray-200'}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${categoryForm.features[key] ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">单位</span>
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
              {!editingField && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">字段标识 *</label>
                  <input
                    type="text"
                    value={fieldForm.field_key}
                    onChange={(e) => setFieldForm({ ...fieldForm, field_key: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                    placeholder="如：height"
                  />
                </div>
              )}
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
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">字段名称 *</label>
                <input
                  type="text"
                  value={fieldForm.field_label}
                  onChange={(e) => setFieldForm({ ...fieldForm, field_label: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                  placeholder="如：身高"
                />
              </div>
              {editingField && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">启用</span>
                  <button
                    type="button"
                    onClick={() => setFieldForm({ ...fieldForm, enabled: !fieldForm.enabled })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${fieldForm.enabled ? 'bg-blue-500' : 'bg-gray-200'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${fieldForm.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
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
                disabled={!fieldForm.field_label.trim() || (!editingField && !fieldForm.field_key.trim())}
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
          <button onClick={() => { if (confirm('确定删除该字段？')) { handleDeleteField(fieldContextMenu.key); } setFieldContextMenu(null); }} className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50">删除</button>
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
    </div>
  );
};

export default Settings;
