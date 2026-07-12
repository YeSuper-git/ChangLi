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
  const [selectedTag, setSelectedTag] = useState<TagWithCategories | null>(null);

  // Edit form state
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

  // Update edit form when selected tag changes
  useEffect(() => {
    if (selectedTag) {
      setEditName(selectedTag.name);
      setEditScope(selectedTag.scope);
      setEditCategoryKeys(selectedTag.category_keys || []);
    }
  }, [selectedTag]);

  // Refresh and re-select
  const refreshData = async () => {
    try {
      const [tagsData, catsData] = await Promise.all([
        getTagsWithCategories(),
        getAllCategories(),
      ]);
      setTags(tagsData);
      setCategories(catsData);
      // Re-select updated tag
      if (selectedTag) {
        const updated = tagsData.find(t => t.id === selectedTag.id);
        setSelectedTag(updated || null);
      }
    } catch (err) {
      console.error('刷新数据失败:', err);
    }
  };

  // ---- Create ----
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
      notify({ message: `标签"${name}"创建成功`, type: 'success' });
    } catch (err) {
      console.error('创建标签失败:', err);
      notify({ message: '创建标签失败', type: 'error' });
    }
  };

  const resetCreateForm = () => {
    setCreateName('');
    setCreateScope('global');
    setCreateCategoryKeys([]);
  };

  // ---- Edit / Save ----
  const handleSaveEdit = async () => {
    if (!selectedTag) return;
    const name = editName.trim();
    if (!name) return;
    if (tags.some(t => t.id !== selectedTag.id && t.name.trim().toLowerCase() === name.toLowerCase())) {
      notify({ message: `标签"${name}"已存在`, type: 'info' });
      return;
    }
    try {
      await updateTag(selectedTag.id, name, editScope);
      await updateTagCategories(selectedTag.id, editCategoryKeys);
      await refreshData();
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
      if (selectedTag?.id === tagId) setSelectedTag(null);
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
    <div className="changli-page h-full">
      {/* Left Sidebar */}
      <div className="w-72 flex-shrink-0 flex flex-col border-r border-gray-200 bg-white/60 h-[calc(100vh-80px)]">
        {/* Header */}
        <div className="p-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900 mb-3">标签管理</h2>
          {/* Search */}
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="搜索标签..."
            className="changli-input w-full text-sm"
          />
          {/* Scope Filter */}
          <div className="flex gap-1 mt-3">
            {([
              { key: 'all' as ScopeFilter, label: '全部' },
              { key: 'global' as ScopeFilter, label: '通用' },
              { key: 'category' as ScopeFilter, label: '特殊' },
            ]).map(f => (
              <button
                key={f.key}
                onClick={() => setScopeFilter(f.key)}
                className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${
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

        {/* Tag List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <img src={loadingIcon} alt="加载中" className="w-8 h-8 animate-spin" />
            </div>
          ) : filteredTags.length > 0 ? (
            filteredTags.map(tag => (
              <div
                key={tag.id}
                onClick={() => setSelectedTag(tag)}
                className={`group px-3 py-2.5 rounded-lg cursor-pointer transition-all ${
                  selectedTag?.id === tag.id
                    ? 'bg-gradient-to-r from-rose-50 to-pink-50 border border-rose-200 shadow-sm'
                    : 'hover:bg-gray-50 border border-transparent'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium ${
                    selectedTag?.id === tag.id ? 'text-rose-700' : 'text-gray-700'
                  }`}>
                    {tag.name}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    tag.scope === 'global'
                      ? 'bg-blue-50 text-blue-600'
                      : 'bg-amber-50 text-amber-600'
                  }`}>
                    {scopeLabel(tag.scope)}
                  </span>
                </div>
                {tag.scope === 'category' && tag.category_keys.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {tag.category_keys.slice(0, 3).map(key => {
                      const cat = categories.find(c => c.key === key);
                      return (
                        <span key={key} className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                          {cat?.name || key}
                        </span>
                      );
                    })}
                    {tag.category_keys.length > 3 && (
                      <span className="text-[10px] text-gray-400">+{tag.category_keys.length - 3}</span>
                    )}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="text-center py-12 text-gray-400 text-sm">
              {searchTerm || scopeFilter !== 'all' ? '没有匹配的标签' : '暂无标签'}
            </div>
          )}
        </div>

        {/* Create Button */}
        <div className="p-3 border-t border-gray-100">
          <button
            onClick={() => {
              resetCreateForm();
              setShowCreateModal(true);
            }}
            className="w-full action-btn action-btn-primary text-sm py-2.5"
          >
            + 创建标签
          </button>
        </div>
      </div>

      {/* Right Panel */}
      <div className="flex-1 flex flex-col h-[calc(100vh-80px)] overflow-hidden">
        {selectedTag ? (
          <div className="flex-1 overflow-y-auto p-8">
            <div className="max-w-xl mx-auto">
              <div className="changli-panel p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-bold text-gray-900">编辑标签</h3>
                  <button
                    onClick={() => requestSecondConfirm(
                      `delete-tag-${selectedTag.id}`,
                      () => handleDelete(selectedTag.id)
                    )}
                    className={`text-sm px-3 py-1.5 rounded-lg transition-all ${
                      pendingKey === `delete-tag-${selectedTag.id}`
                        ? 'bg-red-500 text-white'
                        : 'text-red-400 hover:text-red-600 hover:bg-red-50'
                    }`}
                  >
                    {pendingKey === `delete-tag-${selectedTag.id}` ? '确认删除?' : '删除标签'}
                  </button>
                </div>

                {/* Name */}
                <div className="mb-5">
                  <label className="changli-form-label">标签名称</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="changli-input w-full"
                    placeholder="输入标签名称"
                  />
                </div>

                {/* Scope */}
                <div className="mb-5">
                  <label className="changli-form-label">标签范围</label>
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setEditScope('global'); setEditCategoryKeys([]); }}
                      className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all ${
                        editScope === 'global'
                          ? 'border-blue-300 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      通用标签
                    </button>
                    <button
                      onClick={() => setEditScope('category')}
                      className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all ${
                        editScope === 'category'
                          ? 'border-amber-300 bg-amber-50 text-amber-700'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      特殊标签
                    </button>
                  </div>
                </div>

                {/* Category Checkboxes (only for special) */}
                {editScope === 'category' && (
                  <div className="mb-5">
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

                {/* Save */}
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => setSelectedTag(null)}
                    className="action-btn flex-1 py-2.5 text-sm"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    disabled={!editName.trim()}
                    className="action-btn action-btn-primary flex-1 py-2.5 text-sm disabled:opacity-50"
                  >
                    保存
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Empty State */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="text-6xl mb-4">🏷️</div>
              <p className="text-gray-400 text-lg mb-1">选择一个标签进行编辑</p>
              <p className="text-gray-300 text-sm">或点击左侧「创建标签」按钮新建</p>
            </div>
          </div>
        )}
      </div>

      {/* Create Modal */}
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
                        ? 'border-blue-300 bg-blue-50 text-blue-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    通用标签
                  </button>
                  <button
                    onClick={() => setCreateScope('category')}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all ${
                      createScope === 'category'
                        ? 'border-amber-300 bg-amber-50 text-amber-700'
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
