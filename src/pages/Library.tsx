import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getVideos, scanVideos, deleteVideo } from '../utils/api';
import type { Video } from '../utils/api';

const Library: React.FC = () => {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanPath, setScanPath] = useState('');
  const [scanning, setScanning] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadVideos();
  }, []);

  const loadVideos = async () => {
    try {
      const videosList = await getVideos();
      setVideos(videosList);
    } catch (error) {
      console.error('加载视频失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleScan = async () => {
    if (!scanPath.trim()) return;
    
    setScanning(true);
    try {
      await scanVideos(scanPath);
      loadVideos();
    } catch (error) {
      console.error('扫描失败:', error);
    } finally {
      setScanning(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这个视频吗？')) return;
    
    try {
      await deleteVideo(id);
      loadVideos();
    } catch (error) {
      console.error('删除失败:', error);
    }
  };

  const filteredVideos = videos.filter(video =>
    video.file_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-8">视频库</h1>

      {/* 扫描目录 */}
      <div className="mb-10 p-6 bg-gray-50 rounded-2xl">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">扫描目录</h3>
        <div className="flex gap-4">
          <input
            type="text"
            value={scanPath}
            onChange={(e) => setScanPath(e.target.value)}
            placeholder="输入目录路径..."
            className="flex-1 px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleScan}
            disabled={scanning}
            className="px-6 py-3 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 disabled:opacity-50"
          >
            {scanning ? '扫描中...' : '扫描'}
          </button>
        </div>
      </div>

      {/* 搜索栏 */}
      <div className="mb-8">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="搜索视频..."
          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* 视频列表 */}
      {filteredVideos.length > 0 ? (
        <div className="grid grid-cols-4 gap-6">
          {filteredVideos.map((video) => (
            <div key={video.id} className="bg-white rounded-xl overflow-hidden border border-gray-100 hover:shadow-lg transition-shadow">
              <Link to={`/player/${video.id}`} className="block">
                <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 relative">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-4xl">▶️</span>
                  </div>
                  {video.duration && (
                    <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
                      {Math.floor(video.duration / 60)}分钟
                    </div>
                  )}
                </div>
              </Link>
              <div className="p-4">
                <Link to={`/player/${video.id}`}>
                  <h3 className="font-semibold text-gray-900 text-sm mb-2 line-clamp-2 hover:text-blue-600">
                    {video.file_name}
                  </h3>
                </Link>
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>
                    {video.file_size
                      ? `${(video.file_size / 1024 / 1024 / 1024).toFixed(1)} GB`
                      : ''}
                  </span>
                  <span>{video.resolution || ''}</span>
                </div>
                <div className="flex gap-2 mt-3">
                  <Link
                    to={`/player/${video.id}`}
                    className="flex-1 px-3 py-2 bg-blue-500 text-white rounded-lg text-sm text-center hover:bg-blue-600"
                  >
                    播放
                  </Link>
                  <button
                    onClick={() => handleDelete(video.id)}
                    className="px-3 py-2 bg-red-100 text-red-600 rounded-lg text-sm hover:bg-red-200"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-gray-50 rounded-xl p-12 text-center">
          <p className="text-gray-500 text-lg mb-4">
            {searchTerm ? '没有找到匹配的视频' : '暂无视频'}
          </p>
          {!searchTerm && (
            <p className="text-gray-400 text-sm">扫描本地目录添加视频</p>
          )}
        </div>
      )}
    </div>
  );
};

export default Library;
