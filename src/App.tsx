import { useEffect, useState, useRef } from 'react';
import { BrowserRouter as Router, MemoryRouter, Routes, Route, useLocation, useNavigationType } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import Layout from './components/Layout';
import Home from './pages/Home';
import Search from './pages/Search';
import Downloads from './pages/Downloads';
import Library from './pages/Library';
import Player from './pages/Player';
import Actors from './pages/Actors';
import ActorDetail from './pages/ActorDetail';
import Tags from './pages/Tags';
import VideoDetail from './pages/VideoDetail';
import SeriesDetail from './pages/SeriesDetail';
import Settings from './pages/Settings';
import { useLibraryStore } from './store/libraryStore';
import ToastProvider from './components/ToastProvider';

function App() {
  const windowLabel = getCurrentWindow().label;
  const isPlayerWindow = windowLabel === 'player' || windowLabel.startsWith('player-');
  const playerVideoId = new URLSearchParams(window.location.search).get('videoId') || '0';
  const [dbReady, setDbReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadAll = useLibraryStore((s) => s.loadAll);

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
        console.log('[App] 开始调用 init_db...');
        await invoke('init_db');
        console.log('[App] init_db 成功');
        setDbReady(true);
        await loadAll();
      } catch (err) {
        console.error('[App] 数据库初始化失败:', err);
        setError(String(err));
      }
    };
    initDatabase();
  }, [isPlayerWindow, loadAll]);

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
    useEffect(() => {
      const key = location.key || location.pathname;
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
    }, [location.pathname, location.search]);

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
          <Route path="/video/:id" element={<VideoDetail />} />
          <Route path="/series/:id" element={<SeriesDetail />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;
