import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getDownloads, getVideos, getActors } from '../utils/api';
import type { Download, Video, Actor } from '../utils/api';

const Home: React.FC = () => {
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [actors, setActors] = useState<Actor[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [downloadsList, videosList, actorsList] = await Promise.all([
        getDownloads(),
        getVideos(),
        getActors(),
      ]);
      setDownloads(downloadsList);
      setVideos(videosList);
      setActors(actorsList);
    } catch (error) {
      console.error('加载数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  const activeDownloads = downloads.filter(d => d.status === 'downloading');
  const recentVideos = videos.slice(0, 8);
  const recentActors = actors.slice(0, 8);

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-8">首页</h1>

      {/* 统计卡片 */}
      <div className="grid grid-cols-4 gap-6 mb-10">
        <div className="bg-white rounded-xl p-6 border border-gray-100">
          <div className="text-3xl font-bold text-gray-900 mb-1">{videos.length}</div>
          <div className="text-sm text-gray-500">本地视频</div>
        </div>
        <div className="bg-white rounded-xl p-6 border border-gray-100">
          <div className="text-3xl font-bold text-blue-600 mb-1">{actors.length}</div>
          <div className="text-sm text-gray-500">演员数量</div>
        </div>
        <div className="bg-white rounded-xl p-6 border border-gray-100">
          <div className="text-3xl font-bold text-green-600 mb-1">{activeDownloads.length}</div>
          <div className="text-sm text-gray-500">下载中</div>
        </div>
        <div className="bg-white rounded-xl p-6 border border-gray-100">
          <div className="text-3xl font-bold text-purple-600 mb-1">0</div>
          <div className="text-sm text-gray-500">观看中</div>
        </div>
      </div>

      {/* 继续观看 */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900">继续观看</h2>
          <Link to="/library" className="text-blue-500 hover:text-blue-600 text-sm font-medium">
            查看全部 →
          </Link>
        </div>
        {recentVideos.length > 0 ? (
          <div className="grid grid-cols-4 gap-6">
            {recentVideos.slice(0, 4).map((video) => (
              <Link key={video.id} to={`/player/${video.id}`} className="block">
                <div className="bg-white rounded-xl overflow-hidden border border-gray-100 hover:shadow-lg transition-shadow">
                  <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 relative">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-4xl">▶️</span>
                    </div>
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold text-gray-900 text-sm mb-2 line-clamp-1">
                      {video.file_name}
                    </h3>
                    <div className="text-xs text-gray-500">
                      {video.duration ? `${Math.floor(video.duration / 60)}分钟` : ''}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="bg-gray-50 rounded-xl p-8 text-center">
            <p className="text-gray-500">暂无视频，去扫描本地目录吧</p>
            <Link to="/library" className="text-blue-500 hover:text-blue-600 text-sm mt-2 inline-block">
              去扫描 →
            </Link>
          </div>
        )}
      </section>

      {/* 最近更新 */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900">最近更新</h2>
          <Link to="/library" className="text-blue-500 hover:text-blue-600 text-sm font-medium">
            查看全部 →
          </Link>
        </div>
        {recentVideos.length > 0 ? (
          <div className="grid grid-cols-4 gap-6">
            {recentVideos.slice(4, 8).map((video) => (
              <Link key={video.id} to={`/player/${video.id}`} className="block">
                <div className="bg-white rounded-xl overflow-hidden border border-gray-100 hover:shadow-lg transition-shadow">
                  <div className="aspect-[3/4] bg-gradient-to-br from-gray-100 to-gray-200"></div>
                  <div className="p-4">
                    <h3 className="font-semibold text-gray-900 text-sm mb-2 line-clamp-1">
                      {video.file_name}
                    </h3>
                    <div className="text-xs text-gray-500">
                      {video.file_size ? `${(video.file_size / 1024 / 1024 / 1024).toFixed(1)} GB` : ''}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="bg-gray-50 rounded-xl p-8 text-center">
            <p className="text-gray-500">暂无视频</p>
          </div>
        )}
      </section>

      {/* 热门演员 */}
      <section>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900">热门演员</h2>
          <Link to="/actors" className="text-blue-500 hover:text-blue-600 text-sm font-medium">
            查看全部 →
          </Link>
        </div>
        {recentActors.length > 0 ? (
          <div className="grid grid-cols-4 gap-6">
            {recentActors.slice(0, 4).map((actor) => (
              <Link key={actor.id} to={`/actors/${actor.id}`} className="block">
                <div className="bg-white rounded-xl overflow-hidden border border-gray-100 hover:shadow-lg transition-shadow">
                  <div className="aspect-[3/4] bg-gradient-to-br from-pink-100 to-pink-200"></div>
                  <div className="p-4">
                    <h3 className="font-semibold text-gray-900 text-sm mb-1">{actor.name}</h3>
                    <div className="text-xs text-gray-500">
                      {actor.debut_year ? `${actor.debut_year}年出道` : ''}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="bg-gray-50 rounded-xl p-8 text-center">
            <p className="text-gray-500">暂无演员数据</p>
          </div>
        )}
      </section>
    </div>
  );
};

export default Home;
