import { Tabs, Segmented, Button, message } from 'antd';
import {
  ReloadOutlined,
  UnorderedListOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import { useState, useCallback, useMemo, memo } from 'react';
import UsageSummaryCards from '../components/dashboard/UsageSummaryCards';
import UsageTrendChart from '../components/dashboard/UsageTrendChart';
import RequestLogTable from '../components/dashboard/RequestLogTable';
import ModelStatsTable from '../components/dashboard/ModelStatsTable';
import '../styles/dashboard.css';

type TimeRange = '1d' | '7d' | '30d';

const refreshIntervalOptions = [0, 5000, 10000, 30000, 60000];

const segmentedOptions = [
  { label: '今天', value: '1d' },
  { label: '7 天', value: '7d' },
  { label: '30 天', value: '30d' },
];

const tabItems = [
  {
    key: 'logs',
    label: (
      <span>
        <UnorderedListOutlined style={{ marginRight: 8 }} />
        请求日志
      </span>
    ),
    children: <RequestLogTable refreshIntervalMs={0} />,
  },
  {
    key: 'models',
    label: (
      <span>
        <BarChartOutlined style={{ marginRight: 8 }} />
        模型统计
      </span>
    ),
    children: <ModelStatsTable refreshIntervalMs={0} />,
  },
];

function Dashboard() {
  const [timeRange, setTimeRange] = useState<TimeRange>('1d');
  const [refreshInterval, setRefreshInterval] = useState(30000);
  const [activeTab, setActiveTab] = useState('logs');

  const days = useMemo(() => {
    return timeRange === '1d' ? 1 : timeRange === '7d' ? 7 : 30;
  }, [timeRange]);

  const changeRefreshInterval = useCallback(() => {
    setRefreshInterval((prev) => {
      const currentIndex = refreshIntervalOptions.indexOf(prev);
      const nextIndex = (currentIndex + 1) % refreshIntervalOptions.length;
      return refreshIntervalOptions[nextIndex];
    });
  }, []);

  const handleRefresh = useCallback(() => {
    message.success('数据已刷新');
  }, []);

  const handleTimeRangeChange = useCallback((value: string | number) => {
    setTimeRange(value as TimeRange);
  }, []);

  const handleTabChange = useCallback((key: string) => {
    setActiveTab(key);
  }, []);

  const refreshLabel = useMemo(() => {
    return refreshInterval > 0 ? `${refreshInterval / 1000}s` : '自动刷新';
  }, [refreshInterval]);

  const currentTabItems = useMemo(() => {
    return tabItems.map((item) => ({
      ...item,
      children:
        item.key === 'logs' ? (
          <RequestLogTable
            refreshIntervalMs={refreshInterval > 0 ? refreshInterval : 0}
          />
        ) : (
          <ModelStatsTable
            refreshIntervalMs={refreshInterval > 0 ? refreshInterval : 0}
          />
        ),
    }));
  }, [refreshInterval]);

  return (
    <div className="dashboard-container">
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
            {refreshLabel}
          </Button>
          <Segmented
            value={timeRange}
            onChange={handleTimeRangeChange}
            options={segmentedOptions}
          />
        </div>
      </div>

      <UsageSummaryCards days={days} />

      <UsageTrendChart days={days} />

      <div className="dashboard-tabs-container">
        <Tabs
          activeKey={activeTab}
          onChange={handleTabChange}
          items={currentTabItems}
        />
      </div>
    </div>
  );
}

export default memo(Dashboard);
