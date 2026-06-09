import React from 'react';
import { useParams } from 'react-router-dom';

const Player: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">播放器</h1>
      
      {/* 播放器区域 */}
      <div className="bg-black rounded-lg aspect-video mb-6 flex items-center justify-center">
        <p className="text-white">视频播放区域 - ID: {id}</p>
      </div>
      
      {/* 播放控制 */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">播放控制</h2>
        <div className="flex gap-4">
          <button className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
            播放
          </button>
          <button className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600">
            暂停
          </button>
          <button className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600">
            停止
          </button>
        </div>
        
        {/* 倍速控制 */}
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            倍速
          </label>
          <div className="flex gap-2">
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
              <button
                key={speed}
                className="px-3 py-1 border rounded hover:bg-gray-100"
              >
                {speed}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Player;
