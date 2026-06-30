import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import backIcon from '../assets/icons/back.svg';
import loadingIcon from '../assets/icons/loading.svg';
import favoriteIcon from '../assets/icons/favorite.svg';
import notFavoriteIcon from '../assets/icons/not-favorite.svg';
import {
  getVideo,
  updateVideo,
  getTags,
  addTag,
  getActors,
  addActor,
  getResourceTags,
  addResourceTag,
  removeResourceTag,
  getResourceActors,
  addResourceActor,
  removeResourceActor,
  saveVideoThumbnail,
  getVideoSeriesDetail,
} from '../utils/api';
import type { Video, Tag, Actor, VideoSeries } from '../utils/api';
import { open } from '@tauri-apps/plugin-dialog';
import { SmartPoster, videoPosterDataUrl } from '../utils/media';
import { useLibraryStore } from '../store/libraryStore';
import { notify } from '../utils/notify';

const VideoDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { favorites, toggleFavorite } = useLibraryStore();
  const [searchParams] = useSearchParams();
  const fromActor = searchParams.get('fromActor');
  const fromHome = searchParams.get('fromHome') === '1';
  const editFromUrl = searchParams.get('edit') === '1';
  const clearEditQuery = () => {
    if (editFromUrl) {
      const params = new URLSearchParams(searchParams);
      params.delete('edit');
      const query = params.toString();
      navigate(`${location.pathname}${query ? `?${query}` : ''}`, { replace: true, state: location.state });
    }
  };

  const [video, setVideo] = useState<Video | null>(null);
  const [series, setSeries] = useState<VideoSeries | null>(null);
  const [seriesVideos, setSeriesVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({ fileName: '', description: '', thumbnail: '' });

  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [videoTags, setVideoTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [creatingTag, setCreatingTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');

  const [allActors, setAllActors] = useState<Actor[]>([]);
  const [videoActors, setVideoActors] = useState<Actor[]>([]);
  const [selectedActorIds, setSelectedActorIds] = useState<number[]>([]);
  const [showNewActorModal, setShowNewActorModal] = useState(false);
  const [newActorName, setNewActorName] = useState('');
  const [actorNotice, setActorNotice] = useState('');

  useEffect(() => {
    window.scrollTo(0, 0);
    if (id) {
      loadVideo(parseInt(id));
      loadTags();
      loadActors();
    }
  }, [id]);

  useEffect(() => {
    if (editFromUrl && video) {
      setEditing(true);
    }
  }, [editFromUrl, video]);

  const loadVideo = async (videoId: number) => {
    try {
      const videoData = await getVideo(videoId);
      setVideo(videoData);
      if (videoData) {
        setEditData({
          fileName: videoData.file_name,
          description: videoData.description || '',
          thumbnail: videoData.thumbnail || '',
        });

        if (videoData.series_id) {
          const [seriesData, episodes] = await getVideoSeriesDetail(videoData.series_id);
          setSeries(seriesData);
          setSeriesVideos(episodes);
          setVideoTags([]);
          setVideoActors([]);
          setSelectedTagIds([]);
          setSelectedActorIds([]);
        } else {
          setSeries(null);
          setSeriesVideos([]);
          const [tags, actors] = await Promise.all([
            getResourceTags(videoId),
            getResourceActors(videoId),
          ]);
          setVideoTags(tags);
          setVideoActors(actors);
          setSelectedTagIds(tags.map((tag) => tag.id));
          setSelectedActorIds(actors.map((actor) => actor.id));
        }
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

  const beginEditing = () => {
    if (!video) return;
    setEditData({
      fileName: video.file_name,
      description: video.description || '',
      thumbnail: video.thumbnail || '',
    });
    setSelectedTagIds(videoTags.map((tag) => tag.id));
    setSelectedActorIds(videoActors.map((actor) => actor.id));
    setCreatingTag(false);
    setNewTagName('');
    setShowNewActorModal(false);
    setNewActorName('');
    setEditing(true);
  };

  const cancelEditing = () => {
    if (video) {
      setEditData({
        fileName: video.file_name,
        description: video.description || '',
        thumbnail: video.thumbnail || '',
      });
    }
    setSelectedTagIds(videoTags.map((tag) => tag.id));
    setSelectedActorIds(videoActors.map((actor) => actor.id));
    setCreatingTag(false);
    setNewTagName('');
    setShowNewActorModal(false);
    setNewActorName('');
    setEditing(false);
    clearEditQuery();
  };

  const syncRelations = async () => {
    if (!video) return;

    const currentTagIds = new Set(videoTags.map((tag) => tag.id));
    const nextTagIds = new Set(selectedTagIds);
    await Promise.all([
      ...selectedTagIds
        .filter((tagId) => !currentTagIds.has(tagId))
        .map((tagId) => addResourceTag(video.id, tagId)),
      ...videoTags
        .filter((tag) => !nextTagIds.has(tag.id))
        .map((tag) => removeResourceTag(video.id, tag.id)),
    ]);

    const currentActorIds = new Set(videoActors.map((actor) => actor.id));
    const nextActorIds = new Set(selectedActorIds);
    await Promise.all([
      ...selectedActorIds
        .filter((actorId) => !currentActorIds.has(actorId))
        .map((actorId) => addResourceActor(video.id, actorId)),
      ...videoActors
        .filter((actor) => !nextActorIds.has(actor.id))
        .map((actor) => removeResourceActor(video.id, actor.id)),
    ]);
  };

  const handleSave = async () => {
    if (!video) return;

    try {
      await updateVideo(video.id, editData.fileName, editData.description, editData.thumbnail);
      if (!video.series_id) {
        await syncRelations();
      }
      clearEditQuery();
      setEditing(false);
      await Promise.all([loadVideo(video.id), loadTags(), loadActors()]);
    } catch (error) {
      console.error('保存失败:', error);
      notify({ message: `保存失败：${String(error)}`, type: 'error' });
    }
  };

  const handleSelectThumbnail = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: '图片',
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'svg', 'tif', 'tiff', 'ico', 'heic', 'heif'],
        }],
      });

      if (selected) {
        const storedPath = await saveVideoThumbnail(selected as string);
        setEditData({ ...editData, thumbnail: storedPath });
      }
    } catch (error) {
      console.error('选择海报失败:', error);
      notify({ message: `选择海报失败：${String(error)}`, type: 'error' });
    }
  };

  const toggleTag = (tagId: number) => {
    setSelectedTagIds((current) =>
      current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId]
    );
  };

  const toggleActor = (actorId: number) => {
    setSelectedActorIds((current) =>
      current.includes(actorId) ? current.filter((id) => id !== actorId) : [...current, actorId]
    );
  };

  const handleCreateTag = async () => {
    const name = newTagName.trim();
    if (!name) return;

    const duplicated = allTags.find((tag) => tag.name.trim().toLowerCase() === name.toLowerCase());
    if (duplicated) {
      notify({ message: `标签“${name}”已存在，不能重复添加。`, type: 'info' });
      return;
    }

    try {
      const tag = await addTag(name);
      setAllTags((current) => [...current, tag].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedTagIds((current) => [...current, tag.id]);
      setNewTagName('');
      setCreatingTag(false);
    } catch (error) {
      console.error('新建标签失败:', error);
      notify({ message: `新建标签失败：${String(error)}`, type: 'error' });
    }
  };

  const handleCreateActor = async () => {
    const name = newActorName.trim();
    if (!name) return;

    const duplicated = allActors.find((actor) => actor.name.trim().toLowerCase() === name.toLowerCase());
    if (duplicated) {
      setActorNotice(`演员“${name}”已存在，已为你选中该演员。`);
      setSelectedActorIds((current) => current.includes(duplicated.id) ? current : [...current, duplicated.id]);
      setShowNewActorModal(false);
      setNewActorName('');
      return;
    }

    try {
      const actor = await addActor(name);
      setAllActors((current) => [...current, actor].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedActorIds((current) => [...current, actor.id]);
      setShowNewActorModal(false);
      setNewActorName('');
      setActorNotice('演员已新建并选中，稍后可去演员中补充海报、生日、简介等信息。');
    } catch (error) {
      console.error('新建演员失败:', error);
      notify({ message: `新建演员失败：${String(error)}`, type: 'error' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500 flex items-center gap-2"><img src={loadingIcon} alt="加载中" className="w-6 h-6" /> 加载中...</div>
      </div>
    );
  }

  if (!video) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500 text-lg">视频不存在</p>
        <Link to="/library" className="text-blue-500 hover:text-blue-600 mt-4 inline-block">
          返回视频
        </Link>
      </div>
    );
  }

  const isSeriesEpisode = Boolean(video.series_id);
  const isFavorite = video ? favorites.some(f => 'file_name' in f && f.id === video.id) : false;
  const backState = location.state as { from?: string; backLabel?: string } | null;
  const fallbackBackTo = fromActor ? `/actors/${fromActor}` : fromHome ? '/' : '/library';
  const fallbackBackLabel = fromActor ? '返回演员详情' : fromHome ? '返回首页' : '返回视频';
  const backTo = backState?.from || fallbackBackTo;
  const backLabel = backState?.backLabel || fallbackBackLabel;
  const handleBack = () => {
    if (backState?.from) {
      navigate(-1);
    } else {
      navigate(backTo);
    }
  };
  const displayThumbnailDataUrl = editing && editData.thumbnail !== (video.thumbnail || '')
    ? null
    : videoPosterDataUrl(video);

  return (
    <div>
      <div className="mb-6">
        <button type="button" onClick={handleBack} className="text-sm text-blue-600 hover:underline flex items-center gap-1"><img src={backIcon} alt="返回" className="w-4 h-4" /> {backLabel}</button>
      </div>

      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">视频详情</h1>
        <div className="flex gap-4 items-center">
          
          {editing ? (
            <>
              <button
                onClick={cancelEditing}
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
              onClick={() => {
                if (isSeriesEpisode && video.series_id) {
                  navigate(`/series/${video.series_id}?edit=1`, { state: { from: `/video/${video.id}`, backLabel: '返回视频详情' } });
                } else {
                  beginEditing();
                }
              }}
              className="px-4 py-2 bg-gray-900 text-white rounded-xl font-medium hover:bg-gray-800"
            >
              {isSeriesEpisode ? '编辑视频集' : '编辑'}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-8">
        <div className="col-span-2 space-y-6">
          <div className="card overflow-hidden">
            <div
              className={`aspect-video bg-gradient-to-br from-gray-100 to-gray-200 relative group ${editing ? 'cursor-pointer' : ''}`}
              onClick={editing ? handleSelectThumbnail : undefined}
            >
              <SmartPoster src={displayThumbnailDataUrl} alt={video.file_name} />
              {editing && (
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="bg-black/50 text-white text-xs px-3 py-1.5 rounded-full">
                    点击更换海报
                  </span>
                </div>
              )}
            </div>
          </div>

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
              <div className="flex items-center gap-2">
                <p className="text-gray-900">{video.file_name}</p>
                {video && (
                  <button
                    onClick={() => toggleFavorite(video.id, 'video')}
                    className="flex items-center gap-1 px-3 py-1 rounded-full text-sm transition-all hover:bg-gray-100"
                  >
                    <img
                      src={isFavorite ? favoriteIcon : notFavoriteIcon}
                      alt="追番"
                      className={`w-5 h-5 ${isFavorite ? 'filter-red' : 'text-gray-400'}`}
                    />
                    <span className={isFavorite ? 'text-red-500' : 'text-gray-400'}>
                      {isFavorite ? '已追番' : '追番'}
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>

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

        <div className="space-y-6">
          <Link
            to={`/player/${video.id}`}
            className="block w-full px-6 py-4 bg-blue-500 text-white text-center rounded-xl font-medium hover:bg-blue-600"
          >
            ▶️ 播放视频
          </Link>

          {isSeriesEpisode ? (
            <div className="card p-6">
              <h3 className="text-sm font-medium text-gray-500 mb-4">视频集管理</h3>
              <p className="text-sm text-gray-500 mb-4">
                这是视频集中的单集。演员和标签归属于整个视频集，不在单个分集上编辑。
              </p>
              {series && (
                <Link
                  to={`/series/${series.id}`}
                  className="block p-3 bg-blue-50 text-blue-700 rounded-lg font-medium hover:bg-blue-100 mb-4"
                >
                  管理《{series.title}》演员、标签和分集
                </Link>
              )}
              <div className="space-y-2">
                {seriesVideos.map((episode) => (
                  <Link
                    key={episode.id}
                    to={`/player/${episode.id}`}
                    className={`block p-2 rounded-lg text-sm ${episode.id === video.id ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-700 hover:text-blue-600'}`}
                  >
                    <span>{episode.file_name}</span>
                    {episode.episode_number && (
                      <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600">
                        第 {episode.episode_number} 集
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="card p-6">
                <h3 className="text-sm font-medium text-gray-500 mb-4">标签</h3>
                {editing ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {allTags.map((tag) => {
                        const selected = selectedTagIds.includes(tag.id);
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => toggleTag(tag.id)}
                            className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                              selected
                                ? 'bg-blue-500 border-blue-500 text-white'
                                : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
                            }`}
                          >
                            {tag.name}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => setCreatingTag(true)}
                        className="px-3 py-1 rounded-full text-sm border border-dashed border-gray-300 text-gray-600 hover:bg-gray-50"
                      >
                        + 新建标签
                      </button>
                    </div>
                    {allTags.length === 0 && !creatingTag && (
                      <p className="text-sm text-gray-400 mt-3">暂无已有标签，可点击“新建标签”添加。</p>
                    )}
                    {creatingTag && (
                      <div className="mt-4 flex gap-2">
                        <input
                          type="text"
                          value={newTagName}
                          onChange={(e) => setNewTagName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCreateTag();
                            if (e.key === 'Escape') {
                              setCreatingTag(false);
                              setNewTagName('');
                            }
                          }}
                          placeholder="输入标签名"
                          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                          autoFocus
                        />
                        <button onClick={handleCreateTag} className="px-3 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600">
                          完成
                        </button>
                        <button
                          onClick={() => {
                            setCreatingTag(false);
                            setNewTagName('');
                          }}
                          className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
                        >
                          取消
                        </button>
                      </div>
                    )}
                  </>
                ) : videoTags.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {videoTags.map((tag) => (
                      <span key={tag.id} className="px-3 py-1 bg-gray-100 rounded-full text-sm text-gray-700">
                        {tag.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">暂未添加标签，点击编辑添加标签</p>
                )}
              </div>

              <div className="card p-6">
                <h3 className="text-sm font-medium text-gray-500 mb-4">演员</h3>
                {editing ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {allActors.map((actor) => {
                        const selected = selectedActorIds.includes(actor.id);
                        return (
                          <button
                            key={actor.id}
                            type="button"
                            onClick={() => toggleActor(actor.id)}
                            className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                              selected
                                ? 'bg-blue-500 border-blue-500 text-white'
                                : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
                            }`}
                          >
                            {actor.name}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => setShowNewActorModal(true)}
                        className="px-3 py-1 rounded-full text-sm border border-dashed border-gray-300 text-gray-600 hover:bg-gray-50"
                      >
                        + 新建演员
                      </button>
                    </div>
                    {allActors.length === 0 && (
                      <p className="text-sm text-gray-400 mt-3">暂无已有演员，可点击“新建演员”添加。</p>
                    )}
                  </>
                ) : videoActors.length > 0 ? (
                  <div className="space-y-2">
                    {videoActors.map((actor) => (
                      <Link
                        key={actor.id}
                        to={`/actors/${actor.id}`}
                        state={{ from: `/video/${video.id}`, backLabel: '返回视频详情' }}
                        className="block p-2 bg-gray-50 rounded-lg text-gray-900 hover:text-blue-600"
                      >
                        {actor.name}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">暂未添加演员，点击编辑添加演员</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {actorNotice && (
        <div className="fixed right-6 top-6 z-50 max-w-sm rounded-2xl border border-emerald-200 bg-white px-5 py-4 shadow-xl">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">✓</div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-gray-900">演员已更新</div>
              <div className="mt-1 text-sm text-gray-500">{actorNotice}</div>
            </div>
            <button
              type="button"
              onClick={() => setActorNotice('')}
              className="text-gray-400 hover:text-gray-600"
              aria-label="关闭提示"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {showNewActorModal && (
        <div className="fixed inset-0 bg-gray-900/45 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="w-full max-w-md overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-2xl">
            <div className="border-b border-gray-100 px-6 py-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-500">演员资料</p>
              <h2 className="mt-1 text-2xl font-bold text-gray-900">新建演员</h2>
              <p className="mt-2 text-sm text-gray-500">新建后会自动选中，保存视频详情时同步关联。</p>
            </div>
            <div className="px-6 py-5">
              <label className="block text-sm font-medium text-gray-700 mb-2">姓名</label>
              <input
                type="text"
                value={newActorName}
                onChange={(e) => setNewActorName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateActor();
                  if (e.key === 'Escape') {
                    setShowNewActorModal(false);
                    setNewActorName('');
                  }
                }}
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                placeholder="输入演员姓名"
                autoFocus
              />
              <p className="text-xs text-gray-400 mt-2">新建后会自动选中，稍后可去演员中补充海报和详细信息。</p>
            </div>
            <div className="flex gap-3 border-t border-gray-100 bg-gray-50 px-6 py-4">
              <button
                onClick={() => {
                  setShowNewActorModal(false);
                  setNewActorName('');
                }}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                取消
              </button>
              <button
                onClick={handleCreateActor}
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

export default VideoDetail;
