import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getStandaloneVideos,
  getStandaloneVideosByTag,
  getVideoSeriesByTag,
  getVideoSeriesList,
  getSeriesPlaybackVideo,
  scanVideos,
  deleteVideo,
  deleteVideoSeries,
  getTags,
  playVideo,
} from '../utils/api';
import type { Tag, Video, VideoSeries } from '../utils/api';
import { open } from '@tauri-apps/api/dialog';
import { StaticImagePlaceholder, videoPosterDataUrl } from '../utils/media';

const Library: React.FC = () => {
  const navigate = useNavigate();
  const [videos, setVideos] = useState<Video[]>([]);
  const [seriesList, setSeriesList] = useState<VideoSeries[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTagId, setActiveTagId] = useState<number | null>(null);

  useEffect(() => {
    loadLibrary(null);
  }, []);

  const loadLibrary = async (tagId: number | null = activeTagId) => {
    try {
      const [videosList, series, tagsList] = await Promise.all([
        tagId ? getStandaloneVideosByTag(tagId) : getStandaloneVideos(),
        tagId ? getVideoSeriesByTag(tagId) : getVideoSeriesList(),
        getTags(),
      ]);
      setVideos(videosList);
      setSeriesList(series);
      setTags(tagsList);
      setActiveTagId(tagId);
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
          await loadLibrary(activeTagId);
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

  const handleDeleteVideo = async (id: number, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!confirm('确定要删除这个视频吗？')) return;

    try {
      await deleteVideo(id);
      await loadLibrary(activeTagId);
    } catch (error) {
      console.error('[Library] 删除失败:', error);
      alert('删除失败: ' + String(error));
    }
  };

  const handleDeleteSeries = async (id: number, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!confirm('确定要删除这个视频集吗？该操作会同时删除该视频集下的所有分集记录。')) return;

    try {
      await deleteVideoSeries(id, true);
      await loadLibrary(activeTagId);
    } catch (error) {
      console.error('[Library] 删除视频集失败:', error);
      alert('删除视频集失败: ' + String(error));
    }
  };

  const handlePlayVideo = async (id: number, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await playVideo(id);
    } catch (error) {
      console.error('[Library] 播放失败:', error);
      alert('播放失败: ' + String(error));
    }
  };

  const handlePlaySeries = async (seriesId: number, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      const targetVideo = await getSeriesPlaybackVideo(seriesId);
      if (!targetVideo) {
        alert('这个视频集里还没有可播放的视频');
        return;
      }
      await playVideo(targetVideo.id);
    } catch (error) {
      console.error('[Library] 播放视频集失败:', error);
      alert('播放视频集失败: ' + String(error));
    }
  };

  const handleTagClick = (tagId: number | null) => {
    setLoading(true);
    loadLibrary(tagId);
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

      <div className="mb-6">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="搜索视频或视频集..."
          className="search-input"
        />
      </div>

      <div className="mb-10 flex gap-3 flex-wrap">
        <button onClick={() => handleTagClick(null)} className={`category-btn ${activeTagId === null ? 'active' : ''}`}>全部</button>
        {tags.map((tag) => (
          <button
            key={tag.id}
            onClick={() => handleTagClick(tag.id)}
            className={`category-btn ${activeTagId === tag.id ? 'active' : ''}`}
          >
            {tag.name}
          </button>
        ))}
      </div>

      {filteredSeries.length > 0 && (
        <div className="mb-12">
          <h2 className="text-xl font-semibold mb-4">视频集</h2>
          <div className="grid grid-cols-4 gap-6">
            {filteredSeries.map((series) => (
              <div
                key={series.id}
                onClick={() => navigate(`/series/${series.id}`)}
                className="card block cursor-pointer"
              >
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
                  {series.description && <p className="text-xs text-gray-500 line-clamp-2 mb-3">{series.description}</p>}
                  <div className="flex gap-2">
                    <button onClick={(event) => handlePlaySeries(series.id, event)} className="flex-1 action-btn action-btn-primary text-center">播放</button>
                    <button onClick={(event) => handleDeleteSeries(series.id, event)} className="action-btn action-btn-danger">删除</button>
                  </div>
                </div>
              </div>
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
                <div
                  key={video.id}
                  onClick={() => navigate(`/video/${video.id}`)}
                  className="card cursor-pointer"
                >
                  <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 relative overflow-hidden">
                    {thumbnailDataUrl ? (
                      <img src={thumbnailDataUrl} alt={video.file_name} className="w-full h-full object-cover" />
                    ) : (
                      <StaticImagePlaceholder kind="video" />
                    )}
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold text-gray-900 text-sm mb-2 line-clamp-2 hover:text-blue-600">
                      {video.file_name}
                    </h3>
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
                      <span>{video.file_size ? `${(video.file_size / 1024 / 1024 / 1024).toFixed(1)} GB` : ''}</span>
                      <span>{video.resolution || ''}</span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={(event) => handlePlayVideo(video.id, event)} className="flex-1 action-btn action-btn-primary text-center">播放</button>
                      <button onClick={(event) => handleDeleteVideo(video.id, event)} className="action-btn action-btn-danger">删除</button>
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
