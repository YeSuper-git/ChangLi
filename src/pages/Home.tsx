import React from 'react';

const Home: React.FC = () => {
  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">首页</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* 资源聚合展示 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">最新资源</h2>
          <p className="text-gray-600">暂无资源</p>
        </div>
        
        {/* 下载状态 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">下载状态</h2>
          <p className="text-gray-600">暂无下载任务</p>
        </div>
        
        {/* 本地视频 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">本地视频</h2>
          <p className="text-gray-600">暂无视频</p>
        </div>
      </div>
    </div>
  );
};

export default Home;
