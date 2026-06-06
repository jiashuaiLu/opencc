import { Card, Table, Tag, Space, Button, Input, Select, Tooltip, message } from 'antd';
import { ReloadOutlined, SearchOutlined, ClearOutlined } from '@ant-design/icons';
import { useState, useEffect, useCallback, useMemo, memo } from 'react';

interface Log {
  id: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: Date;
  method?: string;
  url?: string;
  statusCode?: number;
  duration?: number;
  model?: string;
  metadata?: any;
}

function Logs() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(false);
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    loadLogs();
  }, [levelFilter]);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.electronAPI.getLogs({
        level: levelFilter === 'all' ? undefined : levelFilter,
        search: searchText,
        limit: 100,
      });
      setLogs(data || []);
    } catch (error) {
      console.error('Failed to load logs:', error);
    } finally {
      setLoading(false);
    }
  }, [levelFilter, searchText]);

  const handleClearLogs = useCallback(async () => {
    try {
      await window.electronAPI.clearLogs();
      setLogs([]);
      message.success('日志已清空');
    } catch (error) {
      message.error('清空日志失败');
    }
  }, []);

  const columns = useMemo(() => [
    {
      title: '时间',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 170,
      render: (text: Date) => (
        <span style={{ fontSize: 12, color: 'var(--text-secondary-color)' }}>
          {new Date(text).toLocaleString()}
        </span>
      ),
    },
    {
      title: '级别',
      dataIndex: 'level',
      key: 'level',
      width: 80,
      render: (level: string) => {
        const map: Record<string, string> = { error: 'error', warn: 'warning', info: 'processing' };
        return <Tag color={map[level] || 'default'}>{level.toUpperCase()}</Tag>;
      },
    },
    {
      title: '错误信息',
      dataIndex: 'message',
      key: 'errorMessage',
      width: 160,
      render: (text: string, record: Log) => {
        if (record.level !== 'error' || !text) return '-';
        const short = text.length > 30 ? text.slice(0, 30) + '...' : text;
        return (
          <Tooltip title={text}>
            <span style={{ color: 'var(--danger-color)', cursor: 'pointer', fontSize: 12 }}>{short}</span>
          </Tooltip>
        );
      },
    },
    {
      title: 'URL',
      dataIndex: 'url',
      key: 'url',
      ellipsis: true,
      render: (url: string) => url ? <span style={{ fontSize: 12 }} title={url}>{url}</span> : '-',
    },
    {
      title: '状态',
      dataIndex: 'statusCode',
      key: 'statusCode',
      width: 80,
      render: (code: number) => code ? (
        <span className={`status-badge ${code >= 400 ? 'status-badge-error' : 'status-badge-success'}`}>{code}</span>
      ) : '-',
    },
    {
      title: '耗时',
      dataIndex: 'duration',
      key: 'duration',
      width: 80,
      align: 'right' as const,
      render: (d: number) => d ? <span style={{ fontSize: 12 }}>{d}ms</span> : '-',
    },
  ], []);

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-title-group">
          <h1>运行日志</h1>
          <p>查看系统运行状态和错误信息</p>
        </div>
        <div className="page-actions">
          <Button size="small" icon={<ReloadOutlined />} onClick={loadLogs}>刷新</Button>
          <Button size="small" icon={<ClearOutlined />} danger onClick={handleClearLogs}>清空</Button>
        </div>
      </div>

      <div className="page-content">
        <div className="filter-bar">
          <Select
            size="small"
            value={levelFilter}
            onChange={setLevelFilter}
            style={{ width: 110 }}
            options={[
              { label: '全部级别', value: 'all' },
              { label: 'INFO', value: 'info' },
              { label: 'WARN', value: 'warn' },
              { label: 'ERROR', value: 'error' },
            ]}
          />
          <Input
            size="small"
            placeholder="搜索日志..."
            prefix={<SearchOutlined style={{ color: 'var(--text-secondary-color)' }} />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 220 }}
            onPressEnter={loadLogs}
          />
          <Button size="small" type="primary" icon={<SearchOutlined />} onClick={loadLogs}>搜索</Button>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-secondary-color)' }}>
            {logs.length} 条记录
          </span>
        </div>

        <Card className="content-card content-card-no-padding">
          <Table
            columns={columns}
            dataSource={logs}
            rowKey="id"
            loading={loading}
            pagination={{ pageSize: 20, showSizeChanger: true, size: 'small', showTotal: (t) => `共 ${t} 条` }}
            size="small"
          />
        </Card>
      </div>
    </div>
  );
}

export default memo(Logs);
