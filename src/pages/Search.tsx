import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { Actor, VideoSeries, Category, CategoryFeatures } from '../utils/api';
import { formatSeriesEpisodeCountLabel, getAllCategories, parseCategoryFeatures, toggleFavorite, toggleWatched, rescanSingleSeriesMetadata, openSeriesInFileManager, switchSeriesTypeTo, deleteVideoSeries } from '../utils/api';
import { actorPhotoDataUrl, seriesPosterSrc, SmartPoster, StaticImagePlaceholder } from '../utils/media';
import { useLibraryStore } from '../store/libraryStore';
import { notify } from '../utils/notify';
import { useSecondConfirm } from '../utils/useSecondConfirm';

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
  const [categories, setCategories] = useState<Category[]>([]);
  const queryKeyword = useMemo(() => new URLSearchParams(location.search).get('q') || '', [location.search]);
  const [keyword, setKeyword] = useState(queryKeyword);
  const [results, setResults] = useState<SearchItem[]>([]);
  
  const [searched, setSearched] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ type: 'series'; id: number; name: string; x: number; y: number } | null>(null);
  const { pendingKey, requestSecondConfirm, clearPending } = useSecondConfirm();
  const [typeSwitchSeriesId, setTypeSwitchSeriesId] = useState<number | null>(null);
  const [typeSwitchConfirm, setTypeSwitchConfirm] = useState<{ seriesId: number; categoryName: string; categoryKey: string } | null>(null);
  const { favorites, watchedIds, refreshSeries } = useLibraryStore();

  // 加载大类配置
  useEffect(() => {
    window.scrollTo(0, 0);
    getAllCategories().then(setCategories).catch(() => {});
  }, []);

  // 根据 display_type 获取大类配置
  const getCategoryFeatures = (series: VideoSeries): CategoryFeatures => {
    const key = series.display_type || '';
    const cat = categories.find(c => c.key === key);
    return cat ? parseCategoryFeatures(cat.features) : { tags: false, actors: !!series.has_actor, tracking: false, watched: false, status: false, chinese_sub: false, episode: "部", subscription: true };
  };

  const getCategoryName = (series: VideoSeries): string => {
    const key = series.display_type || '';
    const cat = categories.find(c => c.key === key);
    return cat?.name || (series.has_actor ? '影视' : '动漫');
  };

  const getEpisodeWord = (series: VideoSeries): string => {
    const features = getCategoryFeatures(series);
    return features.episode ? '话' : '部';
  };

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
        subtitle: `${getCategoryName(series)} · ${formatSeriesEpisodeCountLabel(series, getEpisodeWord(series))}`,
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

  const openContextMenu = (event: React.MouseEvent, type: 'series', id: number, name: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ type, id, name, x: event.clientX, y: event.clientY });
  };

  const handleEditContextItem = () => {
    if (!contextMenu) return;
    const target = `/series/${contextMenu.id}?edit=1`;
    setContextMenu(null);
    clearPending();
    navigate(target, { state: { from: '/search', backLabel: '返回搜索' } });
  };

  const handleOpenSeriesInFileManager = async (seriesId: number) => {
    setContextMenu(null);
    try {
      await openSeriesInFileManager(seriesId);
    } catch (err) {
      notify({ message: '打开源文件位置失败，请确认文件夹仍然存在', type: 'error' });
    }
  };

  const handleRescanMetadata = async (seriesId: number) => {
    try {
      setContextMenu(null);
      clearPending();
      const matched = await rescanSingleSeriesMetadata(seriesId);
      refreshSeries().catch(() => {});
      notify({ message: matched ? '信息已更新' : '未识别到可更新的信息', type: matched ? 'success' : 'info' });
    } catch (error) {
      notify({ message: '重新识别失败，请确认本地文件夹仍然存在', type: 'error' });
    }
  };

  const handleSwitchType = async (seriesId: number) => {
    setTypeSwitchSeriesId(seriesId);
  };

  const handleSwitchTypeTo = async (seriesId: number, categoryKey: string, categoryName: string) => {
    setTypeSwitchConfirm({ seriesId, categoryName, categoryKey });
    setTypeSwitchSeriesId(null);
    setContextMenu(null);
    clearPending();
  };

  const doSwitchType = async () => {
    if (!typeSwitchConfirm) return;
    const name = typeSwitchConfirm.categoryName;
    setTypeSwitchConfirm(null);
    try {
      await switchSeriesTypeTo(typeSwitchConfirm.seriesId, typeSwitchConfirm.categoryKey);
      refreshSeries().catch(() => {});
      notify({ message: `已切换到${name}`, type: 'success' });
    } catch (error) {
      notify({ message: '切换分类失败，请稍后重试', type: 'error' });
    }
  };

  const handleDeleteSeries = async (seriesId: number) => {
    // 乐观更新：立即从结果中移除
    setResults(prev => prev.filter(r => !(r.type === 'series' && r.id === seriesId)));
    setContextMenu(null);
    clearPending();
    try {
      await deleteVideoSeries(seriesId, true);
      refreshSeries().catch(() => {});
      notify({ message: '视频集已删除', type: 'success' });
    } catch (error) {
      notify({ message: '删除失败，请稍后重试', type: 'error' });
    }
  };

  return (
    <div className="changli-page">
      <div className="changli-page-header">
        <h1 className="changli-heading-xl">搜索</h1>
      </div>

      <form onSubmit={handleSubmit} className="changli-toolbar flex gap-4 mb-10 p-3">
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
          className="action-btn action-btn-primary disabled:opacity-50"
        >
          搜索
        </button>
      </form>

      {searched && (
        <div>
          <div className="changli-section-title">
            <span className="text-gray-500">找到 {results.length} 个本地结果</span>
          </div>

          {results.length > 0 ? (
            <div className="changli-auto-grid-video">
              {results.map((item) => {
                const target = item.type === 'series' ? `/series/${item.id}` : `/actors/${item.id}`;
                const imageDataUrl = item.type === 'series'
                    ? seriesPosterSrc(item.series)
                    : actorPhotoDataUrl(item.actor);
                const aspectClass = item.type === 'series'
                  ? (item.series.poster_orientation === 'portrait' ? 'aspect-[2/3]' : 'aspect-video')
                  : item.type === 'actor'
                    ? 'aspect-[3/4]'
                    : 'aspect-video';
                return (
                  <Link key={`${item.type}-${item.id}`} to={target} className="card flex flex-col no-underline group overflow-hidden" onContextMenu={item.type === 'series' ? (e) => openContextMenu(e, 'series', item.id, item.title) : undefined}>
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
                      <h3 className="text-sm font-semibold text-gray-900 mb-1 line-clamp-2 group-hover:text-rose-600">{item.title}</h3>
                      <p className="text-xs text-gray-500 line-clamp-1">{item.subtitle}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="changli-empty-state">
              <p className="text-gray-500 text-lg">没有找到匹配的视频或演员</p>
            </div>
          )}
        </div>
      )}

      {!searched && (
        <div className="changli-empty-state">
          <p className="text-gray-500 text-lg">在右上角或这里输入关键词，支持模糊搜索视频和演员</p>
        </div>
      )}

      {/* 右键菜单 */}
      {contextMenu && (() => {
        const series = storeSeries.find(s => s.id === contextMenu.id);
        const isFav = series ? favorites.some(f => 'video_count' in f && f.id === series.id) : false;
        const isWatched = series ? watchedIds.has(series.id) : false;
        return (
        <div
          className="changli-context-menu fixed z-50 py-2 w-fit"
          style={{ left: contextMenu.x + 160 > window.innerWidth ? contextMenu.x - 160 : contextMenu.x, top: contextMenu.y + 200 > window.innerHeight ? contextMenu.y - 200 : contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button className="changli-menu-item" onClick={handleEditContextItem}>编辑</button>
          <button className="changli-menu-item" onClick={() => handleOpenSeriesInFileManager(contextMenu.id)}>以文件资源管理器打开</button>
          <button className="changli-menu-item" onClick={() => {
            const id = contextMenu.id;
            const name = contextMenu.name;
            setContextMenu(null);
            toggleFavorite(id, 'series').then(() => {
              refreshSeries();
              notify({ message: isFav ? `已取消「${name}」的追番` : `已将「${name}」添加到追番`, type: 'success' });
            }).catch(() => { notify({ message: '操作失败，请稍后重试', type: 'error' }); });
          }}>{isFav ? '取消该追番' : '添加到追番'}</button>
          <button className="changli-menu-item" onClick={() => {
            const id = contextMenu.id;
            const name = contextMenu.name;
            setContextMenu(null);
            toggleWatched(id).then(() => {
              refreshSeries();
              notify({ message: isWatched ? `已取消「${name}」的已看完标记` : `已将「${name}」标记为已看完`, type: 'success' });
            }).catch(() => { notify({ message: '操作失败，请稍后重试', type: 'error' }); });
          }}>{isWatched ? '取消已看完标记' : '标记为已看完'}</button>
          <button className="changli-menu-item" onClick={() => handleRescanMetadata(contextMenu.id)}>检查更新</button>
          <button className="changli-menu-item" onClick={() => handleSwitchType(contextMenu.id)}>切换分类</button>
          <button className="changli-menu-item changli-menu-item-danger" onClick={() => {
            const key = `${contextMenu.type}-${contextMenu.id}`;
            requestSecondConfirm(key, () => handleDeleteSeries(contextMenu.id));
          }}>{pendingKey === `${contextMenu.type}-${contextMenu.id}` ? '再次点击确认删除' : '删除'}</button>
        </div>
        );
      })()}

      {/* 切换分类选择弹窗 */}
      {typeSwitchSeriesId !== null && (() => {
        const filteredCats = categories.filter(c => c.key !== (storeSeries.find(s => s.id === typeSwitchSeriesId)?.display_type || ''));
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setTypeSwitchSeriesId(null)}>
          <div className="changli-modal-panel" onClick={e => e.stopPropagation()}>
            <div className="changli-modal-header">
              <h2 className="changli-heading-lg">选择要切换的分类</h2>
            </div>
            <div className="changli-modal-body">
              <div className="flex flex-wrap gap-2">
                {filteredCats.map(cat => (
                  <button key={cat.key} className="changli-bubble" onClick={() => handleSwitchTypeTo(typeSwitchSeriesId, cat.key, cat.name)}>{cat.name}</button>
                ))}
                {filteredCats.length === 0 && <p className="text-gray-400 text-sm">没有其他分类可切换</p>}
              </div>
            </div>
            <div className="changli-modal-footer">
              <button className="action-btn" onClick={() => setTypeSwitchSeriesId(null)}>取消</button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* 切换分类确认弹窗 */}
      {typeSwitchConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setTypeSwitchConfirm(null)}>
          <div className="changli-modal-panel" onClick={e => e.stopPropagation()}>
            <div className="changli-modal-header">
              <h2 className="changli-heading-lg">确认切换分类</h2>
            </div>
            <div className="changli-modal-body">
              <p className="text-gray-600">确定要切换到「{typeSwitchConfirm.categoryName}」吗？</p>
            </div>
            <div className="changli-modal-footer">
              <button className="action-btn" onClick={() => setTypeSwitchConfirm(null)}>取消</button>
              <button className="action-btn action-btn-primary" onClick={doSwitchType}>确认</button>
            </div>
          </div>
        </div>
      )}

      {/* 关闭右键菜单的遮罩 */}
      {contextMenu && (
        <div className="fixed inset-0 z-40" onClick={() => { setContextMenu(null); clearPending(); }} />
      )}
    </div>
  );
};

export default Search;
