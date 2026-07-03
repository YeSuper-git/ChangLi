import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { addActor, deleteActor } from '../utils/api';
import type { Actor } from '../utils/api';
import { actorPhotoDataUrl, StaticImagePlaceholder } from '../utils/media';
import { useSecondConfirm } from '../utils/useSecondConfirm';
import FloatingActions from '../components/FloatingActions';
import { useLibraryStore } from '../store/libraryStore';
import { notify } from '../utils/notify';

const Actors: React.FC = () => {
  const navigate = useNavigate();
  const { actors, refreshActors } = useLibraryStore();
  
  const [showAddModal, setShowAddModal] = useState(false);
  const [newActor, setNewActor] = useState({ name: '', bio: '' });
  const [searchTerm, setSearchTerm] = useState('');
  const [contextMenu, setContextMenu] = useState<{ id: number; name: string; x: number; y: number } | null>(null);
  const { pendingKey, requestSecondConfirm, clearPending } = useSecondConfirm();

  useEffect(() => {
    window.scrollTo(0, 0);
    const closeMenu = () => {
      setContextMenu(null);
      clearPending();
    };
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  const handleAddActor = async () => {
    if (!newActor.name.trim()) return;
    
    try {
      const actor = await addActor(
        newActor.name,
        undefined,
        newActor.bio || undefined
      );
      setShowAddModal(false);
      setNewActor({ name: '', bio: '' });
      // 跳转到演员详情页
      navigate(`/actors/${actor.id}`);
    } catch (error) {
      console.error('添加演员失败:', error);
    }
  };


  const handleDeleteActor = async (actorId: number) => {
    try {
      await deleteActor(actorId);
      setContextMenu(null);
      await refreshActors();
    } catch (error) {
      console.error('删除演员失败:', error);
      notify({ message: '删除演员失败: ' + String(error), type: 'error' });
    }
  };

  const openContextMenu = (event: React.MouseEvent, actor: Actor) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ id: actor.id, name: actor.name, x: event.clientX, y: event.clientY });
  };

  const handleEditContextActor = () => {
    if (!contextMenu) return;
    const actorId = contextMenu.id;
    setContextMenu(null);
    clearPending();
    navigate(`/actors/${actorId}?edit=1`, { state: { from: '/actors', backLabel: '返回演员列表' } });
  };

  const filteredActors = actors.filter(actor =>
    actor.name.toLowerCase().includes(searchTerm.toLowerCase())
  );


  return (
    <>
    <div className="changli-page">
      <div className="changli-page-header">
        <h1 className="changli-heading-xl">演员库</h1>
        <button
          onClick={() => setShowAddModal(true)}
          className="action-btn action-btn-primary"
        >
          添加演员
        </button>
      </div>

      {/* 搜索栏 */}
      <div className="changli-toolbar mb-10 p-3">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="搜索演员..."
          className="search-input"
        />
      </div>

      {/* 演员列表 */}
      {filteredActors.length > 0 ? (
        <div className="changli-auto-grid-actor">
          {filteredActors.map((actor) => {
            const photoDataUrl = actorPhotoDataUrl(actor);
            return (
            <Link
              key={actor.id}
              to={`/actors/${actor.id}`}
              state={{ from: '/actors', backLabel: '返回演员列表' }}
              onContextMenu={(event) => openContextMenu(event, actor)}
              className="card block overflow-hidden"
            >
              <div className="aspect-[3/4] bg-gradient-to-br from-pink-100 to-pink-200 relative overflow-hidden">
                {photoDataUrl ? (
                  <img
                    src={photoDataUrl}
                    alt={actor.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <StaticImagePlaceholder kind="actor" />
                )}
                <div className="absolute bottom-3 right-3 inline-flex w-auto bg-black/60 text-white text-xs px-3 py-1 rounded-full backdrop-blur-sm">
                  {actor.work_count || 0} 部作品
                </div>
              </div>
              <div className="px-4 py-3">
                <h3 className="text-base font-semibold text-gray-900 mb-1">{actor.name}</h3>
                <p className="text-sm text-gray-500 line-clamp-1">
                  {actor.bio || '暂无简介'}
                </p>
              </div>
            </Link>
          );
          })}
        </div>
      ) : (
        <div className="changli-empty-state">
          <p className="text-gray-500 text-lg mb-4">
            {searchTerm ? '没有找到匹配的演员' : '暂无演员数据'}
          </p>
          {!searchTerm && (
            <button
              onClick={() => setShowAddModal(true)}
              className="action-btn action-btn-primary"
            >
              添加第一个演员
            </button>
          )}
        </div>
      )}

      {contextMenu && (
        <div
          className="changli-context-menu fixed z-50 py-2 w-fit"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          ref={(node) => {
            if (node) {
              const rect = node.getBoundingClientRect();
              if (rect.right > window.innerWidth) node.style.left = `${contextMenu.x - rect.width}px`;
              if (rect.bottom > window.innerHeight) node.style.top = `${contextMenu.y - rect.height}px`;
            }
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="changli-menu-item"
            onClick={handleEditContextActor}
          >
            编辑
          </button>
          <button
            className="changli-menu-item changli-menu-item-danger"
            onClick={() => requestSecondConfirm(`actor-${contextMenu.id}`, () => handleDeleteActor(contextMenu.id))}
          >
            {pendingKey === `actor-${contextMenu.id}` ? '再次点击确认删除' : '删除'}
          </button>
        </div>
      )}

      {/* 添加演员弹窗 */}
      {showAddModal && (
        <div className="changli-modal-backdrop">
          <div className="changli-modal-panel">
            <h2 className="changli-modal-title">添加演员</h2>
            <div className="space-y-4">
              <div>
                <label className="changli-form-label">姓名</label>
                <input
                  type="text"
                  value={newActor.name}
                  onChange={(e) => setNewActor({ ...newActor, name: e.target.value })}
                  className="changli-input"
                  placeholder="输入演员姓名"
                />
              </div>
              <div>
                <label className="changli-form-label">简介</label>
                <textarea
                  value={newActor.bio}
                  onChange={(e) => setNewActor({ ...newActor, bio: e.target.value })}
                  className="changli-textarea"
                  rows={3}
                  placeholder="输入演员简介"
                />
              </div>
            </div>
            <div className="flex gap-4 mt-8">
              <button
                onClick={() => setShowAddModal(false)}
                className="action-btn flex-1"
              >
                取消
              </button>
              <button
                onClick={handleAddActor}
                className="action-btn action-btn-primary flex-1"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

    <FloatingActions onRefresh={refreshActors} refreshLabel="刷新演员" />
    </>
  );
};

export default Actors;
