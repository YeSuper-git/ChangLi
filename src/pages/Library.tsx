import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getVideos, scanVideos, deleteVideo } from '../utils/api';
import type { Video } from '../utils/api';
import { open } from '@tauri-apps/api/dialog';

const Library: React.FC = () => {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadVideos();
  }, []);

  const loadVideos = async () => {
    try {
      console.log('[Library] 开始加载视频...');
      const videosList = await getVideos();
      console.log('[Library] getVideos 返回:', videosList.length, '条');
      setVideos(videosList);
    } catch (error) {
      console.error('[Library] 加载视频失败:', error);
    } finally {
      console.log('[Library] 设置 loading = false');
      setLoading(false);
    }
  };

  const handleScan = async () => {
    try {
      // 打开文件夹选择器
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择要扫描的文件夹'
      });
      
      if (selected) {
        setScanning(true);
        try {
          console.log('[Library] 文件夹选择器返回:', selected);
          console.log('[Library] 开始扫描:', selected);
          const result = await scanVideos(selected as string);
          console.log('[Library] 扫描完成，返回', result.length, '个视频');
          loadVideos();
        } catch (error) {
          console.error('[Library] 扫描失败:', error);
          alert('扫描失败: ' + String(error));
        } finally {
          setScanning(false);
        }
      }
    } catch (error) {
      console.error('[Library] 打开文件夹选择器失败:', error);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这个视频吗？')) return;
    
    try {
      console.log('[Library] 删除视频, id:', id);
      await deleteVideo(id);
      console.log('[Library] 删除成功, 刷新列表');
      loadVideos();
    } catch (error) {
      console.error('[Library] 删除失败:', error);
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
      <div className="flex items-center justify-between mb-10">
        <h1 className="text-3xl font-bold">视频库</h1>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="px-6 py-3 bg-gray-900 text-white rounded-xl font-medium hover:bg-gray-800 disabled:opacity-50"
        >
          {scanning ? '扫描中...' : '扫描文件夹'}
        </button>
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
            <p className="text-gray-400 text-sm">点击"扫描文件夹"添加视频</p>
          )}
        </div>
      )}
    </div>
  );
};

export default Library;
