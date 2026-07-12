import React, { useState, useEffect, useMemo } from 'react';
import { getTagsWithCategories, addTag, deleteTag, updateTag, updateTagCategories, getAllCategories } from '../utils/api';
import { TagWithCategories, Category } from '../utils/api';
import { useSecondConfirm } from '../utils/useSecondConfirm';
import { useLibraryStore } from '../store/libraryStore';
import { notify } from '../utils/notify';
import loadingIcon from '../assets/icons/loading.svg';

type ScopeFilter = 'all' | 'global' | 'category';

const Tags: React.FC = () => {
  const { refreshTags } = useLibraryStore();
  const [loading, setLoading] = useState(true);
  const [tags, setTags] = useState<TagWithCategories[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');

  // Edit modal state
  const [editingTag, setEditingTag] = useState<TagWithCategories | null>(null);
  const [editName, setEditName] = useState('');
  const [editScope, setEditScope] = useState<'global' | 'category'>('global');
  const [editCategoryKeys, setEditCategoryKeys] = useState<string[]>([]);

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createScope, setCreateScope] = useState<'global' | 'category'>('global');
  const [createCategoryKeys, setCreateCategoryKeys] = useState<string[]>([]);

  const { pendingKey, requestSecondConfirm } = useSecondConfirm();

  // Load data
  const loadData = async () => {
    setLoading(true);
    try {
      const [tagsData, catsData] = await Promise.all([
        getTagsWithCategories(),
        getAllCategories(),
      ]);
      setTags(tagsData);
      setCategories(catsData);
    } catch (err) {
      console.error('加载标签数据失败:', err);
      notify({ message: '加载标签数据失败', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Filtered tags
  const filteredTags = useMemo(() => {
    return tags.filter(tag => {
      const matchSearch = tag.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchScope = scopeFilter === 'all' || tag.scope === scopeFilter;
      return matchSearch && matchScope;
    });
  }, [tags, searchTerm, scopeFilter]);

  // Refresh data
  const refreshData = async () => {
    try {
      const [tagsData, catsData] = await Promise.all([
        getTagsWithCategories(),
        getAllCategories(),
      ]);
      setTags(tagsData);
      setCategories(catsData);
    } catch (err) {
      console.error('刷新数据失败:', err);
    }
  };

  // ---- Create ----
  const resetCreateForm = () => {
    setCreateName('');
    setCreateScope('global');
    setCreateCategoryKeys([]);
  };

  const handleCreate = async () => {
    const name = createName.trim();
    if (!name) return;
    if (tags.some(t => t.name.trim().toLowerCase() === name.toLowerCase())) {
      notify({ message: `标签"${name}"已存在`, type: 'info' });
      return;
    }
    try {
      const newTag = await addTag(name);
      if (createScope === 'category' && createCategoryKeys.length > 0) {
        await updateTag(newTag.id, name, 'category');
        await updateTagCategories(newTag.id, createCategoryKeys);
      }
      setShowCreateModal(false);
      resetCreateForm();
      await refreshData();
      await refreshTags();
      notify({ message: `标签"${name}"创建成功`, type: 'success' });
    } catch (err) {
      console.error('创建标签失败:', err);
      notify({ message: '创建标签失败', type: 'error' });
    }
  };

  // ---- Edit ----
  const openEditModal = (tag: TagWithCategories) => {
    setEditingTag(tag);
    setEditName(tag.name);
    setEditScope(tag.scope);
    setEditCategoryKeys(tag.category_keys || []);
  };

  const handleSaveEdit = async () => {
    if (!editingTag) return;
    const name = editName.trim();
    if (!name) return;
    if (tags.some(t => t.id !== editingTag.id && t.name.trim().toLowerCase() === name.toLowerCase())) {
      notify({ message: `标签"${name}"已存在`, type: 'info' });
      return;
    }
    try {
      await updateTag(editingTag.id, name, editScope);
      await updateTagCategories(editingTag.id, editCategoryKeys);
      setEditingTag(null);
      await refreshData();
      await refreshTags();
      notify({ message: '标签已更新', type: 'success' });
    } catch (err) {
      console.error('更新标签失败:', err);
      notify({ message: '更新标签失败', type: 'error' });
    }
  };

  // ---- Delete ----
  const handleDelete = async (tagId: number) => {
    try {
      await deleteTag(tagId);
      if (editingTag?.id === tagId) setEditingTag(null);
      await refreshData();
      await refreshTags();
      notify({ message: '标签已删除', type: 'success' });
    } catch (err) {
      console.error('删除标签失败:', err);
      notify({ message: '删除标签失败', type: 'error' });
    }
  };

  const toggleCategoryKey = (key: string, list: string[], setter: (v: string[]) => void) => {
    if (list.includes(key)) {
      setter(list.filter(k => k !== key));
    } else {
      setter([...list, key]);
    }
  };

  const scopeLabel = (scope: string) => scope === 'global' ? '通用' : '特殊';

  return (
    <div className="changli-page">
      {/* Header: title + create button */}
      <div className="changli-page-header">
        <h1 className="changli-heading-xl">标签管理</h1>
        <button
          onClick={() => {
            resetCreateForm();
            setShowCreateModal(true);
          }}
          className="action-btn action-btn-primary"
        >
          + 创建标签
        </button>
      </div>

      {/* Toolbar: search + scope filter */}
      <div className="changli-toolbar mb-10 p-3">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="搜索标签..."
          className="search-input"
        />
        <div className="flex gap-1 ml-3">
          {([
            { key: 'all' as ScopeFilter, label: '全部' },
            { key: 'global' as ScopeFilter, label: '通用' },
            { key: 'category' as ScopeFilter, label: '特殊' },
          ]).map(f => (
            <button
              key={f.key}
              onClick={() => setScopeFilter(f.key)}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                scopeFilter === f.key
                  ? 'bg-gradient-to-r from-rose-500 to-pink-500 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tag grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <img src={loadingIcon} alt="加载中" className="w-10 h-10 animate-spin" />
        </div>
      ) : filteredTags.length > 0 ? (
        <div className="changli-auto-grid-actor">
          {filteredTags.map(tag => (
            <div
              key={tag.id}
              className="changli-panel p-4 cursor-pointer hover:shadow-md transition-shadow relative group"
              onClick={() => openEditModal(tag)}
            >
              {/* Delete button (top-right) */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  requestSecondConfirm(
                    `delete-tag-${tag.id}`,
                    () => handleDelete(tag.id)
                  );
                }}
                className={`absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-full text-xs opacity-0 group-hover:opacity-100 transition-all z-10 ${
                  pendingKey === `delete-tag-${tag.id}`
                    ? 'bg-red-500 text-white opacity-100'
                    : 'bg-gray-100 text-gray-400 hover:bg-red-50 hover:text-red-500'
                }`}
                title={pendingKey === `delete-tag-${tag.id}` ? '确认删除?' : '删除标签'}
              >
                {pendingKey === `delete-tag-${tag.id}` ? '✓' : '×'}
              </button>

              {/* Tag name */}
              <h3 className="text-base font-semibold text-gray-900 mb-2 pr-8">
                {tag.name}
              </h3>

              {/* Scope badge */}
              <div className="mb-3">
                <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full font-medium ${
                  tag.scope === 'global'
                    ? 'bg-green-50 text-green-600'
                    : 'bg-blue-50 text-blue-600'
                }`}>
                  {scopeLabel(tag.scope)}
                </span>
              </div>

              {/* Associated categories */}
              {tag.scope === 'category' && tag.category_keys.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tag.category_keys.slice(0, 5).map(key => {
                    const cat = categories.find(c => c.key === key);
                    return (
                      <span key={key} className="changli-brand-badge text-[10px] px-2 py-0.5">
                        {cat?.name || key}
                      </span>
                    );
                  })}
                  {tag.category_keys.length > 5 && (
                    <span className="text-[10px] text-gray-400 self-center">
                      +{tag.category_keys.length - 5}
                    </span>
                  )}
                </div>
              )}

              {/* Empty categories hint */}
              {tag.scope === 'category' && tag.category_keys.length === 0 && (
                <p className="text-[11px] text-gray-400 italic">未关联分类</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="changli-empty-state">
          <p className="text-gray-500 text-lg mb-2">
            {searchTerm || scopeFilter !== 'all' ? '没有匹配的标签' : '暂无标签'}
          </p>
          {!searchTerm && scopeFilter === 'all' && (
            <button
              onClick={() => {
                resetCreateForm();
                setShowCreateModal(true);
              }}
              className="action-btn action-btn-primary"
            >
              创建第一个标签
            </button>
          )}
        </div>
      )}

      {/* ---- Edit Modal ---- */}
      {editingTag && (
        <div className="changli-modal-backdrop" onClick={() => setEditingTag(null)}>
          <div className="changli-modal-panel !w-[min(100%,420px)] !p-0" onClick={e => e.stopPropagation()}>
            <div className="changli-modal-header">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-500">编辑</p>
              <h2 className="mt-1 text-xl font-bold text-gray-900">编辑标签</h2>
            </div>
            <div className="changli-modal-body space-y-5">
              {/* Name */}
              <div>
                <label className="changli-form-label">标签名称</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="changli-input w-full"
                  placeholder="输入标签名称"
                  autoFocus
                />
              </div>

              {/* Scope */}
              <div>
                <label className="changli-form-label">标签范围</label>
                <div className="flex gap-3">
                  <button
                    onClick={() => { setEditScope('global'); setEditCategoryKeys([]); }}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all ${
                      editScope === 'global'
                        ? 'border-green-300 bg-green-50 text-green-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    通用标签
                  </button>
                  <button
                    onClick={() => setEditScope('category')}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all ${
                      editScope === 'category'
                        ? 'border-blue-300 bg-blue-50 text-blue-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    特殊标签
                  </button>
                </div>
              </div>

              {/* Category Checkboxes (only for special) */}
              {editScope === 'category' && (
                <div>
                  <label className="changli-form-label">关联分类</label>
                  <div className="border border-gray-200 rounded-lg p-3 space-y-2 max-h-60 overflow-y-auto">
                    {categories.length > 0 ? categories.map(cat => (
                      <label
                        key={cat.key}
                        className="flex items-center gap-2.5 py-1.5 px-2 rounded-md hover:bg-gray-50 cursor-pointer transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={editCategoryKeys.includes(cat.key)}
                          onChange={() => toggleCategoryKey(cat.key, editCategoryKeys, setEditCategoryKeys)}
                          className="w-4 h-4 rounded border-gray-300 text-rose-500 focus:ring-rose-400"
                        />
                        <span className="text-sm text-gray-700">{cat.name}</span>
                        <span className="text-[10px] text-gray-400 ml-auto">{cat.key}</span>
                      </label>
                    )) : (
                      <p className="text-sm text-gray-400 text-center py-4">暂无分类</p>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="changli-modal-footer">
              <button
                onClick={() => setEditingTag(null)}
                className="action-btn text-sm px-4 py-2"
              >
                取消
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={!editName.trim()}
                className="action-btn action-btn-primary text-sm px-4 py-2 disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Create Modal ---- */}
      {showCreateModal && (
        <div className="changli-modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="changli-modal-panel !w-[min(100%,420px)] !p-0" onClick={e => e.stopPropagation()}>
            <div className="changli-modal-header">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-500">创建</p>
              <h2 className="mt-1 text-xl font-bold text-gray-900">新建标签</h2>
            </div>
            <div className="changli-modal-body space-y-5">
              {/* Name */}
              <div>
                <label className="changli-form-label">标签名称</label>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  className="changli-input w-full"
                  placeholder="输入标签名称"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter' && createName.trim()) handleCreate(); }}
                />
              </div>

              {/* Scope */}
              <div>
                <label className="changli-form-label">标签范围</label>
                <div className="flex gap-3">
                  <button
                    onClick={() => { setCreateScope('global'); setCreateCategoryKeys([]); }}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all ${
                      createScope === 'global'
                        ? 'border-green-300 bg-green-50 text-green-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    通用标签
                  </button>
                  <button
                    onClick={() => setCreateScope('category')}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all ${
                      createScope === 'category'
                        ? 'border-blue-300 bg-blue-50 text-blue-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    特殊标签
                  </button>
                </div>
              </div>

              {/* Category Checkboxes */}
              {createScope === 'category' && (
                <div>
                  <label className="changli-form-label">关联分类</label>
                  <div className="border border-gray-200 rounded-lg p-3 space-y-2 max-h-48 overflow-y-auto">
                    {categories.length > 0 ? categories.map(cat => (
                      <label
                        key={cat.key}
                        className="flex items-center gap-2.5 py-1.5 px-2 rounded-md hover:bg-gray-50 cursor-pointer transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={createCategoryKeys.includes(cat.key)}
                          onChange={() => toggleCategoryKey(cat.key, createCategoryKeys, setCreateCategoryKeys)}
                          className="w-4 h-4 rounded border-gray-300 text-rose-500 focus:ring-rose-400"
                        />
                        <span className="text-sm text-gray-700">{cat.name}</span>
                        <span className="text-[10px] text-gray-400 ml-auto">{cat.key}</span>
                      </label>
                    )) : (
                      <p className="text-sm text-gray-400 text-center py-4">暂无分类</p>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="changli-modal-footer">
              <button
                onClick={() => setShowCreateModal(false)}
                className="action-btn text-sm px-4 py-2"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={!createName.trim()}
                className="action-btn action-btn-primary text-sm px-4 py-2 disabled:opacity-50"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Tags;
