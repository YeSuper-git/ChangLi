import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getCurrentWindow } from '@tauri-apps/api/window';
import PageMotion from './PageMotion';
import settingsIcon from '../assets/icons/settings.svg';
import searchIcon from '../assets/icons/search.svg';
import appIcon from '../assets/brand/app-icon.png';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchKeyword, setSearchKeyword] = useState('');
  const hideGlobalSearch = location.pathname.startsWith('/library') || location.pathname.startsWith('/video') || location.pathname.startsWith('/series') || location.pathname.startsWith('/actors');

  const navItems = [
    { path: '/', label: '首页' },
    { path: '/library', label: '视频' },
    { path: '/actors', label: '演员' },
    { path: '/downloads', label: '下载' },
  ];

  const handleGlobalSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const keyword = searchKeyword.trim();
    if (!keyword) return;
    navigate(`/search?q=${encodeURIComponent(keyword)}`);
  };

  const appWindow = getCurrentWindow();
  const handleMinimize = () => appWindow.minimize();
  const handleToggleMaximize = () => appWindow.toggleMaximize();
  const handleClose = () => appWindow.close();

  return (
    <div className="changli-app-shell">
      {/* 顶部导航 */}
      <nav className="changli-topbar sticky top-0 z-50" data-tauri-drag-region>
        <div className="max-w-7xl mx-auto px-8" data-tauri-drag-region>
          <div className="flex items-center justify-between h-16" data-tauri-drag-region>
            <div className="flex items-center gap-8">
              <Link to="/" className="changli-wordmark flex items-center gap-3 text-xl font-bold text-gray-900 no-underline">
                <img src={appIcon} alt="长离" className="h-9 w-9 rounded-xl shadow-sm ring-1 ring-black/5" />
                <span>长离</span>
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
            <div className="flex items-center gap-3">
              {!hideGlobalSearch && (
                <form onSubmit={handleGlobalSearch} className="relative">
                  <input
                    type="search"
                    value={searchKeyword}
                    onChange={(event) => setSearchKeyword(event.target.value)}
                    placeholder="搜索视频或演员..."
                    aria-label="搜索视频或演员"
                    className="px-4 py-2 pr-10 bg-white/80 border border-gray-200 rounded-full text-sm w-56 focus:outline-none focus:ring-4 focus:ring-rose-100 focus:border-rose-300 focus:bg-white transition-all shadow-sm"
                  />
                  <button
                    type="submit"
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full text-gray-500 hover:bg-gray-200 hover:text-gray-900"
                    aria-label="搜索"
                  >
                    <img src={searchIcon} alt="搜索" className="w-4 h-4" />
                  </button>
                </form>
              )}
              <button 
                onClick={() => navigate('/settings')}
                className="w-10 h-10 bg-white/85 border border-gray-200 rounded-full flex items-center justify-center hover:bg-white hover:shadow-md transition-all"
                aria-label="打开设置"
              >
                <img src={settingsIcon} alt="设置" className="w-5 h-5" />
              </button>
              <div className="changli-window-controls" aria-label="窗口控制">
                <button type="button" onClick={handleMinimize} aria-label="最小化">−</button>
                <button type="button" onClick={handleToggleMaximize} aria-label="最大化">□</button>
                <button type="button" onClick={handleClose} aria-label="关闭" className="close">×</button>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* 主内容区 */}
      <main className="changli-main max-w-7xl mx-auto px-8 py-12">
        <PageMotion motionKey={location.pathname}>
          {children}
        </PageMotion>
      </main>
    </div>
  );
};

export default Layout;
