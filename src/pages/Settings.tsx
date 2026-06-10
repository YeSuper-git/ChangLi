import React, { useState, useEffect } from 'react';
import { getSites, addSite, deleteSite } from '../utils/api';
import type { Site } from '../utils/api';

const Settings: React.FC = () => {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSite, setNewSite] = useState({ name: '', url: '', parser_type: 'auto', config: '{}' });

  useEffect(() => {
    loadSites();
  }, []);

  const loadSites = async () => {
    try {
      const sitesList = await getSites();
      setSites(sitesList);
    } catch (error) {
      console.error('加载网站失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddSite = async () => {
    if (!newSite.name.trim() || !newSite.url.trim()) return;
    
    try {
      await addSite({
        name: newSite.name,
        url: newSite.url,
        parser_type: newSite.parser_type,
        config: JSON.parse(newSite.config)
      });
      setShowAddModal(false);
      setNewSite({ name: '', url: '', parser_type: 'auto', config: '{}' });
      loadSites();
    } catch (error) {
      console.error('添加网站失败:', error);
    }
  };

  const handleDeleteSite = async (id: number) => {
    if (!confirm('确定要删除这个网站吗？')) return;
    
    try {
      await deleteSite(id);
      loadSites();
    } catch (error) {
      console.error('删除网站失败:', error);
    }
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
      <div className="flex items-center justify-between mb-10">
        <h1 className="text-3xl font-bold">设置</h1>
      </div>

      {/* 网站管理 */}
      <section className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">网站管理</h2>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            添加网站
          </button>
        </div>
        
        {sites.length > 0 ? (
          <div className="space-y-4">
            {sites.map((site) => (
              <div key={site.id} className="card p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">{site.name}</h3>
                    <p className="text-sm text-gray-500 mt-1">{site.url}</p>
                    <p className="text-xs text-gray-400 mt-1">解析器: {site.parser_type}</p>
                  </div>
                  <button
                    onClick={() => handleDeleteSite(site.id)}
                    className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-4">暂无网站配置</p>
            <p className="text-gray-400 text-sm">添加网站后可以搜索在线资源</p>
          </div>
        )}
      </section>

      {/* 添加网站弹窗 */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 w-96">
            <h2 className="text-2xl font-bold mb-6">添加网站</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">网站名称 *</label>
                <input
                  type="text"
                  value={newSite.name}
                  onChange={(e) => setNewSite({ ...newSite, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                  placeholder="如：动漫之家"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">网站地址 *</label>
                <input
                  type="text"
                  value={newSite.url}
                  onChange={(e) => setNewSite({ ...newSite, url: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                  placeholder="https://www.example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">解析器类型</label>
                <select
                  value={newSite.parser_type}
                  onChange={(e) => setNewSite({ ...newSite, parser_type: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  <option value="auto">自动检测</option>
                  <option value="custom">自定义</option>
                </select>
              </div>
            </div>
            <div className="flex gap-4 mt-8">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                取消
              </button>
              <button
                onClick={handleAddSite}
                className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
