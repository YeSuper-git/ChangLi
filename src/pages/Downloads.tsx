import React, { useState, useEffect } from 'react';
import { getDownloads, addDownload, pauseDownload, resumeDownload, removeDownload } from '../utils/api';
import type { Download } from '../utils/api';
import { useSecondConfirm } from '../utils/useSecondConfirm';
import loadingIcon from '../assets/icons/loading.svg';

const Downloads: React.FC = () => {
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [loading, setLoading] = useState(true);
  const [magnetInput, setMagnetInput] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const { pendingKey, requestSecondConfirm } = useSecondConfirm();

  useEffect(() => {
    window.scrollTo(0, 0);
    loadDownloads();
  }, []);

  const loadDownloads = async () => {
    try {
      const downloadsList = await getDownloads();
      setDownloads(downloadsList);
    } catch (error) {
      console.error('[Downloads] 加载下载列表失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddDownload = async () => {
    if (!magnetInput.trim()) return;
    
    setAdding(true);
    setAddError(null);
    try {
      await addDownload(magnetInput.trim());
      setMagnetInput('');
      loadDownloads();
    } catch (error) {
      console.error('[Downloads] 添加下载失败:', error);
      setAddError('添加下载失败，请检查链接后重试');
    } finally {
      setAdding(false);
    }
  };

  const handlePause = async (id: number) => {
    try {
      await pauseDownload(id);
      loadDownloads();
    } catch (error) {
      console.error('[Downloads] 暂停下载失败:', error);
    }
  };

  const handleResume = async (id: number) => {
    try {
      await resumeDownload(id);
      loadDownloads();
    } catch (error) {
      console.error('[Downloads] 恢复下载失败:', error);
    }
  };

  const handleRemove = async (id: number) => {
    try {
      await removeDownload(id);
      loadDownloads();
    } catch (error) {
      console.error('[Downloads] 删除下载失败:', error);
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
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 flex items-center gap-2"><img src={loadingIcon} alt="加载中" className="w-6 h-6" /> 加载中...</div>
      </div>
    );
  }

  return (
    <div className="changli-page">
      <div className="changli-page-header">
        <h1 className="changli-heading-xl">下载管理</h1>
        <span className="changli-soft-chip">{downloads.length} 个任务</span>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-4 gap-6 mb-10">
        <div className="card changli-stat-card p-6">
          <div className="text-3xl font-bold text-rose-600 mb-1">{stats.downloading}</div>
          <div className="text-sm text-gray-500">下载中</div>
        </div>
        <div className="card changli-stat-card p-6">
          <div className="text-3xl font-bold text-yellow-600 mb-1">{stats.paused}</div>
          <div className="text-sm text-gray-500">已暂停</div>
        </div>
        <div className="card changli-stat-card p-6">
          <div className="text-3xl font-bold text-green-600 mb-1">{stats.completed}</div>
          <div className="text-sm text-gray-500">已完成</div>
        </div>
        <div className="card changli-stat-card p-6">
          <div className="text-3xl font-bold text-red-600 mb-1">{stats.error}</div>
          <div className="text-sm text-gray-500">失败</div>
        </div>
      </div>

      {/* 添加下载 */}
      <div className="changli-panel p-8 mb-10">
        <h3 className="text-lg font-semibold text-gray-900 mb-6">添加下载</h3>
        <div className="flex gap-4">
          <input
            type="text"
            value={magnetInput}
            onChange={(e) => setMagnetInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddDownload()}
            placeholder="输入磁力链接..."
            className="search-input flex-1"
          />
          <button
            onClick={handleAddDownload}
            disabled={adding || !magnetInput.trim()}
            className="action-btn action-btn-primary disabled:opacity-50"
          >
            {adding ? '添加中...' : '添加'}
          </button>
        </div>
        {addError && (
          <div className="mt-4 text-red-500 text-sm">
            添加失败: {addError}
          </div>
        )}
      </div>

      {/* 筛选标签 */}
      <div className="changli-toolbar flex gap-3 mb-8 p-3">
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
            className={`category-btn ${activeTab === tab.key ? 'active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 下载列表 */}
      {filteredDownloads.length > 0 ? (
        <div className="space-y-4">
          {filteredDownloads.map((download) => (
            <div key={download.id} className="changli-panel p-6 transition-transform duration-200 hover:-translate-y-0.5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-gradient-to-br from-rose-50 to-orange-100 rounded-2xl ring-1 ring-black/5"></div>
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
                  <span className={`tag ${
                    download.status === 'downloading' ? 'status-watching' :
                    download.status === 'paused' ? 'status-ongoing' :
                    download.status === 'completed' ? 'status-completed' :
                    'bg-red-100 text-red-600'
                  }`}>
                    {download.status === 'downloading' ? '下载中' :
                     download.status === 'paused' ? '已暂停' :
                     download.status === 'completed' ? '已完成' : '失败'}
                  </span>
                  {download.status === 'downloading' && (
                    <button
                      onClick={() => handlePause(download.id)}
                      className="action-btn"
                    >
                      ⏸ 暂停
                    </button>
                  )}
                  {download.status === 'paused' && (
                    <button
                      onClick={() => handleResume(download.id)}
                      className="action-btn action-btn-primary"
                    >
                      ▶ 继续
                    </button>
                  )}
                  <button
                    onClick={() => requestSecondConfirm(`download-${download.id}`, () => handleRemove(download.id))}
                    className="action-btn action-btn-danger"
                  >
                    ✕ {pendingKey === `download-${download.id}` ? '再次确认删除' : '删除'}
                  </button>
                </div>
              </div>
              {download.status === 'downloading' && (
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${download.progress}%` }}
                  ></div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="changli-empty-state">
          <p className="text-gray-500 text-lg">
            {activeTab === 'all' ? '暂无下载任务' : `暂无${activeTab === 'downloading' ? '下载中' : activeTab === 'paused' ? '已暂停' : activeTab === 'completed' ? '已完成' : '失败'}的任务`}
          </p>
        </div>
      )}
    </div>
  );
};

export default Downloads;
