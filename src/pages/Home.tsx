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
                    className="card block flex flex-col h-full"
                  >
                    <div className="aspect-[16/10] bg-gradient-to-br from-gray-100 to-gray-200 relative overflow-hidden">
                      <SmartPoster src={series.poster_data_url} alt={series.title} posterOrientation={series.poster_orientation} />
                      <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-full">
                        {series.status === 'completed' ? `${series.video_count}集全` : `更新至${series.video_count}集`}
                      </div>
                    </div>
                    <div className="p-6 flex flex-col flex-1">
                      <h3 className="text-lg font-semibold text-gray-900 mb-3 line-clamp-2">{series.title}</h3>
                      <div className="text-sm text-gray-500 mt-auto">视频集</div>
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
                    className="card block flex flex-col h-full"
                  >
                    <div className="aspect-[16/10] bg-gradient-to-br from-gray-100 to-gray-200 relative overflow-hidden">
                      <SmartPoster src={thumbnailDataUrl} alt={video.file_name} width={video.width} height={video.height} />
                      {video.duration && (
                        <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-full">
                          {Math.floor(video.duration / 60)}分钟
                        </div>
                      )}
                    </div>
                    <div className="p-6 flex flex-col flex-1">
                      <h3 className="text-lg font-semibold text-gray-900 mb-3 line-clamp-2">{video.file_name}</h3>
                      <div className="text-sm text-gray-500 mt-auto">单视频</div>
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
            <Link key={`series-${series.id}`} to={`/series/${series.id}`} state={{ from: '/', backLabel: '返回首页' }} className="card block">
              <div className={`${series.poster_orientation === 'portrait' ? 'aspect-[2/3]' : 'aspect-video'} bg-gradient-to-br from-gray-100 to-gray-200 relative overflow-hidden`}>
                <SmartPoster src={series.poster_data_url} alt={series.title} posterOrientation={series.poster_orientation} />
                <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-full">
                  {series.status === 'completed' ? `${series.video_count}集全` : `更新至${series.video_count}集`}
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
              <Link key={`video-${video.id}`} to={`/video/${video.id}?fromHome=1`} state={{ from: '/', backLabel: '返回首页' }} className="card block">
                <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 relative overflow-hidden">
                  <SmartPoster src={thumbnailDataUrl} alt={video.file_name} width={video.width} height={video.height} />
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
