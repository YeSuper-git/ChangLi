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
  const [newActor, setNewActor] = useState({ name: '' });
  const [searchTerm, setSearchTerm] = useState('');
  const [contextMenu, setContextMenu] = useState<{ id: number; name: string; x: number; y: number } | null>(null);
  const { pendingKey, requestSecondConfirm, clearPending } = useSecondConfirm();

  useEffect(() => {
    const closeMenu = () => {
      setContextMenu(null);
      clearPending();
    };
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  const handleAddActor = async () => {
    const name = newActor.name.trim();
    if (!name) return;
    // 去重检查
    if (actors.some(a => a.name.trim().toLowerCase() === name.toLowerCase())) {
      notify({ message: `演员"${name}"已存在`, type: 'info' });
      return;
    }
    try {
      const actor = await addActor(name, undefined, undefined);
      setShowAddModal(false);
      setNewActor({ name: '' });
      navigate(`/actors/${actor.id}`);
    } catch (error) {
      console.error('新建演员失败:', error);
    }
  };


  const handleDeleteActor = async (actorId: number) => {
    try {
      await deleteActor(actorId);
      setContextMenu(null);
      await refreshActors();
    } catch (error) {
      console.error('删除演员失败:', error);
      notify({ message: '删除演员失败，请稍后重试', type: 'error' });
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
    <div className="changli-page" data-tutorial="actors-content">
      <div className="changli-page-header">
        <h1 className="changli-heading-xl">演员库</h1>
        <button
          onClick={() => setShowAddModal(true)}
          className="action-btn action-btn-primary"
          data-tutorial="add-actor"
        >
          新建演员
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
          {filteredActors.map((actor, index) => {
            const photoDataUrl = actorPhotoDataUrl(actor);
            return (
            <Link
              key={actor.id}
              to={`/actors/${actor.id}`}
              state={{ from: '/actors', backLabel: '返回演员列表', actorSnapshot: actor }}
              onContextMenu={(event) => openContextMenu(event, actor)}
              className="card block overflow-hidden"
              data-tutorial={index === 0 ? "first-actor" : undefined}
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
          <p className="text-gray-500 text-lg mb-2">
            {searchTerm ? '没有找到匹配的演员' : '暂无演员'}
          </p>
          {!searchTerm && (
            <>
              <p className="text-gray-400 text-sm mb-6">
                演员信息会从视频元数据中自动提取，也可手动添加
              </p>
              <button
                onClick={() => setShowAddModal(true)}
                className="action-btn action-btn-primary"
              >
                添加第一个演员
              </button>
            </>
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

      {/* 新建演员弹窗 */}
      {showAddModal && (
        <div className="changli-modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="changli-modal-panel !w-[min(100%,400px)] !p-0" onClick={e => e.stopPropagation()} data-tutorial="add-actor-modal">
            <div className="changli-modal-header">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-500">创建</p>
              <h2 className="mt-1 text-xl font-bold text-gray-900">新建演员</h2>
              <p className="mt-1.5 text-[13px] text-gray-500">输入演员姓名，稍后可补充详细信息</p>
            </div>
            <div className="changli-modal-body">
              <input
                type="text"
                value={newActor.name}
                onChange={(e) => setNewActor({ ...newActor, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter' && newActor.name.trim()) handleAddActor(); }}
                className="changli-input w-full"
                placeholder="输入演员姓名"
                autoFocus
              />
            </div>
            <div className="changli-modal-footer">
              <button
                onClick={() => setShowAddModal(false)}
                className="action-btn text-sm px-4 py-2"
                data-tutorial="cancel-add-actor"
              >
                取消
              </button>
              <button
                onClick={handleAddActor}
                disabled={!newActor.name.trim()}
                className="action-btn action-btn-primary text-sm px-4 py-2 disabled:opacity-50"
              >
                创建
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
