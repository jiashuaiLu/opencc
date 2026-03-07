import { Table, Card, Spin, Empty } from 'antd';
import { useState, useEffect } from 'react';

interface ModelStats {
  model: string;
  requestCount: number;
  totalTokens: number;
  totalCost: string;
  avgCostPerRequest: string;
}

interface ModelStatsTableProps {
  refreshIntervalMs?: number;
}

export default function ModelStatsTable({ refreshIntervalMs = 0 }: ModelStatsTableProps) {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<ModelStats[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (refreshIntervalMs > 0) {
      const interval = setInterval(loadData, refreshIntervalMs);
      return () => clearInterval(interval);
    }
  }, [refreshIntervalMs]);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await window.electronAPI.getModelStats();
      setStats(data || []);
    } catch (error) {
      console.error('Failed to load model stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000000) {
      return `${(tokens / 1000000).toFixed(1)}M`;
    } else if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}k`;
    }
    return tokens.toString();
  };

  const columns = [
    {
      title: '模型',
      dataIndex: 'model',
      key: 'model',
      ellipsis: true,
      render: (model: string) => (
        <span className="model-name">{model || 'unknown'}</span>
      ),
    },
    {
      title: '请求数',
      dataIndex: 'requestCount',
      key: 'requestCount',
      width: 100,
      align: 'right' as const,
      sorter: (a: ModelStats, b: ModelStats) => a.requestCount - b.requestCount,
    },
    {
      title: '总 Token',
      dataIndex: 'totalTokens',
      key: 'totalTokens',
      width: 120,
      align: 'right' as const,
      render: (tokens: number) => formatTokens(tokens),
      sorter: (a: ModelStats, b: ModelStats) => a.totalTokens - b.totalTokens,
    },
  ];

  if (loading) {
    return (
      <Card title="模型统计" className="stats-card">
        <div className="loading-container">
          <Spin />
        </div>
      </Card>
    );
  }

  if (stats.length === 0) {
    return (
      <Card title="模型统计" className="stats-card">
        <Empty description="暂无数据" />
      </Card>
    );
  }

  return (
    <Card title="模型统计" className="stats-card">
      <Table
        columns={columns}
        dataSource={stats}
        rowKey="model"
        pagination={false}
        size="small"
        scroll={{ x: 400 }}
      />
    </Card>
  );
}
