import { useEffect, useState, useRef } from 'react';
import { BrowserRouter as Router, MemoryRouter, Routes, Route, useLocation, useNavigationType } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
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
import Subscriptions from './pages/Subscriptions';
import { useLibraryStore } from './store/libraryStore';
import ToastProvider from './components/ToastProvider';
import { checkLatestRelease, downloadUpdate, cancelUpdateDownload, installUpdate } from './utils/api';
import { currentVersion } from './generated/versionInfo';

function App() {
  const windowLabel = getCurrentWindow().label;
  const isPlayerWindow = windowLabel === 'player' || windowLabel.startsWith('player-');
  const playerVideoId = new URLSearchParams(window.location.search).get('videoId') || '0';
  const [dbReady, setDbReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadAll = useLibraryStore((s) => s.loadAll);
  const [autoUpdateInfo, setAutoUpdateInfo] = useState<{ version: string; body?: string; url: string; fileName?: string } | null>(null);
  const [autoDownloading, setAutoDownloading] = useState(false);
  const [autoDownloadProgress, setAutoDownloadProgress] = useState<{ downloaded: number; total: number; percentage: number } | null>(null);
  const [autoDownloadedFilePath, setAutoDownloadedFilePath] = useState<string | null>(null);

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
        
        const skipCount = parseInt(localStorage.getItem('changli_skip_auto_update') || '0', 10);
        if (skipCount > 0 && skipCount < 5) {
          localStorage.setItem('changli_skip_auto_update', String(skipCount + 1));
          return;
        }
        localStorage.removeItem('changli_skip_auto_update');
        
        const release = await checkLatestRelease() as any;
        const tagName = release.tag_name || '';
        const latestVersion = tagName.replace(/^v/, '');
        
        if (latestVersion && latestVersion !== currentVersion) {
          const isMac = navigator.platform.includes('Mac') || navigator.userAgent.includes('Mac');
          const installer = isMac
            ? release.assets?.find((a: any) => a.name.endsWith('.dmg'))
            : release.assets?.find((a: any) => a.name.endsWith('.exe')) || release.assets?.find((a: any) => a.name.endsWith('.msi'));
          const downloadUrl = installer?.browser_download_url || release.html_url;
          setAutoUpdateInfo({ version: latestVersion, body: release.body, url: downloadUrl, fileName: installer?.name });
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
          <Route path="/subscriptions" element={<Subscriptions />} />
        </Routes>
      </Layout>
      <OnboardingTutorial />
      
      {/* 自动检查更新弹窗 */}
      {(autoUpdateInfo || autoDownloading || autoDownloadedFilePath) && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60">
          <div className="bg-white rounded-2xl shadow-2xl w-[420px] max-h-[80vh] flex flex-col">
            <div className="p-6 pb-4">
              <h3 className="text-lg font-bold text-gray-900">
                {autoDownloading ? '下载更新' : autoDownloadedFilePath ? '安装更新' : `发现新版本 v${autoUpdateInfo?.version}`}
              </h3>
            </div>
            <div className="px-6 overflow-y-auto flex-1">
              {autoDownloading && autoDownloadProgress ? (
                <div className="space-y-4 py-2">
                  <p className="text-sm text-gray-600">正在下载安装包...</p>
                  <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300 ease-out"
                      style={{
                        width: `${autoDownloadProgress.percentage.toFixed(1)}%`,
                        background: 'linear-gradient(90deg, #fb5b7b, #ff8a4c)',
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{autoDownloadProgress.percentage.toFixed(1)}%</span>
                    <span>
                      {(autoDownloadProgress.downloaded / 1024 / 1024).toFixed(1)} MB
                      {autoDownloadProgress.total > 0 ? ` / ${(autoDownloadProgress.total / 1024 / 1024).toFixed(1)} MB` : ''}
                    </span>
                  </div>
                </div>
              ) : autoDownloadedFilePath ? (
                <div className="py-2">
                  <p className="text-sm text-gray-600 mb-2">安装包已下载完成，点击安装按钮打开安装程序。</p>
                  <p className="text-xs text-gray-500">安装前请关闭当前应用</p>
                </div>
              ) : autoUpdateInfo ? (
                <>
                  <p className="text-sm text-gray-600 mb-3">是否下载更新？</p>
                  <label className="flex items-center gap-2 text-xs text-gray-500 mb-3 cursor-pointer">
                    <input type="checkbox" className="rounded" onChange={(e) => {
                      if (e.target.checked) localStorage.setItem('changli_skip_auto_update', '1');
                      else localStorage.removeItem('changli_skip_auto_update');
                    }} />
                    近期不再提示（5次启动后恢复）
                  </label>
                  {autoUpdateInfo.body && (
                    <div className="p-3 bg-gray-50 rounded-lg mb-4">
                      <p className="text-xs font-medium text-gray-500 mb-2">更新内容：</p>
                      <div className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">
                        {autoUpdateInfo.body}
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </div>
            <div className="p-6 pt-4 flex gap-3 justify-end border-t border-gray-100">
              {autoDownloading ? (
                <button 
                  onClick={async () => {
                    try { await cancelUpdateDownload(); } catch {}
                    setAutoDownloading(false);
                    setAutoDownloadProgress(null);
                    setAutoUpdateInfo(null);
                  }} 
                  className="action-btn text-sm px-4 py-1.5"
                >
                  取消下载
                </button>
              ) : autoDownloadedFilePath ? (
                <>
                  <button 
                    onClick={() => {
                      setAutoDownloadedFilePath(null);
                      setAutoUpdateInfo(null);
                    }} 
                    className="action-btn text-sm px-4 py-1.5"
                  >
                    稍后
                  </button>
                  <button 
                    onClick={async () => {
                      try {
                        await installUpdate(autoDownloadedFilePath);
                      } catch (e) {
                        console.error('打开安装包失败:', e);
                      }
                      setAutoDownloadedFilePath(null);
                      setAutoUpdateInfo(null);
                    }} 
                    className="action-btn action-btn-primary text-sm px-4 py-1.5"
                  >
                    立即安装
                  </button>
                </>
              ) : (
                <>
                  <button 
                    onClick={() => setAutoUpdateInfo(null)} 
                    className="action-btn text-sm px-4 py-1.5"
                  >
                    暂不更新
                  </button>
                  <button 
                    onClick={async () => {
                      if (!autoUpdateInfo) return;
                      const info = autoUpdateInfo;
                      
                      if (!info.fileName) {
                        window.open(info.url, '_blank');
                        setAutoUpdateInfo(null);
                        return;
                      }
                      
                      setAutoDownloading(true);
                      setAutoDownloadProgress({ downloaded: 0, total: 0, percentage: 0 });
                      
                      const unlisten = await listen<{ downloaded: number; total: number; percentage: number }>(
                        'update-download-progress',
                        (event) => setAutoDownloadProgress(event.payload)
                      );
                      
                      try {
                        const filePath = await downloadUpdate(info.url, info.fileName);
                        setAutoDownloadedFilePath(filePath);
                      } catch (error: any) {
                        const errMsg = String(error?.message || error || '');
                        if (!errMsg.includes('取消')) {
                          window.open(info.url, '_blank');
                        }
                        setAutoUpdateInfo(null);
                      } finally {
                        unlisten();
                        setAutoDownloading(false);
                        setAutoDownloadProgress(null);
                      }
                    }} 
                    className="action-btn action-btn-primary text-sm px-4 py-1.5"
                  >
                    下载更新
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </Router>
  );
}

export default App;
