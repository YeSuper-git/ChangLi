import React, { useRef, useState, useEffect, useLayoutEffect } from 'react';
import { Link, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
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
  const navigationType = useNavigationType();
  const mainRef = useRef<HTMLElement>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [isMaximized, setIsMaximized] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const hideGlobalSearch = location.pathname.startsWith('/library') || location.pathname.startsWith('/video') || location.pathname.startsWith('/series') || location.pathname.startsWith('/actors');
  const isMac = navigator.platform.includes('Mac') || navigator.userAgent.includes('Mac');

  const navItems = [
    { path: '/', label: '首页' },
    { path: '/library', label: '视频' },
    { path: '/actors', label: '演员', tutorial: 'nav-actors' },
    { path: '/tags', label: '标签' },
    { path: '/subscriptions', label: '订阅' },
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

  const currentScrollKey = location.pathname + location.search;
  const latestScrollKeyRef = useRef(currentScrollKey);

  useEffect(() => {
    latestScrollKeyRef.current = currentScrollKey;
  }, [currentScrollKey]);

  // 滚动恢复机制：返回上一页时恢复原位置；普通跳转进入新页面时回到顶部。
  // 注意：真实滚动容器是 .changli-main，不是 window；并且筛选参数在 search 里，离开页面时必须保存最新 pathname + search。
  useLayoutEffect(() => {
    const restoreKey = latestScrollKeyRef.current;
    const main = mainRef.current;
    let cancelled = false;
    let frame = 0;

    if (navigationType === 'POP' && scrollPositions.has(restoreKey)) {
      const savedTop = scrollPositions.get(restoreKey)!;
      const restore = (attempt = 0) => {
        if (cancelled) return;
        const el = mainRef.current;
        if (!el) return;
        el.scrollTo({ top: savedTop, left: 0, behavior: 'auto' });
        // 列表页返回时可能先渲染骨架/缓存数据，内容高度稍后才撑开；多试几帧避免恢复失败。
        if (attempt < 12 && Math.abs(el.scrollTop - savedTop) > 2) {
          frame = requestAnimationFrame(() => restore(attempt + 1));
        }
      };
      frame = requestAnimationFrame(() => restore());
    } else {
      mainRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      window.scrollTo(0, 0);
    }

    return () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
      if (main && main.scrollTop > 0) {
        scrollPositions.set(latestScrollKeyRef.current, main.scrollTop);
      }
    };
  }, [location.pathname, navigationType]);

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
                {navItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    data-tutorial={item.tutorial}
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
