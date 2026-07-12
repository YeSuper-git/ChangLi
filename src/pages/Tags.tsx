import React, { useState, useEffect, useMemo } from 'react';
import { getTagsWithCategories, addTag, deleteTag, updateTag, updateTagCategories, getAllCategories } from '../utils/api';

import { TagWithCategories, Category } from '../utils/api';
import { useSecondConfirm } from '../utils/useSecondConfirm';
import { useLibraryStore } from '../store/libraryStore';
import { notify } from '../utils/notify';
import FloatingActions from '../components/FloatingActions';
import loadingIcon from '../assets/icons/loading.svg';

const Tags: React.FC = () => {
  const { refreshTags } = useLibraryStore();
  const [loading, setLoading] = useState(true);
  const [tags, setTags] = useState<TagWithCategories[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

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

  useEffect(() => { loadData(); }, []);

  // Split into global and category
  const globalTags = useMemo(() => tags.filter(t => t.scope === 'global'), [tags]);
  const categoryTags = useMemo(() => tags.filter(t => t.scope === 'category'), [tags]);

  const toggleCategoryKey = (key: string, keys: string[], setKeys: (v: string[]) => void) => {
    setKeys(keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key]);
  };

  // Create
  const handleCreate = async () => {
    const name = createName.trim();
    if (!name) return;
    if (tags.some(t => t.name.toLowerCase() === name.toLowerCase())) {
      notify({ message: `标签"${name}"已存在`, type: 'info' });
      return;
    }
    try {
      const newTag = await addTag(name, createScope);
      if (createScope === 'category' && createCategoryKeys.length > 0) {
        try {
          await updateTagCategories(newTag.id, createCategoryKeys);
        } catch (e) {
          console.error('[Tags] updateTagCategories 失败:', e);
          notify({ message: `分类关联失败: ${e}`, type: 'error' });
        }
      }
      setShowCreateModal(false);
      setCreateName('');
      setCreateScope('global');
      setCreateCategoryKeys([]);
      await loadData();
      await refreshTags();
      notify({ message: `标签"${name}"已创建`, type: 'success' });
    } catch (err) {
      console.error('创建标签失败:', err);
      notify({ message: '创建标签失败', type: 'error' });
    }
  };

  // Edit
  const openEditModal = (tag: TagWithCategories) => {
    setEditingTag(tag);
    setEditName(tag.name);
    setEditScope(tag.scope);
    setEditCategoryKeys([...tag.category_keys]);
  };

  const handleSaveEdit = async () => {
    if (!editingTag) return;
    const name = editName.trim();
    if (!name) return;
    if (tags.some(t => t.id !== editingTag.id && t.name.toLowerCase() === name.toLowerCase())) {
      notify({ message: `标签"${name}"已存在`, type: 'info' });
      return;
    }
    try {
      await updateTag(editingTag.id, name, editScope);
      if (editScope === 'category') {
        await updateTagCategories(editingTag.id, editCategoryKeys);
      } else {
        await updateTagCategories(editingTag.id, []);
      }
      setEditingTag(null);
      await loadData();
      await refreshTags();
    } catch (err) {
      console.error('更新标签失败:', err);
      notify({ message: '更新标签失败', type: 'error' });
    }
  };

  // Delete
  const handleDelete = async (id: number) => {
    try {
      await deleteTag(id);
      await loadData();
      await refreshTags();
    } catch (err) {
      console.error('删除标签失败:', err);
      notify({ message: '删除标签失败', type: 'error' });
    }
  };

  // Category name helper
  const catName = (key: string) => categories.find(c => c.key === key)?.name || key;

  // Render tag card
  const renderTagCard = (tag: TagWithCategories) => (
    <div
      key={tag.id}
      className="changli-panel p-5 cursor-pointer hover:shadow-md transition-all duration-200 relative group"
      onClick={() => openEditModal(tag)}
    >
      {/* Delete button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          requestSecondConfirm(`delete-tag-${tag.id}`, () => handleDelete(tag.id));
        }}
        className={`absolute top-2.5 right-2.5 w-7 h-7 flex items-center justify-center rounded-full text-xs opacity-0 group-hover:opacity-100 transition-all duration-200 z-10 ${
          pendingKey === `delete-tag-${tag.id}`
            ? 'bg-red-500 text-white opacity-100'
            : 'bg-gray-100 text-gray-400 hover:bg-red-50 hover:text-red-500'
        }`}
        title={pendingKey === `delete-tag-${tag.id}` ? '确认删除?' : '删除标签'}
      >
        {pendingKey === `delete-tag-${tag.id}` ? '✓' : '×'}
      </button>

      {/* Tag name */}
      <h3 className="text-base font-semibold text-gray-900 mb-2 pr-6">{tag.name}</h3>

      {/* Associated categories */}
      {tag.scope === 'category' && tag.category_keys.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5 mt-2">
          {tag.category_keys.slice(0, 4).map(key => (
            <span key={key} className="changli-brand-badge text-[10px] px-2 py-0.5">
              {catName(key)}
            </span>
          ))}
          {tag.category_keys.length > 4 && (
            <span className="text-[10px] text-gray-400 self-center">+{tag.category_keys.length - 4}</span>
          )}
        </div>
      )}
      {tag.scope === 'category' && tag.category_keys.length === 0 && (
        <p className="text-[11px] text-gray-400 italic mt-1">未关联分类</p>
      )}
    </div>
  );

  // Scope switch in modal
  const renderScopeSwitch = (scope: 'global' | 'category', setScope: (v: 'global' | 'category') => void, setKeys: (v: string[]) => void) => (
    <div>
      <label className="changli-form-label">标签范围</label>
      <div className={`changli-status-switch ${scope === 'category' ? 'is-right' : ''}`} role="group" aria-label="标签范围">
        <button
          type="button"
          onClick={() => { setScope('global'); setKeys([]); }}
          className={scope === 'global' ? 'active' : ''}
        >全局</button>
        <button
          type="button"
          onClick={() => setScope('category')}
          className={scope === 'category' ? 'active' : ''}
        >特殊</button>
      </div>
    </div>
  );

  // Category checkboxes in modal
  const renderCategoryCheckboxes = (scope: string, keys: string[], setKeys: (v: string[]) => void) => scope === 'category' && (
    <div>
      <label className="changli-form-label">关联分类</label>
      <div className="border border-gray-200 rounded-xl p-3 space-y-1 max-h-52 overflow-y-auto bg-gray-50/50">
        {categories.length > 0 ? categories.map(cat => (
          <label
            key={cat.key}
            className="flex items-center gap-2.5 py-2 px-3 rounded-lg hover:bg-white cursor-pointer transition-colors"
          >
            <input
              type="checkbox"
              checked={keys.includes(cat.key)}
              onChange={() => toggleCategoryKey(cat.key, keys, setKeys)}
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
  );

  return (
    <div className="changli-page">
      {/* Header */}
      <div className="changli-page-header">
        <h1 className="changli-heading-xl">标签管理</h1>
        <button
          onClick={() => { setCreateName(''); setCreateScope('global'); setCreateCategoryKeys([]); setShowCreateModal(true); }}
          className="action-btn action-btn-primary"
        >
          + 创建标签
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-gray-500 flex items-center gap-2">加载中 <img src={loadingIcon} alt="" className="w-6 h-6" /></div>
        </div>
      ) : tags.length === 0 ? (
        <div className="changli-empty-state">
          <p className="text-gray-500 text-lg mb-4">暂无标签</p>
          <button
            onClick={() => { setCreateName(''); setCreateScope('global'); setCreateCategoryKeys([]); setShowCreateModal(true); }}
            className="action-btn action-btn-primary"
          >
            创建第一个标签
          </button>
        </div>
      ) : (
        <div className="space-y-10">
          {/* 全局标签 */}
          {globalTags.length > 0 && (
            <section>
              <h2 className="text-sm font-medium text-gray-400 mb-4">全局标签</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {globalTags.map(renderTagCard)}
              </div>
            </section>
          )}

          {/* 特殊标签 */}
          {categoryTags.length > 0 && (
            <section>
              <h2 className="text-sm font-medium text-gray-400 mb-4">特殊标签</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {categoryTags.map(renderTagCard)}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Edit Modal */}
      {editingTag && (
        <div className="changli-modal-backdrop" onClick={() => setEditingTag(null)}>
          <div className="changli-modal-panel !p-0" onClick={e => e.stopPropagation()}>
            <div className="changli-modal-header">
              <h2 className="changli-modal-title">编辑标签</h2>
            </div>
            <div className="changli-modal-body space-y-5">
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
              {renderScopeSwitch(editScope, setEditScope, setEditCategoryKeys)}
              {renderCategoryCheckboxes(editScope, editCategoryKeys, setEditCategoryKeys)}
            </div>
            <div className="changli-modal-footer">
              <button onClick={() => setEditingTag(null)} className="action-btn">取消</button>
              <button
                onClick={handleSaveEdit}
                disabled={!editName.trim()}
                className="action-btn action-btn-primary disabled:opacity-50"
              >保存</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="changli-modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="changli-modal-panel !p-0" onClick={e => e.stopPropagation()}>
            <div className="changli-modal-header">
              <h2 className="changli-modal-title">新建标签</h2>
            </div>
            <div className="changli-modal-body space-y-5">
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
              {renderScopeSwitch(createScope, setCreateScope, setCreateCategoryKeys)}
              {renderCategoryCheckboxes(createScope, createCategoryKeys, setCreateCategoryKeys)}
            </div>
            <div className="changli-modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="action-btn">取消</button>
              <button
                onClick={handleCreate}
                disabled={!createName.trim()}
                className="action-btn action-btn-primary disabled:opacity-50"
              >创建</button>
            </div>
          </div>
        </div>
      )}
      <FloatingActions
        onRefresh={async () => {
          await loadData();
          await refreshTags();
        }}
        refreshLabel="刷新标签"
      />
    </div>
  );
};

export default Tags;
