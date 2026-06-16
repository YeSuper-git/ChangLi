import React, { useState, useEffect } from 'react';
import { useParams, Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { getActor, getActorResources, updateActor, saveActorPhoto, scanVideos, getVideos, addResourceActor } from '../utils/api';
import type { Actor, Video } from '../utils/api';
import { open } from '@tauri-apps/api/dialog';
import { actorPhotoDataUrl, StaticImagePlaceholder, videoPosterDataUrl } from '../utils/media';

const ActorDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const editFromUrl = searchParams.get('edit') === '1';
  const clearEditQuery = () => {
    if (editFromUrl) {
      navigate(location.pathname, { replace: true, state: location.state });
    }
  };
  const [actor, setActor] = useState<Actor | null>(null);
  const [resources, setResources] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    bio: '',
    birthday: '',
    height: '',
    measurements: '',
    japanese_name: '',
  });
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [addingWork, setAddingWork] = useState(false);

  useEffect(() => {
    if (id) {
      loadActor(parseInt(id));
    }
  }, [id]);

  useEffect(() => {
    if (editFromUrl && actor) {
      setEditing(true);
    }
  }, [editFromUrl, actor]);

  const loadActor = async (actorId: number) => {
    try {
      console.log('[Actor] 开始加载演员详情, actorId:', actorId);
      const [actorData, resourcesData] = await Promise.all([
        getActor(actorId),
        getActorResources(actorId),
      ]);
      console.log('[Actor] getActor 返回:', actorData ? `name: ${actorData.name}, photo: ${actorData.photo || '无'}` : 'null');
      console.log('[Actor] getActorResources 返回:', resourcesData.length, '条');
      setActor(actorData);
      setResources(resourcesData);
      if (actorData) {
        setEditForm({
          name: actorData.name,
          bio: actorData.bio || '',
          birthday: actorData.birthday || '',
          height: actorData.height || '',
          measurements: actorData.measurements || '',
          japanese_name: actorData.japanese_name || '',
        });
      }
    } catch (error) {
      console.error('[Actor] 加载演员详情失败:', error);
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
        actor.photo,
        editForm.bio || undefined,
        editForm.birthday || undefined,
        editForm.height || undefined,
        editForm.measurements || undefined,
        editForm.japanese_name || undefined
      );
      clearEditQuery();
      setEditing(false);
      loadActor(actor.id);
    } catch (error) {
      console.error('[Actor] 更新演员失败:', error);
    }
  };

  const handlePhotoClick = async () => {
    try {
      console.log('[ActorDetail] 打开文件选择器...');
      const selected = await open({
        multiple: false,
        filters: [{
          name: '图片',
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'svg', 'tif', 'tiff', 'heic', 'heif']
        }],
        title: '选择演员海报'
      });
      
      if (selected && actor) {
        console.log('[ActorDetail] 选择的文件:', selected);
        setUploadingPhoto(true);
        try {
          // 复制文件到应用数据目录
          const relativePath = await saveActorPhoto(selected as string);
          console.log('[ActorDetail] 保存后的相对路径:', relativePath);
          
          // 更新演员信息
          await updateActor(
            actor.id,
            actor.name,
            relativePath,
            actor.bio || undefined,
            actor.birthday || undefined,
            actor.height || undefined,
            actor.measurements || undefined,
            actor.japanese_name || undefined
          );
          loadActor(actor.id);
        } catch (error) {
          console.error('[Actor] 上传海报失败:', error);
        } finally {
          setUploadingPhoto(false);
        }
      }
    } catch (error) {
      console.error('[Actor] 打开文件选择器失败:', error);
    }
  };


  const handleAddWork = async () => {
    try {
      console.log('[ActorDetail] 打开文件夹选择器...');
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择包含视频的文件夹'
      });
      
      if (selected && actor) {
        console.log('[ActorDetail] 选择的文件夹:', selected);
        setAddingWork(true);
        try {
          // 获取扫描前的视频ID列表
          const existingVideos = await getVideos();
          const existingIds = new Set(existingVideos.map(v => v.id));
          console.log('[ActorDetail] 已有视频数量:', existingIds.size);
          
          // 扫描视频
          console.log('[ActorDetail] 开始扫描视频...');
          const allVideos = await scanVideos(selected as string);
          console.log('[ActorDetail] 扫描后视频总数:', allVideos.length);
          
          // 找出新增的视频
          const newVideos = allVideos.filter(v => !existingIds.has(v.id));
          console.log('[ActorDetail] 新增视频数量:', newVideos.length);
          
          // 将新视频关联到当前演员
          for (const video of newVideos) {
            console.log('[ActorDetail] 关联视频:', video.id, video.file_name);
            await addResourceActor(video.id, actor.id);
          }
          
          // 刷新资源列表
          loadActor(actor.id);
        } catch (error) {
          console.error('[Actor] 添加作品失败:', error);
        } finally {
          setAddingWork(false);
        }
      }
    } catch (error) {
      console.error('[Actor] 打开文件夹选择器失败:', error);
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

  const backState = location.state as { from?: string; backLabel?: string } | null;
  const backLabel = backState?.backLabel || '返回演员列表';
  const handleBack = () => {
    if (backState?.from) {
      navigate(-1);
    } else {
      navigate('/actors');
    }
  };

  const workItems = Array.from(
    resources.reduce((map, resource) => {
      const key = resource.series_id ? `series-${resource.series_id}` : `video-${resource.id}`;
      if (!map.has(key)) {
        map.set(key, resource);
      }
      return map;
    }, new Map<string, Video>()).values()
  );

  return (
    <div>
      {/* 返回按钮 */}
      <div className="mb-10">
        <button type="button" onClick={handleBack} className="text-gray-500 hover:text-gray-700 flex items-center gap-2">
          <span>←</span>
          <span>{backLabel}</span>
        </button>
      </div>

      {/* 演员信息 */}
      <div className="flex gap-12 mb-16">
        {/* 写真 */}
        <div className="w-80 flex-shrink-0">
          <div 
            className="aspect-[3/4] bg-gradient-to-br from-pink-200 to-pink-300 rounded-2xl mb-4 overflow-hidden cursor-pointer relative group"
            onClick={handlePhotoClick}
          >
            {actorPhotoDataUrl(actor) ? (
              <img
                src={actorPhotoDataUrl(actor)!}
                alt={actor.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <StaticImagePlaceholder kind="actor" />
            )}
            {/* 悬浮提示 */}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <span className="text-white text-sm font-medium">
                {uploadingPhoto ? '上传中...' : '点击更换海报'}
              </span>
            </div>
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
                <label className="block text-sm font-medium text-gray-700 mb-2">日本名</label>
                <input
                  type="text"
                  value={editForm.japanese_name}
                  onChange={(e) => setEditForm({ ...editForm, japanese_name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                  placeholder="例: なにか なにか"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">出生日期</label>
                <input
                  type="date"
                  value={editForm.birthday}
                  onChange={(e) => setEditForm({ ...editForm, birthday: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">身高</label>
                <input
                  type="text"
                  value={editForm.height}
                  onChange={(e) => setEditForm({ ...editForm, height: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                  placeholder="例: 160cm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">三围</label>
                <input
                  type="text"
                  value={editForm.measurements}
                  onChange={(e) => setEditForm({ ...editForm, measurements: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                  placeholder="例: B88 W58 H85"
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
                  onClick={() => { setEditing(false); clearEditQuery(); }}
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
              {actor.japanese_name && (
                <p className="text-lg text-gray-500 mb-4">{actor.japanese_name}</p>
              )}
              
              <div className="grid grid-cols-2 gap-6 mb-8 text-sm">
                {actor.birthday && (
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500 w-20">出生日期</span>
                    <span className="font-medium">{actor.birthday}</span>
                  </div>
                )}
                {actor.height && (
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500 w-20">身高</span>
                    <span className="font-medium">{actor.height}</span>
                  </div>
                )}
                {actor.measurements && (
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500 w-20">三围</span>
                    <span className="font-medium">{actor.measurements}</span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <span className="text-gray-500 w-20">作品数量</span>
                  <span className="font-medium">{actor.work_count || workItems.length}部</span>
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
          <button
            onClick={handleAddWork}
            disabled={addingWork}
            className="px-6 py-3 bg-gray-900 text-white rounded-xl font-medium hover:bg-gray-800 disabled:opacity-50"
          >
            {addingWork ? '添加中...' : '添加作品'}
          </button>
        </div>

        {workItems.length > 0 ? (
          <div className="grid grid-cols-4 gap-6">
            {workItems.map((resource) => {
              const isSeries = Boolean(resource.series_id);
              const title = isSeries ? (resource.series_title || '视频集') : resource.file_name;
              const poster = isSeries ? (resource.series_poster_data_url || videoPosterDataUrl(resource)) : videoPosterDataUrl(resource);
              const target = isSeries ? `/series/${resource.series_id}?fromActor=${actor.id}` : `/video/${resource.id}?fromActor=${actor.id}`;
              return (
              <Link
                key={isSeries ? `series-${resource.series_id}` : `video-${resource.id}`}
                to={target}
                state={{ from: `/actors/${actor.id}`, backLabel: '返回演员详情' }}
                className="card block"
              >
                <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 relative overflow-hidden">
                  {poster ? (
                    <img src={poster} alt={title} className="w-full h-full object-cover" />
                  ) : (
                    <StaticImagePlaceholder kind="video" />
                  )}
                </div>
                <div className="p-5">
                  <h3 className="font-semibold text-gray-900 mb-2 line-clamp-2">{title}</h3>
                  <div className="text-sm text-gray-500">
                    {isSeries ? '视频集' : '单视频'}
                  </div>
                </div>
              </Link>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-16">
            <p className="text-gray-500">暂无参演作品</p>
            <p className="text-gray-400 text-sm mt-2">点击"添加作品"按钮添加</p>
          </div>
        )}
      </section>
    </div>
  );
};

export default ActorDetail;
