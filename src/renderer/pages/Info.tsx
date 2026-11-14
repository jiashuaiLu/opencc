import { Card, Typography, Space, Tag, List } from 'antd';
import { CheckCircleFilled } from '@ant-design/icons';
import { useMemo, memo, useState, useEffect } from 'react';

const { Text } = Typography;

function Info() {
  const [currentVersion, setCurrentVersion] = useState('');

  useEffect(() => {
    window.electronAPI.getCurrentVersion().then(setCurrentVersion).catch(() => {});
  }, []);

  const features = useMemo(() => [
    { title: '代理服务管理', description: '一键启动/停止，支持多种 API 提供商' },
    { title: '配置管理', description: '图形化配置界面，支持多配置方案' },
    { title: '日志系统', description: '实时运行日志，多级别过滤与搜索' },
    { title: '监控统计', description: 'Token 消耗统计与请求耗时分析' },
    { title: '对话历史', description: '查看和管理所有对话记录' },
    { title: 'MCP 管理', description: '管理 MCP 服务器和工具配置' },
  ], []);

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-title-group">
          <h1>应用资讯</h1>
          <p>了解 DongCC 的功能特性和版本信息</p>
        </div>
      </div>

      <div className="page-content">
        <div className="section-label">功能特性</div>
        <Card className="content-card">
          {features.map((item, i) => (
            <div key={i} className="setting-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <CheckCircleFilled style={{ color: 'var(--success-color)', fontSize: 14 }} />
                <div className="setting-row-info">
                  <span className="setting-row-label">{item.title}</span>
                  <span className="setting-row-desc">{item.description}</span>
                </div>
              </div>
              <Tag color="green" style={{ fontSize: 11 }}>稳定</Tag>
            </div>
          ))}
        </Card>

        <div className="section-label">版本信息</div>
        <Card className="content-card">
          <div className="setting-row">
            <div className="setting-row-info">
              <span className="setting-row-label">当前版本</span>
            </div>
            <Tag color="blue">{currentVersion ? `v${currentVersion}` : '-'}</Tag>
          </div>
          <div className="setting-row">
            <div className="setting-row-info">
              <span className="setting-row-label">技术栈</span>
            </div>
            <Space wrap size={4}>
              <Tag color="geekblue">Electron 41</Tag>
              <Tag color="cyan">React 18</Tag>
              <Tag color="purple">TypeScript</Tag>
              <Tag color="green">Ant Design 5</Tag>
            </Space>
          </div>
          <div className="setting-row">
            <div className="setting-row-info">
              <span className="setting-row-label">支持平台</span>
            </div>
            <Tag color="orange">macOS (Apple Silicon)</Tag>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default memo(Info);
