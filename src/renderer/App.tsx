import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Config from './pages/Config';
import Logs from './pages/Logs';
import History from './pages/History';
import Settings from './pages/Settings';
import Documentation from './pages/Documentation';

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/config" element={<Config />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/history" element={<History />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/documentation" element={<Documentation />} />
      </Routes>
    </Layout>
  );
}

export default App;
