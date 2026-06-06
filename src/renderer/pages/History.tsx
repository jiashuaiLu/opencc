import { Card, Table, Tag, Space, Button, Modal, Descriptions, message, Popconfirm } from 'antd';
import { EyeOutlined, DeleteOutlined, ReloadOutlined, MessageOutlined, ClearOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import '../styles/history.css';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface Conversation {
  id: string;
  model: string;
  messages: Message[];
  totalTokens: number;
  createdAt: Date;
  updatedAt: Date;
  messageCount?: number;
  inputTokens?: number;
  outputTokens?: number;
}

function History() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  useEffect(() => {
    loadConversations();
  }, []);

  const loadConversations = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.electronAPI.getConversations();
      setConversations(data || []);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleViewConversation = useCallback((conversation: Conversation) => {
    setSelectedConversation(conversation);
    setModalVisible(true);
  }, []);

  const handleDeleteConversation = useCallback(async (id: string) => {
    try {
      await window.electronAPI.deleteConversation(id);
      setConversations(prev => prev.filter((c) => c.id !== id));
      message.success('对话已删除');
    } catch (error) {
      message.error('删除对话失败');
    }
  }, []);

  const handleDeleteAllConversations = useCallback(async () => {
    try {
      await window.electronAPI.deleteAllConversations();
      setConversations([]);
      message.success('所有对话记录已清空');
    } catch (error) {
      message.error('清空对话记录失败');
    }
  }, []);

  const columns = useMemo(() => [
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (text: Date) => (
        <span style={{ fontSize: 12, color: 'var(--text-secondary-color)' }}>
          {new Date(text).toLocaleString()}
        </span>
      ),
    },
    {
      title: '模型',
      dataIndex: 'model',
      key: 'model',
      width: 140,
      render: (model: string) => (
        <span style={{
          fontSize: 11, fontFamily: "'SF Mono', monospace",
          background: 'var(--glass-bg)', padding: '2px 8px', borderRadius: 5,
          border: '1px solid var(--glass-border)',
        }}>{model}</span>
      ),
    },
    {
      title: '消息',
      dataIndex: 'messageCount',
      key: 'messageCount',
      width: 70,
      align: 'right' as const,
      render: (n: number) => <span style={{ fontSize: 12 }}>{n}</span>,
    },
    {
      title: '输入',
      dataIndex: 'inputTokens',
      key: 'inputTokens',
      width: 80,
      align: 'right' as const,
      render: (n: number) => <span style={{ fontSize: 12 }}>{n?.toLocaleString() || '-'}</span>,
    },
    {
      title: '输出',
      dataIndex: 'outputTokens',
      key: 'outputTokens',
      width: 80,
      align: 'right' as const,
      render: (n: number) => <span style={{ fontSize: 12 }}>{n?.toLocaleString() || '-'}</span>,
    },
    {
      title: '',
      key: 'action',
      width: 120,
      render: (_: any, record: Conversation) => (
        <Space size={4}>
          <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => handleViewConversation(record)} />
          <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteConversation(record.id)} />
        </Space>
      ),
    },
  ], [handleViewConversation, handleDeleteConversation]);

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-title-group">
          <h1>对话历史</h1>
          <p>查看和管理 Claude Code 的历史对话记录</p>
        </div>
        <div className="page-actions">
          <Button size="small" icon={<ReloadOutlined />} onClick={loadConversations}>刷新</Button>
          <Popconfirm
            title="清空所有对话"
            description="此操作不可恢复"
            icon={<ExclamationCircleOutlined style={{ color: 'var(--danger-color)' }} />}
            onConfirm={handleDeleteAllConversations}
            okText="确定"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            disabled={conversations.length === 0}
          >
            <Button size="small" danger icon={<ClearOutlined />} disabled={conversations.length === 0}>
              清空
            </Button>
          </Popconfirm>
        </div>
      </div>

      <div className="page-content">
        <Card className="content-card content-card-no-padding">
          <Table
            columns={columns}
            dataSource={conversations}
            rowKey="id"
            loading={loading}
            pagination={{ pageSize: 20, showSizeChanger: true, size: 'small', showTotal: (t) => `共 ${t} 条` }}
            size="small"
          />
        </Card>

        <Modal
          title={<span style={{ fontWeight: 600 }}>对话详情</span>}
          open={modalVisible}
          onCancel={() => setModalVisible(false)}
          width={800}
          footer={null}
        >
          {selectedConversation && (
            <div>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12,
                marginBottom: 20, padding: 14, borderRadius: 10,
                background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
              }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary-color)', marginBottom: 2 }}>模型</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{selectedConversation.model}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary-color)', marginBottom: 2 }}>消息数</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{selectedConversation.messageCount}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary-color)', marginBottom: 2 }}>总 Token</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{selectedConversation.totalTokens?.toLocaleString()}</div>
                </div>
              </div>

              <div className="chat-container">
                {selectedConversation.messages.map((msg, index) => (
                  <div
                    key={index}
                    className={`chat-message ${msg.role === 'user' ? 'chat-message-user' : 'chat-message-assistant'}`}
                  >
                    <div className="chat-role-tag">
                      <Tag color={msg.role === 'user' ? 'blue' : 'green'} style={{ fontSize: 11 }}>
                        {msg.role === 'user' ? '用户' : '助手'}
                      </Tag>
                    </div>
                    <div className="chat-content">{msg.content}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Modal>
      </div>
    </div>
  );
}

export default memo(History);
