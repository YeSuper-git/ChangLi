import { invoke } from '@tauri-apps/api';

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
  return await invoke('get_sites');
}

export async function addSite(site: NewSite): Promise<Site> {
  return await invoke('add_site', { site });
}

export async function updateSite(id: number, site: NewSite): Promise<Site> {
  return await invoke('update_site', { id, site });
}

export async function deleteSite(id: number): Promise<void> {
  return await invoke('delete_site', { id });
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
  return await invoke('search_resources', { keyword, siteIds });
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
  return await invoke('add_download', { magnet });
}

export async function getDownloads(): Promise<Download[]> {
  return await invoke('get_downloads');
}

export async function pauseDownload(id: number): Promise<void> {
  return await invoke('pause_download', { id });
}

export async function resumeDownload(id: number): Promise<void> {
  return await invoke('resume_download', { id });
}

export async function removeDownload(id: number): Promise<void> {
  return await invoke('remove_download', { id });
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
  description?: string;
  created_at: string;
}

export async function scanVideos(path: string): Promise<Video[]> {
  return await invoke('scan_videos', { path });
}

export async function getVideos(): Promise<Video[]> {
  return await invoke('get_videos');
}

export async function getVideo(id: number): Promise<Video | null> {
  return await invoke('get_video', { id });
}

export async function deleteVideo(id: number): Promise<void> {
  return await invoke('delete_video', { id });
}

// 演员相关
export interface Actor {
  id: number;
  name: string;
  photo?: string;
  bio?: string;
  debut_year?: number;
  created_at: string;
  updated_at: string;
}

export async function getActors(): Promise<Actor[]> {
  return await invoke('get_actors');
}

export async function getActor(id: number): Promise<Actor | null> {
  return await invoke('get_actor', { id });
}

export async function addActor(name: string, photo?: string, bio?: string, debutYear?: number): Promise<Actor> {
  return await invoke('add_actor', { name, photo, bio, debutYear });
}

export async function updateActor(id: number, name: string, photo?: string, bio?: string, debutYear?: number): Promise<Actor> {
  return await invoke('update_actor', { id, name, photo, bio, debutYear });
}

export async function deleteActor(id: number): Promise<void> {
  return await invoke('delete_actor', { id });
}

export async function getActorResources(actorId: number): Promise<Resource[]> {
  return await invoke('get_actor_resources', { actorId });
}

// 标签相关
export interface Tag {
  id: number;
  name: string;
  created_at: string;
}

export async function getTags(): Promise<Tag[]> {
  return await invoke('get_tags');
}

export async function addTag(name: string): Promise<Tag> {
  return await invoke('add_tag', { name });
}

export async function deleteTag(id: number): Promise<void> {
  return await invoke('delete_tag', { id });
}

export async function getResourceTags(resourceId: number): Promise<Tag[]> {
  return await invoke('get_resource_tags', { resourceId });
}

export async function addResourceTag(resourceId: number, tagId: number): Promise<void> {
  return await invoke('add_resource_tag', { resourceId, tagId });
}

export async function removeResourceTag(resourceId: number, tagId: number): Promise<void> {
  return await invoke('remove_resource_tag', { resourceId, tagId });
}

// 资源演员关联
export async function getResourceActors(resourceId: number): Promise<Actor[]> {
  return await invoke('get_resource_actors', { resourceId });
}

export async function addResourceActor(resourceId: number, actorId: number, role?: string): Promise<void> {
  return await invoke('add_resource_actor', { resourceId, actorId, role });
}

export async function removeResourceActor(resourceId: number, actorId: number): Promise<void> {
  return await invoke('remove_resource_actor', { resourceId, actorId });
}

// 播放器相关
export async function playVideo(id: number): Promise<void> {
  return await invoke('play_video', { id });
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
  return await invoke('get_play_history');
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
  return await invoke('update_watch_progress', { resourceId, episode, position, duration });
}

export async function getWatchProgress(resourceId: number, episode: number): Promise<WatchProgress | null> {
  return await invoke('get_watch_progress', { resourceId, episode });
}

export async function getResourceWatchProgress(resourceId: number): Promise<WatchProgress[]> {
  return await invoke('get_resource_watch_progress', { resourceId });
}

export async function getResources(): Promise<Resource[]> {
  return await invoke('get_resources');
}

export async function getResourcesByCategory(category: string): Promise<Resource[]> {
  return await invoke('get_resources_by_category', { category });
}

export async function getRecentResources(limit?: number): Promise<Resource[]> {
  return await invoke('get_recent_resources', { limit });
}

export async function updateVideo(id: number, fileName?: string, description?: string, thumbnail?: string): Promise<Video> {
  return await invoke('update_video', { id, fileName, description, thumbnail });
}
