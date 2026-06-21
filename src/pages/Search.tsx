import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { Actor, VideoSeries } from '../utils/api';
import { actorPhotoDataUrl, SmartPoster, StaticImagePlaceholder } from '../utils/media';
import { useLibraryStore } from '../store/libraryStore';

type SearchItem =
  | { type: 'series'; id: number; title: string; subtitle: string; series: VideoSeries }
  | { type: 'actor'; id: number; title: string; subtitle: string; actor: Actor };

const normalize = (value: string) => value.toLowerCase().trim();

const fuzzyMatch = (source: string, keyword: string) => {
  const text = normalize(source);
  const query = normalize(keyword);
  if (!query) return false;
  if (text.includes(query)) return true;

  let queryIndex = 0;
  for (const char of text) {
    if (char === query[queryIndex]) queryIndex += 1;
    if (queryIndex === query.length) return true;
  }
  return false;
};

const Search: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { series: storeSeries, actors: storeActors, loadAll, loaded } = useLibraryStore();
  const queryKeyword = useMemo(() => new URLSearchParams(location.search).get('q') || '', [location.search]);
  const [keyword, setKeyword] = useState(queryKeyword);
  const [results, setResults] = useState<SearchItem[]>([]);
  
  const [searched, setSearched] = useState(false);

  // 首次进入时确保 store 已加载
  useEffect(() => {
    if (!loaded) loadAll();
  }, [loaded, loadAll]);

  useEffect(() => {
    setKeyword(queryKeyword);
    if (queryKeyword.trim()) {
      handleSearch(queryKeyword);
    }
  }, [queryKeyword]);

  const buildResults = (searchKeyword: string, seriesItems: VideoSeries[], actorList: Actor[]) => {
    const seriesResults: SearchItem[] = seriesItems
      .filter((series) =>
        fuzzyMatch(series.title, searchKeyword) ||
        fuzzyMatch(series.description || '', searchKeyword)
      )
      .map((series) => ({
        type: 'series',
        id: series.id,
        title: series.title,
        subtitle: `${(series.has_actor || series.display_type === 'adult') ? '影视' : '动漫'} · ${series.status === 'completed' ? `全${series.video_count}${(series.has_actor || series.display_type === 'adult') ? '部' : '话'}` : `更新至第${series.video_count}${(series.has_actor || series.display_type === 'adult') ? '部' : '话'}`}`,
        series,
      }));

    const actorResults: SearchItem[] = actorList
      .filter((actor) =>
        fuzzyMatch(actor.name, searchKeyword) ||
        fuzzyMatch(actor.japanese_name || '', searchKeyword) ||
        fuzzyMatch(actor.bio || '', searchKeyword)
      )
      .map((actor) => ({
        type: 'actor',
        id: actor.id,
        title: actor.name,
        subtitle: actor.japanese_name ? `演员 · ${actor.japanese_name}` : '演员',
        actor,
      }));

    return [...seriesResults, ...actorResults];
  };

  const handleSearch = (inputKeyword = keyword) => {
    const nextKeyword = inputKeyword.trim();
    if (!nextKeyword) return;

    setSearched(true);
    setResults(buildResults(nextKeyword, storeSeries, storeActors));
    if (nextKeyword !== queryKeyword) {
      navigate(`/search?q=${encodeURIComponent(nextKeyword)}`, { replace: true });
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    handleSearch(keyword);
  };

  return (
    <div>
      <h1 className="text-3xl font-bold mb-10">搜索</h1>

      <form onSubmit={handleSubmit} className="flex gap-4 mb-10">
        <input
          type="search"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="输入视频名、演员名或简介关键词..."
          className="search-input flex-1"
          autoFocus
        />
        <button
          type="submit"
          disabled={!keyword.trim()}
          className="px-8 py-3 bg-gray-900 text-white rounded-xl font-medium hover:bg-gray-800 disabled:opacity-50"
        >
          搜索
        </button>
      </form>

      {searched && (
        <div>
          <div className="text-gray-500 mb-8">
            找到 {results.length} 个本地结果
          </div>

          {results.length > 0 ? (
            <div className="grid grid-cols-2 gap-4">
              {results.map((item) => {
                const target = item.type === 'series' ? `/series/${item.id}` : `/actors/${item.id}`;
                const imageDataUrl = item.type === 'series'
                    ? item.series.poster_data_url
                    : actorPhotoDataUrl(item.actor);
                const aspectClass = item.type === 'series'
                  ? (item.series.poster_orientation === 'portrait' ? 'aspect-[2/3]' : 'aspect-video')
                  : item.type === 'actor'
                    ? 'aspect-[3/4]'
                    : 'aspect-video';
                return (
                  <Link key={`${item.type}-${item.id}`} to={target} className="card flex flex-col no-underline group">
                    <div className={`relative w-full ${aspectClass} bg-gradient-to-br from-gray-100 to-gray-200 rounded-t-xl overflow-hidden flex items-center justify-center`}>
                      {item.type === 'actor' ? (
                        imageDataUrl ? (
                          <img src={imageDataUrl} alt={item.title} className="w-full h-full object-cover" />
                        ) : (
                          <StaticImagePlaceholder kind="actor" />
                        )
                      ) : (
                        <SmartPoster
                          src={imageDataUrl}
                          alt={item.title}
                          posterOrientation={item.type === 'series' ? item.series.poster_orientation : undefined}
                        />
                      )}
                    </div>
                    <div className="p-3 min-w-0">
                      <div className="inline-flex px-2 py-1 rounded-full bg-gray-100 text-gray-600 text-xs mb-2">
                        {item.type === 'series' ? '视频集' : '演员'}
                      </div>
                      <h3 className="text-sm font-semibold text-gray-900 mb-1 line-clamp-2 group-hover:text-blue-600">{item.title}</h3>
                      <p className="text-xs text-gray-500 line-clamp-1">{item.subtitle}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-16">
              <p className="text-gray-500 text-lg">没有找到匹配的视频或演员</p>
            </div>
          )}
        </div>
      )}

      {!searched && (
        <div className="text-center py-16">
          <p className="text-gray-500 text-lg">在右上角或这里输入关键词，支持模糊搜索视频和演员</p>
        </div>
      )}
    </div>
  );
};

export default Search;
