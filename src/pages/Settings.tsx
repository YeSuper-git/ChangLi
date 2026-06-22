import React, { useState, useEffect } from 'react';
import { getSites, addSite, deleteSite, getTags, addTag, deleteTag, getStorageInfo, openDataDir, deleteAllAnime, deleteAllAdult, rescanAnimeMetadata, rescanAdultMetadata, getAllCategories, createCategory, updateCategory, deleteCategory, parseCategoryFeatures, getAllActorFields, updateActorField, createActorField, deleteActorField } from '../utils/api';
import type { Site, Tag, StorageInfo, Category, CategoryFeatures, ActorField } from '../utils/api';
// confirm dialog removed — using custom React modal instead
import { useSecondConfirm } from '../utils/useSecondConfirm';
import { useLibraryStore } from '../store/libraryStore';
import loadingIcon from '../assets/icons/loading.svg';

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

  const [deletingAnime, setDeletingAnime] = useState(false);
  const [deletingAdult, setDeletingAdult] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'anime' | 'adult' } | null>(null);
  const [deleteAnimeResult, setDeleteAnimeResult] = useState<{ videoCount: number; seriesCount: number } | null>(null);
  const [deleteAdultResult, setDeleteAdultResult] = useState<{ videoCount: number; seriesCount: number } | null>(null);
  const refreshSeries = useLibraryStore((s) => s.refreshSeries);

  const handleDeleteAllAnime = () => {
    setDeleteConfirm({ type: 'anime' });
  };

  const doDeleteAllAnime = async () => {
    console.log('[DEBUG] handleDeleteAllAnime: 用户确认删除动漫数据');
    setDeletingAnime(true);
    setDeleteAnimeResult(null);
    try {
      const result = await deleteAllAnime();
      setDeleteAnimeResult(result);
      await refreshSeries();
    } catch (error) {
      console.error('删除所有动漫失败:', error);
      alert('删除失败: ' + String(error));
    } finally {
      setDeletingAnime(false);
    }
  };

  const handleDeleteAllAdult = () => {
    setDeleteConfirm({ type: 'adult' });
  };

  const doDeleteAllAdult = async () => {
    console.log('[DEBUG] handleDeleteAllAdult: 用户确认删除影视数据');
    setDeletingAdult(true);
    setDeleteAdultResult(null);
    try {
      const result = await deleteAllAdult();
      setDeleteAdultResult(result);
      await refreshSeries();
    } catch (error) {
      console.error('删除所有影视失败:', error);
      alert('删除失败: ' + String(error));
    } finally {
      setDeletingAdult(false);
    }
  };

  const [rescanningAnime, setRescanningAnime] = useState(false);
  const [rescanningAdult, setRescanningAdult] = useState(false);
  const [rescanAnimeResult, setRescanAnimeResult] = useState<[number, number] | null>(null);
  const [rescanAdultResult, setRescanAdultResult] = useState<[number, number] | null>(null);

  const handleRescanAnimeMetadata = async () => {
    setRescanningAnime(true);
    setRescanAnimeResult(null);
    try {
      const result = await rescanAnimeMetadata();
      setRescanAnimeResult(result);
    } catch (error) {
      console.error('重新扫描动漫元数据失败:', error);
      alert('扫描失败: ' + String(error));
    } finally {
      setRescanningAnime(false);
    }
  };

  const handleRescanAdultMetadata = async () => {
    setRescanningAdult(true);
    setRescanAdultResult(null);
    try {
      const result = await rescanAdultMetadata();
      setRescanAdultResult(result);
    } catch (error) {
      console.error('重新扫描影视元数据失败:', error);
      alert('扫描失败: ' + String(error));
    } finally {
      setRescanningAdult(false);
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
    features: { tags: true, actors: true, tracking: true, chinese_sub: true, episode: true } as CategoryFeatures,
  });
  const [categoryDeleteConfirm, setCategoryDeleteConfirm] = useState<string | null>(null);

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
    setCategoryForm({ key: '', name: '', card_layout: 'auto', features: { tags: true, actors: true, tracking: true, chinese_sub: true, episode: true } });
    setShowCategoryModal(true);
  };

  const openEditCategory = (cat: Category) => {
    setEditingCategory(cat);
    setCategoryForm({ key: cat.key, name: cat.name, card_layout: cat.card_layout, features: parseCategoryFeatures(cat.features) });
    setShowCategoryModal(true);
  };

  const handleSaveCategory = async () => {
    if (!categoryForm.key.trim() || !categoryForm.name.trim()) return;
    try {
      const featuresStr = JSON.stringify(categoryForm.features);
      if (editingCategory) {
        await updateCategory(categoryForm.key, categoryForm.name, categoryForm.card_layout, featuresStr);
      } else {
        await createCategory(categoryForm.key, categoryForm.name, categoryForm.card_layout, featuresStr);
      }
      setShowCategoryModal(false);
      loadCategories();
    } catch (error) {
      console.error('保存大类失败:', error);
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
  const [fieldForm, setFieldForm] = useState({ field_key: '', field_label: '', field_type: 'text', enabled: true });
  const [fieldDeleteConfirm, setFieldDeleteConfirm] = useState<string | null>(null);

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
    setFieldForm({ field_key: field.field_key, field_label: field.field_label, field_type: field.field_type, enabled: field.enabled });
    setShowFieldModal(true);
  };

  const openAddField = () => {
    setEditingField(null);
    setFieldForm({ field_key: '', field_label: '', field_type: 'text', enabled: true });
    setShowFieldModal(true);
  };

  const handleSaveField = async () => {
    try {
      if (editingField) {
        await updateActorField(fieldForm.field_key, fieldForm.field_label, fieldForm.enabled);
      } else {
        await createActorField(fieldForm.field_key, fieldForm.field_label, fieldForm.field_type);
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
      <div className="flex items-center justify-center h-64">
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

      {/* 视频管理 */}
      <section className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">视频管理</h2>
            <p className="text-sm text-gray-500 mt-1">分别删除动漫或影视数据（不删除本地源文件）</p>
          </div>
        </div>
        <div className="card p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">删除所有动漫视频集及其视频，保留演员和标签数据。</p>
              {deleteAnimeResult && (
                <p className="text-sm text-green-600 mt-2">
                  ✓ 已删除 {deleteAnimeResult.videoCount} 个视频，{deleteAnimeResult.seriesCount} 个视频集
                </p>
              )}
            </div>
            <button
              onClick={handleDeleteAllAnime}
              disabled={deletingAnime}
              className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50"
            >
              {deletingAnime ? '删除中...' : '删除所有动漫'}
            </button>
          </div>
        </div>
        <div className="card p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">删除所有影视视频集及其视频，保留演员和标签数据。</p>
              {deleteAdultResult && (
                <p className="text-sm text-green-600 mt-2">
                  ✓ 已删除 {deleteAdultResult.videoCount} 个视频，{deleteAdultResult.seriesCount} 个视频集
                </p>
              )}
            </div>
            <button
              onClick={handleDeleteAllAdult}
              disabled={deletingAdult}
              className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50"
            >
              {deletingAdult ? '删除中...' : '删除所有影视'}
            </button>
          </div>
        </div>

        <div className="card p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">重新解析所有动漫视频集的文件名，补充缺失的番号（code）和中文字幕标记。</p>
              {rescanAnimeResult && (
                <p className="text-sm text-green-600 mt-2">
                  ✓ 已更新 {rescanAnimeResult[0]} 部，跳过 {rescanAnimeResult[1]} 部
                </p>
              )}
            </div>
            <button
              onClick={handleRescanAnimeMetadata}
              disabled={rescanningAnime}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
            >
              {rescanningAnime ? '扫描中...' : '重新扫描动漫元数据'}
            </button>
          </div>
        </div>
        <div className="card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">重新解析所有影视视频集的文件名，无条件覆盖已有数据。</p>
              {rescanAdultResult && (
                <p className="text-sm text-green-600 mt-2">
                  ✓ 已更新 {rescanAdultResult[0]} 部，跳过 {rescanAdultResult[1]} 部
                </p>
              )}
            </div>
            <button
              onClick={handleRescanAdultMetadata}
              disabled={rescanningAdult}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
            >
              {rescanningAdult ? '扫描中...' : '重新扫描影视元数据'}
            </button>
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
                const labels: Record<string, string> = { tags: '标签', actors: '演员', tracking: '追踪', chinese_sub: '中字', episode: '集数' };
                return labels[k] || k;
              });
              return (
                <div key={cat.key} className="card p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900">{cat.name}</h3>
                      <p className="text-sm text-gray-500 mt-1">Key: {cat.key} · 卡片方向: {layoutLabel}</p>
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
            <h2 className="text-xl font-semibold">演员字段管理</h2>
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
          <div className="space-y-4">
            {actorFields.map((field) => (
              <div key={field.field_key} className="card p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">{field.field_label}</h3>
                    <p className="text-sm text-gray-500 mt-1">Key: {field.field_key} · 类型: {field.field_type}</p>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs mt-2 ${field.enabled ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {field.enabled ? '已启用' : '已禁用'}
                    </span>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => openEditField(field)}
                      className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800"
                    >
                      编辑
                    </button>
                    {field.field_key !== 'name' && (
                      <button
                        onClick={() => setFieldDeleteConfirm(field.field_key)}
                        className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                      >
                        删除
                      </button>
                    )}
                  </div>
                </div>
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

      {/* 删除二次确认弹窗 */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl">
            <p className="text-gray-900 text-base mb-6">
              该操作会删除所有{deleteConfirm.type === 'anime' ? '动漫' : '影视'}，请谨慎操作
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  if (deleteConfirm.type === 'anime') doDeleteAllAnime();
                  else doDeleteAllAdult();
                  setDeleteConfirm(null);
                }}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm font-medium"
              >
                狠心删除
              </button>
              <button
                onClick={() => setDeleteConfirm(null)}
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
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">唯一标识 Key *</label>
                <input
                  type="text"
                  value={categoryForm.key}
                  onChange={(e) => setCategoryForm({ ...categoryForm, key: e.target.value })}
                  readOnly={!!editingCategory}
                  className={`w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500 ${editingCategory ? 'bg-gray-100 text-gray-500' : ''}`}
                  placeholder="如：anime"
                />
              </div>
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
                <label className="block text-sm font-medium text-gray-700 mb-3">功能开关</label>
                <div className="space-y-3">
                  {([
                    { key: 'tags' as const, label: '标签' },
                    { key: 'actors' as const, label: '演员' },
                    { key: 'tracking' as const, label: '追踪' },
                    { key: 'chinese_sub' as const, label: '中文字幕' },
                    { key: 'episode' as const, label: '集数' },
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
                <>
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
                </>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">显示名称 *</label>
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

      {/* 演员字段删除确认弹窗 */}
      {fieldDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl">
            <p className="text-gray-900 text-base mb-6">
              确定要删除字段「{actorFields.find(f => f.field_key === fieldDeleteConfirm)?.field_label || fieldDeleteConfirm}」吗？
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { handleDeleteField(fieldDeleteConfirm); setFieldDeleteConfirm(null); }}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm font-medium"
              >
                确认删除
              </button>
              <button
                onClick={() => setFieldDeleteConfirm(null)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
