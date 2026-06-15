import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { open } from '@tauri-apps/api/dialog';
import {
  addVideoToSeries,
  deleteVideo,
  deleteVideoSeries,
  getVideoSeriesDetail,
  removeVideoFromSeries,
  saveVideoThumbnail,
  updateVideoSeries,
} from '../utils/api';
import type { Video, VideoSeries } from '../utils/api';
import { StaticImagePlaceholder, videoPosterDataUrl } from '../utils/media';

const SeriesDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const seriesId = Number(id);

  const [series, setSeries] = useState<VideoSeries | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editData, setEditData] = useState({ title: '', description: '', poster: '' });

  useEffect(() => {
    if (seriesId) {
      loadSeries();
    }
  }, [seriesId]);

  const loadSeries = async () => {
    try {
      const [seriesData, seriesVideos] = await getVideoSeriesDetail(seriesId);
      setSeries(seriesData);
      setVideos(seriesVideos);
      if (seriesData) {
        setEditData({
          title: seriesData.title,
          description: seriesData.description || '',
          poster: seriesData.poster || '',
        });
      }
    } catch (error) {
      console.error('加载视频集失败:', error);
      alert('加载视频集失败: ' + String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPoster = async () => {
    const selected = await open({
      multiple: false,
      filters: [{
        name: '图片',
        extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'svg', 'tif', 'tiff', 'ico', 'heic', 'heif'],
      }],
    });
    if (selected) {
      const storedPath = await saveVideoThumbnail(selected as string);
      setEditData((current) => ({ ...current, poster: storedPath }));
    }
  };

  const handleSave = async () => {
    if (!series) return;
    const title = editData.title.trim();
    if (!title) {
      alert('标题不能为空');
      return;
    }
    setSaving(true);
    try {
      await updateVideoSeries(series.id, title, editData.description, editData.poster);
      setEditing(false);
      await loadSeries();
    } catch (error) {
      console.error('保存视频集失败:', error);
      alert('保存失败: ' + String(error));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSeries = async () => {
    if (!series) return;
    if (!confirm('确定要删除整个视频集吗？可在下一步选择是否同时删除分集记录。')) return;
    const deleteVideos = confirm('是否同时删除该视频集下的所有分集记录？\n确定：删除视频集和分集。\n取消：只删除视频集，分集转为单视频。');
    try {
      await deleteVideoSeries(series.id, deleteVideos);
      navigate('/library');
    } catch (error) {
      console.error('删除视频集失败:', error);
      alert('删除失败: ' + String(error));
    }
  };

  const handleAddEpisode = async () => {
    const selected = await open({
      multiple: false,
      filters: [{
        name: '视频',
        extensions: ['mp4', 'mkv', 'avi', 'flv', 'mov', 'wmv', 'webm', 'm4v', 'mpg', 'mpeg', '3gp', 'ts', 'rmvb', 'rm', 'vob', 'asf', 'f4v'],
      }],
    });
    if (!selected) return;
    try {
      await addVideoToSeries(seriesId, selected as string);
      await loadSeries();
    } catch (error) {
      console.error('添加分集失败:', error);
      alert('添加分集失败: ' + String(error));
    }
  };

  const handleRemoveEpisode = async (videoId: number) => {
    if (!confirm('确定要从视频集中移除这个分集吗？视频记录会保留为单视频。')) return;
    try {
      await removeVideoFromSeries(videoId);
      await loadSeries();
    } catch (error) {
      console.error('移除分集失败:', error);
      alert('移除失败: ' + String(error));
    }
  };

  const handleDeleteEpisode = async (videoId: number) => {
    if (!confirm('确定要删除这个分集的视频记录吗？')) return;
    try {
      await deleteVideo(videoId);
      await loadSeries();
    } catch (error) {
      console.error('删除分集失败:', error);
      alert('删除失败: ' + String(error));
    }
  };

  if (loading) return <div className="text-gray-500">加载中...</div>;
  if (!series) return <div className="text-gray-500">视频集不存在</div>;

  return (
    <div>
      <div className="mb-6">
        <Link to="/library" className="text-sm text-blue-600 hover:underline">← 返回视频库</Link>
      </div>

      <div className="card p-6 mb-8">
        <div className="flex gap-6">
          <div className="w-80 aspect-video bg-gray-100 rounded-xl overflow-hidden flex-shrink-0">
            {series.poster_data_url ? (
              <img src={series.poster_data_url} alt={series.title} className="w-full h-full object-cover" />
            ) : (
              <StaticImagePlaceholder kind="video" />
            )}
          </div>
          <div className="flex-1">
            {editing ? (
              <div className="space-y-4">
                <input
                  value={editData.title}
                  onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                  className="search-input"
                  placeholder="标题"
                />
                <textarea
                  value={editData.description}
                  onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                  className="search-input min-h-[120px]"
                  placeholder="简介"
                />
                <div className="flex gap-2">
                  <button onClick={handleSelectPoster} className="action-btn">选择海报</button>
                  <button onClick={handleSave} disabled={saving} className="action-btn action-btn-primary">保存</button>
                  <button onClick={() => setEditing(false)} className="action-btn">取消</button>
                </div>
              </div>
            ) : (
              <>
                <h1 className="text-3xl font-bold mb-3">{series.title}</h1>
                <p className="text-gray-500 mb-4">{series.video_count} 集</p>
                {series.description && <p className="text-gray-700 whitespace-pre-wrap mb-6">{series.description}</p>}
                <div className="flex gap-2">
                  <button onClick={() => setEditing(true)} className="action-btn action-btn-primary">编辑信息</button>
                  <button onClick={handleAddEpisode} className="action-btn">添加分集</button>
                  <button onClick={handleDeleteSeries} className="action-btn action-btn-danger">删除整个集</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <h2 className="text-xl font-semibold mb-4">分集</h2>
      {videos.length > 0 ? (
        <div className="grid grid-cols-4 gap-6">
          {videos.map((video) => {
            const poster = videoPosterDataUrl(video);
            return (
              <div key={video.id} className="card">
                <Link to={`/player/${video.id}`}>
                  <div className="aspect-video bg-gray-100 overflow-hidden">
                    {poster ? <img src={poster} alt={video.file_name} className="w-full h-full object-cover" /> : <StaticImagePlaceholder kind="video" />}
                  </div>
                </Link>
                <div className="p-4">
                  <h3 className="font-semibold text-sm line-clamp-2 mb-2">
                    {video.episode_number ? `第 ${video.episode_number} 集 · ` : ''}{video.file_name}
                  </h3>
                  <div className="flex gap-2 flex-wrap">
                    <Link to={`/player/${video.id}`} className="action-btn action-btn-primary text-center">播放</Link>
                    <button onClick={() => handleRemoveEpisode(video.id)} className="action-btn">移出</button>
                    <button onClick={() => handleDeleteEpisode(video.id)} className="action-btn action-btn-danger">删除</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-gray-500 py-10 text-center">暂无分集</div>
      )}
    </div>
  );
};

export default SeriesDetail;
