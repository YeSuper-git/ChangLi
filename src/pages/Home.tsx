import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getActors } from '../utils/api';
import type { Actor } from '../utils/api';

const Home: React.FC = () => {
  const [actors, setActors] = useState<Actor[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('全部');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const actorsList = await getActors();
      setActors(actorsList);
    } catch (error) {
      console.error('加载数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  const categories = ['全部', '日漫', '国漫', '泡面番', '里番', '系列'];

  return (
    <div>
      {/* 分类标签 */}
      <div className="flex gap-3 mb-12">
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => setActiveCategory(category)}
            className={`category-btn ${activeCategory === category ? 'active' : ''}`}
          >
            {category}
          </button>
        ))}
      </div>

      {/* 继续观看 */}
      <section className="mb-16">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-gray-900">继续观看</h2>
          <Link to="/library" className="text-blue-500 hover:text-blue-600 text-sm font-medium">
            查看全部 →
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-8">
          {/* 卡片 1 */}
          <div className="card">
            <div className="aspect-[16/10] bg-gradient-to-br from-orange-100 to-orange-200 relative">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-16 h-16 bg-white/90 rounded-full flex items-center justify-center shadow-lg">
                  <span className="text-2xl ml-1">▶️</span>
                </div>
              </div>
              <div className="absolute bottom-4 left-4 bg-black/80 text-white text-sm px-3 py-1.5 rounded-full">
                第8集 19:23
              </div>
            </div>
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">进击的巨人 最终季</h3>
              <div className="flex gap-2 mb-4">
                <span className="tag status-ongoing">连载中</span>
                <span className="tag status-watching">观看中</span>
              </div>
              <div className="text-sm text-gray-500 mb-4">更新至第12集 · 每周日更新</div>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: '66%' }}></div>
                </div>
                <span className="text-sm text-gray-500">66%</span>
              </div>
            </div>
          </div>

          {/* 卡片 2 */}
          <div className="card">
            <div className="aspect-[16/10] bg-gradient-to-br from-pink-100 to-pink-200 relative">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-16 h-16 bg-white/90 rounded-full flex items-center justify-center shadow-lg">
                  <span className="text-2xl ml-1">▶️</span>
                </div>
              </div>
              <div className="absolute bottom-4 left-4 bg-black/80 text-white text-sm px-3 py-1.5 rounded-full">
                第3集 08:45
              </div>
            </div>
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">间谍过家家 第二季</h3>
              <div className="flex gap-2 mb-4">
                <span className="tag status-ongoing">连载中</span>
                <span className="tag status-watching">观看中</span>
              </div>
              <div className="text-sm text-gray-500 mb-4">更新至第5集 · 每周六更新</div>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-pink-500 rounded-full" style={{ width: '60%' }}></div>
                </div>
                <span className="text-sm text-gray-500">60%</span>
              </div>
            </div>
          </div>

          {/* 卡片 3 */}
          <div className="card">
            <div className="aspect-[16/10] bg-gradient-to-br from-purple-100 to-purple-200 relative">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-16 h-16 bg-white/90 rounded-full flex items-center justify-center shadow-lg">
                  <span className="text-2xl ml-1">▶️</span>
                </div>
              </div>
              <div className="absolute bottom-4 left-4 bg-black/80 text-white text-sm px-3 py-1.5 rounded-full">
                第1集 02:10
              </div>
            </div>
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">咒术回战 第二季</h3>
              <div className="flex gap-2 mb-4">
                <span className="tag status-ongoing">连载中</span>
                <span className="tag status-watching">观看中</span>
              </div>
              <div className="text-sm text-gray-500 mb-4">更新至第10集 · 每周四更新</div>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-purple-500 rounded-full" style={{ width: '10%' }}></div>
                </div>
                <span className="text-sm text-gray-500">10%</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 最近更新 */}
      <section className="mb-16">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-gray-900">最近更新</h2>
          <Link to="/library" className="text-blue-500 hover:text-blue-600 text-sm font-medium">
            查看全部 →
          </Link>
        </div>
        <div className="grid grid-cols-4 gap-6">
          <div className="card">
            <div className="aspect-[3/4] bg-gradient-to-br from-green-100 to-green-200 relative">
              <div className="absolute top-3 right-3 bg-blue-500 text-white text-xs px-3 py-1 rounded-full font-medium">NEW</div>
            </div>
            <div className="p-4">
              <h3 className="font-semibold text-gray-900 mb-2">葬送的芙莉莲</h3>
              <span className="tag status-ongoing">连载中</span>
              <div className="text-sm text-gray-500 mt-2">更新至第16集</div>
            </div>
          </div>

          <div className="card">
            <div className="aspect-[3/4] bg-gradient-to-br from-blue-100 to-blue-200 relative">
              <div className="absolute top-3 right-3 bg-blue-500 text-white text-xs px-3 py-1 rounded-full font-medium">NEW</div>
            </div>
            <div className="p-4">
              <h3 className="font-semibold text-gray-900 mb-2">迷宫饭</h3>
              <span className="tag status-ongoing">连载中</span>
              <div className="text-sm text-gray-500 mt-2">更新至第14集</div>
            </div>
          </div>

          <div className="card">
            <div className="aspect-[3/4] bg-gradient-to-br from-yellow-100 to-yellow-200"></div>
            <div className="p-4">
              <h3 className="font-semibold text-gray-900 mb-2">我推的孩子 第二季</h3>
              <span className="tag status-ongoing">连载中</span>
              <div className="text-sm text-gray-500 mt-2">更新至第8集</div>
            </div>
          </div>

          <div className="card">
            <div className="aspect-[3/4] bg-gradient-to-br from-red-100 to-red-200"></div>
            <div className="p-4">
              <h3 className="font-semibold text-gray-900 mb-2">药屋少女的呢喃</h3>
              <span className="tag status-ongoing">连载中</span>
              <div className="text-sm text-gray-500 mt-2">更新至第20集</div>
            </div>
          </div>
        </div>
      </section>

      {/* 热门演员 */}
      <section>
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-gray-900">热门演员</h2>
          <Link to="/actors" className="text-blue-500 hover:text-blue-600 text-sm font-medium">
            查看全部 →
          </Link>
        </div>
        <div className="grid grid-cols-4 gap-6">
          {actors.slice(0, 4).map((actor) => (
            <Link key={actor.id} to={`/actors/${actor.id}`} className="card block">
              <div className="aspect-[3/4] bg-gradient-to-br from-pink-100 to-pink-200"></div>
              <div className="p-4">
                <h3 className="font-semibold text-gray-900 mb-1">{actor.name}</h3>
                <div className="text-sm text-gray-500">
                  {actor.debut_year ? `${actor.debut_year}年出道` : ''}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
};

export default Home;
