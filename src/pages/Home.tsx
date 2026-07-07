import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { VideoSeries, Category, CategoryFeatures, PlayHistory, Video } from '../utils/api';
import { formatSeriesEpisodeCountLabel, formatSeriesWatchLabel, getAllCategories, getPlayHistory, getVideos, parseCategoryFeatures } from '../utils/api';
import { actorPhotoDataUrl, SmartPoster, StaticImagePlaceholder } from '../utils/media';
import loadingIcon from '../assets/icons/loading.svg';
import { useLibraryStore } from '../store/libraryStore';
import FloatingActions from '../components/FloatingActions';

const Home: React.FC = () => {
  const { actors, series: storeSeries, favorites, refreshSeries } = useLibraryStore();
  const [categories, setCategories] = useState<Category[]>([]);
  const [playHistory, setPlayHistory] = useState<PlayHistory[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
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
    getPlayHistory()
      .then(setPlayHistory)
      .catch(() => {});
    getVideos()
      .then(setVideos)
      .catch(() => {});
  }, []);

  // 按最近观看时间排序分类
  const sortedCategories = useMemo(() => {
    if (playHistory.length === 0) return categories;
    // video_id → category_key 映射
    const videoToCategory = new Map<number, string>();
    for (const s of storeSeries) {
      videoToCategory.set(s.id, s.display_type || (s.has_actor ? 'adult' : 'anime'));
    }
    // category_key → 最近观看时间
    const catLastWatched = new Map<string, number>();
    for (const h of playHistory) {
      const catKey = videoToCategory.get(h.video_id);
      if (catKey) {
        const t = new Date(h.last_played).getTime();
        if (!catLastWatched.has(catKey) || t > catLastWatched.get(catKey)!) {
          catLastWatched.set(catKey, t);
        }
      }
    }
    return [...categories].sort((a, b) => {
      const ta = catLastWatched.get(a.key) ?? -1;
      const tb = catLastWatched.get(b.key) ?? -1;
      return tb - ta;
    });
  }, [categories, playHistory, storeSeries]);

  // video_id → series_id 映射 + series_id → 最近观看时间
  const seriesLastWatched = useMemo(() => {
    const map = new Map<number, number>();
    if (playHistory.length === 0 || videos.length === 0) return map;
    // video_id → series_id
    const videoToSeries = new Map<number, number>();
    for (const v of videos) {
      if (v.series_id) videoToSeries.set(v.id, v.series_id);
    }
    // series_id → 最近观看时间
    for (const h of playHistory) {
      const sid = videoToSeries.get(h.video_id);
      if (sid) {
        const t = new Date(h.last_played).getTime();
        if (!map.has(sid) || t > map.get(sid)!) {
          map.set(sid, t);
        }
      }
    }
    return map;
  }, [playHistory, videos]);

  const seriesList = [...storeSeries].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // 追番按最近观看排序
  const sortedFavorites = useMemo(() => {
    if (seriesLastWatched.size === 0) return favorites;
    return [...favorites].sort((a, b) => {
      const ta = seriesLastWatched.get(a.id) ?? -1;
      const tb = seriesLastWatched.get(b.id) ?? -1;
      return tb - ta;
    });
  }, [favorites, seriesLastWatched]);

  const getCategoryFeatures = (series: VideoSeries): CategoryFeatures => {
    const cat = categories.find(c => c.key === series.display_type);
    if (!cat) {
      const isLegacyAdult = series.has_actor || series.display_type === 'adult';
      return {
        tags: !isLegacyAdult,
        actors: isLegacyAdult,
        tracking: !isLegacyAdult,
        watched: !isLegacyAdult,
        status: !isLegacyAdult,
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

  const renderSeriesCard = (series: VideoSeries, options?: { aspectClass?: string; epWord?: string; showSubBadge?: boolean }) => {
    const aspectClass = options?.aspectClass || (series.poster_orientation === 'portrait' ? 'aspect-[3/4]' : 'aspect-video');
    const epWord = options?.epWord || getEpisodeWord(series);
    const isTracking = getCategoryFeatures(series).tracking;
    return (
      <Link key={`series-${series.id}`} to={`/series/${series.id}`} state={{ from: '/', backLabel: '返回首页' }} className="group block min-w-0">
        <div className={`card relative w-full ${aspectClass} overflow-hidden`}>
          <SmartPoster src={series.poster_data_url} alt={series.title} posterOrientation={series.poster_orientation} />
          <div className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-black/55 to-transparent" />
          {options?.showSubBadge && series.has_chinese_sub === 1 && (
            <span className="absolute bottom-2 left-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-bold text-rose-600 shadow-sm backdrop-blur-sm">
              中字
            </span>
          )}
          <div className="absolute bottom-2 right-2 rounded-full bg-black/45 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur-sm">
            {formatSeriesEpisodeCountLabel(series, epWord, isTracking, true)}
          </div>
        </div>
        <div className="mt-2 min-w-0">
          <h3 className="truncate text-sm font-semibold text-zinc-900 transition-colors group-hover:text-rose-600" title={series.title}>{series.title}</h3>
          <div className="mt-0.5 truncate text-xs text-zinc-500">
            {formatSeriesWatchLabel(series, epWord)}
          </div>
        </div>
      </Link>
    );
  };

  return (
    <>
      <div className="changli-page">
        <section className="changli-detail-hero changli-panel mb-12 overflow-hidden p-7">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="changli-heading-xl mb-3">今天想看什么</h1>
              <p className="changli-muted max-w-2xl text-sm leading-6">
                快速回到追番进度，浏览最近入库的视频集，也可以直接进入演员库继续整理收藏。
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link to="/library" className="action-btn action-btn-primary">进入视频库</Link>
              <Link to="/actors" className="action-btn">演员库</Link>
            </div>
          </div>
          <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="changli-stat-card rounded-2xl border border-white/70 bg-white/68 p-5 shadow-sm">
              <div className="text-3xl font-extrabold tracking-tight text-gray-950">{seriesList.length}</div>
              <div className="mt-1 text-sm font-medium text-gray-500">视频集</div>
            </div>
            <div className="changli-stat-card rounded-2xl border border-white/70 bg-white/68 p-5 shadow-sm">
              <div className="text-3xl font-extrabold tracking-tight text-gray-950">{favorites.length}</div>
              <div className="mt-1 text-sm font-medium text-gray-500">追番</div>
            </div>
            <div className="changli-stat-card rounded-2xl border border-white/70 bg-white/68 p-5 shadow-sm">
              <div className="text-3xl font-extrabold tracking-tight text-gray-950">{actors.length}</div>
              <div className="mt-1 text-sm font-medium text-gray-500">演员</div>
            </div>
          </div>
        </section>

        <section className="mb-16">
          <div className="changli-section-title">
            <h2 className="text-2xl font-bold text-gray-900">我的追番</h2>
            <Link to="/library?favorite=1&scope=all" className="changli-section-link">查看全部 ›</Link>
          </div>
          {favorites.length > 0 ? (
            <div className="changli-auto-grid-series changli-home-one-row changli-home-one-row-series">
              {sortedFavorites.slice(0, 10).map((item) => renderSeriesCard(item as VideoSeries, { aspectClass: 'aspect-[3/4]' }))}
            </div>
          ) : (
            <div className="changli-empty-state text-gray-500">暂无追番</div>
          )}
        </section>

        {sortedCategories.length > 0 ? sortedCategories.map((cat) => {
          const features = parseCategoryFeatures(cat.features);
          const catSeries = seriesList
            .filter(s => s.display_type === cat.key || (!s.display_type && !s.has_actor && cat.key === 'anime') || (s.has_actor && cat.key === 'adult'))
            .sort((a, b) => {
              const ta = seriesLastWatched.get(a.id) ?? -1;
              const tb = seriesLastWatched.get(b.id) ?? -1;
              if (ta !== tb) return tb - ta;
              return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            });
          const isPortrait = cat.card_layout === 'portrait';
          const aspectClass = isPortrait ? 'aspect-[3/4]' : 'aspect-video';
          const epWord = features.episode || '部';

          return (
            <section key={cat.key} className="mb-16">
              <div className="changli-section-title">
                <h2 className="text-2xl font-bold text-gray-900">我的{cat.name}</h2>
                <Link to={`/library?cat=${cat.key}`} className="changli-section-link">查看全部 ›</Link>
              </div>
              {catSeries.length > 0 ? (
                <div className={`${isPortrait ? 'changli-auto-grid-series changli-home-one-row-series' : 'changli-auto-grid-video changli-home-one-row-video'} changli-home-one-row`}>
                  {catSeries.slice(0, 8).map((series) => renderSeriesCard(series, { aspectClass, epWord, showSubBadge: features.chinese_sub }))}
                </div>
              ) : (
                <div className="changli-empty-state text-gray-500">暂无{cat.name}</div>
              )}
            </section>
          );
        }) : (
          <section className="mb-16">
            <div className="changli-section-title">
              <h2 className="text-2xl font-bold text-gray-900">正在加载内容</h2>
            </div>
            <div className="changli-empty-state text-gray-500">
              <img src={loadingIcon} alt="加载中" className="mx-auto h-6 w-6 animate-spin" />
            </div>
          </section>
        )}

        <section>
          <div className="changli-section-title">
            <h2 className="text-2xl font-bold text-gray-900">热门演员</h2>
            <Link to="/actors" className="changli-section-link">查看全部 ›</Link>
          </div>

          {actors.length > 0 ? (
            <div className="changli-scroll-wrap group">
              <div ref={hotActorsRef} className="changli-scroll-track changli-hot-actors-track scrollbar-hide snap-x snap-mandatory overflow-x-auto px-1 pb-4 scroll-smooth">
                {actors.slice(0, 10).map((actor) => {
                  const photoDataUrl = actorPhotoDataUrl(actor);
                  return (
                    <Link key={actor.id} to={`/actors/${actor.id}`} state={{ from: '/', backLabel: '返回首页' }} className="card block w-[250px] flex-shrink-0 snap-start">
                      <div className="aspect-[3/4] overflow-hidden rounded-2xl bg-gradient-to-br from-pink-100 to-rose-200">
                        {photoDataUrl ? (
                          <img src={photoDataUrl} alt={actor.name} className="h-full w-full object-cover" />
                        ) : (
                          <StaticImagePlaceholder kind="actor" />
                        )}
                      </div>
                      <div className="px-4 py-3">
                        <h3 className="truncate font-semibold text-gray-900" title={actor.name}>{actor.name}</h3>
                        <div className="truncate text-xs text-gray-500">{actor.alias || ''}</div>
                      </div>
                    </Link>
                  );
                })}

                <Link to="/actors" className="card block w-[250px] flex-shrink-0 snap-start">
                  <div className="aspect-[3/4] rounded-2xl border-2 border-dashed border-gray-300 bg-white/58 flex items-center justify-center text-gray-500 transition-colors hover:border-rose-300 hover:text-rose-500">
                    <div className="text-center">
                      <div className="mb-1 text-2xl">›</div>
                      <div className="text-sm font-semibold">查看更多</div>
                    </div>
                  </div>
                  <div className="px-4 py-3">
                    <div className="font-semibold text-gray-900">演员列表</div>
                    <div className="text-xs text-gray-500">查看全部演员</div>
                  </div>
                </Link>
              </div>

              <button
                type="button"
                aria-label="向左滚动"
                className="changli-scroll-arrow absolute left-2 top-1/2 z-10 -translate-y-1/2 opacity-0 group-hover:opacity-100"
                onClick={() => scrollHotActors('left')}
              >
                ‹
              </button>
              <button
                type="button"
                aria-label="向右滚动"
                className="changli-scroll-arrow absolute right-2 top-1/2 z-10 -translate-y-1/2 opacity-0 group-hover:opacity-100"
                onClick={() => scrollHotActors('right')}
              >
                ›
              </button>
            </div>
          ) : (
            <div className="changli-empty-state text-gray-500">暂无演员</div>
          )}
        </section>

        <FloatingActions onRefresh={async () => { await refreshSeries(); }} refreshLabel="刷新" />
      </div>
    </>
  );
};

export default Home;
