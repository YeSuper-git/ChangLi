import React from 'react';

const Library: React.FC = () => {
  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">视频库</h1>
      
      {/* 扫描目录 */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">扫描目录</h2>
        <div className="flex gap-4">
          <input
            type="text"
            placeholder="输入目录路径..."
            className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition">
            扫描
          </button>
        </div>
      </div>
      
      {/* 视频列表 */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">本地视频</h2>
        <p className="text-gray-500 text-center py-8">暂无视频</p>
      </div>
    </div>
  );
};

export default Library;
