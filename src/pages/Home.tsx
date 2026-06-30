import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { VideoSeries, Category, CategoryFeatures } from '../utils/api';
import { getAllCategories, parseCategoryFeatures } from '../utils/api';
import { actorPhotoDataUrl, SmartPoster, StaticImagePlaceholder } from '../utils/media';
import loadingIcon from '../assets/icons/loading.svg';
import { useLibraryStore } from '../store/libraryStore';
import { HorizontalScroll } from '../components/HorizontalScroll';
import FloatingActions from '../components/FloatingActions';

const Home: React.FC = () => {
  const { actors, series: storeSeries, favorites, refreshSeries } = useLibraryStore();
  const [categories, setCategories] = useState<Category[]>([]);
  const hotActorsRef = useRef<HTMLDivElement>(null);

  const scrollHotActors = (direction: 'left' | 'right') => {
    const el = hotActorsRef.current;
    if (!el) return;
    const amount = Math.round(el.clientWidth * 0.7);
    el.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' });
  };

  useEffect(() => {
    window.scrollTo(0, 0);
    getAllCategories()
      .then(setCategories)
      .catch((err) => console.error('[Home] 加载大类配置失败:', err));
  }, []);

  const seriesList = [...storeSeries].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const getCategoryFeatures = (series: VideoSeries): CategoryFeatures => {
    const cat = categories.find(c => c.key === series.display_type);
    if (!cat) {
      // fallback: 和原 isAdult 行为一致
      const isLegacyAdult = series.has_actor || series.display_type === 'adult';
      return {
        tags: !isLegacyAdult,
        actors: isLegacyAdult,
        tracking: !isLegacyAdult,
        chinese_sub: isLegacyAdult,
        episode: !isLegacyAdult ? '话' : '部',
      };
    }
    return parseCategoryFeatures(cat.features);
  };



  const getEpisodeWord = (series: VideoSeries): string => {
    const features = getCategoryFeatures(series);
    return features.episode || '部';
  };

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
                        {series.status === 'completed' ? `共${series.video_count}${getEpisodeWord(series)}` : `更新至第${series.video_count}${getEpisodeWord(series)}`}
                      </div>
                    </div>
                    <div className="mt-2">
                      <h3 className="text-sm font-medium text-zinc-900 truncate group-hover:text-blue-600" title={series.title}>{series.title}</h3>
                      <div className="text-xs text-zinc-500 mt-0.5">{series.is_watched ? '已看完' : series.last_watched_episode ? `看到第${series.last_watched_episode}${getEpisodeWord(series)}` : '尚未观看'}</div>
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

      {/* 大类区块 */}
      {categories.length > 0 ? categories.map((cat) => {
        const features = parseCategoryFeatures(cat.features);
        const catSeries = seriesList.filter(s => s.display_type === cat.key || (!s.display_type && !s.has_actor && cat.key === 'anime') || (s.has_actor && cat.key === 'adult'));
        const isPortrait = cat.card_layout === 'portrait';
        const gridCols = isPortrait ? 'grid-cols-4 md:grid-cols-5' : 'grid-cols-3 md:grid-cols-4';
        const aspectClass = isPortrait ? 'aspect-[3/4]' : 'aspect-video';
        const epWord = features.episode || '部';

        return (
          <section key={cat.key} className="mb-16">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-2xl font-bold text-gray-900">我的{cat.name}</h2>
              <Link to={`/library?cat=${cat.key}`} className="text-blue-500 hover:text-blue-600 text-sm font-medium">
                查看全部 →
              </Link>
            </div>
            <div className={`grid ${gridCols} gap-5 auto-rows-max`}>
              {catSeries.slice(0, 8).map((series) => (
                <Link key={`series-${series.id}`} to={`/series/${series.id}`} state={{ from: '/', backLabel: '返回首页' }} className="group">
                  <div className={`card relative w-full ${aspectClass} overflow-hidden`}>
                    <SmartPoster src={series.poster_data_url} alt={series.title} posterOrientation={series.poster_orientation} />
                    <div className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-black/50 to-transparent"></div>
                    {features.chinese_sub && series.has_chinese_sub === 1 && (
                      <span className="absolute bottom-2 left-2 bg-orange-500 text-white text-xs px-1.5 py-0.5 rounded-sm">
                        中字
                      </span>
                    )}
                    <div className="absolute bottom-2 right-2 text-white text-xs drop-shadow-lg">
                      {series.status === 'completed' || !features.tracking ? `共${series.video_count}${epWord}` : `更新至第${series.video_count}${epWord}`}
                    </div>
                  </div>
                  <div className="mt-2">
                    <h3 className="text-sm font-medium text-zinc-900 truncate group-hover:text-blue-600" title={series.title}>{series.title}</h3>
                    <div className="text-xs text-zinc-500 mt-0.5">{series.is_watched ? '已看完' : series.last_watched_episode ? `看到第${series.last_watched_episode}${epWord}` : '尚未观看'}</div>
                  </div>
                </Link>
              ))}
              {catSeries.length === 0 && (
                <div className={`col-span-4 md:col-span-5 text-center text-gray-500 py-12`}>
                  暂无{cat.name}
                </div>
              )}
            </div>
          </section>
        );
      }) : (
        <>
          <section className="mb-16">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-2xl font-bold text-gray-900">我的动漫</h2>
              <Link to="/library?cat=anime" className="text-blue-500 hover:text-blue-600 text-sm font-medium">查看全部 →</Link>
            </div>
            <div className="text-center text-gray-500 py-12"><img src={loadingIcon} alt="加载中" className="w-6 h-6 animate-spin mx-auto" /></div>
          </section>
          <section className="mb-16">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-2xl font-bold text-gray-900">我的影视</h2>
              <Link to="/library?cat=adult" className="text-blue-500 hover:text-blue-600 text-sm font-medium">查看全部 →</Link>
            </div>
            <div className="text-center text-gray-500 py-12"><img src={loadingIcon} alt="加载中" className="w-6 h-6 animate-spin mx-auto" /></div>
          </section>
        </>
      )}

      <section>
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-gray-900">热门演员</h2>
          <Link to="/actors" className="text-blue-500 hover:text-blue-600 text-sm font-medium">
            查看全部 →
          </Link>
        </div>

        <div className="relative group">
          <div ref={hotActorsRef} className="flex gap-5 overflow-x-auto pb-2 scroll-smooth snap-x snap-mandatory scrollbar-hide">
            {actors.slice(0, 10).map((actor) => {
              const photoDataUrl = actorPhotoDataUrl(actor);
              return (
                <Link key={actor.id} to={`/actors/${actor.id}`} state={{ from: '/', backLabel: '返回首页' }} className="card block flex-shrink-0 w-[260px] snap-start">
                  <div className="aspect-[3/4] bg-gradient-to-br from-pink-100 to-pink-200 relative overflow-hidden rounded-xl">
                    {photoDataUrl ? (
                      <img src={photoDataUrl} alt={actor.name} className="w-full h-full object-cover" />
                    ) : (
                      <StaticImagePlaceholder kind="actor" />
                    )}
                  </div>
                  <div className="mt-2 px-1">
                    <h3 className="font-semibold text-gray-900 mb-0.5 truncate" title={actor.name}>{actor.name}</h3>
                    <div className="text-xs text-gray-500 truncate">{actor.birthday ? `${actor.birthday}` : ''}</div>
                  </div>
                </Link>
              );
            })}

            <Link to="/actors" className="card block flex-shrink-0 w-[260px] snap-start">
              <div className="aspect-[3/4] rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-500 hover:text-blue-500 hover:border-blue-400 transition-colors">
                <div className="text-center">
                  <div className="text-2xl mb-1">›</div>
                  <div className="text-sm">查看更多</div>
                </div>
              </div>
              <div className="mt-2 px-1">
                <div className="font-semibold text-gray-900">演员列表</div>
                <div className="text-xs text-gray-500">查看全部演员</div>
              </div>
            </Link>
          </div>

          {actors.length > 0 && (
            <>
              <button
                type="button"
                aria-label="向左滚动"
                className="absolute left-1 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 border border-gray-200 shadow-sm flex items-center justify-center text-gray-600 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => scrollHotActors('left')}
              >
                ‹
              </button>
              <button
                type="button"
                aria-label="向右滚动"
                className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 border border-gray-200 shadow-sm flex items-center justify-center text-gray-600 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => scrollHotActors('right')}
              >
                ›
              </button>
            </>
          )}
        </div>

        {actors.length === 0 && (
          <div className="text-center text-gray-500 py-12">暂无演员</div>
        )}
      </section>

    <FloatingActions onRefresh={async () => { await refreshSeries(); }} refreshLabel="刷新" />
    </div>
  );
};

export default Home;
