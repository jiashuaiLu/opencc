import {
  ReloadOutlined,
} from '@ant-design/icons';
import { useState, useCallback, memo } from 'react';
import { GlassButton, GlassSegmented } from '../components/ui';
import UsageSummaryCards from '../components/dashboard/UsageSummaryCards';
import ServiceTerminal from '../components/dashboard/ServiceTerminal';
import UsageTrendChart from '../components/dashboard/UsageTrendChart';
import RequestLogTable from '../components/dashboard/RequestLogTable';
import ModelStatsTable from '../components/dashboard/ModelStatsTable';
import '../styles/dashboard.css';

type TimeRange = '1d' | '7d' | '30d';

const refreshIntervalOptions = [0, 5000, 10000, 30000, 60000];

function Dashboard() {
  const [timeRange, setTimeRange] = useState<TimeRange>('1d');
  const [refreshInterval, setRefreshInterval] = useState(30000);
  const [activeTab, setActiveTab] = useState('logs');

  const days = timeRange === '1d' ? 1 : timeRange === '7d' ? 7 : 30;

  const changeRefreshInterval = useCallback(() => {
    const currentIndex = refreshIntervalOptions.indexOf(refreshInterval);
    const nextIndex = (currentIndex + 1) % refreshIntervalOptions.length;
    setRefreshInterval(refreshIntervalOptions[nextIndex]);
  }, [refreshInterval]);

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-title-group">
          <h1>仪表盘</h1>
          <p>监控代理服务的运行状态和使用情况</p>
        </div>
        <div className="page-actions">
          <GlassButton
            size="small"
            icon={<ReloadOutlined />}
            onClick={changeRefreshInterval}
          >
            {refreshInterval > 0 ? `${refreshInterval / 1000}s` : '手动'}
          </GlassButton>
          <GlassSegmented
            size="small"
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

      <div className="page-content">
        <UsageSummaryCards days={days} refreshIntervalMs={refreshInterval} />
        <ServiceTerminal />
        <UsageTrendChart days={days} refreshIntervalMs={refreshInterval} />

        <div className="dashboard-tabs-container">
          <GlassSegmented
            value={activeTab}
            onChange={setActiveTab}
            options={[
              { label: '请求日志', value: 'logs' },
              { label: '模型统计', value: 'models' },
            ]}
            size="small"
          />
          <div style={{ marginTop: 16 }}>
            {activeTab === 'logs' ? (
              <RequestLogTable refreshIntervalMs={refreshInterval > 0 ? refreshInterval : 0} />
            ) : (
              <ModelStatsTable refreshIntervalMs={refreshInterval > 0 ? refreshInterval : 0} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(Dashboard);
