import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getActors, addActor } from '../utils/api';
import type { Actor } from '../utils/api';
import { convertFileSrc } from '@tauri-apps/api/tauri';

const Actors: React.FC = () => {
  const navigate = useNavigate();
  const [actors, setActors] = useState<Actor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newActor, setNewActor] = useState({ name: '', bio: '' });
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadActors();
  }, []);

  const loadActors = async () => {
    try {
      const actorsList = await getActors();
      setActors(actorsList);
    } catch (error) {
      console.error('加载演员失败:', error);
    } finally {
      setLoading(false);
    }
  };

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

  const filteredActors = actors.filter(actor =>
    actor.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  return (
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
          {filteredActors.map((actor) => (
            <Link key={actor.id} to={`/actors/${actor.id}`} className="card block">
              <div className="aspect-[3/4] bg-gradient-to-br from-pink-100 to-pink-200 relative overflow-hidden">
                {actor.photo ? (
                  <img
                    src={convertFileSrc(actor.photo)}
                    alt={actor.name}
                    className="w-full h-full object-cover"
                    onError={(event) => {
                      event.currentTarget.style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-5xl">👤</div>
                )}
                <div className="absolute bottom-4 left-4 right-4">
                  <div className="bg-black/60 text-white text-sm px-3 py-2 rounded-lg backdrop-blur-sm">
                    参演作品
                  </div>
                </div>
              </div>
              <div className="p-5">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">{actor.name}</h3>
                <p className="text-sm text-gray-500">
                  {actor.birthday ? `${actor.birthday}` : ''}
                </p>
              </div>
            </Link>
          ))}
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

      {/* 添加演员弹窗 */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 w-96">
            <h2 className="text-2xl font-bold mb-6">添加演员</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">姓名 *</label>
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
  );
};

export default Actors;
