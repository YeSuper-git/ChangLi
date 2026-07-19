import React, { useRef, useState, useEffect, useLayoutEffect } from 'react';
import { Link, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { getCurrentWindow } from '@tauri-apps/api/window';
import appIcon from '../assets/brand/app-icon.png';
import settingsIcon from '../assets/icons/settings.svg';
import PageMotion from './PageMotion';
import { navigateToLibraryReady } from '../utils/libraryNavigation';
import { NAV_VISIBILITY_CHANGED_EVENT, readNavVisibility, type NavVisibility } from '../utils/navVisibility';

interface LayoutProps {
  children: React.ReactNode;
}

const routeScrollPositions = new Map<string, number>();


const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const mainRef = useRef<HTMLElement>(null);
  const currentScrollKey = `${location.pathname}${location.search}`;
  const latestScrollKeyRef = useRef(currentScrollKey);
  const previousPathnameRef = useRef(location.pathname);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [isMaximized, setIsMaximized] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [navVisibility, setNavVisibility] = useState<NavVisibility>(() => readNavVisibility());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const hideGlobalSearch = location.pathname.startsWith('/library') || location.pathname.startsWith('/video') || location.pathname.startsWith('/series') || location.pathname.startsWith('/actors') || location.pathname.startsWith('/completion');
  const isMac = navigator.platform.includes('Mac') || navigator.userAgent.includes('Mac');

  const navItems = [
    { path: '/', label: '首页' },
    { path: '/library', label: '视频' },
    { path: '/actors', label: '演员', tutorial: 'nav-actors' },
    { path: '/tags', label: '标签' },
    { path: '/subscriptions', label: '订阅', visibilityKey: 'subscriptions' as const },
    { path: '/downloads', label: '下载', visibilityKey: 'downloads' as const },
    { path: '/completion', label: '影评', visibilityKey: 'completion' as const },
  ];

  const visibleNavItems = navItems.filter((item) => !item.visibilityKey || navVisibility[item.visibilityKey]);

  const handleGlobalSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const keyword = searchKeyword.trim();
    if (!keyword) return;
    navigate(`/search?q=${encodeURIComponent(keyword)}`);
  };

  const handleNavClick = (event: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    if (path !== '/library') return;
    event.preventDefault();
    navigateToLibraryReady(navigate, path).catch((error) => {
      console.error('[Layout] 进入视频库前准备海报失败:', error);
      navigate(path);
    });
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

  useEffect(() => {
    latestScrollKeyRef.current = currentScrollKey;
  }, [currentScrollKey]);

  useLayoutEffect(() => {
    const restoreTimers: number[] = [];

    const saveLeavingScrollPosition = () => {
      const main = mainRef.current;
      const top = main?.scrollTop ?? 0;
      const key = latestScrollKeyRef.current;
      if (top > 0) {
        routeScrollPositions.set(key, top);
      } else {
        routeScrollPositions.delete(key);
      }
    };

    const scrollMainTo = (top: number) => {
      const main = mainRef.current;
      main?.scrollTo({ top, left: 0, behavior: 'auto' });
    };

    const scheduleRestore = (callback: () => void, delay: number) => {
      const timer = window.setTimeout(callback, delay);
      restoreTimers.push(timer);
    };

    const pathnameChanged = previousPathnameRef.current !== location.pathname;
    previousPathnameRef.current = location.pathname;

    if (navigationType === 'POP') {
      const targetTop = routeScrollPositions.get(currentScrollKey) || 0;
      let attempts = 0;
      const restore = () => {
        scrollMainTo(targetTop);
        attempts += 1;
        if (targetTop > 0 && attempts < 8) {
          scheduleRestore(restore, 50);
        }
      };
      scheduleRestore(restore, 0);
    } else if (pathnameChanged) {
      scrollMainTo(0);
    }

    return () => {
      restoreTimers.forEach((timer) => window.clearTimeout(timer));
      saveLeavingScrollPosition();
    };
  }, [location.key]);

  useEffect(() => {
    const handleVisibilityChange = (event: Event) => {
      const customEvent = event as CustomEvent<NavVisibility>;
      setNavVisibility(customEvent.detail || readNavVisibility());
    };
    window.addEventListener(NAV_VISIBILITY_CHANGED_EVENT, handleVisibilityChange);
    window.addEventListener('storage', handleVisibilityChange);
    return () => {
      window.removeEventListener(NAV_VISIBILITY_CHANGED_EVENT, handleVisibilityChange);
      window.removeEventListener('storage', handleVisibilityChange);
    };
  }, []);

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
              {/* macOS 原生红绿灯由 Tauri titleBarStyle: overlay 提供，导航栏左侧留空 */}
              {isMac && <div className="w-[50px] flex-shrink-0" />}
              <Link to="/" className="changli-wordmark flex items-center gap-3 text-xl font-bold text-gray-900 no-underline">
                <img src={appIcon} alt="长离" className="h-9 w-9 rounded-xl shadow-sm ring-1 ring-black/5" />
                {!isMac && <span>长离</span>}
              </Link>
              <div className="flex flex-wrap gap-2">
                {visibleNavItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    data-tutorial={item.tutorial}
                    onClick={(event) => handleNavClick(event, item.path)}
                    className={`nav-link relative overflow-visible ${
                      location.pathname === item.path ? 'active' : ''
                    }`}
                  >
                    {item.label}
                    {item.path === '/completion' && (
                      <span className="absolute -right-3 -bottom-1 rounded-full bg-gray-200 px-1.5 py-0.5 text-[9px] font-semibold leading-none tracking-wide text-gray-500 ring-1 ring-gray-300/70">
                        Bata
                      </span>
                    )}
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
                <button type="button" onClick={() => navigate('/settings')} aria-label="打开设置" title="设置" data-tutorial="go-settings">
                  <img src={settingsIcon} alt="" className="w-[14px] h-[14px]" />
                </button>
                {/* Windows 窗口控制按钮 */}
                {!isMac && (
                  <>
                    <button type="button" onClick={handleMinimize} aria-label="最小化" title="最小化">
                      <span className="control-icon minimize-icon" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={handleToggleMaximize} aria-label="最大化" className={isMaximized ? 'is-maximized' : ''} title="最大化">
                      <span className="control-icon maximize-icon" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={handleClose} aria-label="关闭" className="close" title="关闭">
                      <span className="control-icon close-icon" aria-hidden="true" />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* 主内容区 */}
      <main ref={mainRef} className="changli-main w-full px-4 py-10 sm:px-5 xl:px-6 2xl:px-8">
        <PageMotion motionKey={location.pathname}>
          {children}
        </PageMotion>
      </main>
    </div>
  );
};

export default Layout;
