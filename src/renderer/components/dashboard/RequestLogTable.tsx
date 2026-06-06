import { Table, Tag, Button, Input, Select, Space, Spin, Pagination, Tooltip } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useState, useEffect } from 'react';
import { fmtTokens } from '../../utils/format';

const { Option } = Select;

interface RequestLog {
  requestId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalCostUsd: string;
  isStreaming: boolean;
  latencyMs: number;
  durationMs: number;
  statusCode: number;
  errorMessage?: string;
  createdAt: number;
}

interface PaginatedLogs {
  data: RequestLog[];
  total: number;
  page: number;
  pageSize: number;
}

interface RequestLogTableProps {
  refreshIntervalMs?: number;
}

export default function RequestLogTable({ refreshIntervalMs = 0 }: RequestLogTableProps) {
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [modelFilter, setModelFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<number | undefined>();

  useEffect(() => {
    loadData();
  }, [page, pageSize]);

  useEffect(() => {
    if (refreshIntervalMs > 0) {
      const interval = setInterval(loadData, refreshIntervalMs);
      return () => clearInterval(interval);
    }
  }, [refreshIntervalMs, page, pageSize, modelFilter, statusFilter]);

  const loadData = async () => {
    setLoading(true);
    try {
      const filters: any = {};
      if (modelFilter) filters.model = modelFilter;
      if (statusFilter) filters.statusCode = statusFilter;

      const result: PaginatedLogs = await window.electronAPI.getRequestLogs(filters, page, pageSize);
      setLogs(result.data || []);
      setTotal(result.total || 0);
    } catch (error) {
      console.error('Failed to load logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };


  const formatDate = (timestamp: number): string => {
    return new Date(timestamp * 1000).toLocaleString('zh-CN');
  };

  const columns = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (timestamp: number) => formatDate(timestamp),
    },
    {
      title: '模型',
      dataIndex: 'model',
      key: 'model',
      width: 200,
      ellipsis: true,
      render: (model: string) => (
        <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{model || 'unknown'}</span>
      ),
    },
    {
      title: '输入',
      dataIndex: 'inputTokens',
      key: 'inputTokens',
      width: 100,
      align: 'right' as const,
      render: (tokens: number) => fmtTokens(tokens),
    },
    {
      title: '输出',
      dataIndex: 'outputTokens',
      key: 'outputTokens',
      width: 100,
      align: 'right' as const,
      render: (tokens: number) => fmtTokens(tokens),
    },
    {
      title: '缓存读取',
      dataIndex: 'cacheReadTokens',
      key: 'cacheReadTokens',
      width: 100,
      align: 'right' as const,
      render: (tokens: number) => (tokens > 0 ? fmtTokens(tokens) : '-'),
    },
    {
      title: '耗时',
      dataIndex: 'durationMs',
      key: 'durationMs',
      width: 100,
      align: 'center' as const,
      render: (ms: number) => {
        const color = ms < 5000 ? 'green' : ms < 30000 ? 'orange' : 'red';
        return (
          <Tag color={color}>
            {formatDuration(ms || 0)}
          </Tag>
        );
      },
    },
    {
      title: '类型',
      dataIndex: 'isStreaming',
      key: 'isStreaming',
      width: 80,
      align: 'center' as const,
      render: (streaming: boolean) => (
        <Tag color={streaming ? 'blue' : 'purple'}>
          {streaming ? '流式' : '非流式'}
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'statusCode',
      key: 'statusCode',
      width: 80,
      align: 'center' as const,
      render: (status: number) => (
        <Tag color={status >= 200 && status < 300 ? 'green' : 'red'}>
          {status}
        </Tag>
      ),
    },
    {
      title: '错误信息',
      dataIndex: 'errorMessage',
      key: 'errorMessage',
      width: 160,
      ellipsis: true,
      render: (msg: string | undefined) =>
        msg ? (
          <Tooltip title={msg}>
            <span style={{ color: '#ff4d4f', fontSize: 12 }}>{msg}</span>
          </Tooltip>
        ) : (
          <span style={{ color: '#d9d9d9' }}>-</span>
        ),
    },
  ];

  return (
    <div>
      {/* 筛选栏 */}
      <div className="filter-bar">
        <Input
          placeholder="搜索模型"
          prefix={<SearchOutlined />}
          value={modelFilter}
          onChange={(e) => setModelFilter(e.target.value)}
          className="filter-input"
          onPressEnter={loadData}
        />
        <Select
          placeholder="状态码"
          value={statusFilter}
          onChange={setStatusFilter}
          className="filter-select"
          allowClear
        >
          <Option value={200}>200 OK</Option>
          <Option value={400}>400 Bad Request</Option>
          <Option value={401}>401 Unauthorized</Option>
          <Option value={429}>429 Rate Limit</Option>
          <Option value={500}>500 Server Error</Option>
        </Select>
        <Button type="primary" icon={<SearchOutlined />} onClick={loadData}>
          搜索
        </Button>
        <Button icon={<ReloadOutlined />} onClick={loadData}>
          刷新
        </Button>
        <span className="filter-total">
          共 {total} 条记录
        </span>
      </div>

      {/* 表格 */}
      <Spin spinning={loading}>
        <Table
          columns={columns}
          dataSource={logs}
          rowKey="requestId"
          pagination={false}
          size="small"
          scroll={{ x: 1000 }}
          className="logs-table"
        />
        {total > pageSize && (
          <div className="table-pagination">
            <Pagination
              current={page + 1}
              pageSize={pageSize}
              total={total}
              showSizeChanger
              showQuickJumper
              onChange={(p, ps) => {
                setPage(p - 1);
                setPageSize(ps);
              }}
              onShowSizeChange={(current, size) => {
                setPage(0);
                setPageSize(size);
              }}
            />
          </div>
        )}
      </Spin>
    </div>
  );
}
