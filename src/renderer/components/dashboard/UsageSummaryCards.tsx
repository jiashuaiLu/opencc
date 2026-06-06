import { Card, Row, Col, Statistic, Spin, message } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  ApiOutlined,
  DollarOutlined,
  ThunderboltOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';
import { useState, useEffect } from 'react';
import { fmtTokens } from '../../utils/format';

interface UsageSummary {
  totalRequests: number;
  successRate: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
}

interface ServiceStatus {
  running: boolean;
  uptime: number;
}

interface UsageSummaryCardsProps {
  days: number;
  onRefresh?: () => void;
}

interface UsageSummaryCardsProps {
  days: number;
  refreshIntervalMs?: number;
  onRefresh?: () => void;
}

export default function UsageSummaryCards({ days, refreshIntervalMs = 30000, onRefresh }: UsageSummaryCardsProps) {
  const [initialLoading, setInitialLoading] = useState(true);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>({ running: false, uptime: 0 });
  const [summary, setSummary] = useState<UsageSummary>({
    totalRequests: 0,
    successRate: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
  });

  useEffect(() => {
    loadData();
    if (refreshIntervalMs > 0) {
      const interval = setInterval(loadData, refreshIntervalMs);
      return () => clearInterval(interval);
    }
  }, [days, refreshIntervalMs]);

  const loadData = async () => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const startOfToday = Math.floor(today.getTime() / 1000);
      const startTime = days === 1 ? startOfToday : startOfToday - (days - 1) * 24 * 60 * 60;
      const data = await window.electronAPI.getUsageSummary(startTime, now);
      if (data) {
        setSummary(data);
      }

      const status = await window.electronAPI.getServiceStatus();
      setServiceStatus(status);
    } catch (error) {
      console.error('Failed to load summary:', error);
    } finally {
      setInitialLoading(false);
    }
  };

  const handleStartService = async () => {
    try {
      const config = await window.electronAPI.getConfig('default') as any;
      // 兼容新嵌套结构 {claude, codex} 与旧扁平结构
      const claude = config?.claude || (config?.apiKey ? {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      } : null);
      const codex = config?.codex;
      const hasValid = (claude && claude.apiKey && claude.baseUrl) || (codex && codex.apiKey && codex.baseUrl);
      if (!config || !hasValid) {
        message.error('请先在配置页面设置 API Key 和 Base URL');
        return;
      }
      // 仪表盘启动时默认启动所有服务
      config.startMode = 'all';
      await window.electronAPI.startService(config);
      setServiceStatus({ running: true, uptime: 0 });
      message.success('代理服务已启动');
    } catch (error) {
      message.error('启动服务失败');
    }
  };

  const handleStopService = async () => {
    try {
      await window.electronAPI.stopService();
      setServiceStatus({ running: false, uptime: 0 });
      message.success('代理服务已停止');
    } catch (error) {
      message.error('停止服务失败');
    }
  };


  if (initialLoading) {
    return (
      <div className="loading-container">
        <Spin size="large" />
      </div>
    );
  }

  const totalTokens = summary.totalInputTokens + summary.totalOutputTokens;
  const totalCacheTokens = summary.totalCacheCreationTokens + summary.totalCacheReadTokens;

  return (
    <div className="summary-cards-container">
      {/* 服务状态卡片 */}
      <Card className="service-status-card">
        <Row gutter={16} align="middle">
          <Col span={12}>
            <Statistic
              title="服务状态"
              value={serviceStatus.running ? '运行中' : '已停止'}
              prefix={
                serviceStatus.running ? (
                  <CheckCircleOutlined style={{ color: '#52c41a' }} />
                ) : (
                  <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                )
              }
              valueStyle={{
                color: serviceStatus.running ? '#52c41a' : '#ff4d4f',
              }}
              className="service-status-value"
            />
          </Col>
          <Col span={12} style={{ textAlign: 'right' }}>
            {serviceStatus.running ? (
              <button
                onClick={handleStopService}
                className="service-status-btn btn-stop"
              >
                <PauseCircleOutlined /> 停止服务
              </button>
            ) : (
              <button
                onClick={handleStartService}
                className="service-status-btn btn-start"
              >
                <PlayCircleOutlined /> 启动服务
              </button>
            )}
          </Col>
        </Row>
      </Card>

      {/* 统计卡片 */}
      <Row gutter={16}>
        <Col span={6}>
          <Card hoverable className="stat-card">
            <Statistic
              title={
                <span className="stat-card-title" style={{ color: '#1890ff' }}>
                  <ApiOutlined />
                  总请求数
                </span>
              }
              value={summary.totalRequests}
              valueStyle={{ color: '#1890ff' }}
              className="stat-value"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card hoverable className="stat-card">
            <Statistic
              title={
                <span className="stat-card-title" style={{ color: '#52c41a' }}>
                  <DollarOutlined />
                  成功率
                </span>
              }
              value={summary.successRate}
              suffix="%"
              valueStyle={{ color: '#52c41a' }}
              className="stat-value"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card hoverable className="stat-card">
            <Statistic
              title={
                <span className="stat-card-title" style={{ color: '#fa8c16' }}>
                  <ThunderboltOutlined />
                  总 Token
                </span>
              }
              value={fmtTokens(totalTokens)}
              valueStyle={{ color: '#fa8c16' }}
              className="stat-value"
            />
            <div className="stat-subtext">
              输入: {fmtTokens(summary.totalInputTokens)} / 输出: {fmtTokens(summary.totalOutputTokens)}
            </div>
          </Card>
        </Col>
        <Col span={6}>
          <Card hoverable className="stat-card">
            <Statistic
              title={
                <span className="stat-card-title" style={{ color: '#722ed1' }}>
                  <DatabaseOutlined />
                  缓存 Token
                </span>
              }
              value={fmtTokens(totalCacheTokens)}
              valueStyle={{ color: '#722ed1' }}
              className="stat-value"
            />
            <div className="stat-subtext">
              创建: {fmtTokens(summary.totalCacheCreationTokens)} / 读取: {fmtTokens(summary.totalCacheReadTokens)}
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
