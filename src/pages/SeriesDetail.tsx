import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { open } from '@tauri-apps/api/dialog';
import backIcon from '../assets/icons/back.svg';
import loadingIcon from '../assets/icons/loading.svg';
import {
  addActor,
  addSeriesActor,
  addSeriesTag,
  addTag,
  addVideoToSeries,
  deleteVideo,
  getActors,
  getStandaloneVideos,
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
import { SmartPoster, videoPosterDataUrl } from '../utils/media';
import { useSecondConfirm } from '../utils/useSecondConfirm';

const SeriesDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const fromActor = searchParams.get('fromActor');
  const editFromUrl = searchParams.get('edit') === '1';
  const clearEditQuery = () => {
    if (editFromUrl) {
      const params = new URLSearchParams(searchParams);
      params.delete('edit');
      const query = params.toString();
      navigate(`${location.pathname}${query ? `?${query}` : ''}`, { replace: true, state: location.state });
    }
  };
  const seriesId = Number(id);

  const [series, setSeries] = useState<VideoSeries | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editData, setEditData] = useState<{ title: string; description: string; poster: string; status: 'ongoing' | 'completed' }>({ title: '', description: '', poster: '', status: 'ongoing' });
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [seriesTags, setSeriesTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [creatingTag, setCreatingTag] = useState(false);
  const [showNewActorModal, setShowNewActorModal] = useState(false);
  const [allActors, setAllActors] = useState<Actor[]>([]);
  const [seriesActors, setSeriesActors] = useState<Actor[]>([]);
  const [selectedActorIds, setSelectedActorIds] = useState<number[]>([]);
  const [newActorName, setNewActorName] = useState('');
  const [actorNotice, setActorNotice] = useState('');
  // 使用后端返回的 poster_orientation 字段，不再动态检测
  const [episodeEditing, setEpisodeEditing] = useState(false);
  const [standaloneVideos, setStandaloneVideos] = useState<Video[]>([]);
  const [loadingStandalone, setLoadingStandalone] = useState(false);
  const { pendingKey, requestSecondConfirm } = useSecondConfirm();

  useEffect(() => {
    if (seriesId) {
      loadSeries();
    }
  }, [seriesId]);

  useEffect(() => {
    if (editFromUrl && series) {
      setEditing(true);
    }
  }, [editFromUrl, series]);

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
          status: seriesData.status === 'completed' ? 'completed' : 'ongoing',
        });
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
    const duplicated = allTags.find((tag) => tag.name.trim().toLowerCase() === name.toLowerCase());
    if (duplicated) {
      alert(`标签"${name}"已存在，不能重复添加。`);
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
      alert(`新建标签失败：${String(error)}`);
    }
  };

  const handleCreateActor = async () => {
    const name = newActorName.trim();
    if (!name) return;
    const duplicated = allActors.find((actor) => actor.name.trim().toLowerCase() === name.toLowerCase());
    if (duplicated) {
      setActorNotice(`演员"${name}"已存在，已为你选中该演员。`);
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
      alert(`新建演员失败：${String(error)}`);
    }
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
      await updateVideoSeries(series.id, title, editData.description, editData.poster, undefined, editData.status);
      await syncSeriesRelations();
      clearEditQuery();
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

  const handleToggleEpisodeEditing = async () => {
    if (episodeEditing) {
      setEpisodeEditing(false);
      setStandaloneVideos([]);
      return;
    }
    setEpisodeEditing(true);
    setLoadingStandalone(true);
    try {
      const standalone = await getStandaloneVideos();
      setStandaloneVideos(standalone);
    } catch (error) {
      console.error('加载单视频失败:', error);
    } finally {
      setLoadingStandalone(false);
    }
  };

  const handleAddStandaloneVideo = async (videoPath: string) => {
    try {
      await addVideoToSeries(seriesId, videoPath);
      await loadSeries();
      // 刷新单视频列表
      const standalone = await getStandaloneVideos();
      setStandaloneVideos(standalone);
    } catch (error) {
      console.error('添加分集失败:', error);
      alert('添加分集失败: ' + String(error));
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

  if (loading) return <div className="text-gray-500 flex items-center gap-2"><img src={loadingIcon} alt="加载中" className="w-6 h-6" /> 加载中...</div>;
  if (!series) return <div className="text-gray-500">视频集不存在</div>;

  return (
    <div>
      <div className="mb-6">
        <button type="button" onClick={handleBack} className="text-sm text-blue-600 hover:underline flex items-center gap-1">
          <img src={backIcon} alt="返回" className="w-4 h-4" /> {backLabel}
        </button>
      </div>

      <div className="card p-6 mb-8">
        <div className="flex gap-6">
          <div className="w-80 aspect-video bg-gray-100 rounded-xl overflow-hidden flex-shrink-0">
            <div
              className={`relative w-full h-full group ${editing ? 'cursor-pointer' : ''}`}
              onClick={editing ? handleSelectPoster : undefined}
            >
              <SmartPoster
                src={series.poster_data_url}
                alt={series.title}
                posterOrientation={series.poster_orientation}
              />
              {editing && (
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="bg-black/50 text-white text-xs px-3 py-1.5 rounded-full">点击更换海报</span>
                </div>
              )}
            </div>
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
                <select
                  value={editData.status}
                  onChange={(e) => setEditData({ ...editData, status: e.target.value as 'ongoing' | 'completed' })}
                  className="search-input"
                >
                  <option value="ongoing">连载中</option>
                  <option value="completed">已完结</option>
                </select>
                <textarea
                  value={editData.description}
                  onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                  className="search-input min-h-[120px]"
                  placeholder="简介"
                />
                <div>
                  <div className="text-sm font-medium text-gray-500 mb-2">标签</div>
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
                    <button
                      type="button"
                      onClick={() => setCreatingTag(true)}
                      className="px-3 py-1 rounded-full text-sm border border-dashed border-gray-300 text-gray-600 hover:bg-gray-50"
                    >
                      + 新建标签
                    </button>
                  </div>
                  {creatingTag && (
                    <div className="mt-3 flex gap-2">
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
                        className="search-input"
                        autoFocus
                      />
                      <button onClick={handleCreateTag} className="action-btn">完成</button>
                      <button
                        onClick={() => {
                          setCreatingTag(false);
                          setNewTagName('');
                        }}
                        className="action-btn"
                      >取消</button>
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-500 mb-2">演员</div>
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
                    <button
                      type="button"
                      onClick={() => setShowNewActorModal(true)}
                      className="px-3 py-1 rounded-full text-sm border border-dashed border-gray-300 text-gray-600 hover:bg-gray-50"
                    >
                      + 新建演员
                    </button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleSave} disabled={saving} className="action-btn action-btn-primary">保存</button>
                  <button onClick={() => { setEditing(false); clearEditQuery(); }} className="action-btn">取消</button>
                </div>
              </div>
            ) : (
              <>
                <h1 className="text-3xl font-bold mb-3">{series.title}</h1>
                <div className="mb-2">
                  <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${series.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                    {series.status === 'completed' ? '已完结' : '连载中'}
                  </span>
                </div>
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
                  <button onClick={handleToggleEpisodeEditing} className={`action-btn ${episodeEditing ? 'action-btn-primary' : ''}`}>{episodeEditing ? '完成编辑' : '编辑分集'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {episodeEditing && (
        <div className="card p-6 mb-8">
          <h3 className="text-lg font-semibold mb-4">编辑分集</h3>
          {videos.length > 0 ? (
            <div className="space-y-2 mb-6">
              {videos.map((video) => (
                <div key={video.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex-1 min-w-0 mr-4">
                    <span className="text-sm font-medium text-gray-900 truncate block">
                      {video.episode_number ? `第${video.episode_number}集 - ` : ''}{video.file_name}
                    </span>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => requestSecondConfirm(`remove-ep-${video.id}`, () => handleRemoveEpisode(video.id))}
                      className="action-btn text-xs"
                    >
                      {pendingKey === `remove-ep-${video.id}` ? '确认移出' : '移出'}
                    </button>
                    <button
                      onClick={() => requestSecondConfirm(`delete-ep-${video.id}`, () => handleDeleteEpisode(video.id))}
                      className="action-btn action-btn-danger text-xs"
                    >
                      {pendingKey === `delete-ep-${video.id}` ? '确认删除' : '删除'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-gray-500 text-sm mb-6">暂无分集</div>
          )}
          <div className="border-t pt-4">
            <div className="flex gap-3 mb-4">
              <button onClick={handleAddEpisode} className="action-btn">从文件添加</button>
            </div>
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">从单视频添加</h4>
              {loadingStandalone ? (
                <div className="text-gray-500 text-sm flex items-center gap-2"><img src={loadingIcon} alt="加载中" className="w-5 h-5" /> 加载中...</div>
              ) : standaloneVideos.length > 0 ? (
                <div className="max-h-60 overflow-y-auto space-y-1">
                  {standaloneVideos.map((sv) => (
                    <div key={sv.id} className="flex items-center justify-between p-2 hover:bg-gray-50 rounded-lg">
                      <span className="text-sm text-gray-900 truncate mr-4">{sv.file_name}</span>
                      <button
                        onClick={() => handleAddStandaloneVideo(sv.file_path)}
                        className="action-btn text-xs flex-shrink-0"
                      >
                        添加
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-gray-500 text-sm">暂无可添加的单视频</div>
              )}
            </div>
          </div>
        </div>
      )}

      <h2 className="text-xl font-semibold mb-4">分集</h2>
      {videos.length > 0 ? (
        <VideoGrid
          videos={videos}
          posterOrientation={series?.poster_orientation || 'unknown'}
        />
      ) : (
        <div className="text-gray-500 py-10 text-center">暂无分集</div>
      )}

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
              <p className="mt-2 text-sm text-gray-500">新建后会自动选中，保存视频集详情时同步关联。</p>
            </div>
            <div className="px-6 py-5">
              <label className="block text-sm font-medium text-gray-700 mb-2">姓名 *</label>
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

/** 获取季标题 */
function getSeasonLabel(season: number): string {
  if (season === 999) return '剧场版';
  if (season >= 1 && season <= 998) return `第${season}季`;
  return `第${season}季`;
}

interface VideoGridProps {
  videos: Video[];
  posterOrientation: string;
}

const VideoGrid: React.FC<VideoGridProps> = ({
  videos,
  posterOrientation,
}) => {
  // 判断是否有任何视频设置了 season（非 0）
  const hasSeason = useMemo(
    () => videos.some((v) => v.season != null && v.season !== 0),
    [videos]
  );

  // 按 season 分组并排序
  const seasonGroups = useMemo(() => {
    if (!hasSeason) return [];
    const map = new Map<number, Video[]>();
    for (const v of videos) {
      const s = v.season ?? 0;
      if (!map.has(s)) map.set(s, []);
      map.get(s)!.push(v);
    }
    const entries = Array.from(map.entries());
    // 排序：普通季（1,2,3...）在前，999 在最后
    entries.sort(([a], [b]) => {
      if (a === 999 && b !== 999) return 1;
      if (b === 999 && a !== 999) return -1;
      return a - b;
    });
    return entries;
  }, [videos, hasSeason]);

  const gridClass = 'grid grid-cols-4 md:grid-cols-5 gap-5 auto-rows-max';

  /** 渲染单个视频卡片 */
  const renderVideoCard = (video: Video) => {
    const poster = videoPosterDataUrl(video);
    return (
      <Link key={video.id} to={`/player/${video.id}`} className="card block cursor-pointer">
        <div
          className={`${
            posterOrientation === 'portrait' ? 'aspect-[2/3]' : 'aspect-video'
          } bg-gray-100 overflow-hidden relative`}
        >
          <SmartPoster src={poster} alt={video.file_name} posterOrientation={posterOrientation} />
        </div>
        <div className="p-2">
          <h3 className="font-medium text-xs line-clamp-1 mb-1">
            {video.episode_number ? `第${video.episode_number}集` : video.file_name}
          </h3>
          {video.episode_number && (
            <p className="text-[11px] text-gray-400 truncate">{video.file_name}</p>
          )}
        </div>
      </Link>
    );
  };

  // 无 season 信息时保持原有扁平展示
  if (!hasSeason) {
    return (
      <div className={gridClass}>
        {videos.map((video) => renderVideoCard(video))}
      </div>
    );
  }

  // 按季分组展示
  return (
    <div className="space-y-8">
      {seasonGroups.map(([season, groupVideos]) => (
        <div key={season}>
          <h3 className="text-xl font-semibold mb-4">{getSeasonLabel(season)}</h3>
          <div className={gridClass}>
            {groupVideos.map((video) => renderVideoCard(video))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default SeriesDetail;
