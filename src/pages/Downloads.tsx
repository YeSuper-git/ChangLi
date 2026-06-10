import React, { useState, useEffect } from 'react';
import { getDownloads, addDownload, pauseDownload, resumeDownload, removeDownload } from '../utils/api';
import type { Download } from '../utils/api';

const Downloads: React.FC = () => {
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [loading, setLoading] = useState(true);
  const [magnetInput, setMagnetInput] = useState('');
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => {
    loadDownloads();
  }, []);

  const loadDownloads = async () => {
    try {
      const downloadsList = await getDownloads();
      setDownloads(downloadsList);
    } catch (error) {
      console.error('加载下载列表失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddDownload = async () => {
    if (!magnetInput.trim()) return;
    
    try {
      await addDownload(magnetInput);
      setMagnetInput('');
      loadDownloads();
    } catch (error) {
      console.error('添加下载失败:', error);
    }
  };

  const handlePause = async (id: number) => {
    try {
      await pauseDownload(id);
      loadDownloads();
    } catch (error) {
      console.error('暂停下载失败:', error);
    }
  };

  const handleResume = async (id: number) => {
    try {
      await resumeDownload(id);
      loadDownloads();
    } catch (error) {
      console.error('恢复下载失败:', error);
    }
  };

  const handleRemove = async (id: number) => {
    if (!confirm('确定要删除这个下载任务吗？')) return;
    
    try {
      await removeDownload(id);
      loadDownloads();
    } catch (error) {
      console.error('删除下载失败:', error);
    }
  };

  const filteredDownloads = downloads.filter(download => {
    if (activeTab === 'all') return true;
    if (activeTab === 'downloading') return download.status === 'downloading';
    if (activeTab === 'paused') return download.status === 'paused';
    if (activeTab === 'completed') return download.status === 'completed';
    if (activeTab === 'error') return download.status === 'error';
    return true;
  });

  const stats = {
    downloading: downloads.filter(d => d.status === 'downloading').length,
    paused: downloads.filter(d => d.status === 'paused').length,
    completed: downloads.filter(d => d.status === 'completed').length,
    error: downloads.filter(d => d.status === 'error').length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-8">下载管理</h1>

      {/* 统计卡片 */}
      <div className="grid grid-cols-4 gap-6 mb-10">
        <div className="bg-white rounded-xl p-6 border border-gray-100">
          <div className="text-3xl font-bold text-blue-600 mb-1">{stats.downloading}</div>
          <div className="text-sm text-gray-500">下载中</div>
        </div>
        <div className="bg-white rounded-xl p-6 border border-gray-100">
          <div className="text-3xl font-bold text-yellow-600 mb-1">{stats.paused}</div>
          <div className="text-sm text-gray-500">已暂停</div>
        </div>
        <div className="bg-white rounded-xl p-6 border border-gray-100">
          <div className="text-3xl font-bold text-green-600 mb-1">{stats.completed}</div>
          <div className="text-sm text-gray-500">已完成</div>
        </div>
        <div className="bg-white rounded-xl p-6 border border-gray-100">
          <div className="text-3xl font-bold text-red-600 mb-1">{stats.error}</div>
          <div className="text-sm text-gray-500">失败</div>
        </div>
      </div>

      {/* 添加下载 */}
      <div className="mb-10 p-6 bg-gray-50 rounded-2xl">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">添加下载</h3>
        <div className="flex gap-4">
          <input
            type="text"
            value={magnetInput}
            onChange={(e) => setMagnetInput(e.target.value)}
            placeholder="输入磁力链接..."
            className="flex-1 px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleAddDownload}
            className="px-6 py-3 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600"
          >
            添加
          </button>
        </div>
      </div>

      {/* 筛选标签 */}
      <div className="flex gap-2 mb-8">
        {[
          { key: 'all', label: '全部' },
          { key: 'downloading', label: '下载中' },
          { key: 'paused', label: '已暂停' },
          { key: 'completed', label: '已完成' },
          { key: 'error', label: '失败' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-lg text-sm ${
              activeTab === tab.key
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 下载列表 */}
      {filteredDownloads.length > 0 ? (
        <div className="space-y-4">
          {filteredDownloads.map((download) => (
            <div
              key={download.id}
              className="bg-white rounded-xl border border-gray-100 p-6"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg"></div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{download.file_name || '未知文件'}</h3>
                    <div className="flex items-center gap-4 text-sm text-gray-500 mt-1">
                      {download.file_size && (
                        <span>{(download.file_size / 1024 / 1024 / 1024).toFixed(1)} GB</span>
                      )}
                      {download.download_speed > 0 && (
                        <span>{(download.download_speed / 1024 / 1024).toFixed(1)} MB/s</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1 rounded-full text-sm ${
                    download.status === 'downloading'
                      ? 'bg-blue-100 text-blue-600'
                      : download.status === 'paused'
                      ? 'bg-yellow-100 text-yellow-600'
                      : download.status === 'completed'
                      ? 'bg-green-100 text-green-600'
                      : 'bg-red-100 text-red-600'
                  }`}>
                    {download.status === 'downloading' ? '下载中' :
                     download.status === 'paused' ? '已暂停' :
                     download.status === 'completed' ? '已完成' : '失败'}
                  </span>
                  {download.status === 'downloading' && (
                    <button
                      onClick={() => handlePause(download.id)}
                      className="px-3 py-1 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                    >
                      ⏸ 暂停
                    </button>
                  )}
                  {download.status === 'paused' && (
                    <button
                      onClick={() => handleResume(download.id)}
                      className="px-3 py-1 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                    >
                      ▶ 继续
                    </button>
                  )}
                  <button
                    onClick={() => handleRemove(download.id)}
                    className="px-3 py-1 bg-red-100 text-red-600 rounded-lg hover:bg-red-200"
                  >
                    ✕ 删除
                  </button>
                </div>
              </div>
              {download.status === 'downloading' && (
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${download.progress}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-gray-50 rounded-xl p-12 text-center">
          <p className="text-gray-500 text-lg">
            {activeTab === 'all' ? '暂无下载任务' : `暂无${activeTab === 'downloading' ? '下载中' : activeTab === 'paused' ? '已暂停' : activeTab === 'completed' ? '已完成' : '失败'}的任务`}
          </p>
        </div>
      )}
    </div>
  );
};

export default Downloads;
