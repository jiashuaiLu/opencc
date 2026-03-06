import { Layout as AntLayout, Menu } from 'antd';
import {
  DashboardOutlined,
  SettingOutlined,
  FileTextOutlined,
  HistoryOutlined,
  ToolOutlined,
  BookOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import logo from '../assets/logo.png';

const { Sider, Content } = AntLayout;

export default function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: '仪表盘' },
    { key: '/config', icon: <SettingOutlined />, label: '配置管理' },
    { key: '/logs', icon: <FileTextOutlined />, label: '运行日志' },
    { key: '/history', icon: <HistoryOutlined />, label: '对话历史' },
    { key: '/settings', icon: <ToolOutlined />, label: '系统设置' },
    { key: '/documentation', icon: <BookOutlined />, label: '使用文档' },
    { key: '/info', icon: <InfoCircleOutlined />, label: '应用资讯' },
  ];

  return (
    <AntLayout style={{ height: '100vh' }}>
      <Sider width={200} style={{ background: '#fff' }}>
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            fontSize: 20,
            fontWeight: 'bold',
            color: '#1890ff',
            borderBottom: '1px solid #f0f0f0',
            gap: 8,
            paddingLeft: 24,
            paddingTop: 10,
          }}
        >
          <img 
            src={logo} 
            alt="OpenCC Logo" 
            style={{ 
              width: 32, 
              height: 32, 
              objectFit: 'contain' 
            }} 
          />
          OpenCC
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderRight: 0 }}
        />
      </Sider>
      <AntLayout>
        <Content
          style={{
            margin: 24,
            padding: 24,
            background: '#fff',
            borderRadius: 8,
            overflow: 'auto',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
          }}
        >
          {children}
        </Content>
      </AntLayout>
    </AntLayout>
  );
}
