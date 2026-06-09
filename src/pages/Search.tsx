import React, { useState } from 'react';

const Search: React.FC = () => {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<any[]>([]);

  const handleSearch = async () => {
    // TODO: 实现搜索功能
    console.log('搜索:', keyword);
  };

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">搜索资源</h1>
      
      {/* 搜索栏 */}
      <div className="flex gap-4 mb-6">
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="输入关键词搜索..."
          className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={handleSearch}
          className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
        >
          搜索
        </button>
      </div>
      
      {/* 搜索结果 */}
      <div className="space-y-4">
        {results.length === 0 ? (
          <p className="text-gray-500 text-center py-8">暂无搜索结果</p>
        ) : (
          results.map((item, index) => (
            <div key={index} className="bg-white rounded-lg shadow p-4">
              <h3 className="text-lg font-semibold">{item.title}</h3>
              <p className="text-gray-600">{item.description}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default Search;
