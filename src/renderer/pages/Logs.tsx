import { Card, Table, Tag, Space, Button, Input, Select } from 'antd';
import { ReloadOutlined, SearchOutlined, ClearOutlined } from '@ant-design/icons';
import { useState, useEffect } from 'react';

interface Log {
  id: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
  method?: string;
  url?: string;
  statusCode?: number;
  duration?: number;
  model?: string;
  metadata?: any;
}

export default function Logs() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(false);
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
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
  };

  const handleClearLogs = async () => {
    try {
      await window.electronAPI.clearLogs();
      setLogs([]);
      message.success('日志已清空');
    } catch (error) {
      message.error('清空日志失败');
    }
  };

  const columns = [
    {
      title: '时间',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 160,
      render: (text: string) => new Date(text).toLocaleString(),
    },
    {
      title: '级别',
      dataIndex: 'level',
      key: 'level',
      width: 80,
      render: (level: string) => {
        const color = level === 'error' ? 'red' : level === 'warn' ? 'orange' : 'blue';
        return <Tag color={color}>{level.toUpperCase()}</Tag>;
      },
    },
    {
      title: '方法',
      dataIndex: 'method',
      key: 'method',
      width: 80,
      render: (method: string) => method || '-',
    },
    {
      title: 'URL',
      dataIndex: 'url',
      key: 'url',
      ellipsis: true,
    },
    {
      title: '状态码',
      dataIndex: 'statusCode',
      key: 'statusCode',
      width: 80,
      render: (statusCode: number) => statusCode || '-',
    },
    {
      title: '耗时(ms)',
      dataIndex: 'duration',
      key: 'duration',
      width: 120,
      render: (duration: number) => duration || '-',
    },
  ];

  return (
    <Card
      title="运行日志"
      extra={
        <Space>
          <Select
            value={levelFilter}
            onChange={setLevelFilter}
            style={{ width: 120 }}
            options={[
              { label: '全部', value: 'all' },
              { label: 'INFO', value: 'info' },
              { label: 'WARN', value: 'warn' },
              { label: 'ERROR', value: 'error' },
            ]}
          />
          <Input
            placeholder="搜索日志"
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 200 }}
          />
          <Button icon={<ReloadOutlined />} onClick={loadLogs}>
            刷新
          </Button>
          <Button icon={<ClearOutlined />} danger onClick={handleClearLogs}>
            清空
          </Button>
        </Space>
      }
    >
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
      />
    </Card>
  );
}

import { message } from 'antd';
