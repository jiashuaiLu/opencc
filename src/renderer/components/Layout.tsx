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
import Logo from './Logo';
import '../styles/layout.css';

const { Sider, Content } = AntLayout;

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

export default function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

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
          {children}
        </Content>
      </AntLayout>
    </AntLayout>
  );
}
