import { Tabs, Segmented, Button, Space, message } from 'antd';
import {
  ReloadOutlined,
  LineChartOutlined,
  UnorderedListOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import { useState, useEffect } from 'react';
import UsageSummaryCards from '../components/dashboard/UsageSummaryCards';
import UsageTrendChart from '../components/dashboard/UsageTrendChart';
import RequestLogTable from '../components/dashboard/RequestLogTable';
import ModelStatsTable from '../components/dashboard/ModelStatsTable';
import '../styles/dashboard.css';

type TimeRange = '1d' | '7d' | '30d';

export default function Dashboard() {
  const [timeRange, setTimeRange] = useState<TimeRange>('1d');
  const [refreshInterval, setRefreshInterval] = useState(30000);
  const [activeTab, setActiveTab] = useState('logs');

  const days = timeRange === '1d' ? 1 : timeRange === '7d' ? 7 : 30;

  const refreshIntervalOptions = [0, 5000, 10000, 30000, 60000];

  const changeRefreshInterval = () => {
    const currentIndex = refreshIntervalOptions.indexOf(refreshInterval);
    const nextIndex = (currentIndex + 1) % refreshIntervalOptions.length;
    setRefreshInterval(refreshIntervalOptions[nextIndex]);
  };

  const handleRefresh = () => {
    message.success('数据已刷新');
  };

  return (
    <div className="dashboard-container">
      {/* 页面标题和时间范围选择 */}
      <div className="dashboard-header">
        <div className="dashboard-title-group">
          <h1>仪表盘</h1>
          <p>监控代理服务的运行状态和使用情况</p>
        </div>
        <div className="dashboard-actions">
          <Button
            icon={<ReloadOutlined />}
            onClick={changeRefreshInterval}
            className="refresh-btn"
          >
            {refreshInterval > 0 ? `${refreshInterval / 1000}s` : '自动刷新'}
          </Button>
          <Segmented
            value={timeRange}
            onChange={(value) => setTimeRange(value as TimeRange)}
            options={[
              { label: '今天', value: '1d' },
              { label: '7 天', value: '7d' },
              { label: '30 天', value: '30d' },
            ]}
          />
        </div>
      </div>

      {/* 统计卡片 */}
      <UsageSummaryCards days={days} />

      {/* 趋势图表 */}
      <UsageTrendChart days={days} />

      {/* 标签页：请求日志 / 模型统计 */}
      <div className="dashboard-tabs-container">
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'logs',
              label: (
                <span>
                  <UnorderedListOutlined style={{ marginRight: 8 }} />
                  请求日志
                </span>
              ),
              children: (
                <RequestLogTable
                  refreshIntervalMs={refreshInterval > 0 ? refreshInterval : 0}
                />
              ),
            },
            {
              key: 'models',
              label: (
                <span>
                  <BarChartOutlined style={{ marginRight: 8 }} />
                  模型统计
                </span>
              ),
              children: (
                <ModelStatsTable
                  refreshIntervalMs={refreshInterval > 0 ? refreshInterval : 0}
                />
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
