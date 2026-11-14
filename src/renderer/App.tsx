import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Config from './pages/Config';
import Logs from './pages/Logs';
import History from './pages/History';
import Settings from './pages/Settings';
import Documentation from './pages/Documentation';
import Info from './pages/Info';
import McpManagement from './pages/McpManagement';
import SkillManagement from './pages/SkillManagement';
import ThemeSettings from './pages/ThemeSettings';
import PromptManager from './pages/PromptManager';
import FloatingBox from './pages/FloatingBox';
import UpdateNotification from './components/UpdateNotification';
import './styles/common.css';

function MainApp() {
  return (
    <>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/config" element={<Config />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/history" element={<History />} />
          <Route path="/prompts" element={<PromptManager />} />
          <Route path="/mcp" element={<McpManagement />} />
          <Route path="/skills" element={<SkillManagement />} />
          <Route path="/theme" element={<ThemeSettings />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/documentation" element={<Documentation />} />
          <Route path="/info" element={<Info />} />
        </Routes>
      </Layout>
      <UpdateNotification />
    </>
  );
}

function App() {
  return (
    <Routes>
      {/* 悬浮窗：独立视图，不套主界面 Layout */}
      <Route path="/floating" element={<FloatingBox />} />
      <Route path="*" element={<MainApp />} />
    </Routes>
  );
}

export default App;
