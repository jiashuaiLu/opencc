import { Card, Table, Tag, Space, Button, Input, Select, message } from 'antd';
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
      width: 180,
      render: (text: Date) => new Date(text).toLocaleString(),
    },
    {
      title: '级别',
      dataIndex: 'level',
      key: 'level',
      width: 100,
      render: (level: string) => {
        let color = 'default';
        if (level === 'error') color = 'error';
        else if (level === 'warn') color = 'warning';
        else if (level === 'info') color = 'processing';
        
        return <Tag color={color}>{level.toUpperCase()}</Tag>;
      },
    },
    {
      title: '方法',
      dataIndex: 'method',
      key: 'method',
      width: 100,
      render: (method: string) => (
        method ? <span className="code-block" style={{ padding: '2px 6px' }}>{method}</span> : '-'
      ),
    },
    {
      title: 'URL',
      dataIndex: 'url',
      key: 'url',
      ellipsis: true,
      render: (url: string) => (
        url ? <span title={url}>{url}</span> : '-'
      ),
    },
    {
      title: '状态码',
      dataIndex: 'statusCode',
      key: 'statusCode',
      width: 100,
      render: (statusCode: number) => (
        statusCode ? (
          <span className={`status-badge ${statusCode >= 400 ? 'status-badge-error' : 'status-badge-success'}`}>
            {statusCode}
          </span>
        ) : '-'
      ),
    },
    {
      title: '耗时(ms)',
      dataIndex: 'duration',
      key: 'duration',
      width: 120,
      align: 'right' as const,
      render: (duration: number) => duration ? `${duration}ms` : '-',
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
          <Button icon={<ReloadOutlined />} onClick={loadLogs}>
            刷新
          </Button>
          <Button icon={<ClearOutlined />} danger onClick={handleClearLogs}>
            清空
          </Button>
        </div>
      </div>

      <div className="page-content">
        <div className="filter-bar">
          <Select
            value={levelFilter}
            onChange={setLevelFilter}
            className="filter-select"
            options={[
              { label: '全部级别', value: 'all' },
              { label: 'INFO', value: 'info' },
              { label: 'WARN', value: 'warn' },
              { label: 'ERROR', value: 'error' },
            ]}
          />
          <Input
            placeholder="搜索日志内容、URL..."
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="filter-input"
            onPressEnter={loadLogs}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={loadLogs}>
            搜索
          </Button>
          <span className="filter-total">
            共 {logs.length} 条记录
          </span>
        </div>

        <Card className="content-card content-card-no-padding">
          <Table
            columns={columns}
            dataSource={logs}
            rowKey="id"
            loading={loading}
            pagination={{
              pageSize: 20,
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条日志`,
            }}
            size="middle"
          />
        </Card>
      </div>
    </div>
  );
}

export default memo(Logs);
