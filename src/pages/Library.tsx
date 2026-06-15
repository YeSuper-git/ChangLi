import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  getStandaloneVideos,
  getVideoSeriesList,
  scanVideos,
  deleteVideo,
} from '../utils/api';
import type { Video, VideoSeries } from '../utils/api';
import { open } from '@tauri-apps/api/dialog';
import { StaticImagePlaceholder, videoPosterDataUrl } from '../utils/media';

const Library: React.FC = () => {
  const [videos, setVideos] = useState<Video[]>([]);
  const [seriesList, setSeriesList] = useState<VideoSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadLibrary();
  }, []);

  const loadLibrary = async () => {
    try {
      const [videosList, series] = await Promise.all([
        getStandaloneVideos(),
        getVideoSeriesList(),
      ]);
      setVideos(videosList);
      setSeriesList(series);
    } catch (error) {
      console.error('[Library] 加载视频失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const importPath = async (directory: boolean) => {
    try {
      const selected = await open({
        directory,
        multiple: false,
        title: directory ? '选择要扫描的视频文件夹' : '选择要添加的视频文件',
        filters: directory ? undefined : [{
          name: '视频',
          extensions: ['mp4', 'mkv', 'avi', 'flv', 'mov', 'wmv', 'webm', 'm4v', 'mpg', 'mpeg', '3gp', 'ts', 'rmvb', 'rm', 'vob', 'asf', 'f4v'],
        }],
      });

      if (selected) {
        setScanning(true);
        try {
          await scanVideos(selected as string);
          await loadLibrary();
        } catch (error) {
          console.error('[Library] 导入失败:', error);
          alert('导入失败: ' + String(error));
        } finally {
          setScanning(false);
        }
      }
    } catch (error) {
      console.error('[Library] 打开选择器失败:', error);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这个视频吗？')) return;

    try {
      await deleteVideo(id);
      await loadLibrary();
    } catch (error) {
      console.error('[Library] 删除失败:', error);
      alert('删除失败: ' + String(error));
    }
  };

  const normalizedSearch = searchTerm.toLowerCase();
  const filteredVideos = videos.filter((video) =>
    video.file_name.toLowerCase().includes(normalizedSearch)
  );
  const filteredSeries = seriesList.filter((series) =>
    series.title.toLowerCase().includes(normalizedSearch) ||
    (series.description || '').toLowerCase().includes(normalizedSearch)
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
        <h1 className="text-3xl font-bold">视频</h1>
        <div className="flex gap-3">
          <button
            onClick={() => importPath(false)}
            disabled={scanning}
            className="px-6 py-3 bg-white border border-gray-200 rounded-xl font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            添加单视频
          </button>
          <button
            onClick={() => importPath(true)}
            disabled={scanning}
            className="px-6 py-3 bg-gray-900 text-white rounded-xl font-medium hover:bg-gray-800 disabled:opacity-50"
          >
            {scanning ? '扫描中...' : '扫描文件夹'}
          </button>
        </div>
      </div>

      <div className="mb-10">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="搜索视频或视频集..."
          className="search-input"
        />
      </div>

      {filteredSeries.length > 0 && (
        <div className="mb-12">
          <h2 className="text-xl font-semibold mb-4">视频集</h2>
          <div className="grid grid-cols-4 gap-6">
            {filteredSeries.map((series) => (
              <Link key={series.id} to={`/series/${series.id}`} className="card block">
                <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 relative overflow-hidden">
                  {series.poster_data_url ? (
                    <img src={series.poster_data_url} alt={series.title} className="w-full h-full object-cover" />
                  ) : (
                    <StaticImagePlaceholder kind="video" />
                  )}
                  <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-full">
                    {series.video_count} 集
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="font-semibold text-gray-900 text-sm mb-2 line-clamp-2 hover:text-blue-600">
                    {series.title}
                  </h3>
                  {series.description && <p className="text-xs text-gray-500 line-clamp-2">{series.description}</p>}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {filteredVideos.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">单视频</h2>
          <div className="grid grid-cols-4 gap-6">
            {filteredVideos.map((video) => {
              const thumbnailDataUrl = videoPosterDataUrl(video);
              return (
                <div key={video.id} className="card">
                  <Link to={`/player/${video.id}`}>
                    <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 relative overflow-hidden">
                      {thumbnailDataUrl ? (
                        <img src={thumbnailDataUrl} alt={video.file_name} className="w-full h-full object-cover" />
                      ) : (
                        <StaticImagePlaceholder kind="video" />
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
                      <span>{video.file_size ? `${(video.file_size / 1024 / 1024 / 1024).toFixed(1)} GB` : ''}</span>
                      <span>{video.resolution || ''}</span>
                    </div>
                    <div className="flex gap-2">
                      <Link to={`/player/${video.id}`} className="flex-1 action-btn action-btn-primary text-center">播放</Link>
                      <button onClick={() => handleDelete(video.id)} className="action-btn action-btn-danger">删除</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {filteredSeries.length === 0 && filteredVideos.length === 0 && (
        <div className="text-center py-16">
          <p className="text-gray-500 text-lg mb-4">{searchTerm ? '没有找到匹配的视频' : '暂无视频'}</p>
          {!searchTerm && <p className="text-gray-400 text-sm">点击“添加单视频”或“扫描文件夹”添加视频</p>}
        </div>
      )}
    </div>
  );
};

export default Library;
