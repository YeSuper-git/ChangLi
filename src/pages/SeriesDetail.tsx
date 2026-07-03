import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { open } from '@tauri-apps/plugin-dialog';
import backIcon from '../assets/icons/back.svg';
import loadingIcon from '../assets/icons/loading.svg';
import favoriteIcon from '../assets/icons/favorite.svg';
import notFavoriteIcon from '../assets/icons/not-favorite.svg';
import watchedIcon from '../assets/icons/watched.svg';
import translateIcon from '../assets/icons/translate.svg';

import {
  addActor,
  addSeriesActor,
  addSeriesTag,
  addTag,
  deleteVideo,
  deleteSeason,
  getActors,
  getSeriesActors,
  getSeriesSeasons,
  getSeriesTags,
  getSeriesPlaybackVideo,
  openPlayerWindow,
  getTags,
  getVideoSeriesDetail,
  getMissingSeriesVideos,
  removeSeriesActor,
  removeSeriesTag,
  removeVideoFromSeries,
  saveVideoThumbnail,
  updateVideoSeries,
  toggleWatched,
  toggleChineseSub,
  getAllCategories,
  formatSeriesWatchLabel,
  rescanSingleSeriesMetadata,
  parseCategoryFeatures,
} from '../utils/api';
import type { Actor, SeasonInfo, Tag, Video, VideoSeries, Category, CategoryFeatures } from '../utils/api';
import { SmartPoster, videoPosterDataUrl } from '../utils/media';
import { useSecondConfirm } from '../utils/useSecondConfirm';
import { useLibraryStore } from '../store/libraryStore';
import ConfirmDialog from '../components/ConfirmDialog';
import { notify } from '../utils/notify';

interface SeriesDetailCacheEntry {
  series: VideoSeries | null;
  videos: Video[];
  seriesTags: Tag[];
  seriesActors: Actor[];
}

const seriesDetailCache = new Map<number, SeriesDetailCacheEntry>();

function toEditData(series: VideoSeries) {
  return {
    title: series.title,
    description: series.description || '',
    poster: series.poster || '',
    status: series.status === 'completed' ? 'completed' as const : 'ongoing' as const,
    code: series.code || '',
    has_chinese_sub: series.has_chinese_sub === 1,
  };
}

function extractCode(folderName: string): { code: string; hasChineseSub: boolean } {
  const match = folderName.match(/[A-Za-z]+-\d+[A-Za-z]*/);
  if (!match) return { code: '', hasChineseSub: false };

  let raw = match[0];
  let hasChineseSub = false;

  // 检查末尾 ch/CH/Ch/cH
  if (/[cC][hH]$/.test(raw)) {
    raw = raw.slice(0, -2);
    hasChineseSub = true;
  }
  // 检查末尾 C/c
  else if (/[cC]$/.test(raw)) {
    raw = raw.slice(0, -1);
    hasChineseSub = true;
  }

  return { code: raw.toUpperCase(), hasChineseSub };
}

const SeriesDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { favorites, toggleFavorite, refreshSeries, tags: cachedTags, actors: cachedActors } = useLibraryStore();
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
  const routeState = location.state as { from?: string; backLabel?: string; filterSearch?: string; seriesSnapshot?: VideoSeries } | null;
  const cachedDetail = Number.isFinite(seriesId) ? seriesDetailCache.get(seriesId) : undefined;
  const initialSeries = cachedDetail?.series || routeState?.seriesSnapshot || null;

  const [series, setSeries] = useState<VideoSeries | null>(initialSeries);
  const [videos, setVideos] = useState<Video[]>(cachedDetail?.videos || []);
  const [loading, setLoading] = useState(!initialSeries);
  const [refreshing, setRefreshing] = useState(Boolean(initialSeries));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [userTouchedSub, setUserTouchedSub] = useState(false);
  const [editData, setEditData] = useState<{ title: string; description: string; poster: string; status: 'ongoing' | 'completed'; code: string; has_chinese_sub: boolean }>({ title: '', description: '', poster: '', status: 'ongoing', code: '', has_chinese_sub: false });
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [seriesTags, setSeriesTags] = useState<Tag[]>(cachedDetail?.seriesTags || []);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>(cachedDetail?.seriesTags.map((tag) => tag.id) || []);
  const [newTagName, setNewTagName] = useState('');
  const [creatingTag, setCreatingTag] = useState(false);
  const [showNewActorModal, setShowNewActorModal] = useState(false);
  const [allActors, setAllActors] = useState<Actor[]>([]);
  const [seriesActors, setSeriesActors] = useState<Actor[]>(cachedDetail?.seriesActors || []);
  const [selectedActorIds, setSelectedActorIds] = useState<number[]>(cachedDetail?.seriesActors.map((actor) => actor.id) || []);
  const [newActorName, setNewActorName] = useState('');
  const [actorNotice, setActorNotice] = useState('');
  const [editOptionsLoaded, setEditOptionsLoaded] = useState(false);
  // 使用后端返回的 poster_orientation 字段，不再动态检测
  const { pendingKey, requestSecondConfirm, clearPending } = useSecondConfirm();
  // 右键菜单
  const [contextMenu, setContextMenu] = useState<{ videoId: number; videoName: string; x: number; y: number } | null>(null);
  // 管理季
  const [showSeasonManager, setShowSeasonManager] = useState(false);
  const [seasons, setSeasons] = useState<SeasonInfo[]>([]);
  const [loadingSeasons, setLoadingSeasons] = useState(false);
  const [missingVideos, setMissingVideos] = useState<Video[]>([]);
  const [seasonDeleteConfirm, setSeasonDeleteConfirm] = useState<{ season: number; label: string; videoCount: number } | null>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
    setEditOptionsLoaded(false);
    const nextCached = Number.isFinite(seriesId) ? seriesDetailCache.get(seriesId) : undefined;
    const nextSeries = nextCached?.series || routeState?.seriesSnapshot || null;
    setSeries(nextSeries);
    setVideos(nextCached?.videos || []);
    setSeriesTags(nextCached?.seriesTags || []);
    setSeriesActors(nextCached?.seriesActors || []);
    setSelectedTagIds(nextCached?.seriesTags.map((tag) => tag.id) || []);
    setSelectedActorIds(nextCached?.seriesActors.map((actor) => actor.id) || []);
    if (nextSeries) {
      setEditData(toEditData(nextSeries));
    }
    setLoading(!nextSeries);
    if (seriesId) {
      loadSeries({ silent: Boolean(nextSeries) });
    }
  }, [seriesId]);

  useEffect(() => {
    if (editFromUrl && series) {
      setEditing(true);
    }
  }, [editFromUrl, series]);

  // 编辑模式打开时自动识别车牌
  useEffect(() => {
    if (userTouchedSub) return;
    if (editing && series && !editData.code) {
      const source = series.folder_path || series.title;
      const { code, hasChineseSub } = extractCode(source);
      if (code) {
        setEditData((prev) => ({ ...prev, code, has_chinese_sub: hasChineseSub }));
      }
    }
  }, [editing, series, editData.code, userTouchedSub]);

  // 点击空白关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => { setContextMenu(null); clearPending(); };
    window.addEventListener('click', close);
    return () => {
      window.removeEventListener('click', close);
    };
  }, [contextMenu, clearPending]);

  const loadSeries = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!seriesId) return;
    if (!options.silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [[seriesData, seriesVideos], selectedTags, selectedActors] = await Promise.all([
        getVideoSeriesDetail(seriesId),
        getSeriesTags(seriesId),
        getSeriesActors(seriesId),
      ]);
      setSeries(seriesData);
      setVideos(seriesVideos);
      setSeriesTags(selectedTags);
      setSeriesActors(selectedActors);
      setSelectedTagIds(selectedTags.map((tag) => tag.id));
      setSelectedActorIds(selectedActors.map((actor) => actor.id));
      if (seriesData) {
        setEditData(toEditData(seriesData));
      }
      seriesDetailCache.set(seriesId, { series: seriesData, videos: seriesVideos, seriesTags: selectedTags, seriesActors: selectedActors });
    } catch (error) {
      console.error('加载视频集失败:', error);
      notify({ message: '加载视频集失败: ' + String(error), type: 'error' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [seriesId]);

  const loadEditOptions = useCallback(async () => {
    if (editOptionsLoaded) return;
    if (cachedTags.length > 0) setAllTags(cachedTags);
    if (cachedActors.length > 0) setAllActors(cachedActors);
    try {
      const [tags, actors] = await Promise.all([
        cachedTags.length > 0 ? Promise.resolve(cachedTags) : getTags(),
        cachedActors.length > 0 ? Promise.resolve(cachedActors) : getActors(),
      ]);
      setAllTags(tags);
      setAllActors(actors);
      setEditOptionsLoaded(true);
    } catch (error) {
      console.error('加载编辑选项失败:', error);
      notify({ message: '加载编辑选项失败: ' + String(error), type: 'error' });
    }
  }, [cachedActors, cachedTags, editOptionsLoaded]);

  useEffect(() => {
    if (editing) {
      loadEditOptions();
    }
  }, [editing, loadEditOptions]);

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
      notify({ message: `标签"${name}"已存在，不能重复添加。`, type: 'info' });
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
      notify({ message: `新建演员失败：${String(error)}`, type: 'error' });
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
      notify({ message: '标题不能为空', type: 'info' });
      return;
    }
    setSaving(true);
    try {
      console.log('[Save] has_chinese_sub:', editData.has_chinese_sub, '→ sending:', editData.has_chinese_sub ? 1 : 0);
      const result = await updateVideoSeries(series.id, title, editData.description, editData.poster, undefined, editData.status, editData.code || undefined, editData.has_chinese_sub ? 1 : 0);
      console.log('[Save] returned has_chinese_sub:', result.has_chinese_sub);
      await syncSeriesRelations();
      clearEditQuery(); setUserTouchedSub(false);
      setEditing(false);
      await loadSeries();
    } catch (error) {
      console.error('保存视频集失败:', error);
      notify({ message: '保存失败: ' + String(error), type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveEpisode = async (videoId: number) => {
    try {
      await removeVideoFromSeries(videoId);
      setContextMenu(null);
      await loadSeries();
    } catch (error) {
      console.error('移除分集失败:', error);
      notify({ message: '移除失败: ' + String(error), type: 'error' });
    }
  };

  const handleDeleteEpisode = async (videoId: number) => {
    try {
      await deleteVideo(videoId);
      setContextMenu(null);
      await loadSeries();
    } catch (error) {
      console.error('删除分集失败:', error);
      notify({ message: '删除失败: ' + String(error), type: 'error' });
    }
  };

  // 管理季
  const handleOpenSeasonManager = async () => {
    setShowSeasonManager(true);
    setLoadingSeasons(true);
    try {
      const data = await getSeriesSeasons(seriesId);
      setSeasons(data);
    } catch (error) {
      console.error('加载季信息失败:', error);
    } finally {
      setLoadingSeasons(false);
    }
  };

  const handleDeleteSeason = async (season: number) => {
    try {
      await deleteSeason(seriesId, season);
      const data = await getSeriesSeasons(seriesId);
      setSeasons(data);
      await loadSeries();
    } catch (error) {
      console.error('删除季失败:', error);
      notify({ message: '删除季失败: ' + String(error), type: 'error' });
    }
  };

  const backState = routeState;
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

  // 大类配置
  const [categories, setCategories] = useState<Category[]>([]);
  useEffect(() => {
    getAllCategories()
      .then(setCategories)
      .catch((err) => console.error('[SeriesDetail] 加载大类配置失败:', err));
  }, []);

  const currentCategory = useMemo(() => {
    if (!series) return null;
    return categories.find(c => c.key === series.display_type) || null;
  }, [categories, series]);

  const isAdult = series ? (series.has_actor || series.display_type === 'adult') : false;

  const features: CategoryFeatures = useMemo(() => {
    if (currentCategory) return parseCategoryFeatures(currentCategory.features);
    // fallback: 和原 isAdult 行为一致
    return {
      tags: !isAdult,
      actors: isAdult,
      tracking: !isAdult,
      chinese_sub: isAdult,
      episode: !isAdult ? '话' : '部',
    };
  }, [currentCategory, isAdult]);

  const isPortrait = currentCategory ? currentCategory.card_layout === 'portrait' : !isAdult;

  if (loading && !series) return <div className="flex items-center justify-center min-h-screen"><div className="text-gray-500 flex items-center gap-2"><img src={loadingIcon} alt="加载中" className="w-6 h-6 animate-spin" /></div></div>;
  if (!series) return <div className="text-gray-500">视频集不存在</div>;

  const isFavorite = series ? favorites.some(f => 'video_count' in f && f.id === series.id) : false;
  const isWatched = series?.is_watched === 1;
  const epWord = features.episode || '部';
  const lastWatchedEpisode = series.last_watched_episode || 0;
  const watchProgressLabel = formatSeriesWatchLabel(series, epWord);
  const progressReminder = lastWatchedEpisode > 0
    ? `上次观看到${watchProgressLabel.replace(/^看到/, '')}`
    : '';
  const orderedVideos = [...videos].sort((a, b) => {
    const seasonA = a.season ?? 0;
    const seasonB = b.season ?? 0;
    if (seasonA !== seasonB) return seasonA - seasonB;
    const episodeA = a.episode_number ?? Number.MAX_SAFE_INTEGER;
    const episodeB = b.episode_number ?? Number.MAX_SAFE_INTEGER;
    if (episodeA !== episodeB) return episodeA - episodeB;
    return a.file_name.localeCompare(b.file_name);
  });
  const hasWatchProgress = !isWatched && lastWatchedEpisode > 0;
  const playButtonLabel = hasWatchProgress ? '继续观看' : '立即观看';
  const playButtonHint = hasWatchProgress
    ? progressReminder
    : orderedVideos.length > 0
      ? '尚未观看'
      : '暂无可播放分集';
  const episodeCountLabel = series.status === 'completed' || !features.tracking
    ? `全 ${series.video_count} ${epWord}`
    : `更新至第 ${series.video_count} ${epWord}`;

  const handlePrimaryPlay = async () => {
    if (!series || orderedVideos.length === 0) return;
    try {
      const target = hasWatchProgress
        ? await getSeriesPlaybackVideo(series.id)
        : orderedVideos[0];
      if (target) await openPlayerWindow(target.id);
    } catch (error) {
      console.error('[SeriesDetail] 播放入口失败:', error);
      notify({ message: '打开播放失败: ' + String(error), type: 'error' });
    }
  };

  const handleToggleWatched = async () => {
    if (!series) return;
    try {
      await toggleWatched(series.id);
      setSeries(prev => prev ? { ...prev, is_watched: prev.is_watched === 1 ? 0 : 1 } : prev);
    } catch (error) {
      console.error('切换已看完状态失败:', error);
    }
  };

  const handleToggleChineseSub = async () => {
    if (!series) return;
    try {
      await toggleChineseSub(series.id);
      setSeries(prev => prev ? { ...prev, has_chinese_sub: prev.has_chinese_sub === 1 ? 0 : 1 } : prev);
      await refreshSeries();
    } catch (error) {
      console.error('切换中文字幕状态失败:', error);
    }
  };

  const handleCheckUpdates = async () => {
    if (!series) return;
    try {
      const matched = await rescanSingleSeriesMetadata(series.id);
      const missing = await getMissingSeriesVideos(series.id);
      seriesDetailCache.delete(series.id);
      await loadSeries();
      await refreshSeries();
      if (missing.length > 0) {
        setMissingVideos(missing);
        notify({ message: `发现 ${missing.length} 个本地已不存在的分集`, type: 'info' });
      } else {
        notify({ message: matched ? '元数据更新成功' : '未匹配到格式，未更新', type: matched ? 'success' : 'info' });
      }
    } catch (error) {
      console.error('[SeriesDetail] 检查更新失败:', error);
      notify({ message: '检查更新失败: ' + String(error), type: 'error' });
    }
  };

  const handleDeleteMissingVideos = async () => {
    if (missingVideos.length === 0) return;
    try {
      for (const video of missingVideos) {
        await deleteVideo(video.id);
      }
      setMissingVideos([]);
      seriesDetailCache.delete(seriesId);
      await loadSeries();
      await refreshSeries();
      notify({ message: '已删除本地不存在的分集记录', type: 'success' });
    } catch (error) {
      console.error('[SeriesDetail] 删除缺失分集失败:', error);
      notify({ message: '删除缺失分集失败: ' + String(error), type: 'error' });
    }
  };

  return (
    <div className="changli-page">
      {refreshing && (
        <div className="fixed right-6 top-20 z-40 rounded-full border border-gray-200 bg-white/90 px-3 py-1 text-xs font-medium text-gray-500 shadow-sm">同步中</div>
      )}
      <div className="mb-6">
        <button type="button" onClick={handleBack} className="changli-back-link">
          <span className="changli-back-icon"><img src={backIcon} alt="返回" /></span>
          <span>{backLabel}</span>
        </button>
      </div>

      <div className="changli-detail-hero changli-panel p-6 mb-8">
        <div className="flex gap-6">
          <div className={`w-80 bg-gray-100 rounded-2xl overflow-hidden flex-shrink-0 shadow-sm ring-1 ring-black/5 ${editing && !isPortrait ? 'h-80' : 'aspect-video'}`}>
            <div
              className={`relative w-full h-full group ${editing ? 'cursor-pointer' : ''}`}
              onClick={editing ? handleSelectPoster : undefined}
            >
              <SmartPoster
                src={series.poster_data_url}
                alt={series.title}
                posterOrientation={series.poster_orientation}
                imageClassName={editing && !isPortrait ? '!object-contain' : ''}
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
                {features.actors ? (
                  <>
                    {series?.has_actor && (
                      <>
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
                                  className={`px-3 py-1 rounded-full text-sm font-semibold border transition-colors ${selected ? 'bg-gradient-to-r from-[#fb5b7b] to-[#ff8a4c] border-transparent text-white shadow-sm' : 'bg-white border-gray-200 text-gray-500 hover:border-rose-200 hover:bg-rose-50/60 hover:text-rose-600'}`}
                                >
                                  {actor.name}
                                </button>
                              );
                            })}
                            <button
                              type="button"
                              onClick={() => setShowNewActorModal(true)}
                              className="px-3 py-1 rounded-full text-sm font-semibold border border-dashed border-rose-200 text-rose-500 bg-white hover:bg-rose-50/70"
                            >
                              + 新建演员
                            </button>
                          </div>
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-500 mb-2">车牌</div>
                          <input
                            type="text"
                            value={editData.code}
                            onChange={(e) => setEditData({ ...editData, code: e.target.value.toUpperCase() })}
                            className="search-input"
                            placeholder="如 JJK-098"
                            style={{ textTransform: 'uppercase' }}
                          />
                        </div>
                      </>
                    )}
                    <textarea
                      value={editData.description}
                      onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                      className="search-input min-h-[120px]"
                      placeholder="简介"
                    />
                  </>
                ) : (
                  <div>
                    <div className="text-sm font-medium text-gray-500 mb-2">追番状态</div>
                    <div className="changli-status-switch" role="group" aria-label="追番状态">
                      <button
                        type="button"
                        onClick={() => setEditData({ ...editData, status: 'ongoing' })}
                        className={editData.status !== 'completed' ? 'active' : ''}
                      >连载中</button>
                      <button
                        type="button"
                        onClick={() => setEditData({ ...editData, status: 'completed' })}
                        className={editData.status === 'completed' ? 'active' : ''}
                      >已完结</button>
                    </div>
                  </div>
                )}
                {features.tags && (
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
                            className={`px-3 py-1 rounded-full text-sm font-semibold border transition-colors ${selected ? 'bg-gradient-to-r from-[#fb5b7b] to-[#ff8a4c] border-transparent text-white shadow-sm' : 'bg-white border-gray-200 text-gray-500 hover:border-rose-200 hover:bg-rose-50/60 hover:text-rose-600'}`}
                          >
                            {tag.name}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => setCreatingTag(true)}
                        className="px-3 py-1 rounded-full text-sm font-semibold border border-dashed border-rose-200 text-rose-500 bg-white hover:bg-rose-50/70"
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
                )}
                {features.tags && (
                  <textarea
                    value={editData.description}
                    onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                    className="search-input min-h-[120px]"
                    placeholder="简介"
                  />
                )}
                <div className="flex gap-2">
                  <button onClick={handleSave} disabled={saving} className="action-btn action-btn-primary">保存</button>
                  <button onClick={() => { setEditing(false); clearEditQuery(); setUserTouchedSub(false); }} className="action-btn">取消</button>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-3 flex items-start justify-between gap-5">
                  <div className="min-w-0 flex-1">
                    <h1 className="changli-heading-lg mb-3 line-clamp-2" title={series.title}>{series.title}</h1>
                    <div className="flex flex-wrap items-center gap-2">
                      {features.chinese_sub && (
                        <button
                          onClick={handleToggleChineseSub}
                          className="flex items-center gap-1 px-3 py-1 rounded-full text-sm transition-all hover:bg-gray-100"
                        >
                          <img
                            src={translateIcon}
                            alt="中文字幕"
                            className={`w-5 h-5 ${series.has_chinese_sub === 1 ? 'filter-red' : 'text-gray-400'}`}
                            style={series.has_chinese_sub === 1 ? { filter: 'invert(42%) sepia(88%) saturate(1621%) hue-rotate(315deg) brightness(98%) contrast(98%)' } : {}}
                          />
                          <span className={series.has_chinese_sub === 1 ? 'text-rose-500' : 'text-gray-400'}>中字</span>
                        </button>
                      )}
                      <button
                        onClick={() => toggleFavorite(series.id, 'series')}
                        className="flex items-center gap-1 px-3 py-1 rounded-full text-sm transition-all hover:bg-gray-100"
                      >
                        <img src={isFavorite ? favoriteIcon : notFavoriteIcon} alt="追番" className={`w-5 h-5 ${isFavorite ? 'filter-red' : 'text-gray-400'}`} />
                        <span className={isFavorite ? 'text-red-500' : 'text-gray-400'}>{isFavorite ? '已追番' : '追番'}</span>
                      </button>
                      <button
                        onClick={handleToggleWatched}
                        className="flex items-center gap-1 px-3 py-1 rounded-full text-sm transition-all hover:bg-gray-100"
                      >
                        <img src={watchedIcon} alt="已看完" className={`w-5 h-5 ${isWatched ? 'filter-gold' : 'text-gray-400'}`} />
                        <span className={isWatched ? 'text-yellow-600' : 'text-gray-400'}>{isWatched ? '已看完' : '看完'}</span>
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${series.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-rose-50 text-rose-700'}`}>
                        {series.status === 'completed' ? '已完结' : '连载中'}
                      </span>
                      <span className="inline-block px-2.5 py-0.5 rounded-full bg-gray-100 text-xs font-medium text-gray-600">{episodeCountLabel}</span>
                    </div>
                  </div>
                </div>
                {series.description && <p className="text-gray-700 whitespace-pre-wrap mb-4">{series.description}</p>}
                <div className="mb-4 space-y-3">
                  {features.tags && (
                    <div>
                      <span className="text-sm font-medium text-gray-500 mr-2">标签：</span>
                      {seriesTags.length > 0 ? seriesTags.map((tag) => (
                        <span key={tag.id} className="inline-block mr-2 mb-2 px-3 py-1 bg-gray-100 rounded-full text-sm text-gray-700">{tag.name}</span>
                      )) : <span className="text-sm text-gray-400">暂无</span>}
                    </div>
                  )}
                  {features.actors && (
                    <div>
                      <span className="text-sm font-medium text-gray-500 mr-2">演员：</span>
                      {seriesActors.length > 0 ? seriesActors.map((actor) => (
                        <Link
                          key={actor.id}
                          to={`/actors/${actor.id}`}
                          state={{ from: `/series/${series.id}`, backLabel: '返回视频集详情' }}
                          className="inline-block mr-2 mb-2 px-3 py-1 bg-gray-100 rounded-full text-sm text-gray-700 hover:text-rose-600"
                        >
                          {actor.name}
                        </Link>
                      )) : <span className="text-sm text-gray-400">暂无</span>}
                    </div>
                  )}
                  {features.actors && series.code && (
                    <div>
                      <span className="text-sm font-medium text-gray-500 mr-2">车牌：</span>
                      <span className="inline-block mr-2 mb-2 px-3 py-1 bg-gray-100 rounded-full text-sm text-gray-700 font-mono">{series.code}</span>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handlePrimaryPlay}
                    disabled={orderedVideos.length === 0}
                    className="group flex min-w-[184px] items-center justify-between gap-3 rounded-2xl border border-transparent bg-gradient-to-r from-[#fb5b7b] to-[#ff8a4c] px-4 py-3 text-left text-white shadow-[0_14px_30px_rgba(251,91,123,0.20)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_38px_rgba(251,91,123,0.26)] disabled:cursor-not-allowed disabled:border-gray-100 disabled:bg-none disabled:bg-gray-100 disabled:text-gray-400 disabled:shadow-none disabled:hover:translate-y-0"
                    title={playButtonHint}
                  >
                    <span>
                      <span className="block text-sm font-extrabold leading-none">{playButtonLabel}</span>
                      <span className="mt-1 block max-w-[116px] truncate text-[11px] font-semibold text-white/80 group-disabled:text-gray-400">{playButtonHint}</span>
                    </span>
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-base font-black shadow-[inset_0_1px_0_rgba(255,255,255,0.28)] transition-transform duration-200 group-hover:translate-x-0.5 group-disabled:bg-white/60 group-disabled:text-gray-400">▶</span>
                  </button>
                  <button onClick={() => setEditing(true)} className="action-btn">编辑信息</button>
                  <button onClick={handleOpenSeasonManager} className="action-btn">管理季</button>
                  <button onClick={handleCheckUpdates} className="action-btn">检查更新</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="changli-section-title">
        <h2 className="text-xl font-semibold">{features.episode === '话' || features.episode === '集' ? '分集' : '分部'}</h2>
        <span className="changli-soft-chip">{videos.length} {features.episode || '部'}</span>
      </div>
      {videos.length > 0 ? (
        <VideoGrid
          videos={videos}
          posterOrientation={series?.poster_orientation || 'unknown'}
          onContextMenu={(videoId, videoName, x, y) => setContextMenu({ videoId, videoName, x, y })}
          episodeWord={features.episode || '部'}
          fallbackPoster={series?.poster_data_url}
        />
      ) : (
        <div className="changli-empty-state text-gray-500">暂无分集</div>
      )}

      {/* 右键菜单 */}
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
            className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100"
            onClick={() => {
              requestSecondConfirm(`remove-${contextMenu.videoId}`, () => handleRemoveEpisode(contextMenu.videoId));
            }}
          >
            {pendingKey === `remove-${contextMenu.videoId}` ? '确认移出' : '移出视频集'}
          </button>
          <button
            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
            onClick={() => {
              requestSecondConfirm(`delete-${contextMenu.videoId}`, () => handleDeleteEpisode(contextMenu.videoId));
            }}
          >
            {pendingKey === `delete-${contextMenu.videoId}` ? '确认删除' : '删除视频'}
          </button>
        </div>
      )}


      {missingVideos.length > 0 && (
        <div className="changli-modal-backdrop">
          <div className="changli-modal-panel !w-[min(100%,560px)] !p-0">
            <div className="changli-modal-header">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-500">检查更新</p>
              <h2 className="mt-1 text-2xl font-bold text-gray-900">发现本地已不存在的分集</h2>
              <p className="mt-2 text-sm text-gray-500">下面这些分集的文件已经不在磁盘上。确认后只删除应用内记录，不会删除其他文件。</p>
            </div>
            <div className="changli-modal-body max-h-80 overflow-y-auto">
              <div className="space-y-2">
                {missingVideos.map((video) => (
                  <div key={video.id} className="rounded-2xl border border-gray-100 bg-[#f8f9fc] p-3">
                    <div className="text-sm font-semibold text-gray-900">{video.episode_number ? `第${video.episode_number}${epWord}` : video.file_name}</div>
                    <div className="mt-1 break-all text-xs text-gray-400">{video.file_path}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="changli-modal-footer">
              <button onClick={() => setMissingVideos([])} className="action-btn flex-1">先不删除</button>
              <button onClick={handleDeleteMissingVideos} className="action-btn action-btn-danger flex-1">确认删除记录</button>
            </div>
          </div>
        </div>
      )}

      {/* 管理季面板 */}
      {showSeasonManager && (
        <div className="changli-modal-backdrop">
          <div className="changli-modal-panel !w-[min(100%,540px)] !p-0">
            <div className="changli-modal-header">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-500">管理</p>
              <h2 className="mt-1 text-2xl font-bold text-gray-900">季管理</h2>
            </div>
            <div className="changli-modal-body max-h-96 overflow-y-auto">
              {loadingSeasons ? (
                <div className="text-gray-500 text-sm flex items-center gap-2 py-4">
                  <img src={loadingIcon} alt="加载中" className="w-5 h-5 animate-spin" />
                </div>
              ) : seasons.length > 0 ? (
                <div className="space-y-3">
                  {seasons.map((s) => (
                    <div key={`${s.season}-${s.subtitle || ''}`} className="flex items-center justify-between rounded-2xl border border-gray-100 bg-[#f8f9fc] p-3">
                      <div>
                        <span className="text-sm font-medium text-gray-900">
                          {s.season === 999 ? (s.subtitle || '剧场版') : `第${s.season}季`}
                        </span>
                        {s.season === 999 && s.subtitle && (
                          <span className="ml-2 text-xs text-gray-400">(剧场版)</span>
                        )}
                        <span className="ml-3 text-xs text-gray-500">{s.video_count} 个视频</span>
                      </div>
                      <button
                        onClick={() => {
                          const label = s.season === 999 ? (s.subtitle || '剧场版') : `第${s.season}季`;
                          setSeasonDeleteConfirm({ season: s.season, label, videoCount: s.video_count });
                        }}
                        className="action-btn action-btn-danger text-xs"
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-gray-500 text-sm py-4">暂无季信息</div>
              )}
            </div>
            <div className="changli-modal-footer">
              <button
                onClick={() => setShowSeasonManager(false)}
                className="action-btn flex-1"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!seasonDeleteConfirm}
        title="删除季"
        message={seasonDeleteConfirm ? `确定要删除「${seasonDeleteConfirm.label}」吗？该季下所有 ${seasonDeleteConfirm.videoCount} 个视频将被删除。` : ''}
        confirmText="确认删除"
        danger
        onConfirm={() => {
          if (!seasonDeleteConfirm) return;
          handleDeleteSeason(seasonDeleteConfirm.season);
          setSeasonDeleteConfirm(null);
        }}
        onCancel={() => setSeasonDeleteConfirm(null)}
      />

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
        <div className="changli-modal-backdrop">
          <div className="changli-modal-panel !w-[min(100%,448px)] !p-0">
            <div className="changli-modal-header">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-500">演员资料</p>
              <h2 className="mt-1 text-2xl font-bold text-gray-900">新建演员</h2>
              <p className="mt-2 text-sm text-gray-500">新建后会自动选中，保存视频集详情时同步关联。</p>
            </div>
            <div className="changli-modal-body">
              <label className="changli-form-label">姓名</label>
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
                className="changli-input"
                placeholder="输入演员姓名"
                autoFocus
              />
              <p className="text-xs text-gray-400 mt-2">新建后会自动选中，稍后可去演员中补充海报和详细信息。</p>
            </div>
            <div className="changli-modal-footer">
              <button
                onClick={() => {
                  setShowNewActorModal(false);
                  setNewActorName('');
                }}
                className="action-btn flex-1"
              >
                取消
              </button>
              <button
                onClick={handleCreateActor}
                className="action-btn action-btn-primary flex-1"
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
function getSeasonLabel(season: number, subtitle?: string): string {
  if (season === 999) return subtitle || '剧场版';
  if (season >= 1 && season <= 998) return `第${season}季`;
  return `第${season}季`;
}

interface VideoGridProps {
  videos: Video[];
  posterOrientation: string;
  onContextMenu?: (videoId: number, videoName: string, x: number, y: number) => void;
  episodeWord?: string;
  fallbackPoster?: string | null;
}

const VideoGrid: React.FC<VideoGridProps> = ({
  videos,
  posterOrientation,
  onContextMenu,
  episodeWord: epWord,
  fallbackPoster,
}) => {
  // 判断是否有任何视频设置了 season（非 0）
  const hasSeason = useMemo(
    () => videos.some((v) => v.season != null && v.season !== 0),
    [videos]
  );

  // 按 season 分组并排序
  const seasonGroups = useMemo(() => {
    if (!hasSeason) return [];
    // 对于 season=999（剧场版），按 subtitle 再分组
    const map = new Map<string, { season: number; subtitle?: string; videos: Video[] }>();
    for (const v of videos) {
      const s = v.season ?? 0;
      if (s === 999) {
        // 剧场版按 subtitle 分组
        const key = `999-${v.subtitle || ''}`;
        if (!map.has(key)) map.set(key, { season: 999, subtitle: v.subtitle, videos: [] });
        map.get(key)!.videos.push(v);
      } else {
        const key = `${s}`;
        if (!map.has(key)) map.set(key, { season: s, videos: [] });
        map.get(key)!.videos.push(v);
      }
    }
    const entries = Array.from(map.entries());
    // 排序：普通季（1,2,3...）在前，999 在最后
    entries.sort(([, a], [, b]) => {
      if (a.season === 999 && b.season !== 999) return 1;
      if (b.season === 999 && a.season !== 999) return -1;
      return a.season - b.season;
    });
    return entries;
  }, [videos, hasSeason]);

  
  const gridClass = 'grid grid-cols-4 md:grid-cols-5 gap-5 auto-rows-max';

  /** 渲染单个视频卡片 */
  const renderVideoCard = (video: Video) => {
    const poster = videoPosterDataUrl(video) || fallbackPoster;
    return (
      <button
        key={video.id}
        type="button"
        className="card block w-full cursor-pointer overflow-hidden text-left"
        onClick={() => openPlayerWindow(video.id).catch((error) => notify({ message: '打开播放失败: ' + String(error), type: 'error' }))}
        onContextMenu={(e) => {
          if (onContextMenu) {
            e.preventDefault();
            onContextMenu(video.id, video.file_name, e.clientX, e.clientY);
          }
        }}
      >
        <div
          className={`${
            posterOrientation === 'portrait' ? 'aspect-[2/3]' : 'aspect-video'
          } bg-gray-100 overflow-hidden relative rounded-t-xl`}
        >
          <SmartPoster src={poster} alt={video.file_name} posterOrientation={posterOrientation} />

        </div>
        <div className="p-2">
          <h3 className="font-semibold text-xs line-clamp-1 mb-1 text-gray-900">
            {video.episode_number ? `第${video.episode_number}${epWord || '部'}` : video.file_name}
          </h3>
          {video.episode_number && (
            <p className="text-[11px] text-gray-400 truncate">{video.file_name}</p>
          )}
        </div>
      </button>
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
      {seasonGroups.map(([, group]) => (
        <div key={`${group.season}-${group.subtitle || ''}`} className="changli-panel p-5">
          <h3 className="text-xl font-semibold mb-4">{getSeasonLabel(group.season, group.subtitle)}</h3>
          <div className={gridClass}>
            {group.videos
              .sort((a, b) => (a.episode_number ?? 0) - (b.episode_number ?? 0))
              .map((video) => renderVideoCard(video))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default SeriesDetail;
