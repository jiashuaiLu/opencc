import { Card, Table, Tag, Space, Button, Modal, Descriptions, message } from 'antd';
import { EyeOutlined, DeleteOutlined, ReloadOutlined, MessageOutlined } from '@ant-design/icons';
import { useState, useEffect } from 'react';
import '../styles/history.css';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
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

export default function History() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  useEffect(() => {
    loadConversations();
  }, []);

  const loadConversations = async () => {
    setLoading(true);
    try {
      const data = await window.electronAPI.getConversations();
      setConversations(data || []);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleViewConversation = (conversation: Conversation) => {
    setSelectedConversation(conversation);
    setModalVisible(true);
  };

  const handleDeleteConversation = async (id: string) => {
    try {
      await window.electronAPI.deleteConversation(id);
      setConversations(conversations.filter((c) => c.id !== id));
      message.success('对话已删除');
    } catch (error) {
      message.error('删除对话失败');
    }
  };

  const columns = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (text: Date) => new Date(text).toLocaleString(),
    },
    {
      title: '模型',
      dataIndex: 'model',
      key: 'model',
      width: 120,
      render: (model: string) => <span className="code-block" style={{ padding: '2px 6px' }}>{model}</span>,
    },
    {
      title: '消息数',
      dataIndex: 'messageCount',
      key: 'messageCount',
      width: 100,
      align: 'right' as const,
    },
    {
      title: '输入Token',
      dataIndex: 'inputTokens',
      key: 'inputTokens',
      width: 100,
      align: 'right' as const,
    },
    {
      title: '输出Token',
      dataIndex: 'outputTokens',
      key: 'outputTokens',
      width: 100,
      align: 'right' as const,
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_: any, record: Conversation) => (
        <Space>
          <Button
            type="text"
            icon={<EyeOutlined />}
            onClick={() => handleViewConversation(record)}
          >
            查看
          </Button>
          <Button
            type="text"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDeleteConversation(record.id)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-title-group">
          <h1>对话历史</h1>
          <p>查看和管理 Claude Code 的历史对话记录</p>
        </div>
        <div className="page-actions">
          <Button icon={<ReloadOutlined />} onClick={loadConversations}>
            刷新
          </Button>
        </div>
      </div>

      <div className="page-content">
        <Card className="content-card content-card-no-padding">
          <Table
            columns={columns}
            dataSource={conversations}
            rowKey="id"
            loading={loading}
            pagination={{
              pageSize: 20,
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条对话`,
            }}
            size="middle"
          />
        </Card>

        <Modal
          title={<div className="form-section-title"><MessageOutlined style={{ marginRight: 8 }} />对话详情</div>}
          open={modalVisible}
          onCancel={() => setModalVisible(false)}
          width={800}
          footer={null}
          className="history-modal"
        >
          {selectedConversation && (
            <div>
              <Descriptions bordered column={2} size="small" style={{ marginBottom: 24 }}>
                <Descriptions.Item label="模型">
                  <span className="code-block" style={{ padding: '2px 6px' }}>{selectedConversation.model}</span>
                </Descriptions.Item>
                <Descriptions.Item label="消息数">
                  {selectedConversation.messageCount}
                </Descriptions.Item>
                <Descriptions.Item label="输入 Token">
                  {selectedConversation.inputTokens}
                </Descriptions.Item>
                <Descriptions.Item label="输出 Token">
                  {selectedConversation.outputTokens}
                </Descriptions.Item>
                <Descriptions.Item label="总 Token">
                  {selectedConversation.totalTokens}
                </Descriptions.Item>
                <Descriptions.Item label="创建时间">
                  {new Date(selectedConversation.createdAt).toLocaleString()}
                </Descriptions.Item>
              </Descriptions>

              <div className="chat-container">
                {selectedConversation.messages.map((msg, index) => (
                  <div
                    key={index}
                    className={`chat-message ${msg.role === 'user' ? 'chat-message-user' : 'chat-message-assistant'}`}
                  >
                    <div className="chat-role-tag">
                      <Tag color={msg.role === 'user' ? 'blue' : 'green'}>
                        {msg.role === 'user' ? '用户' : '助手'}
                      </Tag>
                      <span className="chat-timestamp">{new Date(msg.timestamp).toLocaleTimeString()}</span>
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
