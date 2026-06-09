import React from 'react';

const Downloads: React.FC = () => {
  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">下载管理</h1>
      
      {/* 添加下载 */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">添加下载</h2>
        <div className="flex gap-4">
          <input
            type="text"
            placeholder="输入磁力链接..."
            className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button className="px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition">
            添加
          </button>
        </div>
      </div>
      
      {/* 下载列表 */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">下载列表</h2>
        <p className="text-gray-500 text-center py-8">暂无下载任务</p>
      </div>
    </div>
  );
};

export default Downloads;
