import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();

  const navItems = [
    { path: '/', label: '首页' },
    { path: '/search', label: '搜索' },
    { path: '/downloads', label: '下载' },
    { path: '/library', label: '视频库' },
    { path: '/actors', label: '演员' },
    { path: '/tags', label: '标签' },
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* 顶部导航 */}
      <nav className="bg-white border-b border-gray-100 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-8">
              <Link to="/" className="text-xl font-bold text-gray-900 no-underline">
                长离
              </Link>
              <div className="flex gap-2">
                {navItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`nav-link ${
                      location.pathname === item.path ? 'active' : ''
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <input
                type="text"
                placeholder="搜索..."
                className="px-4 py-2 bg-gray-50 border-0 rounded-full text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
              />
              <button 
                onClick={() => navigate('/settings')}
                className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200"
              >
                <span>⚙️</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* 主内容区 */}
      <main className="max-w-7xl mx-auto px-8 py-12">
        {children}
      </main>
    </div>
  );
};

export default Layout;
