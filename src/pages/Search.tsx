import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getActors, getVideos } from '../utils/api';
import type { Actor, Video } from '../utils/api';
import { actorPhotoDataUrl, StaticImagePlaceholder, videoPosterDataUrl } from '../utils/media';

type SearchItem =
  | { type: 'video'; id: number; title: string; subtitle: string; video: Video }
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
  const queryKeyword = useMemo(() => new URLSearchParams(location.search).get('q') || '', [location.search]);
  const [keyword, setKeyword] = useState(queryKeyword);
  const [videos, setVideos] = useState<Video[]>([]);
  const [actors, setActors] = useState<Actor[]>([]);
  const [results, setResults] = useState<SearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    setKeyword(queryKeyword);
    if (queryKeyword.trim()) {
      handleSearch(queryKeyword);
    }
  }, [queryKeyword]);

  const buildResults = (searchKeyword: string, videoList: Video[], actorList: Actor[]) => {
    const videoResults: SearchItem[] = videoList
      .filter((video) =>
        fuzzyMatch(video.file_name, searchKeyword) ||
        fuzzyMatch(video.description || '', searchKeyword) ||
        fuzzyMatch(video.source_site || '', searchKeyword)
      )
      .map((video) => ({
        type: 'video',
        id: video.id,
        title: video.file_name,
        subtitle: video.resolution ? `视频 · ${video.resolution}` : '视频',
        video,
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

    return [...videoResults, ...actorResults];
  };

  const handleSearch = async (inputKeyword = keyword) => {
    const nextKeyword = inputKeyword.trim();
    if (!nextKeyword) return;

    setLoading(true);
    setSearched(true);

    try {
      const [videoList, actorList] = await Promise.all([
        videos.length ? Promise.resolve(videos) : getVideos(),
        actors.length ? Promise.resolve(actors) : getActors(),
      ]);
      setVideos(videoList);
      setActors(actorList);
      setResults(buildResults(nextKeyword, videoList, actorList));
      if (nextKeyword !== queryKeyword) {
        navigate(`/search?q=${encodeURIComponent(nextKeyword)}`, { replace: true });
      }
    } catch (error) {
      console.error('搜索失败:', error);
      setResults([]);
    } finally {
      setLoading(false);
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
          disabled={loading || !keyword.trim()}
          className="px-8 py-3 bg-gray-900 text-white rounded-xl font-medium hover:bg-gray-800 disabled:opacity-50"
        >
          {loading ? '搜索中...' : '搜索'}
        </button>
      </form>

      {searched && (
        <div>
          <div className="text-gray-500 mb-8">
            {loading ? '搜索中...' : `找到 ${results.length} 个本地结果`}
          </div>

          {results.length > 0 ? (
            <div className="space-y-4">
              {results.map((item) => {
                const target = item.type === 'video' ? `/video/${item.id}` : `/actors/${item.id}`;
                const imageDataUrl = item.type === 'video'
                  ? videoPosterDataUrl(item.video)
                  : actorPhotoDataUrl(item.actor);
                return (
                  <Link key={`${item.type}-${item.id}`} to={target} className="card p-5 flex gap-5 no-underline">
                    <div className="w-24 h-32 bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center">
                      {imageDataUrl ? (
                        <img src={imageDataUrl} alt={item.title} className="w-full h-full object-cover" />
                      ) : (
                        <StaticImagePlaceholder kind={item.type === 'video' ? 'video' : 'actor'} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="inline-flex px-2 py-1 rounded-full bg-gray-100 text-gray-600 text-xs mb-3">
                        {item.type === 'video' ? '视频' : '演员'}
                      </div>
                      <h3 className="text-xl font-semibold text-gray-900 mb-2 truncate">{item.title}</h3>
                      <p className="text-sm text-gray-500">{item.subtitle}</p>
                      {item.type === 'video' && item.video.description && (
                        <p className="text-sm text-gray-600 mt-3 line-clamp-2">{item.video.description}</p>
                      )}
                      {item.type === 'actor' && item.actor.bio && (
                        <p className="text-sm text-gray-600 mt-3 line-clamp-2">{item.actor.bio}</p>
                      )}
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
