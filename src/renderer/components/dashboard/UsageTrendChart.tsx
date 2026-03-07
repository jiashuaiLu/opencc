import { Card, Spin, Empty, Segmented } from 'antd';
import { useState, useEffect } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface DailyStats {
  date: string;
  requestCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
}

interface UsageTrendChartProps {
  days: number;
}

export default function UsageTrendChart({ days }: UsageTrendChartProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DailyStats[]>([]);
  const [metric, setMetric] = useState<'tokens' | 'requests'>('tokens');

  useEffect(() => {
    loadData();
  }, [days]);

  const loadData = async () => {
    setLoading(true);
    try {
      const now = Math.floor(Date.now() / 1000);
      const startTime = now - days * 24 * 60 * 60;
      const trends = await window.electronAPI.getUsageTrends(startTime, now);
      setData(trends || []);
    } catch (error) {
      console.error('Failed to load trends:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    if (dateStr.includes('T')) {
      // Hourly format: "2024-01-15T10:00"
      const parts = dateStr.split('T');
      const time = parts[1].split(':')[0];
      return `${parseInt(time)}:00`;
    } else {
      // Daily format: "2024-01-15"
      const parts = dateStr.split('-');
      return `${parts[1]}-${parts[2]}`;
    }
  };

  const chartData = data.map((item) => ({
    ...item,
    label: formatDate(item.date),
    totalTokens: item.totalInputTokens + item.totalOutputTokens,
  }));

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="chart-tooltip">
          <p>{label}</p>
          {payload.map((entry: any, index: number) => (
            <div key={index} className="chart-tooltip-item">
              <div
                className="chart-tooltip-dot"
                style={{ background: entry.color }}
              />
              <span className="chart-tooltip-label">{entry.name}:</span>
              <span className="chart-tooltip-value">{entry.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <Card className="trend-chart-card">
        <div className="loading-container">
          <Spin size="large" />
        </div>
      </Card>
    );
  }

  if (chartData.length === 0) {
    return (
      <Card
        title="使用趋势"
        className="trend-chart-card"
        extra={
          <Segmented
            value={metric}
            onChange={(value) => setMetric(value as 'tokens' | 'requests')}
            options={[
              { label: 'Token', value: 'tokens' },
              { label: '请求', value: 'requests' },
            ]}
          />
        }
      >
        <Empty description="暂无数据" className="empty-container" />
      </Card>
    );
  }

  return (
    <Card
      title="使用趋势"
      className="trend-chart-card"
      extra={
        <Segmented
          value={metric}
          onChange={(value) => setMetric(value as 'tokens' | 'requests')}
          options={[
            { label: 'Token', value: 'tokens' },
            { label: '请求', value: 'requests' },
          ]}
        />
      }
    >
      <div className="chart-wrapper">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="colorInput" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorOutput" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorCacheCreation" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f97316" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorCacheRead" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#a855f7" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorRequests" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#1890ff" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#1890ff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="#e8e8e8"
              opacity={0.5}
            />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#8c8c8c', fontSize: 12 }}
              dy={10}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#8c8c8c', fontSize: 12 }}
              tickFormatter={(value) =>
                value >= 1000 ? `${(value / 1000).toFixed(0)}k` : value
              }
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            {metric === 'tokens' ? (
              <>
                <Area
                  type="monotone"
                  dataKey="totalInputTokens"
                  name="输入 Tokens"
                  stroke="#3b82f6"
                  fillOpacity={1}
                  fill="url(#colorInput)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="totalOutputTokens"
                  name="输出 Tokens"
                  stroke="#22c55e"
                  fillOpacity={1}
                  fill="url(#colorOutput)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="totalCacheCreationTokens"
                  name="缓存创建"
                  stroke="#f97316"
                  fillOpacity={1}
                  fill="url(#colorCacheCreation)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="totalCacheReadTokens"
                  name="缓存命中"
                  stroke="#a855f7"
                  fillOpacity={1}
                  fill="url(#colorCacheRead)"
                  strokeWidth={2}
                />
              </>
            ) : (
              <Area
                type="monotone"
                dataKey="requestCount"
                name="请求数"
                stroke="#1890ff"
                fillOpacity={1}
                fill="url(#colorRequests)"
                strokeWidth={2}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
