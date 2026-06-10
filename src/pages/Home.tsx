import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getActors, getResources, getDownloads, getRecentResources } from '../utils/api';
import type { Actor, Resource, Download } from '../utils/api';

const Home: React.FC = () => {
  const [actors, setActors] = useState<Actor[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('全部');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [actorsList, resourcesList, downloadsList] = await Promise.all([
        getActors(),
        getRecentResources(10),
        getDownloads()
      ]);
      setActors(actorsList);
      setResources(resourcesList);
      setDownloads(downloadsList);
    } catch (error) {
      console.error('加载数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  const categories = ['全部', '日漫', '国漫', '泡面番', '里番', '系列'];

  return (
    <div>
      {/* 分类标签 */}
      <div className="flex gap-3 mb-12">
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => setActiveCategory(category)}
            className={`category-btn ${activeCategory === category ? 'active' : ''}`}
          >
            {category}
          </button>
        ))}
      </div>

      {/* 继续观看 */}
      <section className="mb-16">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-gray-900">继续观看</h2>
          <Link to="/library" className="text-blue-500 hover:text-blue-600 text-sm font-medium">
            查看全部 →
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-8">
          {downloads.filter(d => d.status === 'downloading' || d.status === 'paused').slice(0, 3).map((download) => (
            <div key={download.id} className="card">
              <div className="aspect-[16/10] bg-gradient-to-br from-orange-100 to-orange-200 relative">
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-16 h-16 bg-white/90 rounded-full flex items-center justify-center shadow-lg">
                    <span className="text-2xl ml-1">▶️</span>
                  </div>
                </div>
                <div className="absolute bottom-4 left-4 bg-black/80 text-white text-sm px-3 py-1.5 rounded-full">
                  {download.progress.toFixed(0)}%
                </div>
              </div>
              <div className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">{download.file_name || '未知文件'}</h3>
                <div className="flex gap-2 mb-4">
                  <span className={`tag ${download.status === 'downloading' ? 'status-ongoing' : 'status-watching'}`}>
                    {download.status === 'downloading' ? '下载中' : '已暂停'}
                  </span>
                </div>
                <div className="text-sm text-gray-500 mb-4">
                  {download.download_speed > 0 ? `${(download.download_speed / 1024 / 1024).toFixed(1)} MB/s` : ''}
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${download.progress}%` }}></div>
                  </div>
                  <span className="text-sm text-gray-500">{download.progress.toFixed(0)}%</span>
                </div>
              </div>
            </div>
          ))}
          {downloads.filter(d => d.status === 'downloading' || d.status === 'paused').length === 0 && (
            <div className="col-span-3 text-center text-gray-500 py-12">
              暂无下载中的任务
            </div>
          )}
        </div>
      </section>

      {/* 最近更新 */}
      <section className="mb-16">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-gray-900">最近更新</h2>
          <Link to="/library" className="text-blue-500 hover:text-blue-600 text-sm font-medium">
            查看全部 →
          </Link>
        </div>
        <div className="grid grid-cols-4 gap-6">
          {resources.slice(0, 8).map((resource) => (
            <div key={resource.id} className="card">
              <div className="aspect-[3/4] bg-gradient-to-br from-green-100 to-green-200 relative">
                <div className="absolute top-3 right-3 bg-blue-500 text-white text-xs px-3 py-1 rounded-full font-medium">NEW</div>
              </div>
              <div className="p-4">
                <h3 className="font-semibold text-gray-900 mb-2">{resource.title}</h3>
                <span className="tag status-ongoing">资源</span>
                <div className="text-sm text-gray-500 mt-2">
                  {resource.created_at ? new Date(resource.created_at).toLocaleDateString() : ''}
                </div>
              </div>
            </div>
          ))}
          {resources.length === 0 && (
            <div className="col-span-4 text-center text-gray-500 py-12">
              暂无资源，请先搜索或添加网站
            </div>
          )}
        </div>
      </section>

      {/* 热门演员 */}
      <section>
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-gray-900">热门演员</h2>
          <Link to="/actors" className="text-blue-500 hover:text-blue-600 text-sm font-medium">
            查看全部 →
          </Link>
        </div>
        <div className="grid grid-cols-4 gap-6">
          {actors.slice(0, 4).map((actor) => (
            <Link key={actor.id} to={`/actors/${actor.id}`} className="card block">
              <div className="aspect-[3/4] bg-gradient-to-br from-pink-100 to-pink-200"></div>
              <div className="p-4">
                <h3 className="font-semibold text-gray-900 mb-1">{actor.name}</h3>
                <div className="text-sm text-gray-500">
                  {actor.debut_year ? `${actor.debut_year}年出道` : ''}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
};

export default Home;
