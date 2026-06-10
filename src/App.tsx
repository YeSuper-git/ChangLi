import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Search from './pages/Search';
import Downloads from './pages/Downloads';
import Library from './pages/Library';
import Player from './pages/Player';
import Actors from './pages/Actors';
import ActorDetail from './pages/ActorDetail';
import Tags from './pages/Tags';
import Settings from './pages/Settings';

function App() {
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
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;
