import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { open } from '@tauri-apps/api/dialog';
import {
  addActor,
  addSeriesActor,
  addSeriesTag,
  addTag,
  addVideoToSeries,
  deleteVideo,
  getActors,
  getSeriesActors,
  getSeriesTags,
  getTags,
  getVideoSeriesDetail,
  removeSeriesActor,
  removeSeriesTag,
  removeVideoFromSeries,
  saveVideoThumbnail,
  updateVideoSeries,
} from '../utils/api';
import type { Actor, Tag, Video, VideoSeries } from '../utils/api';
import { StaticImagePlaceholder, videoPosterDataUrl } from '../utils/media';
import { useSecondConfirm } from '../utils/useSecondConfirm';

const SeriesDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const fromActor = searchParams.get('fromActor');
  const editFromUrl = searchParams.get('edit') === '1';
  const seriesId = Number(id);

  const [series, setSeries] = useState<VideoSeries | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editData, setEditData] = useState({ title: '', description: '', poster: '' });
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [seriesTags, setSeriesTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [allActors, setAllActors] = useState<Actor[]>([]);
  const [seriesActors, setSeriesActors] = useState<Actor[]>([]);
  const [selectedActorIds, setSelectedActorIds] = useState<number[]>([]);
  const [newActorName, setNewActorName] = useState('');
  const { pendingKey, requestSecondConfirm } = useSecondConfirm();

  useEffect(() => {
    if (seriesId) {
      loadSeries();
    }
  }, [seriesId, editFromUrl]);

  const loadSeries = async () => {
    try {
      const [seriesData, seriesVideos] = await getVideoSeriesDetail(seriesId);
      const [tags, actors, selectedTags, selectedActors] = await Promise.all([
        getTags(),
        getActors(),
        getSeriesTags(seriesId),
        getSeriesActors(seriesId),
      ]);
      setSeries(seriesData);
      setVideos(seriesVideos);
      setAllTags(tags);
      setAllActors(actors);
      setSeriesTags(selectedTags);
      setSeriesActors(selectedActors);
      setSelectedTagIds(selectedTags.map((tag) => tag.id));
      setSelectedActorIds(selectedActors.map((actor) => actor.id));
      if (seriesData) {
        setEditData({
          title: seriesData.title,
          description: seriesData.description || '',
          poster: seriesData.poster || '',
        });
        if (editFromUrl) {
          setEditing(true);
        }
      }
    } catch (error) {
      console.error('加载视频集失败:', error);
      alert('加载视频集失败: ' + String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPoster = async () => {
    const selected = await open({
      multiple: false,
      filters: [{
        name: '图片',
        extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'svg', 'tif', 'tiff', 'ico', 'heic', 'heif'],
      }],
    });
    if (selected) {
      const storedPath = await saveVideoThumbnail(selected as string);
      setEditData((current) => ({ ...current, poster: storedPath }));
    }
  };

  const syncSeriesRelations = async () => {
    if (!series) return;
    const currentTagIds = new Set(seriesTags.map((tag) => tag.id));
    const nextTagIds = new Set(selectedTagIds);
    const currentActorIds = new Set(seriesActors.map((actor) => actor.id));
    const nextActorIds = new Set(selectedActorIds);

    await Promise.all([
      ...selectedTagIds.filter((tagId) => !currentTagIds.has(tagId)).map((tagId) => addSeriesTag(series.id, tagId)),
      ...seriesTags.filter((tag) => !nextTagIds.has(tag.id)).map((tag) => removeSeriesTag(series.id, tag.id)),
      ...selectedActorIds.filter((actorId) => !currentActorIds.has(actorId)).map((actorId) => addSeriesActor(series.id, actorId)),
      ...seriesActors.filter((actor) => !nextActorIds.has(actor.id)).map((actor) => removeSeriesActor(series.id, actor.id)),
    ]);
  };

  const handleCreateTag = async () => {
    const name = newTagName.trim();
    if (!name) return;
    const existing = allTags.find((tag) => tag.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) {
      setSelectedTagIds((current) => current.includes(existing.id) ? current : [...current, existing.id]);
      setNewTagName('');
      return;
    }
    const tag = await addTag(name);
    setAllTags((current) => [...current, tag].sort((a, b) => a.name.localeCompare(b.name)));
    setSelectedTagIds((current) => [...current, tag.id]);
    setNewTagName('');
  };

  const handleCreateActor = async () => {
    const name = newActorName.trim();
    if (!name) return;
    const existing = allActors.find((actor) => actor.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) {
      setSelectedActorIds((current) => current.includes(existing.id) ? current : [...current, existing.id]);
      setNewActorName('');
      return;
    }
    const actor = await addActor(name);
    setAllActors((current) => [...current, actor].sort((a, b) => a.name.localeCompare(b.name)));
    setSelectedActorIds((current) => [...current, actor.id]);
    setNewActorName('');
  };

  const toggleTag = (tagId: number) => {
    setSelectedTagIds((current) => current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId]);
  };

  const toggleActor = (actorId: number) => {
    setSelectedActorIds((current) => current.includes(actorId) ? current.filter((id) => id !== actorId) : [...current, actorId]);
  };

  const handleSave = async () => {
    if (!series) return;
    const title = editData.title.trim();
    if (!title) {
      alert('标题不能为空');
      return;
    }
    setSaving(true);
    try {
      await updateVideoSeries(series.id, title, editData.description, editData.poster);
      await syncSeriesRelations();
      setEditing(false);
      await loadSeries();
    } catch (error) {
      console.error('保存视频集失败:', error);
      alert('保存失败: ' + String(error));
    } finally {
      setSaving(false);
    }
  };

  const handleAddEpisode = async () => {
    const selected = await open({
      multiple: false,
      filters: [{
        name: '视频',
        extensions: ['mp4', 'mkv', 'avi', 'flv', 'mov', 'wmv', 'webm', 'm4v', 'mpg', 'mpeg', '3gp', 'ts', 'rmvb', 'rm', 'vob', 'asf', 'f4v'],
      }],
    });
    if (!selected) return;
    try {
      await addVideoToSeries(seriesId, selected as string);
      await loadSeries();
    } catch (error) {
      console.error('添加分集失败:', error);
      alert('添加分集失败: ' + String(error));
    }
  };

  const handleRemoveEpisode = async (videoId: number) => {
    try {
      await removeVideoFromSeries(videoId);
      await loadSeries();
    } catch (error) {
      console.error('移除分集失败:', error);
      alert('移除失败: ' + String(error));
    }
  };

  const handleDeleteEpisode = async (videoId: number) => {
    try {
      await deleteVideo(videoId);
      await loadSeries();
    } catch (error) {
      console.error('删除分集失败:', error);
      alert('删除失败: ' + String(error));
    }
  };

  const backState = location.state as { from?: string; backLabel?: string } | null;
  const fallbackBackTo = fromActor ? `/actors/${fromActor}` : '/library';
  const fallbackBackLabel = fromActor ? '返回演员详情' : '返回视频';
  const backTo = backState?.from || fallbackBackTo;
  const backLabel = backState?.backLabel || fallbackBackLabel;
  const handleBack = () => {
    if (backState?.from) {
      navigate(-1);
    } else {
      navigate(backTo);
    }
  };

  if (loading) return <div className="text-gray-500">加载中...</div>;
  if (!series) return <div className="text-gray-500">视频集不存在</div>;

  return (
    <div>
      <div className="mb-6">
        <button type="button" onClick={handleBack} className="text-sm text-blue-600 hover:underline">
          ← {backLabel}
        </button>
      </div>

      <div className="card p-6 mb-8">
        <div className="flex gap-6">
          <div className="w-80 aspect-video bg-gray-100 rounded-xl overflow-hidden flex-shrink-0">
            {series.poster_data_url ? (
              <img src={series.poster_data_url} alt={series.title} className="w-full h-full object-cover" />
            ) : (
              <StaticImagePlaceholder kind="video" />
            )}
          </div>
          <div className="flex-1">
            {editing ? (
              <div className="space-y-4">
                <input
                  value={editData.title}
                  onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                  className="search-input"
                  placeholder="标题"
                />
                <textarea
                  value={editData.description}
                  onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                  className="search-input min-h-[120px]"
                  placeholder="简介"
                />
                <div>
                  <div className="text-sm font-medium text-gray-500 mb-2">视频集标签</div>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {allTags.map((tag) => {
                      const selected = selectedTagIds.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => toggleTag(tag.id)}
                          className={`px-3 py-1 rounded-full text-sm border ${selected ? 'bg-blue-500 border-blue-500 text-white' : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'}`}
                        >
                          {tag.name}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleCreateTag(); }}
                      className="search-input"
                      placeholder="新建标签"
                    />
                    <button type="button" onClick={handleCreateTag} className="action-btn">添加标签</button>
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-500 mb-2">视频集演员</div>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {allActors.map((actor) => {
                      const selected = selectedActorIds.includes(actor.id);
                      return (
                        <button
                          key={actor.id}
                          type="button"
                          onClick={() => toggleActor(actor.id)}
                          className={`px-3 py-1 rounded-full text-sm border ${selected ? 'bg-blue-500 border-blue-500 text-white' : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'}`}
                        >
                          {actor.name}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={newActorName}
                      onChange={(e) => setNewActorName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleCreateActor(); }}
                      className="search-input"
                      placeholder="新建演员"
                    />
                    <button type="button" onClick={handleCreateActor} className="action-btn">添加演员</button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleSelectPoster} className="action-btn">选择海报</button>
                  <button onClick={handleSave} disabled={saving} className="action-btn action-btn-primary">保存</button>
                  <button onClick={() => setEditing(false)} className="action-btn">取消</button>
                </div>
              </div>
            ) : (
              <>
                <h1 className="text-3xl font-bold mb-3">{series.title}</h1>
                <p className="text-gray-500 mb-4">{series.video_count} 集</p>
                {series.description && <p className="text-gray-700 whitespace-pre-wrap mb-4">{series.description}</p>}
                <div className="mb-4 space-y-3">
                  <div>
                    <span className="text-sm font-medium text-gray-500 mr-2">标签：</span>
                    {seriesTags.length > 0 ? seriesTags.map((tag) => (
                      <span key={tag.id} className="inline-block mr-2 mb-2 px-3 py-1 bg-gray-100 rounded-full text-sm text-gray-700">{tag.name}</span>
                    )) : <span className="text-sm text-gray-400">暂无</span>}
                  </div>
                  <div>
                    <span className="text-sm font-medium text-gray-500 mr-2">演员：</span>
                    {seriesActors.length > 0 ? seriesActors.map((actor) => (
                      <Link
                        key={actor.id}
                        to={`/actors/${actor.id}`}
                        state={{ from: `/series/${series.id}`, backLabel: '返回视频集详情' }}
                        className="inline-block mr-2 mb-2 px-3 py-1 bg-gray-100 rounded-full text-sm text-gray-700 hover:text-blue-600"
                      >
                        {actor.name}
                      </Link>
                    )) : <span className="text-sm text-gray-400">暂无</span>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setEditing(true)} className="action-btn action-btn-primary">编辑信息</button>
                  <button onClick={handleAddEpisode} className="action-btn">添加分集</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <h2 className="text-xl font-semibold mb-4">分集</h2>
      {videos.length > 0 ? (
        <div className="grid grid-cols-4 gap-6">
          {videos.map((video) => {
            const poster = videoPosterDataUrl(video);
            return (
              <div key={video.id} className="card">
                <Link to={`/player/${video.id}`}>
                  <div className="aspect-video bg-gray-100 overflow-hidden relative">
                    {poster ? <img src={poster} alt={video.file_name} className="w-full h-full object-cover" /> : <StaticImagePlaceholder kind="video" />}
                    {video.episode_number && (
                      <div className="absolute bottom-2 right-2 bg-gray-700/70 text-white text-xs px-2.5 py-1 rounded-full">
                        第 {video.episode_number} 集
                      </div>
                    )}
                  </div>
                </Link>
                <div className="p-4">
                  <h3 className="font-semibold text-sm line-clamp-2 mb-2">
                    {video.file_name}
                  </h3>
                  <div className="flex gap-2 flex-wrap">
                    <Link to={`/player/${video.id}`} className="action-btn action-btn-primary text-center">播放</Link>
                    <button
                      onClick={() => requestSecondConfirm(`remove-episode-${video.id}`, () => handleRemoveEpisode(video.id))}
                      className="action-btn"
                    >
                      {pendingKey === `remove-episode-${video.id}` ? '再次确认移出' : '移出'}
                    </button>
                    <button
                      onClick={() => requestSecondConfirm(`delete-episode-${video.id}`, () => handleDeleteEpisode(video.id))}
                      className="action-btn action-btn-danger"
                    >
                      {pendingKey === `delete-episode-${video.id}` ? '再次确认删除' : '删除'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-gray-500 py-10 text-center">暂无分集</div>
      )}
    </div>
  );
};

export default SeriesDetail;
