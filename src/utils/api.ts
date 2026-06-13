import { invoke } from '@tauri-apps/api';

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
  file_size?: number;
  duration?: number;
  width?: number;
  height?: number;
  resolution?: string;
  source_site?: string;
  metadata?: any;
  thumbnail?: string;
  thumbnail_data_url?: string;
  description?: string;
  created_at: string;
}

export async function scanVideos(path: string): Promise<Video[]> {
  console.log('[API] 调用 scanVideos, path:', path);
  try {
    const result = await invoke<Video[]>('scan_videos', { path });
    console.log('[API] scanVideos 返回:', result.length, '个视频');
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
  created_at: string;
  updated_at: string;
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

export async function addActor(name: string, photo?: string, bio?: string, birthday?: string, height?: string, measurements?: string, japaneseName?: string): Promise<Actor> {
  console.log('[API] 调用 addActor, name:', name, 'photo:', photo, 'japaneseName:', japaneseName);
  try {
    const result = await invoke<Actor>('add_actor', { name, photo, bio, birthday, height, measurements, japaneseName });
    console.log('[API] addActor 成功, 返回:', result);
    return result;
  } catch (err) {
    console.error('[API] addActor 失败:', err);
    throw err;
  }
}

export async function updateActor(id: number, name: string, photo?: string, bio?: string, birthday?: string, height?: string, measurements?: string, japaneseName?: string): Promise<Actor> {
  console.log('[API] 调用 updateActor, id:', id, 'name:', name, 'photo:', photo, 'japaneseName:', japaneseName);
  try {
    const result = await invoke<Actor>('update_actor', { id, name, photo, bio, birthday, height, measurements, japaneseName });
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

export async function getActorResources(actorId: number): Promise<Resource[]> {
  console.log('[API] 调用 getActorResources, actorId:', actorId);
  try {
    const result = await invoke<Resource[]>('get_actor_resources', { actorId });
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

export async function addResourceActor(resourceId: number, actorId: number, role?: string): Promise<void> {
  console.log('[API] 调用 addResourceActor, resourceId:', resourceId, 'actorId:', actorId, 'role:', role);
  try {
    await invoke('add_resource_actor', { resourceId, actorId, role });
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

// 播放器相关
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
