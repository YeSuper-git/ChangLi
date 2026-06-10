import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getActor, getActorResources, updateActor } from '../utils/api';
import type { Actor, Resource } from '../utils/api';

const ActorDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [actor, setActor] = useState<Actor | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', bio: '', debutYear: '' });

  useEffect(() => {
    if (id) {
      loadActor(parseInt(id));
    }
  }, [id]);

  const loadActor = async (actorId: number) => {
    try {
      const [actorData, resourcesData] = await Promise.all([
        getActor(actorId),
        getActorResources(actorId),
      ]);
      setActor(actorData);
      setResources(resourcesData);
      if (actorData) {
        setEditForm({
          name: actorData.name,
          bio: actorData.bio || '',
          debutYear: actorData.debut_year?.toString() || '',
        });
      }
    } catch (error) {
      console.error('加载演员详情失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!actor || !editForm.name.trim()) return;
    
    try {
      await updateActor(
        actor.id,
        editForm.name,
        undefined,
        editForm.bio || undefined,
        editForm.debutYear ? parseInt(editForm.debutYear) : undefined
      );
      setEditing(false);
      loadActor(actor.id);
    } catch (error) {
      console.error('更新演员失败:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  if (!actor) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">演员不存在</div>
      </div>
    );
  }

  return (
    <div>
      {/* 返回按钮 */}
      <div className="mb-10">
        <Link to="/actors" className="text-gray-500 hover:text-gray-700 flex items-center gap-2">
          <span>←</span>
          <span>返回演员列表</span>
        </Link>
      </div>

      {/* 演员信息 */}
      <div className="flex gap-12 mb-16">
        {/* 写真 */}
        <div className="w-80 flex-shrink-0">
          <div className="aspect-[3/4] bg-gradient-to-br from-pink-200 to-pink-300 rounded-2xl mb-4"></div>
          {/* 写真集 */}
          <div className="grid grid-cols-4 gap-2">
            <div className="aspect-square bg-gradient-to-br from-pink-100 to-pink-200 rounded-lg"></div>
            <div className="aspect-square bg-gradient-to-br from-pink-200 to-pink-300 rounded-lg"></div>
            <div className="aspect-square bg-gradient-to-br from-pink-100 to-pink-200 rounded-lg"></div>
            <div className="aspect-square bg-gradient-to-br from-pink-200 to-pink-300 rounded-lg"></div>
          </div>
        </div>

        {/* 详细信息 */}
        <div className="flex-1">
          {editing ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">姓名</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">出道年份</label>
                <input
                  type="number"
                  value={editForm.debutYear}
                  onChange={(e) => setEditForm({ ...editForm, debutYear: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">简介</label>
                <textarea
                  value={editForm.bio}
                  onChange={(e) => setEditForm({ ...editForm, bio: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                  rows={4}
                />
              </div>
              <div className="flex gap-4">
                <button
                  onClick={() => setEditing(false)}
                  className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                >
                  保存
                </button>
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-4xl font-bold text-gray-900 mb-4">{actor.name}</h1>
              
              <div className="grid grid-cols-2 gap-6 mb-8 text-sm">
                <div className="flex items-center gap-3">
                  <span className="text-gray-500 w-20">出道年份</span>
                  <span className="font-medium">{actor.debut_year || '未知'}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-gray-500 w-20">作品数量</span>
                  <span className="font-medium">{resources.length}部</span>
                </div>
              </div>

              {actor.bio && (
                <p className="text-gray-600 mb-8 leading-relaxed text-lg">{actor.bio}</p>
              )}

              <div className="flex gap-4">
                <button
                  onClick={() => setEditing(true)}
                  className="px-6 py-3 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800"
                >
                  ✏️ 编辑信息
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 参演作品 */}
      <section>
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-gray-900">参演作品</h2>
        </div>

        {resources.length > 0 ? (
          <div className="grid grid-cols-4 gap-6">
            {resources.map((resource) => (
              <Link key={resource.id} to={`/resources/${resource.id}`} className="card block">
                <div className="aspect-[3/4] bg-gradient-to-br from-gray-100 to-gray-200"></div>
                <div className="p-5">
                  <h3 className="font-semibold text-gray-900 mb-2">{resource.title}</h3>
                  <div className="text-sm text-gray-500">
                    {resource.created_at.split('T')[0]}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <p className="text-gray-500">暂无参演作品</p>
          </div>
        )}
      </section>
    </div>
  );
};

export default ActorDetail;
