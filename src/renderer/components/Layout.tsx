import { Layout as AntLayout, Menu } from 'antd';
import {
  DashboardOutlined,
  SettingOutlined,
  FileTextOutlined,
  HistoryOutlined,
  ToolOutlined,
  BookOutlined,
  InfoCircleOutlined,
  ApiOutlined,
  ThunderboltOutlined,
  SkinOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Logo from './Logo';
import '../styles/layout.css';

const { Sider, Content } = AntLayout;

export default function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: '仪表盘' },
    { key: '/config', icon: <SettingOutlined />, label: '配置管理' },
    { key: '/logs', icon: <FileTextOutlined />, label: '运行日志' },
    { key: '/history', icon: <HistoryOutlined />, label: '对话历史' },
    { key: '/mcp', icon: <ApiOutlined />, label: 'MCP 管理' },
    { key: '/skills', icon: <ThunderboltOutlined />, label: 'Skills 管理' },
    { key: '/theme', icon: <SkinOutlined />, label: '主题设置' },
    { key: '/settings', icon: <ToolOutlined />, label: '系统设置' },
    { key: '/documentation', icon: <BookOutlined />, label: '使用文档' },
    { key: '/info', icon: <InfoCircleOutlined />, label: '应用资讯' },
  ];

  return (
    <AntLayout className="app-layout">
      <Sider
        width={240}
        className="app-sider"
        trigger={null}
      >
        <div className="app-logo-container">
          <Logo width={32} height={32} />
          <span className="app-logo-text">OpenCC</span>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          className="app-menu"
        />
      </Sider>
      <AntLayout className="app-content-layout">
        <Content className="app-content">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              style={{ height: '100%' }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </Content>
      </AntLayout>
    </AntLayout>
  );
}
