import { invoke } from '@tauri-apps/api/core';

export interface StorageInfo {
  mode: 'system' | 'portable';
  data_dir: string;
  db_path: string;
  portable_root?: string;
}

export async function getStorageInfo(): Promise<StorageInfo> {
  console.log('[API] 调用 getStorageInfo');
  try {
    const result = await invoke<StorageInfo>('get_storage_info');
    console.log('[API] getStorageInfo 返回:', result);
    return result;
  } catch (err) {
    console.error('[API] getStorageInfo 失败:', err);
    throw err;
  }
}

export async function openDataDir(): Promise<void> {
  console.log('[API] 调用 openDataDir');
  try {
    await invoke('open_data_dir');
    console.log('[API] openDataDir 成功');
  } catch (err) {
    console.error('[API] openDataDir 失败:', err);
    throw err;
  }
}

// 网站相关
export interface Site {
  id: number;
  name: string;
  url: string;
  parser_type: string;
  config: any;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface NewSite {
  name: string;
  url: string;
  parser_type: string;
  config: any;
  enabled?: boolean;
}

export async function getSites(): Promise<Site[]> {
  console.log('[API] 调用 getSites');
  try {
    const result = await invoke<Site[]>('get_sites');
    console.log('[API] getSites 返回:', result.length, '条');
    return result;
  } catch (err) {
    console.error('[API] getSites 失败:', err);
    throw err;
  }
}

export async function addSite(site: NewSite): Promise<Site> {
  console.log('[API] 调用 addSite, site:', site);
  try {
    const result = await invoke<Site>('add_site', { site });
    console.log('[API] addSite 成功, 返回:', result);
    return result;
  } catch (err) {
    console.error('[API] addSite 失败:', err);
    throw err;
  }
}

export async function updateSite(id: number, site: NewSite): Promise<Site> {
  console.log('[API] 调用 updateSite, id:', id, 'site:', site);
  try {
    const result = await invoke<Site>('update_site', { id, site });
    console.log('[API] updateSite 成功, 返回:', result);
    return result;
  } catch (err) {
    console.error('[API] updateSite 失败:', err);
    throw err;
  }
}

export async function deleteSite(id: number): Promise<void> {
  console.log('[API] 调用 deleteSite, id:', id);
  try {
    await invoke('delete_site', { id });
    console.log('[API] deleteSite 成功');
  } catch (err) {
    console.error('[API] deleteSite 失败:', err);
    throw err;
  }
}

// 资源相关
export interface Resource {
  id: number;
  site_id: number;
  title: string;
  url?: string;
  magnet?: string;
  info?: any;
  created_at: string;
}

export async function searchResources(keyword: string, siteIds?: number[]): Promise<Resource[]> {
  console.log('[API] 调用 searchResources, keyword:', keyword, 'siteIds:', siteIds);
  try {
    const result = await invoke<Resource[]>('search_resources', { keyword, siteIds });
    console.log('[API] searchResources 返回:', result.length, '条');
    return result;
  } catch (err) {
    console.error('[API] searchResources 失败:', err);
    throw err;
  }
}

// 下载相关
export interface Download {
  id: number;
  resource_id?: number;
  aria2_gid?: string;
  status: string;
  progress: number;
  download_speed: number;
  file_path?: string;
  file_name?: string;
  file_size?: number;
  created_at: string;
  updated_at: string;
}

export async function addDownload(magnet: string): Promise<Download> {
  console.log('[API] 调用 addDownload, magnet(前50字符):', magnet.substring(0, 50));
  try {
    const result = await invoke<Download>('add_download', { magnet });
    console.log('[API] addDownload 成功, 返回:', result);
    return result;
  } catch (err) {
    console.error('[API] addDownload 失败:', err);
    throw err;
  }
}

export async function getDownloads(): Promise<Download[]> {
  console.log('[API] 调用 getDownloads');
  try {
    const result = await invoke<Download[]>('get_downloads');
    console.log('[API] getDownloads 返回:', result.length, '条');
    return result;
  } catch (err) {
    console.error('[API] getDownloads 失败:', err);
    throw err;
  }
}

export async function pauseDownload(id: number): Promise<void> {
  console.log('[API] 调用 pauseDownload, id:', id);
  try {
    await invoke('pause_download', { id });
    console.log('[API] pauseDownload 成功');
  } catch (err) {
    console.error('[API] pauseDownload 失败:', err);
    throw err;
  }
}

export async function resumeDownload(id: number): Promise<void> {
  console.log('[API] 调用 resumeDownload, id:', id);
  try {
    await invoke('resume_download', { id });
    console.log('[API] resumeDownload 成功');
  } catch (err) {
    console.error('[API] resumeDownload 失败:', err);
    throw err;
  }
}

export async function removeDownload(id: number): Promise<void> {
  console.log('[API] 调用 removeDownload, id:', id);
  try {
    await invoke('remove_download', { id });
    console.log('[API] removeDownload 成功');
  } catch (err) {
    console.error('[API] removeDownload 失败:', err);
    throw err;
  }
}

// 视频相关
export interface Video {
  id: number;
  file_path: string;
  file_name: string;
  series_id?: number;
  episode_number?: number;
  file_size?: number;
  duration?: number;
  width?: number;
  height?: number;
  resolution?: string;
  source_site?: string;
  metadata?: any;
  thumbnail?: string;
  thumbnail_data_url?: string;
  thumbnail_base64?: string;
  series_title?: string;
  series_poster_data_url?: string;
  description?: string;
  poster_orientation?: string;
  season?: number;
  subtitle?: string;
  created_at: string;
  is_favorite?: number;
  series_has_chinese_sub?: number;
  series_code?: string;
}

export interface ScanResult {
  added: number;
  updated: number;
}

export async function scanVideos(path: string): Promise<ScanResult> {
  console.log('[API] 调用 scanVideos, path:', path);
  try {
    const result = await invoke<ScanResult>('scan_videos', { path });
    console.log('[API] scanVideos 返回:', result);
    return result;
  } catch (err) {
    console.error('[API] scanVideos 失败:', err);
    throw err;
  }
}

export async function getVideos(): Promise<Video[]> {
  console.log('[API] 调用 getVideos');
  try {
    const result = await invoke<Video[]>('get_videos');
    console.log('[API] getVideos 返回:', result.length, '条');
    return result;
  } catch (err) {
    console.error('[API] getVideos 失败:', err);
    throw err;
  }
}

export async function getVideo(id: number): Promise<Video | null> {
  console.log('[API] 调用 getVideo, id:', id);
  try {
    const result = await invoke<Video | null>('get_video', { id });
    console.log('[API] getVideo 返回:', result ? `video(${result.file_name})` : 'null');
    return result;
  } catch (err) {
    console.error('[API] getVideo 失败:', err);
    throw err;
  }
}

export async function deleteVideo(id: number): Promise<void> {
  console.log('[API] 调用 deleteVideo, id:', id);
  try {
    await invoke('delete_video', { id });
    console.log('[API] deleteVideo 成功');
  } catch (err) {
    console.error('[API] deleteVideo 失败:', err);
    throw err;
  }
}

export interface VideoSeries {
  id: number;
  title: string;
  description?: string;
  poster?: string;
  poster_data_url?: string;
  folder_path?: string;
  video_count: number;
  poster_orientation?: string;
  status?: string;
  created_at: string;
  updated_at: string;
  is_favorite?: number;
  is_watched?: number;
  last_watched_episode?: number;
  last_watched_season?: number;
  has_actor?: boolean;
  code?: string;
  has_chinese_sub?: number;
  display_type?: string;
}

export function formatSeriesWatchLabel(series: Pick<VideoSeries, 'is_watched' | 'last_watched_episode' | 'last_watched_season'>, epWord: string): string {
  if (series.is_watched) return '已看完';
  const episode = series.last_watched_episode;
  if (!episode) return '尚未观看';
  const season = series.last_watched_season;
  if (season && season > 0 && season !== 999) return `看到第${season}季第${episode}${epWord}`;
  if (season === 999) return `看到剧场版第${episode}${epWord}`;
  return `看到第${episode}${epWord}`;
}

export async function getVideoSeriesList(sortBy?: string, sortOrder?: string): Promise<VideoSeries[]> {
  return invoke<VideoSeries[]>('get_video_series_list', { sortBy, sortOrder });
}



export async function getVideoSeriesByTag(tagId: number): Promise<VideoSeries[]> {
  return invoke<VideoSeries[]>('get_video_series_by_tag', { tagId });
}

export async function getVideoSeriesByTagName(tagName: string): Promise<VideoSeries[]> {
  return invoke<VideoSeries[]>('get_video_series_by_tag_name', { tagName });
}

export async function getVideoSeriesByActor(actorId: number): Promise<VideoSeries[]> {
  return invoke<VideoSeries[]>('get_video_series_by_actor', { actorId });
}

export async function getSeriesPlaybackVideo(seriesId: number): Promise<Video | null> {
  return invoke<Video | null>('get_series_playback_video', { seriesId });
}

export async function getVideoSeriesDetail(id: number): Promise<[VideoSeries | null, Video[]]> {
  return invoke<[VideoSeries | null, Video[]]>('get_video_series_detail', { id });
}

export async function updateVideoSeries(id: number, title: string, description?: string, poster?: string, poster_orientation?: string, status?: string, code?: string, has_chinese_sub?: number): Promise<VideoSeries> {
  return invoke<VideoSeries>('update_video_series', { id, title, description, poster, poster_orientation, status, code, has_chinese_sub });
}

export async function deleteVideoSeries(id: number, deleteVideos: boolean): Promise<void> {
  return invoke('delete_video_series', { id, deleteVideos });
}

export async function switchSeriesType(seriesId: number): Promise<void> {
  return invoke('switch_series_type', { seriesId });
}

export async function switchSeriesTypeTo(seriesId: number, categoryKey: string): Promise<void> {
  return invoke('switch_series_type_to', { seriesId, categoryKey });
}

export async function addVideoToSeries(seriesId: number, path: string): Promise<Video> {
  return invoke<Video>('add_video_to_series', { seriesId, path });
}

export async function removeVideoFromSeries(videoId: number): Promise<Video> {
  return invoke<Video>('remove_video_from_series', { videoId });
}

export async function toggleFavorite(id: number, type: 'video' | 'series'): Promise<void> {
  await invoke('toggle_favorite', { id, favType: type });
}

export async function toggleWatched(id: number): Promise<void> {
  await invoke('toggle_watched', { id });
}

export async function toggleChineseSub(id: number): Promise<void> {
  await invoke('toggle_chinese_sub', { id });
}

export async function getFavoriteVideos(): Promise<Video[]> {
  return invoke<Video[]>('get_favorite_videos_cmd');
}

export async function getFavoriteSeries(): Promise<VideoSeries[]> {
  return invoke<VideoSeries[]>('get_favorite_series_cmd');
}

// 季管理
export interface SeasonInfo {
  season: number;
  subtitle?: string;
  video_count: number;
}

export async function getSeriesSeasons(seriesId: number): Promise<SeasonInfo[]> {
  return invoke<SeasonInfo[]>('get_series_seasons', { seriesId });
}

export async function deleteSeason(seriesId: number, season: number): Promise<void> {
  return invoke('delete_season', { seriesId, season });
}

export async function updateVideoSubtitle(videoId: number, subtitle?: string): Promise<void> {
  return invoke('update_video_subtitle', { videoId, subtitle });
}

export async function deleteAllVideos(): Promise<{ videoCount: number; seriesCount: number }> {
  const [videoCount, seriesCount] = await invoke<[number, number]>('delete_all_videos');
  return { videoCount, seriesCount };
}

export async function deleteAllAnime(): Promise<{ videoCount: number; seriesCount: number }> {
  const [videoCount, seriesCount] = await invoke<[number, number]>('delete_all_anime');
  return { videoCount, seriesCount };
}

export async function deleteAllAdult(): Promise<{ videoCount: number; seriesCount: number }> {
  const [videoCount, seriesCount] = await invoke<[number, number]>('delete_all_adult');
  return { videoCount, seriesCount };
}
export async function deleteVideosByCategory(categoryKey: string): Promise<{ videoCount: number; seriesCount: number }> {
  const [videoCount, seriesCount] = await invoke<[number, number]>('delete_videos_by_category', { categoryKey });
  return { videoCount, seriesCount };
}

export async function rescanCategoryMetadata(categoryKey: string): Promise<[number, number, number, number]> {
  return invoke<[number, number, number, number]>('rescan_category_metadata', { categoryKey });
}

export async function rescanAllSeriesMetadata(): Promise<[number, number]> {
  return invoke<[number, number]>('rescan_all_series_metadata');
}

export async function rescanAnimeMetadata(): Promise<[number, number]> {
  return invoke<[number, number]>('rescan_anime_metadata');
}

export async function rescanAdultMetadata(): Promise<[number, number]> {
  return invoke<[number, number]>('rescan_adult_metadata');
}

export async function rescanSingleSeriesMetadata(seriesId: number): Promise<boolean> {
  return invoke<boolean>('rescan_single_series_metadata', { seriesId });
}

export async function getMissingSeriesVideos(seriesId: number): Promise<Video[]> {
  return invoke<Video[]>('get_missing_series_videos', { seriesId });
}

export interface SeriesUpdateResult {
  new_videos: Video[];
  missing_videos: Video[];
}

export async function checkSeriesUpdates(seriesId: number): Promise<SeriesUpdateResult> {
  return invoke<SeriesUpdateResult>('check_series_updates', { seriesId });
}

export interface SeriesUpdateSummary {
  series_id: number;
  series_title: string;
  new_videos: Video[];
  missing_videos: Video[];
}

export interface CategoryUpdateResult {
  new_series: string[];
  missing_series: string[];
  series_updates: SeriesUpdateSummary[];
}

export async function checkCategoryUpdates(categoryKey: string): Promise<CategoryUpdateResult> {
  return invoke<CategoryUpdateResult>('check_category_updates', { categoryKey });
}

// 演员相关
export interface Actor {
  id: number;
  name: string;
  photo?: string;
  photo_data_url?: string;
  bio?: string;
  birthday?: string;
  height?: string;
  measurements?: string;
  japanese_name?: string;
  cup_size?: string;
  alias?: string;
  weight?: string;
  work_count: number;
  view_count: number;
  created_at: string;
  updated_at: string;
}

// 演员时期
export interface ActorPeriod {
  id: number;
  actor_id: number;
  name: string;
  sort_order: number;
  created_at: string;
}

export async function getActors(): Promise<Actor[]> {
  console.log('[API] 调用 getActors');
  try {
    const result = await invoke<Actor[]>('get_actors');
    console.log('[API] getActors 返回:', result.length, '条');
    return result;
  } catch (err) {
    console.error('[API] getActors 失败:', err);
    throw err;
  }
}

export async function getActorsByCategory(categoryKey: string): Promise<Actor[]> {
  return invoke<Actor[]>('get_actors_by_category', { categoryKey });
}

export async function incrementActorView(actorId: number): Promise<void> {
  return invoke<void>('increment_actor_view', { actorId });
}

export async function getActor(id: number): Promise<Actor | null> {
  console.log('[API] 调用 getActor, id:', id);
  try {
    const result = await invoke<Actor | null>('get_actor', { id });
    console.log('[API] getActor 返回:', result ? `actor(${result.name}, photo: ${result.photo || '无'})` : 'null');
    return result;
  } catch (err) {
    console.error('[API] getActor 失败:', err);
    throw err;
  }
}

export async function addActor(name: string, photo?: string, bio?: string, birthday?: string, height?: string, measurements?: string, japaneseName?: string, cupSize?: string, alias?: string): Promise<Actor> {
  console.log('[API] 调用 addActor, name:', name, 'photo:', photo, 'japaneseName:', japaneseName, 'cupSize:', cupSize, 'alias:', alias);
  try {
    const result = await invoke<Actor>('add_actor', { name, photo, bio, birthday, height, measurements, japaneseName, cupSize, alias });
    console.log('[API] addActor 成功, 返回:', result);
    return result;
  } catch (err) {
    console.error('[API] addActor 失败:', err);
    throw err;
  }
}

export async function updateActor(id: number, name: string, photo?: string, bio?: string, birthday?: string, height?: string, measurements?: string, japaneseName?: string, cupSize?: string, alias?: string, weight?: string): Promise<Actor> {
  console.log('[API] 调用 updateActor, id:', id, 'name:', name, 'photo:', photo, 'japaneseName:', japaneseName, 'cupSize:', cupSize, 'alias:', alias, 'weight:', weight);
  try {
    const result = await invoke<Actor>('update_actor', { id, name, photo, bio, birthday, height, measurements, japaneseName, cupSize, alias, weight });
    console.log('[API] updateActor 成功, 返回:', result);
    return result;
  } catch (err) {
    console.error('[API] updateActor 失败:', err);
    throw err;
  }
}

export async function deleteActor(id: number): Promise<void> {
  console.log('[API] 调用 deleteActor, id:', id);
  try {
    await invoke('delete_actor', { id });
    console.log('[API] deleteActor 成功');
  } catch (err) {
    console.error('[API] deleteActor 失败:', err);
    throw err;
  }
}

export async function getActorResources(actorId: number): Promise<Video[]> {
  console.log('[API] 调用 getActorResources, actorId:', actorId);
  try {
    const result = await invoke<Video[]>('get_actor_resources', { actorId });
    console.log('[API] getActorResources 返回:', result.length, '条');
    return result;
  } catch (err) {
    console.error('[API] getActorResources 失败:', err);
    throw err;
  }
}

export async function saveActorPhoto(sourcePath: string): Promise<string> {
  console.log('[API] 调用 saveActorPhoto, sourcePath:', sourcePath);
  try {
    const result = await invoke<string>('save_actor_photo', { sourcePath });
    console.log('[API] saveActorPhoto 成功, 返回路径:', result);
    return result;
  } catch (err) {
    console.error('[API] saveActorPhoto 失败:', err);
    throw err;
  }
}

export async function saveVideoThumbnail(sourcePath: string): Promise<string> {
  console.log('[API] 调用 saveVideoThumbnail, sourcePath:', sourcePath);
  try {
    const result = await invoke<string>('save_video_thumbnail', { sourcePath });
    console.log('[API] saveVideoThumbnail 成功, 返回路径:', result);
    return result;
  } catch (err) {
    console.error('[API] saveVideoThumbnail 失败:', err);
    throw err;
  }
}

// 标签相关
export interface Tag {
  id: number;
  name: string;
  created_at: string;
}

export async function getTags(): Promise<Tag[]> {
  console.log('[API] 调用 getTags');
  try {
    const result = await invoke<Tag[]>('get_tags');
    console.log('[API] getTags 返回:', result.length, '条');
    return result;
  } catch (err) {
    console.error('[API] getTags 失败:', err);
    throw err;
  }
}

export async function getTagsByCategory(categoryKey: string): Promise<Tag[]> {
  return invoke<Tag[]>('get_tags_by_category', { categoryKey });
}

export async function addTag(name: string): Promise<Tag> {
  console.log('[API] 调用 addTag, name:', name);
  try {
    const result = await invoke<Tag>('add_tag', { name });
    console.log('[API] addTag 成功, 返回:', result);
    return result;
  } catch (err) {
    console.error('[API] addTag 失败:', err);
    throw err;
  }
}

export async function deleteTag(id: number): Promise<void> {
  console.log('[API] 调用 deleteTag, id:', id);
  try {
    await invoke('delete_tag', { id });
    console.log('[API] deleteTag 成功');
  } catch (err) {
    console.error('[API] deleteTag 失败:', err);
    throw err;
  }
}

export async function getResourceTags(resourceId: number): Promise<Tag[]> {
  console.log('[API] 调用 getResourceTags, resourceId:', resourceId);
  try {
    const result = await invoke<Tag[]>('get_resource_tags', { resourceId });
    console.log('[API] getResourceTags 返回:', result.length, '条');
    return result;
  } catch (err) {
    console.error('[API] getResourceTags 失败:', err);
    throw err;
  }
}

export async function addResourceTag(resourceId: number, tagId: number): Promise<void> {
  console.log('[API] 调用 addResourceTag, resourceId:', resourceId, 'tagId:', tagId);
  try {
    await invoke('add_resource_tag', { resourceId, tagId });
    console.log('[API] addResourceTag 成功');
  } catch (err) {
    console.error('[API] addResourceTag 失败:', err);
    throw err;
  }
}

export async function removeResourceTag(resourceId: number, tagId: number): Promise<void> {
  console.log('[API] 调用 removeResourceTag, resourceId:', resourceId, 'tagId:', tagId);
  try {
    await invoke('remove_resource_tag', { resourceId, tagId });
    console.log('[API] removeResourceTag 成功');
  } catch (err) {
    console.error('[API] removeResourceTag 失败:', err);
    throw err;
  }
}

// 资源演员关联
export async function getResourceActors(resourceId: number): Promise<Actor[]> {
  console.log('[API] 调用 getResourceActors, resourceId:', resourceId);
  try {
    const result = await invoke<Actor[]>('get_resource_actors', { resourceId });
    console.log('[API] getResourceActors 返回:', result.length, '条');
    return result;
  } catch (err) {
    console.error('[API] getResourceActors 失败:', err);
    throw err;
  }
}

export async function addResourceActor(resourceId: number, actorId: number, role?: string, periodId?: number): Promise<void> {
  console.log('[API] 调用 addResourceActor, resourceId:', resourceId, 'actorId:', actorId, 'role:', role, 'periodId:', periodId);
  try {
    await invoke('add_resource_actor', { resourceId, actorId, role, periodId });
    console.log('[API] addResourceActor 成功');
  } catch (err) {
    console.error('[API] addResourceActor 失败:', err);
    throw err;
  }
}

export async function removeResourceActor(resourceId: number, actorId: number): Promise<void> {
  console.log('[API] 调用 removeResourceActor, resourceId:', resourceId, 'actorId:', actorId);
  try {
    await invoke('remove_resource_actor', { resourceId, actorId });
    console.log('[API] removeResourceActor 成功');
  } catch (err) {
    console.error('[API] removeResourceActor 失败:', err);
    throw err;
  }
}

// 视频集标签/演员关联
export async function getSeriesTags(seriesId: number): Promise<Tag[]> {
  return invoke<Tag[]>('get_series_tags', { seriesId });
}

export async function addSeriesTag(seriesId: number, tagId: number): Promise<void> {
  return invoke('add_series_tag', { seriesId, tagId });
}

export async function removeSeriesTag(seriesId: number, tagId: number): Promise<void> {
  return invoke('remove_series_tag', { seriesId, tagId });
}

export async function getSeriesActors(seriesId: number): Promise<Actor[]> {
  return invoke<Actor[]>('get_series_actors', { seriesId });
}

export async function addSeriesActor(seriesId: number, actorId: number, role?: string): Promise<void> {
  return invoke('add_series_actor', { seriesId, actorId, role });
}

export async function removeSeriesActor(seriesId: number, actorId: number): Promise<void> {
  return invoke('remove_series_actor', { seriesId, actorId });
}

// 演员时期相关
export interface ActorPhoto {
  id: number;
  actor_id: number;
  photo?: string;
  photo_data_url?: string;
  is_primary: number;
  sort_order: number;
  created_at: string;
}

export async function getActorPhotos(actorId: number): Promise<ActorPhoto[]> {
  return invoke<ActorPhoto[]>('get_actor_photos', { actorId });
}

export async function addActorPhoto(actorId: number, photo?: string, photoBase64?: string, isPrimary?: number): Promise<ActorPhoto> {
  return invoke<ActorPhoto>('add_actor_photo_cmd', { actorId, photo, photoBase64, isPrimary });
}

export async function deleteActorPhoto(photoId: number): Promise<void> {
  return invoke('delete_actor_photo_cmd', { photoId });
}

export async function setPrimaryPhoto(actorId: number, photoId: number): Promise<void> {
  return invoke('set_primary_photo_cmd', { actorId, photoId });
}

export async function reorderActorPhotos(actorId: number, photoIds: number[]): Promise<void> {
  return invoke('reorder_actor_photos_cmd', { actorId, photoIds });
}

// 演员时期相关
export async function getActorPeriods(actorId: number): Promise<ActorPeriod[]> {
  return invoke<ActorPeriod[]>('get_actor_periods', { actorId });
}

export async function addActorPeriod(actorId: number, name: string): Promise<ActorPeriod> {
  return invoke<ActorPeriod>('add_actor_period', { actorId, name });
}

export async function updateActorPeriod(id: number, name: string): Promise<void> {
  return invoke('update_actor_period', { id, name });
}

export async function deleteActorPeriod(id: number): Promise<void> {
  return invoke('delete_actor_period', { id });
}

export async function reorderActorPeriods(periodIds: number[]): Promise<void> {
  return invoke('reorder_actor_periods_cmd', { periodIds });
}

export async function getActorWorkPeriodMap(actorId: number): Promise<Record<string, number>> {
  return invoke<Record<string, number>>('get_actor_work_period_map', { actorId });
}

export async function updateActorWorkPeriod(actorId: number, workType: 'video' | 'series', workId: number, periodId?: number | null): Promise<void> {
  return invoke('update_actor_work_period', { actorId, workType, workId, periodId: periodId ?? null });
}

// 播放器相关
export async function openPlayerWindow(id: number): Promise<void> {
  console.log('[API] 调用 openPlayerWindow, id:', id);
  try {
    await invoke('open_player_window', { id });
    console.log('[API] openPlayerWindow 成功');
  } catch (err) {
    console.error('[API] openPlayerWindow 失败:', err);
    throw err;
  }
}

export async function updatePlayHistory(videoId: number, lastPosition: number, totalDuration?: number): Promise<void> {
  return invoke('update_play_history', { videoId, lastPosition, totalDuration });
}

export async function playVideo(id: number): Promise<void> {
  console.log('[API] 调用 playVideo, id:', id);
  try {
    await invoke('play_video', { id });
    console.log('[API] playVideo 成功');
  } catch (err) {
    console.error('[API] playVideo 失败:', err);
    throw err;
  }
}

export interface PlayHistory {
  id: number;
  video_id: number;
  last_position: number;
  total_duration?: number;
  play_count: number;
  last_played: string;
}


export interface RecentWatchItem {
  video: Video;
  series?: VideoSeries;
  last_position: number;
  total_duration?: number;
  play_count: number;
  last_played: string;
}

export async function getPlayHistory(): Promise<PlayHistory[]> {
  console.log('[API] 调用 getPlayHistory');
  try {
    const result = await invoke<PlayHistory[]>('get_play_history');
    console.log('[API] getPlayHistory 返回:', result.length, '条');
    return result;
  } catch (err) {
    console.error('[API] getPlayHistory 失败:', err);
    throw err;
  }
}


export async function getRecentWatchItems(limit?: number): Promise<RecentWatchItem[]> {
  console.log('[API] 调用 getRecentWatchItems, limit:', limit);
  try {
    const result = await invoke<RecentWatchItem[]>('get_recent_watch_items', { limit });
    console.log('[API] getRecentWatchItems 返回:', result.length, '条');
    return result;
  } catch (err) {
    console.error('[API] getRecentWatchItems 失败:', err);
    throw err;
  }
}

// 观看进度相关
export interface WatchProgress {
  id: number;
  resource_id: number;
  episode: number;
  position: number;
  duration: number;
  updated_at: string;
}

export async function updateWatchProgress(resourceId: number, episode: number, position: number, duration: number): Promise<void> {
  console.log('[API] 调用 updateWatchProgress, resourceId:', resourceId, 'episode:', episode, 'position:', position, 'duration:', duration);
  try {
    await invoke('update_watch_progress', { resourceId, episode, position, duration });
    console.log('[API] updateWatchProgress 成功');
  } catch (err) {
    console.error('[API] updateWatchProgress 失败:', err);
    throw err;
  }
}

export async function getWatchProgress(resourceId: number, episode: number): Promise<WatchProgress | null> {
  console.log('[API] 调用 getWatchProgress, resourceId:', resourceId, 'episode:', episode);
  try {
    const result = await invoke<WatchProgress | null>('get_watch_progress', { resourceId, episode });
    console.log('[API] getWatchProgress 返回:', result ? `position: ${result.position}/${result.duration}` : 'null');
    return result;
  } catch (err) {
    console.error('[API] getWatchProgress 失败:', err);
    throw err;
  }
}

export async function getResourceWatchProgress(resourceId: number): Promise<WatchProgress[]> {
  console.log('[API] 调用 getResourceWatchProgress, resourceId:', resourceId);
  try {
    const result = await invoke<WatchProgress[]>('get_resource_watch_progress', { resourceId });
    console.log('[API] getResourceWatchProgress 返回:', result.length, '条');
    return result;
  } catch (err) {
    console.error('[API] getResourceWatchProgress 失败:', err);
    throw err;
  }
}

export async function getResources(): Promise<Resource[]> {
  console.log('[API] 调用 getResources');
  try {
    const result = await invoke<Resource[]>('get_resources');
    console.log('[API] getResources 返回:', result.length, '条');
    return result;
  } catch (err) {
    console.error('[API] getResources 失败:', err);
    throw err;
  }
}

export async function getResourcesByCategory(category: string): Promise<Resource[]> {
  console.log('[API] 调用 getResourcesByCategory, category:', category);
  try {
    const result = await invoke<Resource[]>('get_resources_by_category', { category });
    console.log('[API] getResourcesByCategory 返回:', result.length, '条');
    return result;
  } catch (err) {
    console.error('[API] getResourcesByCategory 失败:', err);
    throw err;
  }
}

export async function getRecentResources(limit?: number): Promise<Resource[]> {
  console.log('[API] 调用 getRecentResources, limit:', limit);
  try {
    const result = await invoke<Resource[]>('get_recent_resources', { limit });
    console.log('[API] getRecentResources 返回:', result.length, '条');
    return result;
  } catch (err) {
    console.error('[API] getRecentResources 失败:', err);
    throw err;
  }
}

export async function updateVideo(id: number, fileName?: string, description?: string, thumbnail?: string): Promise<Video> {
  console.log('[API] 调用 updateVideo, id:', id, 'fileName:', fileName, 'description:', description, 'thumbnail:', thumbnail);
  try {
    const result = await invoke<Video>('update_video', { id, fileName, description, thumbnail });
    console.log('[API] updateVideo 成功, 返回:', result);
    return result;
  } catch (err) {
    console.error('[API] updateVideo 失败:', err);
    throw err;
  }
}

export async function scanVideosForActor(path: string, actorId: number, periodId?: number): Promise<ScanResult> {
  console.log('[API] 调用 scanVideosForActor, path:', path, 'actorId:', actorId, 'periodId:', periodId);
  try {
    const result = await invoke<ScanResult>('scan_videos_for_actor', { path, actorId, periodId: periodId ?? null });
    console.log('[API] scanVideosForActor 返回:', result);
    return result;
  } catch (err) {
    console.error('[API] scanVideosForActor 失败:', err);
    throw err;
  }
}

// ==================== 大类配置 ====================

export interface Category {
  id: number;
  key: string;
  name: string;
  card_layout: 'portrait' | 'landscape' | 'auto';
  features: string; // JSON string
  sort_order: number;
  scan_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface CategoryFeatures {
  tags: boolean;
  actors: boolean;
  tracking: boolean;
  status: boolean;
  chinese_sub: boolean;
  episode: string;
}

export function parseCategoryFeatures(features: string): CategoryFeatures {
  try {
    const parsed = JSON.parse(features);
    if (typeof parsed.episode === 'boolean') {
      parsed.episode = parsed.episode ? '话' : '部';
    }
    return parsed;
  } catch {
    return { tags: false, actors: false, tracking: false, status: false, chinese_sub: false, episode: '部' };
  }
}

export async function getAllCategories(): Promise<Category[]> {
  return invoke<Category[]>('get_all_categories');
}

export async function createCategory(key: string, name: string, cardLayout: string, features: string, scanPath?: string | null): Promise<Category> {
  return invoke<Category>('create_category_cmd', { key, name, cardLayout, features, scanPath: scanPath || null });
}

export async function updateCategory(key: string, name: string, cardLayout: string, features: string, scanPath?: string | null): Promise<Category> {
  return invoke<Category>('update_category_cmd', { key, name, cardLayout, features, scanPath: scanPath || null });
}

export async function deleteCategory(key: string): Promise<void> {
  return invoke('delete_category_cmd', { key });
}

export async function reorderCategories(categoryKeys: string[]): Promise<void> {
  return invoke('reorder_categories_cmd', { categoryKeys });
}

export async function scanCategory(categoryKey: string): Promise<{ added: number; updated: number }> {
  return invoke('scan_category', { categoryKey });
}

export async function getCategoryConfig(categoryKey: string): Promise<{ category: Category; features: CategoryFeatures } | null> {
  const categories = await getAllCategories();
  const cat = categories.find(c => c.key === categoryKey);
  if (!cat) return null;
  return { category: cat, features: parseCategoryFeatures(cat.features) };
}

// ==================== 演员字段配置 ====================

export interface ActorField {
  id: number;
  field_key: string;
  field_label: string;
  field_type: string;
  options: string | null;
  format: string | null;
  sort_order: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export async function getAllActorFields(): Promise<ActorField[]> {
  return invoke<ActorField[]>('get_all_actor_fields');
}

export async function updateActorField(fieldKey: string, fieldLabel: string, fieldType: string, options: string | null, format: string | null, enabled: boolean): Promise<void> {
  return invoke('update_actor_field_cmd', { fieldKey, fieldLabel, fieldType, options, format, enabled });
}

export async function createActorField(fieldKey: string, fieldLabel: string, fieldType: string, options: string | null, format: string | null): Promise<ActorField> {
  return invoke<ActorField>('create_actor_field_cmd', { fieldKey, fieldLabel, fieldType, options, format });
}

export async function deleteActorField(fieldKey: string): Promise<void> {
  return invoke('delete_actor_field_cmd', { fieldKey });
}

export async function reorderActorFields(fieldKeys: string[]): Promise<void> {
  return invoke('reorder_actor_fields_cmd', { fieldKeys });
}

// ==================== 预设模板 ====================

export interface PresetTemplate {
  id: number;
  key: string;
  name: string;
  field_type: string;
  sub_fields: string;
  rules: string;
  is_extension: boolean;
  sort_order: number;
  created_at: string;
}

export async function getPresetTemplates(): Promise<PresetTemplate[]> {
  return invoke<PresetTemplate[]>('get_preset_templates_cmd');
}

export async function getExtensionPresetTemplates(): Promise<PresetTemplate[]> {
  return invoke<PresetTemplate[]>('get_extension_preset_templates_cmd');
}

export async function isPresetTemplateEnabled(key: string): Promise<boolean> {
  return invoke<boolean>('is_preset_template_enabled_cmd', { key });
}

export async function enablePresetTemplate(key: string): Promise<void> {
  return invoke('enable_preset_template_cmd', { key });
}

export async function disablePresetTemplate(key: string): Promise<void> {
  return invoke('disable_preset_template_cmd', { key });
}

export interface ReleaseAssetInfo {
  name: string;
  browser_download_url: string;
}

export interface LatestReleaseInfo {
  tag_name: string;
  html_url: string;
  assets: ReleaseAssetInfo[];
}

export async function checkLatestRelease(): Promise<LatestReleaseInfo> {
  return invoke<LatestReleaseInfo>('check_latest_release');
}

// 游戏覆盖（NVIDIA / 游戏加加）
export async function setGameOverlayDisabled(disabled: boolean): Promise<string> {
  return invoke<string>('set_game_overlay_disabled', { disabled });
}

export async function getGameOverlayDisabled(): Promise<boolean> {
  return invoke<boolean>('get_game_overlay_disabled');
}
