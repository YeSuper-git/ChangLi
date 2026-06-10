import React, { useState } from 'react';
import { searchResources } from '../utils/api';
import type { Resource } from '../utils/api';

const Search: React.FC = () => {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (!keyword.trim()) return;
    
    setLoading(true);
    setSearched(true);
    
    try {
      const resources = await searchResources(keyword);
      setResults(resources);
    } catch (error) {
      console.error('搜索失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  return (
    <div>
      <h1 className="text-3xl font-bold mb-10">搜索资源</h1>
      
      {/* 搜索框 */}
      <div className="flex gap-4 mb-10">
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="输入关键词搜索..."
          className="search-input flex-1"
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="px-8 py-3 bg-gray-900 text-white rounded-xl font-medium hover:bg-gray-800 disabled:opacity-50"
        >
          {loading ? '搜索中...' : '搜索'}
        </button>
      </div>

      {/* 搜索结果 */}
      {searched && (
        <div>
          <div className="text-gray-500 mb-8">
            {loading ? '搜索中...' : `找到 ${results.length} 个结果`}
          </div>
          
          {results.length > 0 ? (
            <div className="space-y-6">
              {results.map((resource, index) => (
                <div key={index} className="card p-6">
                  <div className="flex gap-6">
                    <div className="w-32 h-44 bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl flex-shrink-0"></div>
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold text-gray-900 mb-3">
                        {resource.title}
                      </h3>
                      {resource.info && (
                        <div className="flex gap-2 mb-4 flex-wrap">
                          {Object.entries(resource.info).map(([key, value]) => (
                            <span key={key} className="tag status-ongoing">
                              {String(value)}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center justify-between mt-6">
                        <div className="flex gap-3">
                          {resource.magnet && (
                            <button className="action-btn">
                              📋 复制磁力
                            </button>
                          )}
                          <button className="action-btn">
                            📥 下载
                          </button>
                        </div>
                        <button className="action-btn action-btn-primary">
                          查看详情
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <p className="text-gray-500 text-lg">没有找到相关资源</p>
            </div>
          )}
        </div>
      )}

      {/* 未搜索时的提示 */}
      {!searched && (
        <div className="text-center py-16">
          <p className="text-gray-500 text-lg">输入关键词开始搜索</p>
        </div>
      )}
    </div>
  );
};

export default Search;
