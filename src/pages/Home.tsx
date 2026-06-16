import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  getActors,
  getRecentWatchItems,
  getStandaloneVideos,
  getStandaloneVideosByTag,
  getTags,
  getVideoSeriesByTag,
  getVideoSeriesList,
  playVideo,
} from '../utils/api';
import type { Actor, RecentWatchItem, Tag, Video, VideoSeries } from '../utils/api';
import { actorPhotoDataUrl, StaticImagePlaceholder, videoPosterDataUrl } from '../utils/media';

const formatWatchTime = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainSeconds = safeSeconds % 60;
  return `${minutes}分${remainSeconds.toString().padStart(2, '0')}秒`;
};

const Home: React.FC = () => {
  const [actors, setActors] = useState<Actor[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [seriesList, setSeriesList] = useState<VideoSeries[]>([]);
  const [recentWatchItems, setRecentWatchItems] = useState<RecentWatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTagId, setActiveTagId] = useState<number | null>(null);

  useEffect(() => {
    loadData(null);
  }, []);

  const loadData = async (tagId: number | null) => {
    try {
      console.log('[Home] 开始加载数据, tagId:', tagId);

      const [actorsList, tagsList, recentList, videosList, series] = await Promise.all([
        getActors(),
        getTags(),
        getRecentWatchItems(3),
        tagId ? getStandaloneVideosByTag(tagId) : getStandaloneVideos(),
        tagId ? getVideoSeriesByTag(tagId) : getVideoSeriesList(),
      ]);

      setActors(actorsList);
      setTags(tagsList);
      setRecentWatchItems(recentList);
      setVideos(videosList);
      setSeriesList(series);
      setActiveTagId(tagId);
    } catch (error) {
      console.error('[Home] 加载数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTagClick = (tagId: number | null) => {
    setLoading(true);
    loadData(tagId);
  };

  const handlePlay = async (videoId: number, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await playVideo(videoId);
      await loadData(activeTagId);
    } catch (error) {
      console.error('[Home] 播放失败:', error);
      alert('播放失败: ' + String(error));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-12">
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={() => handleTagClick(null)}
            className={`category-btn ${activeTagId === null ? 'active' : ''}`}
          >
            全部
          </button>
          {tags.map((tag) => (
            <button
              key={tag.id}
              onClick={() => handleTagClick(tag.id)}
              className={`category-btn ${activeTagId === tag.id ? 'active' : ''}`}
            >
              {tag.name}
            </button>
          ))}
        </div>
        <Link
          to="/settings"
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm"
        >
          + 添加资源
        </Link>
      </div>

      <section className="mb-16">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-gray-900">继续观看</h2>
          <Link to="/library" className="text-blue-500 hover:text-blue-600 text-sm font-medium">
            查看全部 →
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-8">
          {recentWatchItems.slice(0, 3).map((item) => {
            const title = item.series ? item.series.title : item.video.file_name;
            const poster = item.series?.poster_data_url || videoPosterDataUrl(item.video);
            const watchText = item.series
              ? `观看至第 ${item.video.episode_number || '?'} 集 ${formatWatchTime(item.last_position)}`
              : `观看至 ${formatWatchTime(item.last_position)}`;
            return (
              <Link key={`${item.video.id}-${item.last_played}`} to={`/video/${item.video.id}`} className="card block">
                <div className="aspect-[16/10] bg-gradient-to-br from-gray-100 to-gray-200 relative overflow-hidden">
                  {poster ? (
                    <img src={poster} alt={title} className="w-full h-full object-cover" />
                  ) : (
                    <StaticImagePlaceholder kind="video" />
                  )}
                  <button
                    onClick={(event) => handlePlay(item.video.id, event)}
                    className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/20 transition-colors"
                    title="继续播放"
                  >
                    <span className="w-16 h-16 bg-white/90 rounded-full flex items-center justify-center shadow-lg text-2xl ml-1">▶️</span>
                  </button>
                </div>
                <div className="p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3 line-clamp-2">{title}</h3>
                  <div className="text-sm text-gray-500">{watchText}</div>
                </div>
              </Link>
            );
          })}
          {recentWatchItems.length === 0 && (
            <div className="col-span-3 text-center text-gray-500 py-12">
              小主最近暂无观看记录哦~
            </div>
          )}
        </div>
      </section>

      <section className="mb-16">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-gray-900">我的视频库</h2>
          <Link to="/library" className="text-blue-500 hover:text-blue-600 text-sm font-medium">
            查看全部 →
          </Link>
        </div>
        <div className="grid grid-cols-4 gap-6">
          {seriesList.slice(0, 8).map((series) => (
            <Link key={`series-${series.id}`} to={`/series/${series.id}`} className="card block">
              <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 relative overflow-hidden">
                {series.poster_data_url ? (
                  <img src={series.poster_data_url} alt={series.title} className="w-full h-full object-cover" />
                ) : (
                  <StaticImagePlaceholder kind="video" />
                )}
                <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-full">
                  {series.video_count} 集
                </div>
              </div>
              <div className="p-4">
                <h3 className="font-semibold text-gray-900 text-sm mb-2 line-clamp-2">{series.title}</h3>
                <div className="text-xs text-gray-500">视频集</div>
              </div>
            </Link>
          ))}
          {videos.slice(0, Math.max(0, 8 - seriesList.length)).map((video) => {
            const thumbnailDataUrl = videoPosterDataUrl(video);
            return (
              <Link key={`video-${video.id}`} to={`/video/${video.id}`} className="card block">
                <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 relative overflow-hidden">
                  {thumbnailDataUrl ? (
                    <img src={thumbnailDataUrl} alt={video.file_name} className="w-full h-full object-cover" />
                  ) : (
                    <StaticImagePlaceholder kind="video" />
                  )}
                  {video.duration && (
                    <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-full">
                      {Math.floor(video.duration / 60)}分钟
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <h3 className="font-semibold text-gray-900 text-sm mb-2 line-clamp-2">{video.file_name}</h3>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>{video.file_size ? `${(video.file_size / 1024 / 1024 / 1024).toFixed(1)} GB` : ''}</span>
                    <span>{video.resolution || '单视频'}</span>
                  </div>
                </div>
              </Link>
            );
          })}
          {seriesList.length === 0 && videos.length === 0 && (
            <div className="col-span-4 text-center text-gray-500 py-12">
              <p className="text-lg mb-4">暂无视频</p>
              <p className="text-sm">点击"扫描文件夹"添加视频</p>
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-gray-900">热门演员</h2>
          <Link to="/actors" className="text-blue-500 hover:text-blue-600 text-sm font-medium">
            查看全部 →
          </Link>
        </div>
        <div className="grid grid-cols-4 gap-6">
          {actors.slice(0, 4).map((actor) => {
            const photoDataUrl = actorPhotoDataUrl(actor);
            return (
              <Link key={actor.id} to={`/actors/${actor.id}`} className="card block">
                <div className="aspect-[3/4] bg-gradient-to-br from-pink-100 to-pink-200 relative overflow-hidden">
                  {photoDataUrl ? (
                    <img src={photoDataUrl} alt={actor.name} className="w-full h-full object-cover" />
                  ) : (
                    <StaticImagePlaceholder kind="actor" />
                  )}
                </div>
                <div className="p-4">
                  <h3 className="font-semibold text-gray-900 mb-1">{actor.name}</h3>
                  <div className="text-sm text-gray-500">{actor.birthday ? `${actor.birthday}` : ''}</div>
                </div>
              </Link>
            );
          })}
          {actors.length === 0 && (
            <div className="col-span-4 text-center text-gray-500 py-12">暂无演员</div>
          )}
        </div>
      </section>
    </div>
  );
};

export default Home;
