import React, { useState } from 'react';
import { addTag, deleteTag } from '../utils/api';
import { useSecondConfirm } from '../utils/useSecondConfirm';
import { useLibraryStore } from '../store/libraryStore';
import { notify } from '../utils/notify';

const Tags: React.FC = () => {
  const { tags, refreshTags } = useLibraryStore();
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const { pendingKey, requestSecondConfirm } = useSecondConfirm();

  const handleAddTag = async () => {
    const name = newTagName.trim();
    if (!name) return;
    // 去重检查
    if (tags.some(t => t.name.trim().toLowerCase() === name.toLowerCase())) {
      notify({ message: `标签"${name}"已存在`, type: 'info' });
      return;
    }
    try {
      await addTag(name);
      setShowAddModal(false);
      setNewTagName('');
      await refreshTags();
    } catch (error) {
      console.error('添加标签失败:', error);
    }
  };

  const handleDeleteTag = async (id: number) => {
    try {
      await deleteTag(id);
      await refreshTags();
    } catch (error) {
      console.error('删除标签失败:', error);
    }
  };


  return (
    <div className="changli-page">
      <div className="changli-page-header">
        <h1 className="changli-heading-xl">标签管理</h1>
        <button
          onClick={() => setShowAddModal(true)}
          className="action-btn action-btn-primary"
        >
          添加标签
        </button>
      </div>

      {/* 标签列表 */}
      {tags.length > 0 ? (
        <div className="changli-panel p-8">
          <div className="flex flex-wrap gap-3">
            {tags.map((tag) => (
              <div
                key={tag.id}
                className="flex items-center gap-2 rounded-full border border-gray-200 bg-white/78 px-4 py-2 shadow-sm"
              >
                <span className="text-gray-700">{tag.name}</span>
                <button
                  onClick={() => requestSecondConfirm(`tag-${tag.id}`, () => handleDeleteTag(tag.id))}
                  className="text-gray-400 hover:text-red-500 transition-colors"
                >
                  {pendingKey === `tag-${tag.id}` ? '确认' : '✕'}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="changli-empty-state">
          <p className="text-gray-500 text-lg mb-4">暂无标签</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="action-btn action-btn-primary"
          >
            添加第一个标签
          </button>
        </div>
      )}

      {/* 添加标签弹窗 */}
      {showAddModal && (
        <div className="changli-modal-backdrop">
          <div className="changli-modal-panel">
            <h2 className="changli-modal-title">添加标签</h2>
            <div>
              <label className="changli-form-label">标签名称</label>
              <input
                type="text"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                className="changli-input"
                placeholder="输入标签名称"
                onKeyPress={(e) => e.key === 'Enter' && handleAddTag()}
              />
            </div>
            <div className="flex gap-4 mt-8">
              <button
                onClick={() => setShowAddModal(false)}
                className="action-btn flex-1"
              >
                取消
              </button>
              <button
                onClick={handleAddTag}
                className="action-btn action-btn-primary flex-1"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Tags;
