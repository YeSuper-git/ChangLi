import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { invoke } from '@tauri-apps/api';
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
import Settings from './pages/Settings';

function App() {
  const [dbReady, setDbReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initDatabase = async () => {
      try {
        await invoke('init_db');
        setDbReady(true);
      } catch (err) {
        console.error('数据库初始化失败:', err);
        setError(String(err));
      }
    };
    initDatabase();
  }, []);

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

  return (
    <Router>
      <Layout>
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
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;
