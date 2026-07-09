import { useEffect, useState, useRef } from 'react';
import { BrowserRouter as Router, MemoryRouter, Routes, Route, useLocation, useNavigationType } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import Layout from './components/Layout';
import { OnboardingTutorial } from './components/OnboardingTutorial';
import Home from './pages/Home';
import Search from './pages/Search';
import Downloads from './pages/Downloads';
import Library from './pages/Library';
import Player from './pages/Player';
import Actors from './pages/Actors';
import ActorDetail from './pages/ActorDetail';
import Tags from './pages/Tags';
import SeriesDetail from './pages/SeriesDetail';
import Settings from './pages/Settings';
import { useLibraryStore } from './store/libraryStore';
import ToastProvider from './components/ToastProvider';
import { checkLatestRelease } from './utils/api';
import { currentVersion } from './generated/versionInfo';

function App() {
  const windowLabel = getCurrentWindow().label;
  const isPlayerWindow = windowLabel === 'player' || windowLabel.startsWith('player-');
  const playerVideoId = new URLSearchParams(window.location.search).get('videoId') || '0';
  const [dbReady, setDbReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadAll = useLibraryStore((s) => s.loadAll);
  const [autoUpdateInfo, setAutoUpdateInfo] = useState<{ version: string; body?: string; url: string } | null>(null);

  useEffect(() => {
    const preventBrowserContextMenu = (event: MouseEvent) => {
      if (!event.defaultPrevented) {
        event.preventDefault();
      }
    };
    document.addEventListener('contextmenu', preventBrowserContextMenu);
    return () => document.removeEventListener('contextmenu', preventBrowserContextMenu);
  }, []);

  useEffect(() => {
    if (isPlayerWindow) {
      return;
    }

    const initDatabase = async () => {
      try {
        console.log('[App] calling init_db...');
        await invoke('init_db');
        console.log('[App] init_db done, calling loadAll...');
        setDbReady(true);
        await loadAll();
        console.log('[App] loadAll done');
      } catch (err: any) {
        console.error('[App] 初始化失败:', err, JSON.stringify(err));
        setError(`初始化失败: ${err?.message || err || 'unknown'}`);
      }
    };
    initDatabase();
  }, [isPlayerWindow, loadAll]);

  // 启动时后台自动检查更新
  useEffect(() => {
    if (isPlayerWindow || !dbReady) return;
    
    const autoCheckUpdate = async () => {
      try {
        // 等待 5 秒后再检查，避免影响启动速度
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        const release = await checkLatestRelease() as any;
        const tagName = release.tag_name || '';
        const latestVersion = tagName.replace(/^v/, '');
        
        if (latestVersion && latestVersion !== currentVersion) {
          const installer = release.assets?.find((a: any) => 
            a.name.endsWith('.dmg') || a.name.endsWith('.exe') || a.name.endsWith('.msi')
          );
          const downloadUrl = installer?.browser_download_url || release.html_url;
          setAutoUpdateInfo({ version: latestVersion, body: release.body, url: downloadUrl });
        }
      } catch (error) {
        // 静默失败，不影响用户体验
        console.log('[App] 自动检查更新失败:', error);
      }
    };
    
    autoCheckUpdate();
  }, [isPlayerWindow, dbReady]);

  if (isPlayerWindow) {
    return (
      <MemoryRouter initialEntries={[`/player/${playerVideoId}`]}>
        <Routes>
          <Route path="/player/:id" element={<Player />} />
        </Routes>
      </MemoryRouter>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-500 mb-4">初始化失败</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!dbReady) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">正在初始化...</div>
      </div>
    );
  }

  // ScrollRestoration: POP(返回)恢复位置，PUSH/REPLACE(导航)滚到顶部
  const ScrollRestoration: React.FC = () => {
    const location = useLocation();
    const navigationType = useNavigationType();
    const positions = useRef<Map<string, number>>(new Map());

    // 保存离开前的位置
    useEffect(() => {
      return () => {
        // cleanup 时保存当前位置（仅在 POP 前的正常导航时）
        const key = location.key || location.pathname;
        positions.current.set(key, window.scrollY);
      };
    }, [location]);

    // 页面渲染后决定滚动位置
    const prevPathname = useRef(location.pathname);
    useEffect(() => {
      // 只在路由路径变化时处理滚动，search params变化（筛选）不影响
      if (prevPathname.current === location.pathname) return;
      prevPathname.current = location.pathname;

      const key = location.pathname;
      if (navigationType === 'POP') {
        // 返回：恢复之前保存的位置
        const saved = positions.current.get(key);
        if (saved !== undefined && saved > 0) {
          requestAnimationFrame(() => window.scrollTo(0, saved));
          return;
        }
      }
      // PUSH 或 REPLACE：滚到顶部
      window.scrollTo(0, 0);
    }, [location.pathname]);

    return null;
  };

  return (
    <Router>
      <ScrollRestoration />
      <Layout>
        <ToastProvider />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/downloads" element={<Downloads />} />
          <Route path="/library" element={<Library />} />
          <Route path="/player/:id" element={<Player />} />
          <Route path="/actors" element={<Actors />} />
          <Route path="/actors/:id" element={<ActorDetail />} />
          <Route path="/tags" element={<Tags />} />
          <Route path="/series/:id" element={<SeriesDetail />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Layout>
      <OnboardingTutorial />
      
      {/* 自动检查更新弹窗 */}
      {autoUpdateInfo && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60">
          <div className="bg-white rounded-2xl shadow-2xl w-[420px] max-h-[80vh] flex flex-col">
            <div className="p-6 pb-4">
              <h3 className="text-lg font-bold text-gray-900">发现新版本 v{autoUpdateInfo.version}</h3>
            </div>
            <div className="px-6 overflow-y-auto flex-1">
              <p className="text-sm text-gray-600 mb-3">是否跳转下载更新？</p>
              {autoUpdateInfo.body && (
                <div className="p-3 bg-gray-50 rounded-lg mb-4">
                  <p className="text-xs font-medium text-gray-500 mb-2">更新内容：</p>
                  <div className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">
                    {autoUpdateInfo.body}
                  </div>
                </div>
              )}
            </div>
            <div className="p-6 pt-4 flex gap-3 justify-end border-t border-gray-100">
              <button 
                onClick={() => setAutoUpdateInfo(null)} 
                className="action-btn text-sm px-4 py-1.5"
              >
                暂不更新
              </button>
              <button 
                onClick={async () => {
                  const url = autoUpdateInfo.url;
                  setAutoUpdateInfo(null);
                  window.open(url, '_blank');
                }} 
                className="action-btn action-btn-primary text-sm px-4 py-1.5"
              >
                下载更新
              </button>
            </div>
          </div>
        </div>
      )}
    </Router>
  );
}

export default App;
