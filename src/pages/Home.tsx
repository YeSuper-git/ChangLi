import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import loadingIcon from '../assets/icons/loading.svg';
import {
  getStandaloneVideosByTag,
  getVideoSeriesByTag,
} from '../utils/api';
import type { Video, VideoSeries } from '../utils/api';
import { actorPhotoDataUrl, SmartPoster, StaticImagePlaceholder, videoPosterDataUrl } from '../utils/media';
import { useLibraryStore } from '../store/libraryStore';
import { HorizontalScroll } from '../components/HorizontalScroll';

const Home: React.FC = () => {
  const { actors, tags, videos: storeVideos, series: storeSeries, favorites } = useLibraryStore();
  const [videos, setVideos] = useState<Video[]>([]);
  const [seriesList, setSeriesList] = useState<VideoSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTagId, setActiveTagId] = useState<number | null>(null);

  useEffect(() => {
    loadAndApplyTag(null);
  }, []);

  const loadAndApplyTag = async (tagId: number | null) => {
    try {
      if (tagId) {
        const [videosList, series] = await Promise.all([
          getStandaloneVideosByTag(tagId),
          getVideoSeriesByTag(tagId),
        ]);
        setVideos(videosList);
        setSeriesList(series);
      } else {
        // Sort by created_at DESC
        const sortedVideos = [...storeVideos].sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        const sortedSeries = [...storeSeries].sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        setVideos(sortedVideos);
        setSeriesList(sortedSeries);
      }
      setActiveTagId(tagId);
    } catch (error) {
      console.error('[Home] 加载数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTagClick = (tagId: number | null) => {
    setLoading(true);
    loadAndApplyTag(tagId);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 "><img src={loadingIcon} alt="加载中" className="w-6 h-6" /> 加载中...</div>
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

      {/* 我的追番 */}
      <section className="mb-16">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-gray-900">
            我的追番
          </h2>
        </div>
        {favorites.length > 0 ? (
          <HorizontalScroll
            items={favorites}
            renderItem={(item) => {
              const isSeries = 'video_count' in item;
              if (isSeries) {
                const series = item as VideoSeries;
                return (
                  <Link
                    to={`/series/${series.id}`}
                    state={{ from: '/', backLabel: '返回首页' }}
                    className="card flex flex-col h-full group"
                  >
                    <div className="relative w-full aspect-[2/3]">
                      <SmartPoster src={series.poster_data_url} alt={series.title} posterOrientation={series.poster_orientation} />
                      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 via-black/40 to-transparent"></div>
                      <div className="absolute bottom-2 right-2 bg-black/60 rounded-md text-white text-xs px-2 py-0.5">
                        {series.status === 'completed' ? `全${series.video_count}话` : `更新至第${series.video_count}话`}
                      </div>
                    </div>
                    <div className="relative -mt-14 p-2 flex flex-col justify-end h-20">
                      <h3 className="font-medium text-white text-sm line-clamp-2 group-hover:text-blue-400">{series.title}</h3>
                      <div className="text-xs text-white/70 mt-1">{series.last_watched_episode ? `看到第${series.last_watched_episode}话` : '尚未观看'}</div>
                    </div>
                  </Link>
                );
              } else {
                const video = item as Video;
                const thumbnailDataUrl = videoPosterDataUrl(video);
                return (
                  <Link
                    to={`/video/${video.id}?fromHome=1`}
                    state={{ from: '/', backLabel: '返回首页' }}
                    className="card flex flex-col h-full group"
                  >
                    <div className="relative w-full aspect-video">
                      <SmartPoster src={thumbnailDataUrl} alt={video.file_name} width={video.width} height={video.height} />
                      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 via-black/40 to-transparent"></div>
                      {video.duration && (
                        <div className="absolute bottom-2 right-2 bg-black/60 rounded-md text-white text-xs px-2 py-0.5">
                          {Math.floor(video.duration / 60)}分钟
                        </div>
                      )}
                    </div>
                    <div className="relative -mt-14 p-2 flex flex-col justify-end h-20">
                      <h3 className="font-medium text-white text-sm line-clamp-2 group-hover:text-blue-400">{video.file_name}</h3>
                      <div className="text-xs text-white/70 mt-1">尚未观看</div>
                    </div>
                  </Link>
                );
              }
            }}
          />
        ) : (
          <div className="text-center text-gray-500 py-12">
            暂无追番
          </div>
        )}
      </section>

      <section className="mb-16">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-gray-900">我的视频库</h2>
          <Link to="/library" className="text-blue-500 hover:text-blue-600 text-sm font-medium">
            查看全部 →
          </Link>
        </div>
        <div className="grid grid-cols-4 md:grid-cols-5 gap-5 auto-rows-max">
          {seriesList.slice(0, 8).map((series) => (
            <Link key={`series-${series.id}`} to={`/series/${series.id}`} state={{ from: '/', backLabel: '返回首页' }} className="card flex flex-col group">
              <div className="aspect-[2/3] relative w-full">
                <SmartPoster src={series.poster_data_url} alt={series.title} posterOrientation={series.poster_orientation} />
                <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 via-black/40 to-transparent"></div>
                <div className="absolute bottom-2 right-2 bg-black/60 rounded-md text-white text-xs px-2 py-0.5">
                  {series.status === 'completed' ? `全${series.video_count}话` : `更新至第${series.video_count}话`}
                </div>
              </div>
              <div className="relative -mt-14 p-2 flex flex-col justify-end h-20">
                <h3 className="font-medium text-white text-sm line-clamp-2 group-hover:text-blue-400">{series.title}</h3>
                <div className="text-xs text-white/70 mt-1">{series.last_watched_episode ? `看到第${series.last_watched_episode}话` : '尚未观看'}</div>
              </div>
            </Link>
          ))}
          {videos.slice(0, Math.max(0, 8 - seriesList.length)).map((video) => {
            const thumbnailDataUrl = videoPosterDataUrl(video);
            return (
              <Link key={`video-${video.id}`} to={`/video/${video.id}?fromHome=1`} state={{ from: '/', backLabel: '返回首页' }} className="card flex flex-col group">
                <div className="relative w-full aspect-video">
                  <SmartPoster src={thumbnailDataUrl} alt={video.file_name} width={video.width} height={video.height} />
                  <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 via-black/40 to-transparent"></div>
                  {video.duration && (
                    <div className="absolute bottom-2 right-2 bg-black/60 rounded-md text-white text-xs px-2 py-0.5">
                      {Math.floor(video.duration / 60)}分钟
                    </div>
                  )}
                </div>
                <div className="relative -mt-14 p-2 flex flex-col justify-end h-20">
                  <h3 className="font-medium text-white text-sm line-clamp-2 group-hover:text-blue-400">{video.file_name}</h3>
                  <div className="text-xs text-white/70 mt-1">尚未观看</div>
                </div>
              </Link>
            );
          })}
          {seriesList.length === 0 && videos.length === 0 && (
            <div className="col-span-4 md:col-span-5 text-center text-gray-500 py-12">
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
              <Link key={actor.id} to={`/actors/${actor.id}`} state={{ from: '/', backLabel: '返回首页' }} className="card block">
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
