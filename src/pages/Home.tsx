import React from 'react';
import { Link } from 'react-router-dom';
import type { VideoSeries } from '../utils/api';
import { actorPhotoDataUrl, SmartPoster, StaticImagePlaceholder } from '../utils/media';
import { useLibraryStore } from '../store/libraryStore';
import { HorizontalScroll } from '../components/HorizontalScroll';

const Home: React.FC = () => {
  const { actors, series: storeSeries, favorites } = useLibraryStore();

  const seriesList = [...storeSeries].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <div>

      {/* 我的追番 */}
      <section className="mb-16">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-gray-900">
            我的追番
          </h2>
          <Link to="/library?favorite=1" className="text-blue-500 hover:text-blue-600 text-sm font-medium">
            查看全部 →
          </Link>
        </div>
        {favorites.length > 0 ? (
          <HorizontalScroll
            items={favorites}
            renderItem={(item) => {
              // 所有追番项都是视频集
              const series = item as VideoSeries;
              return (
                  <Link
                    to={`/series/${series.id}`}
                    state={{ from: '/', backLabel: '返回首页' }}
                    className="group"
                  >
                    <div className="card relative w-full aspect-[3/4] overflow-hidden">
                      <SmartPoster src={series.poster_data_url} alt={series.title} posterOrientation={series.poster_orientation} />
                  <div className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-black/50 to-transparent"></div>
                      <div className="absolute bottom-2 right-2 text-white text-xs drop-shadow-lg">
                        {series.status === 'completed' ? `全${series.video_count}话` : `更新至第${series.video_count}话`}
                      </div>
                    </div>
                    <div className="mt-2">
                      <h3 className="text-sm font-medium text-zinc-900 truncate group-hover:text-blue-600" title={series.title}>{series.title}</h3>
                      <div className="text-xs text-zinc-500 mt-0.5">{series.is_watched ? '已看完' : series.last_watched_episode ? `看到第${series.last_watched_episode}话` : '尚未观看'}</div>
                    </div>
                  </Link>
                );
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
            <Link key={`series-${series.id}`} to={`/series/${series.id}`} state={{ from: '/', backLabel: '返回首页' }} className="group">
              <div className="card relative w-full aspect-[3/4] overflow-hidden">
                <SmartPoster src={series.poster_data_url} alt={series.title} posterOrientation={series.poster_orientation} />
                  <div className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-black/50 to-transparent"></div>
                <div className="absolute bottom-2 right-2 text-white text-xs drop-shadow-lg">
                  {series.status === 'completed' ? `全${series.video_count}话` : `更新至第${series.video_count}话`}
                </div>
              </div>
              <div className="mt-2">
                <h3 className="text-sm font-medium text-zinc-900 truncate group-hover:text-blue-600" title={series.title}>{series.title}</h3>
                <div className="text-xs text-zinc-500 mt-0.5">{series.is_watched ? '已看完' : series.last_watched_episode ? `看到第${series.last_watched_episode}话` : '尚未观看'}</div>
              </div>
            </Link>
          ))}
          {seriesList.length === 0 && (
            <div className="col-span-4 md:col-span-5 text-center text-gray-500 py-12">
              暂无视频
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
