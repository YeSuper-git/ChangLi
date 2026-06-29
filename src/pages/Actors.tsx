import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { addActor, deleteActor } from '../utils/api';
import type { Actor } from '../utils/api';
import { actorPhotoDataUrl, StaticImagePlaceholder } from '../utils/media';
import { useSecondConfirm } from '../utils/useSecondConfirm';
import FloatingActions from '../components/FloatingActions';
import { useLibraryStore } from '../store/libraryStore';

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
      alert('删除演员失败: ' + String(error));
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
    <div>
      <div className="flex items-center justify-between mb-10">
        <h1 className="text-3xl font-bold">演员库</h1>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-6 py-3 bg-gray-900 text-white rounded-xl font-medium hover:bg-gray-800"
        >
          添加演员
        </button>
      </div>

      {/* 搜索栏 */}
      <div className="mb-10">
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
        <div className="grid grid-cols-4 gap-6">
          {filteredActors.map((actor) => {
            const photoDataUrl = actorPhotoDataUrl(actor);
            return (
            <Link
              key={actor.id}
              to={`/actors/${actor.id}`}
              state={{ from: '/actors', backLabel: '返回演员列表' }}
              onContextMenu={(event) => openContextMenu(event, actor)}
              className="card block"
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
        <div className="text-center py-16">
          <p className="text-gray-500 text-lg mb-4">
            {searchTerm ? '没有找到匹配的演员' : '暂无演员数据'}
          </p>
          {!searchTerm && (
            <button
              onClick={() => setShowAddModal(true)}
              className="px-6 py-3 bg-blue-500 text-white rounded-xl hover:bg-blue-600"
            >
              添加第一个演员
            </button>
          )}
        </div>
      )}

      {contextMenu && (
        <div
          className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-xl py-2 w-fit"
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
            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            onClick={handleEditContextActor}
          >
            编辑
          </button>
          <button
            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
            onClick={() => requestSecondConfirm(`actor-${contextMenu.id}`, () => handleDeleteActor(contextMenu.id))}
          >
            {pendingKey === `actor-${contextMenu.id}` ? '再次点击确认删除' : '删除'}
          </button>
        </div>
      )}

      {/* 添加演员弹窗 */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 w-96">
            <h2 className="text-2xl font-bold mb-6">添加演员</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">姓名</label>
                <input
                  type="text"
                  value={newActor.name}
                  onChange={(e) => setNewActor({ ...newActor, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                  placeholder="输入演员姓名"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">简介</label>
                <textarea
                  value={newActor.bio}
                  onChange={(e) => setNewActor({ ...newActor, bio: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                  rows={3}
                  placeholder="输入演员简介"
                />
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
                onClick={handleAddActor}
                className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
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
