import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getActors, getDownloads, getTags, getVideos } from '../utils/api';
import type { Actor, Download, Tag, Video } from '../utils/api';
import { convertFileSrc } from '@tauri-apps/api/tauri';

const Home: React.FC = () => {
  const [actors, setActors] = useState<Actor[]>([]);
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('全部');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [actorsList, downloadsList, tagsList, videosList] = await Promise.all([
        getActors(),
        getDownloads(),
        getTags(),
        getVideos()
      ]);
      setActors(actorsList);
      setDownloads(downloadsList);
      setTags(tagsList);
      setVideos(videosList);
    } catch (error) {
      console.error('加载数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const getVideoThumbnail = (video: Video) => {
    if (video.thumbnail) {
      return convertFileSrc(video.thumbnail);
    }
    return null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  return (
    <div>
      {/* 分类标签 */}
      <div className="flex items-center justify-between mb-12">
        <div className="flex gap-3">
          <button
            onClick={() => setActiveCategory('全部')}
            className={`category-btn ${activeCategory === '全部' ? 'active' : ''}`}
          >
            全部
          </button>
          {tags.map((tag) => (
            <button
              key={tag.id}
              onClick={() => setActiveCategory(tag.name)}
              className={`category-btn ${activeCategory === tag.name ? 'active' : ''}`}
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

      {/* 我的视频库 */}
      <section className="mb-16">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-gray-900">我的视频库</h2>
          <Link to="/library" className="text-blue-500 hover:text-blue-600 text-sm font-medium">
            查看全部 →
          </Link>
        </div>
        <div className="grid grid-cols-4 gap-6">
          {videos.slice(0, 8).map((video) => (
            <Link key={video.id} to={`/video/${video.id}`} className="card block">
              <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 relative overflow-hidden">
                {getVideoThumbnail(video) ? (
                  <img
                    src={getVideoThumbnail(video)!}
                    alt={video.file_name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-4xl">▶️</span>
                  </div>
                )}
                {video.duration && (
                  <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-full">
                    {Math.floor(video.duration / 60)}分钟
                  </div>
                )}
              </div>
              <div className="p-4">
                <h3 className="font-semibold text-gray-900 text-sm mb-2 line-clamp-2">
                  {video.file_name}
                </h3>
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>
                    {video.file_size
                      ? `${(video.file_size / 1024 / 1024 / 1024).toFixed(1)} GB`
                      : ''}
                  </span>
                  <span>{video.resolution || ''}</span>
                </div>
              </div>
            </Link>
          ))}
          {videos.length === 0 && (
            <div className="col-span-4 text-center text-gray-500 py-12">
              <p className="text-lg mb-4">暂无视频</p>
              <p className="text-sm">点击"扫描文件夹"添加视频</p>
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
