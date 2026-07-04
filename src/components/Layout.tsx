import React, { useRef, useState, useEffect, useLayoutEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getCurrentWindow } from '@tauri-apps/api/window';
import appIcon from '../assets/brand/app-icon.png';
import settingsIcon from '../assets/icons/settings.svg';
import PageMotion from './PageMotion';

interface LayoutProps {
  children: React.ReactNode;
}

// 保存各页面滚动位置，返回时恢复
const scrollPositions = new Map<string, number>();

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const mainRef = useRef<HTMLElement>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [isMaximized, setIsMaximized] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
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

  const runWindowAction = (action: () => Promise<void>, name: string) => {
    action().catch((error) => console.error(`[Layout] ${name} 失败:`, error));
  };

  const handleChromeDrag = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('a,button,input,form,.changli-window-controls')) return;
    appWindow.startDragging().catch((error) => console.error('[Layout] 拖动窗口失败:', error));
  };

  const handleMinimize = () => runWindowAction(() => appWindow.minimize(), '最小化');
  const handleToggleMaximize = () => runWindowAction(async () => {
    await appWindow.toggleMaximize();
    setIsMaximized(await appWindow.isMaximized());
  }, '最大化');
  const handleClose = () => runWindowAction(() => appWindow.close(), '关闭');
  const stopWindowControlDrag = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  // 保存当前页面滚动位置，返回时恢复
  useLayoutEffect(() => {
    const key = location.pathname + location.search;
    const main = mainRef.current;

    if (scrollPositions.has(key)) {
      // 该页面之前访问过，恢复保存的位置
      const savedTop = scrollPositions.get(key)!;
      // 用 setTimeout 确保在 DOM 更新后执行
      setTimeout(() => {
        mainRef.current?.scrollTo({ top: savedTop, left: 0, behavior: 'auto' });
      }, 0);
    } else {
      // 新页面，滚到顶部
      mainRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      window.scrollTo(0, 0);
    }

    // 离开时保存当前滚动位置
    return () => {
      if (main && main.scrollTop > 0) {
        scrollPositions.set(location.pathname + location.search, main.scrollTop);
      }
    };
  }, [location.pathname, location.search]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    appWindow.isMaximized().then(setIsMaximized).catch((error) => console.error('[Layout] 获取最大化状态失败:', error));
    appWindow.onResized(async () => {
      setIsMaximized(await appWindow.isMaximized());
    }).then((fn) => {
      unlisten = fn;
    }).catch((error) => console.error('[Layout] 监听窗口大小失败:', error));
    return () => unlisten?.();
  }, [appWindow]);

  return (
    <div className="changli-app-shell">
      {/* 顶部导航 */}
      <nav className="changli-topbar z-50" onMouseDown={handleChromeDrag}>
        <div className="w-full px-4 sm:px-5">
          <div className="grid h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4">
            <div className="flex items-center gap-8 min-w-0">
              <Link to="/" className="changli-wordmark flex items-center gap-3 text-xl font-bold text-gray-900 no-underline">
                <img src={appIcon} alt="长离" className="h-9 w-9 rounded-xl shadow-sm ring-1 ring-black/5" />
                <span>长离</span>
              </Link>
              <div className="flex flex-wrap gap-2">
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
            <div className="flex min-w-0 items-center justify-end gap-1">
              {!hideGlobalSearch && (
                <div className={`changli-search-bar ${searchExpanded ? 'expanded' : ''}`}>
                  <form onSubmit={handleGlobalSearch} className="changli-search-form">
                    <input
                      ref={searchInputRef}
                      type="search"
                      value={searchKeyword}
                      onChange={(event) => setSearchKeyword(event.target.value)}
                      placeholder="搜索视频或演员..."
                      aria-label="搜索视频或演员"
                      className="changli-search-input"
                      onBlur={() => {
                        if (!searchKeyword.trim()) setSearchExpanded(false);
                      }}
                    />
                  </form>
                </div>
              )}
              <div className="changli-window-controls" aria-label="窗口控制" onMouseDown={stopWindowControlDrag}>
                {!hideGlobalSearch && (
                  <button type="button" aria-label="搜索" title="搜索" onClick={() => {
                    setSearchExpanded((prev) => {
                      const next = !prev;
                      if (next) requestAnimationFrame(() => searchInputRef.current?.focus());
                      return next;
                    });
                  }}>
                    <span className="control-icon search-icon" aria-hidden="true" />
                  </button>
                )}
                <button type="button" onClick={() => navigate('/settings')} aria-label="打开设置" title="设置">
                  <img src={settingsIcon} alt="" className="w-[14px] h-[14px]" />
                </button>
                <button type="button" onClick={handleMinimize} aria-label="最小化" title="最小化">
                  <span className="control-icon minimize-icon" aria-hidden="true" />
                </button>
                <button type="button" onClick={handleToggleMaximize} aria-label="最大化" className={isMaximized ? 'is-maximized' : ''} title="最大化">
                  <span className="control-icon maximize-icon" aria-hidden="true" />
                </button>
                <button type="button" onClick={handleClose} aria-label="关闭" className="close" title="关闭">
                  <span className="control-icon close-icon" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* 主内容区 */}
      <main ref={mainRef} className="changli-main w-full px-4 py-10 sm:px-5 xl:px-6 2xl:px-8">
        <PageMotion motionKey={`${location.pathname}${location.search}`}>
          {children}
        </PageMotion>
      </main>
    </div>
  );
};

export default Layout;
