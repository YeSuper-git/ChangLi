import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getVideo, updateVideo, getTags, addTag, getActors, addActor, getResourceTags, addResourceTag, removeResourceTag, getResourceActors, addResourceActor, removeResourceActor } from '../utils/api';
import type { Video, Tag, Actor } from '../utils/api';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { open } from '@tauri-apps/api/dialog';

const VideoDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  const [video, setVideo] = useState<Video | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({ fileName: '', description: '', thumbnail: '' });
  
  // 标签相关
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [videoTags, setVideoTags] = useState<Tag[]>([]);
  const [newTagName, setNewTagName] = useState('');
  
  // 演员相关
  const [allActors, setAllActors] = useState<Actor[]>([]);
  const [videoActors, setVideoActors] = useState<Actor[]>([]);
  const [newActorName, setNewActorName] = useState('');

  useEffect(() => {
    if (id) {
      loadVideo(parseInt(id));
      loadTags();
      loadActors();
    }
  }, [id]);

  const loadVideo = async (videoId: number) => {
    try {
      const videoData = await getVideo(videoId);
      setVideo(videoData);
      if (videoData) {
        setEditData({
          fileName: videoData.file_name,
          description: videoData.description || '',
          thumbnail: videoData.thumbnail || ''
        });
        
        // 加载视频的标签和演员
        const [tags, actors] = await Promise.all([
          getResourceTags(videoId),
          getResourceActors(videoId)
        ]);
        setVideoTags(tags);
        setVideoActors(actors);
      }
    } catch (error) {
      console.error('加载视频失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadTags = async () => {
    try {
      const tags = await getTags();
      setAllTags(tags);
    } catch (error) {
      console.error('加载标签失败:', error);
    }
  };

  const loadActors = async () => {
    try {
      const actors = await getActors();
      setAllActors(actors);
    } catch (error) {
      console.error('加载演员失败:', error);
    }
  };

  const handleSave = async () => {
    if (!video) return;
    
    try {
      await updateVideo(video.id, editData.fileName, editData.description, editData.thumbnail);
      setEditing(false);
      loadVideo(video.id);
    } catch (error) {
      console.error('保存失败:', error);
    }
  };

  const handleSelectThumbnail = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: '图片',
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'svg', 'tif', 'tiff', 'heic', 'heif']
        }]
      });
      
      if (selected) {
        setEditData({ ...editData, thumbnail: selected as string });
      }
    } catch (error) {
      console.error('选择海报失败:', error);
    }
  };

  const handleAddTag = async (tagName: string) => {
    if (!video || !tagName.trim()) return;
    
    try {
      // 先检查标签是否存在，不存在则创建
      let tag = allTags.find(t => t.name === tagName);
      if (!tag) {
        tag = await addTag(tagName);
        loadTags();
      }
      
      await addResourceTag(video.id, tag.id);
      const tags = await getResourceTags(video.id);
      setVideoTags(tags);
    } catch (error) {
      console.error('添加标签失败:', error);
    }
  };

  const handleRemoveTag = async (tagId: number) => {
    if (!video) return;
    
    try {
      await removeResourceTag(video.id, tagId);
      const tags = await getResourceTags(video.id);
      setVideoTags(tags);
    } catch (error) {
      console.error('移除标签失败:', error);
    }
  };

  const handleAddActor = async (actorName: string) => {
    if (!video || !actorName.trim()) return;
    
    try {
      // 先检查演员是否存在，不存在则创建
      let actor = allActors.find(a => a.name === actorName);
      if (!actor) {
        actor = await addActor(actorName);
        loadActors();
      }
      
      await addResourceActor(video.id, actor.id);
      const actors = await getResourceActors(video.id);
      setVideoActors(actors);
    } catch (error) {
      console.error('添加演员失败:', error);
    }
  };

  const handleRemoveActor = async (actorId: number) => {
    if (!video) return;
    
    try {
      await removeResourceActor(video.id, actorId);
      const actors = await getResourceActors(video.id);
      setVideoActors(actors);
    } catch (error) {
      console.error('移除演员失败:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  if (!video) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500 text-lg">视频不存在</p>
        <Link to="/library" className="text-blue-500 hover:text-blue-600 mt-4 inline-block">
          返回视频库
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">视频详情</h1>
        <div className="flex gap-4">
          {editing ? (
            <>
              <button
                onClick={() => setEditing(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                保存
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="px-4 py-2 bg-gray-900 text-white rounded-xl font-medium hover:bg-gray-800"
            >
              编辑
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-8">
        {/* 左侧：视频信息 */}
        <div className="col-span-2 space-y-6">
          {/* 海报 */}
          <div className="card overflow-hidden">
            <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 relative">
              {video.thumbnail ? (
                <img
                  src={convertFileSrc(video.thumbnail)}
                  alt={video.file_name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-6xl">▶️</span>
                </div>
              )}
              {editing && (
                <button
                  onClick={handleSelectThumbnail}
                  className="absolute bottom-4 right-4 px-4 py-2 bg-black/60 text-white rounded-lg hover:bg-black/80"
                >
                  更换海报
                </button>
              )}
            </div>
          </div>

          {/* 文件名 */}
          <div className="card p-6">
            <h3 className="text-sm font-medium text-gray-500 mb-2">文件名</h3>
            {editing ? (
              <input
                type="text"
                value={editData.fileName}
                onChange={(e) => setEditData({ ...editData, fileName: e.target.value })}
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
              />
            ) : (
              <p className="text-gray-900">{video.file_name}</p>
            )}
          </div>

          {/* 简介 */}
          <div className="card p-6">
            <h3 className="text-sm font-medium text-gray-500 mb-2">简介</h3>
            {editing ? (
              <textarea
                value={editData.description}
                onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                rows={4}
                placeholder="输入视频简介..."
              />
            ) : (
              <p className="text-gray-900">{video.description || '暂无简介'}</p>
            )}
          </div>

          {/* 视频信息 */}
          <div className="card p-6">
            <h3 className="text-sm font-medium text-gray-500 mb-4">视频信息</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-gray-500">文件大小：</span>
                <span>{video.file_size ? `${(video.file_size / 1024 / 1024 / 1024).toFixed(2)} GB` : '未知'}</span>
              </div>
              <div>
                <span className="text-gray-500">分辨率：</span>
                <span>{video.resolution || '未知'}</span>
              </div>
              <div>
                <span className="text-gray-500">时长：</span>
                <span>{video.duration ? `${Math.floor(video.duration / 60)} 分钟` : '未知'}</span>
              </div>
              <div>
                <span className="text-gray-500">格式：</span>
                <span>{video.file_name.split('.').pop()?.toUpperCase() || '未知'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* 右侧：标签和演员 */}
        <div className="space-y-6">
          {/* 播放按钮 */}
          <Link
            to={`/player/${video.id}`}
            className="block w-full px-6 py-4 bg-blue-500 text-white text-center rounded-xl font-medium hover:bg-blue-600"
          >
            ▶️ 播放视频
          </Link>

          {/* 标签 */}
          <div className="card p-6">
            <h3 className="text-sm font-medium text-gray-500 mb-4">标签</h3>
            <div className="flex flex-wrap gap-2 mb-4">
              {videoTags.map((tag) => (
                <span
                  key={tag.id}
                  className="flex items-center gap-1 px-3 py-1 bg-gray-100 rounded-full text-sm"
                >
                  {tag.name}
                  {editing && (
                    <button
                      onClick={() => handleRemoveTag(tag.id)}
                      className="text-gray-400 hover:text-red-500"
                    >
                      ✕
                    </button>
                  )}
                </span>
              ))}
            </div>
            {editing && (
              <>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="输入新标签或选择已有标签..."
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleAddTag(newTagName);
                        setNewTagName('');
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      handleAddTag(newTagName);
                      setNewTagName('');
                    }}
                    className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm"
                  >
                    添加
                  </button>
                </div>
                <div className="mt-4">
                  <p className="text-xs text-gray-400 mb-2">已有标签：</p>
                  <div className="flex flex-wrap gap-2">
                    {allTags.filter(t => !videoTags.find(vt => vt.id === t.id)).slice(0, 10).map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => handleAddTag(tag.name)}
                        className="px-2 py-1 bg-gray-50 text-gray-600 rounded text-xs hover:bg-gray-100"
                      >
                        + {tag.name}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* 演员 */}
          <div className="card p-6">
            <h3 className="text-sm font-medium text-gray-500 mb-4">演员</h3>
            <div className="space-y-2 mb-4">
              {videoActors.map((actor) => (
                <div
                  key={actor.id}
                  className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
                >
                  <Link to={`/actors/${actor.id}`} className="text-gray-900 hover:text-blue-600">
                    {actor.name}
                  </Link>
                  {editing && (
                    <button
                      onClick={() => handleRemoveActor(actor.id)}
                      className="text-gray-400 hover:text-red-500 text-sm"
                    >
                      移除
                    </button>
                  )}
                </div>
              ))}
            </div>
            {editing && (
              <>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newActorName}
                    onChange={(e) => setNewActorName(e.target.value)}
                    placeholder="输入新演员或选择已有演员..."
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleAddActor(newActorName);
                        setNewActorName('');
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      handleAddActor(newActorName);
                      setNewActorName('');
                    }}
                    className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm"
                  >
                    添加
                  </button>
                </div>
                <div className="mt-4">
                  <p className="text-xs text-gray-400 mb-2">已有演员：</p>
                  <div className="flex flex-wrap gap-2">
                    {allActors.filter(a => !videoActors.find(va => va.id === a.id)).slice(0, 10).map((actor) => (
                      <button
                        key={actor.id}
                        onClick={() => handleAddActor(actor.name)}
                        className="px-2 py-1 bg-gray-50 text-gray-600 rounded text-xs hover:bg-gray-100"
                      >
                        + {actor.name}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoDetail;
