import { Card, Row, Col, Statistic, Button, Space, message, Modal, List, Tag, Alert, Descriptions } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  WarningOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface EnvironmentStatus {
  claudeCode: {
    installed: boolean;
    version?: string;
    path?: string;
    valid?: boolean;
    message?: string;
  };
  nodejs: {
    installed: boolean;
    version?: string;
    valid?: boolean;
    message?: string;
  };
  port: {
    available: boolean;
    usedBy?: string;
  };
  config: {
    exists: boolean;
    valid: boolean;
    path?: string;
  };
}

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
  const [environmentStatus, setEnvironmentStatus] = useState<EnvironmentStatus | null>(null);
  const [envLoading, setEnvLoading] = useState(false);

  useEffect(() => {
    loadStats();
    checkServiceStatus();
    loadEnvironmentStatus();
  }, []);

  const loadEnvironmentStatus = async () => {
    setEnvLoading(true);
    try {
      const status = await window.electronAPI.getEnvironmentStatus();
      setEnvironmentStatus(status);
    } catch (error) {
      console.error('Failed to load environment status:', error);
    } finally {
      setEnvLoading(false);
    }
  };

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

  const renderEnvironmentStatus = () => {
    if (!environmentStatus) return null;

    const hasIssues = 
      !environmentStatus.nodejs.installed || 
      !environmentStatus.nodejs.valid ||
      !environmentStatus.claudeCode.installed ||
      !environmentStatus.port.available;

    return (
      <Card 
        title={
          <Space>
            <span>环境状态</span>
            {hasIssues ? (
              <WarningOutlined style={{ color: '#faad14' }} />
            ) : (
              <CheckCircleOutlined style={{ color: '#52c41a' }} />
            )}
          </Space>
        }
        extra={
          <Button size="small" onClick={loadEnvironmentStatus} loading={envLoading}>
            刷新
          </Button>
        }
        style={{ marginBottom: 16 }}
      >
        {hasIssues && (
          <Alert
            message="环境检查发现问题"
            description="部分环境配置不符合要求，可能影响服务正常运行"
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}
        
        <Descriptions column={2} size="small">
          <Descriptions.Item 
            label={
              <Space>
                Node.js
                {environmentStatus.nodejs.installed && environmentStatus.nodejs.valid ? (
                  <CheckCircleOutlined style={{ color: '#52c41a' }} />
                ) : (
                  <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                )}
              </Space>
            }
          >
            {environmentStatus.nodejs.installed ? (
              <Space direction="vertical" size={0}>
                <span>{environmentStatus.nodejs.version}</span>
                {!environmentStatus.nodejs.valid && (
                  <span style={{ color: '#ff4d4f', fontSize: 12 }}>
                    {environmentStatus.nodejs.message}
                  </span>
                )}
              </Space>
            ) : (
              <span style={{ color: '#ff4d4f' }}>未安装</span>
            )}
          </Descriptions.Item>

          <Descriptions.Item 
            label={
              <Space>
                Claude Code
                {environmentStatus.claudeCode.installed ? (
                  <CheckCircleOutlined style={{ color: '#52c41a' }} />
                ) : (
                  <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                )}
              </Space>
            }
          >
            {environmentStatus.claudeCode.installed ? (
              <Space direction="vertical" size={0}>
                <span>{environmentStatus.claudeCode.version || '已安装'}</span>
                {environmentStatus.claudeCode.path && (
                  <span style={{ color: '#999', fontSize: 12 }}>
                    {environmentStatus.claudeCode.path}
                  </span>
                )}
              </Space>
            ) : (
              <span style={{ color: '#ff4d4f' }}>
                {environmentStatus.claudeCode.message || '未安装'}
              </span>
            )}
          </Descriptions.Item>

          <Descriptions.Item 
            label={
              <Space>
                端口状态
                {environmentStatus.port.available ? (
                  <CheckCircleOutlined style={{ color: '#52c41a' }} />
                ) : (
                  <WarningOutlined style={{ color: '#faad14' }} />
                )}
              </Space>
            }
          >
            {environmentStatus.port.available ? (
              <span style={{ color: '#52c41a' }}>可用</span>
            ) : (
              <Space direction="vertical" size={0}>
                <span style={{ color: '#faad14' }}>已被占用</span>
                {environmentStatus.port.usedBy && (
                  <span style={{ color: '#999', fontSize: 12 }}>
                    {environmentStatus.port.usedBy}
                  </span>
                )}
              </Space>
            )}
          </Descriptions.Item>

          <Descriptions.Item 
            label={
              <Space>
                Claude 配置
                {environmentStatus.config.exists && environmentStatus.config.valid ? (
                  <CheckCircleOutlined style={{ color: '#52c41a' }} />
                ) : (
                  <WarningOutlined style={{ color: '#faad14' }} />
                )}
              </Space>
            }
          >
            {environmentStatus.config.exists ? (
              <Space direction="vertical" size={0}>
                <span>{environmentStatus.config.valid ? '配置正确' : '配置有误'}</span>
                {environmentStatus.config.path && (
                  <span style={{ color: '#999', fontSize: 12 }}>
                    {environmentStatus.config.path}
                  </span>
                )}
              </Space>
            ) : (
              <span style={{ color: '#faad14' }}>配置文件不存在</span>
            )}
          </Descriptions.Item>
        </Descriptions>
      </Card>
    );
  };

  return (
    <div>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {renderEnvironmentStatus()}
        
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
