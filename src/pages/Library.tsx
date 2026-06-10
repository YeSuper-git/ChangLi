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
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-10">视频库</h1>

      {/* 扫描目录 */}
      <div className="card p-8 mb-10">
        <h3 className="text-lg font-semibold text-gray-900 mb-6">扫描目录</h3>
        <div className="flex gap-4">
          <input
            type="text"
            value={scanPath}
            onChange={(e) => setScanPath(e.target.value)}
            placeholder="输入目录路径..."
            className="search-input flex-1"
          />
          <button
            onClick={handleScan}
            disabled={scanning}
            className="px-8 py-3 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 disabled:opacity-50"
          >
            {scanning ? '扫描中...' : '扫描'}
          </button>
        </div>
      </div>

      {/* 搜索栏 */}
      <div className="mb-10">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="搜索视频..."
          className="search-input"
        />
      </div>

      {/* 视频列表 */}
      {filteredVideos.length > 0 ? (
        <div className="grid grid-cols-4 gap-6">
          {filteredVideos.map((video) => (
            <div key={video.id} className="card">
              <Link to={`/player/${video.id}`}>
                <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 relative">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-4xl">▶️</span>
                  </div>
                  {video.duration && (
                    <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-full">
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
                <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
                  <span>
                    {video.file_size
                      ? `${(video.file_size / 1024 / 1024 / 1024).toFixed(1)} GB`
                      : ''}
                  </span>
                  <span>{video.resolution || ''}</span>
                </div>
                <div className="flex gap-2">
                  <Link
                    to={`/player/${video.id}`}
                    className="flex-1 action-btn action-btn-primary text-center"
                  >
                    播放
                  </Link>
                  <button
                    onClick={() => handleDelete(video.id)}
                    className="action-btn action-btn-danger"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-16">
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
