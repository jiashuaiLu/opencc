import { Card, Row, Col, Statistic, Button, Space, message, Modal, List, Tag } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
} from '@ant-design/icons';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Dashboard() {
  const navigate = useNavigate();
  const [serviceStatus, setServiceStatus] = useState<'running' | 'stopped'>('stopped');
  const [stats, setStats] = useState({
    totalRequests: 0,
    successRate: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    avgDuration: 0,
  });
  const [logsModalVisible, setLogsModalVisible] = useState(false);
  const [recentLogs, setRecentLogs] = useState<any[]>([]);

  useEffect(() => {
    loadStats();
    checkServiceStatus();
  }, []);

  const loadStats = async () => {
    try {
      const data = await window.electronAPI.getStats('today');
      if (data) {
        setStats(data);
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const formatTokens = (tokens: number): string => {
    if (tokens >= 100000) {
      return `${(tokens / 1000).toFixed(1)}k`;
    } else if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}k`;
    } else {
      return tokens.toString();
    }
  };

  const checkServiceStatus = async () => {
    try {
      const status = await window.electronAPI.getServiceStatus();
      setServiceStatus(status.running ? 'running' : 'stopped');
    } catch (error) {
      console.error('Failed to check service status:', error);
    }
  };

  const handleStartService = async () => {
    try {
      const config = await window.electronAPI.getConfig('default');
      if (!config || !config.apiKey || !config.baseUrl) {
        message.error('请先在配置页面设置 API Key 和 Base URL');
        return;
      }
      await window.electronAPI.startService(config);
      setServiceStatus('running');
      message.success('代理服务已启动');
    } catch (error) {
      message.error('启动服务失败');
    }
  };

  const handleStopService = async () => {
    try {
      await window.electronAPI.stopService();
      setServiceStatus('stopped');
      message.success('代理服务已停止');
    } catch (error) {
      message.error('停止服务失败');
    }
  };

  const handleViewRecentLogs = async () => {
    try {
      const logs = await window.electronAPI.getLogs({ limit: 10 });
      setRecentLogs(logs || []);
      setLogsModalVisible(true);
    } catch (error) {
      message.error('加载日志失败');
    }
  };

  return (
    <div>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Card>
          <Row gutter={16} align="middle">
            <Col span={12}>
              <Statistic
                title="服务状态"
                value={serviceStatus === 'running' ? '运行中' : '已停止'}
                prefix={
                  serviceStatus === 'running' ? (
                    <CheckCircleOutlined style={{ color: '#52c41a' }} />
                  ) : (
                    <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                  )
                }
                valueStyle={{
                  color: serviceStatus === 'running' ? '#52c41a' : '#ff4d4f',
                }}
              />
            </Col>
            <Col span={12} style={{ textAlign: 'right' }}>
              <Space>
                {serviceStatus === 'stopped' ? (
                  <Button
                    type="primary"
                    size="large"
                    icon={<PlayCircleOutlined />}
                    onClick={handleStartService}
                  >
                    启动服务
                  </Button>
                ) : (
                  <Button
                    danger
                    size="large"
                    icon={<PauseCircleOutlined />}
                    onClick={handleStopService}
                  >
                    停止服务
                  </Button>
                )}
              </Space>
            </Col>
          </Row>
        </Card>

        <Row gutter={16}>
          <Col span={4}>
            <Card hoverable>
              <Statistic title="总请求数" value={stats.totalRequests} />
            </Card>
          </Col>
          <Col span={4}>
            <Card hoverable>
              <Statistic title="成功率" value={stats.successRate} suffix="%" />
            </Card>
          </Col>
          <Col span={4}>
            <Card hoverable>
              <Statistic 
                title="输入Token" 
                value={formatTokens(stats.totalInputTokens)}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card hoverable>
              <Statistic 
                title="输出Token" 
                value={formatTokens(stats.totalOutputTokens)}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card hoverable>
              <Statistic 
                title="总Token" 
                value={formatTokens(stats.totalTokens)}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card hoverable>
              <Statistic 
                title="平均耗时" 
                value={(stats.avgDuration / 1000).toFixed(1)} 
                suffix="秒" 
              />
            </Card>
          </Col>
        </Row>

        <Card title="快速操作">
          <Space>
            <Button onClick={handleViewRecentLogs}>
              查看最近日志
            </Button>
            <Button onClick={loadStats}>刷新统计</Button>
          </Space>
        </Card>
      </Space>

      <Modal
        title="最近日志"
        open={logsModalVisible}
        onCancel={() => setLogsModalVisible(false)}
        footer={
          <Button type="primary" onClick={() => {
            setLogsModalVisible(false);
            navigate('/logs');
          }}>
            查看全部日志
          </Button>
        }
        width={800}
        bodyStyle={{ maxHeight: 400, overflowY: 'auto', padding: 0 }}
      >
        <List
          dataSource={recentLogs}
          renderItem={(log: any) => (
            <List.Item style={{ padding: '12px 24px' }}>
              <List.Item.Meta
                title={
                  <Space>
                    <Tag color={log.level === 'error' ? 'red' : log.level === 'warn' ? 'orange' : 'blue'}>
                      {log.level?.toUpperCase() || 'INFO'}
                    </Tag>
                    <span style={{ fontSize: 12, color: '#999' }}>
                      {log.timestamp ? new Date(log.timestamp).toLocaleString() : ''}
                    </span>
                  </Space>
                }
                description={log.message || ''}
              />
            </List.Item>
          )}
        />
      </Modal>
    </div>
  );
}
