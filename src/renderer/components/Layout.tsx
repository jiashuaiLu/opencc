import { useState, useEffect } from 'react';
import { Tooltip } from 'antd';
import { UserOutlined } from '@ant-design/icons';
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
import RemoteNotice from './RemoteNotice';
import type { UserInfo } from '../../shared/types';
import '../styles/layout.css';

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: '仪表盘', desc: '监控与统计', color: '#3b82f6' },
  { key: '/config', icon: <SettingOutlined />, label: '配置管理', desc: 'API 与模型设置', color: '#6b7280' },
  { key: '/logs', icon: <FileTextOutlined />, label: '运行日志', desc: '请求与错误日志', color: '#10b981' },
  { key: '/history', icon: <HistoryOutlined />, label: '对话历史', desc: '会话记录查看', color: '#8b5cf6' },
  { key: '/mcp', icon: <ApiOutlined />, label: 'MCP 管理', desc: '服务器与工具', color: '#06b6d4' },
  { key: '/skills', icon: <ThunderboltOutlined />, label: 'Skill 广场', desc: '技能安装管理', color: '#f97316' },
  { key: '/theme', icon: <SkinOutlined />, label: '主题设置', desc: '外观与配色', color: '#ec4899' },
  { key: '/settings', icon: <ToolOutlined />, label: '系统设置', desc: '通用与数据', color: '#6b7280' },
  { key: '/documentation', icon: <BookOutlined />, label: '使用文档', desc: '帮助与教程', color: '#14b8a6' },
  { key: '/info', icon: <InfoCircleOutlined />, label: '应用资讯', desc: '版本与更新', color: '#6366f1' },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);

  useEffect(() => {
    window.electronAPI.getUserInfo().then((info) => {
      if (info) setUserInfo(info);
    });
    window.electronAPI.onUserInfoUpdated((info) => {
      setUserInfo(info);
    });
    return () => {
      window.electronAPI.removeUserInfoListener();
    };
  }, []);

  return (
    <div className="app-layout">
      <aside className="app-sider">
        <div className="app-logo-container">
          <Logo width={28} height={28} />
          <span className="app-logo-text">DongCC</span>
        </div>
        <nav className="app-nav">
          {menuItems.map((item) => (
            <div
              key={item.key}
              className={`app-nav-item ${location.pathname === item.key ? 'app-nav-item-active' : ''}`}
              onClick={() => navigate(item.key)}
            >
              <div className="app-nav-icon" style={{ background: item.color }}>
                {item.icon}
              </div>
              <div className="app-nav-text">
                <span className="app-nav-label">{item.label}</span>
                <span className="app-nav-desc">{item.desc}</span>
              </div>
            </div>
          ))}
        </nav>
        {userInfo && (
          <div className="app-user-info">
            <div className="app-user-avatar">
              {userInfo.avatar ? (
                <img src={userInfo.avatar} alt="" />
              ) : (
                <span>{userInfo.name ? userInfo.name.charAt(0) : <UserOutlined />}</span>
              )}
            </div>
            <div className="app-user-detail">
              <span className="app-user-name">{userInfo.name || 'User'}</span>
            </div>
          </div>
        )}
      </aside>
      <main className="app-main">
        <div className="app-content">
          <RemoteNotice />
          {children}
        </div>
      </main>
    </div>
  );
}
