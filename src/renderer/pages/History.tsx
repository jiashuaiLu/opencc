import { Card, Table, Tag, Space, Button, Modal, Descriptions } from 'antd';
import { EyeOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { useState, useEffect } from 'react';

interface Conversation {
  id: string;
  model: string;
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  createdAt: string;
  messages: Message[];
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
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
      width: 160,
      render: (text: string) => new Date(text).toLocaleString(),
    },
    {
      title: '模型',
      dataIndex: 'model',
      key: 'model',
      width: 80,
      render: (model: string) => <Tag color="blue">{model}</Tag>,
    },
    {
      title: '消息数',
      dataIndex: 'messageCount',
      key: 'messageCount',
      width: 80,
    },
    {
      title: '输入Token',
      dataIndex: 'inputTokens',
      key: 'inputTokens',
      width: 90,
    },
    {
      title: '输出Token',
      dataIndex: 'outputTokens',
      key: 'outputTokens',
      width: 90,
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: any, record: Conversation) => (
        <Space>
          <Button
            type="link"
            icon={<EyeOutlined />}
            onClick={() => handleViewConversation(record)}
          >
            查看
          </Button>
          <Button
            type="link"
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
    <Card
      title="对话历史"
      extra={
        <Button icon={<ReloadOutlined />} onClick={loadConversations}>
          刷新
        </Button>
      }
    >
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
      />

      <Modal
        title="对话详情"
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        width={800}
        footer={null}
      >
        {selectedConversation && (
          <div>
            <Descriptions bordered column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="模型">{selectedConversation.model}</Descriptions.Item>
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

            <div style={{ maxHeight: 400, overflow: 'auto' }}>
              {selectedConversation.messages.map((msg, index) => (
                <div
                  key={index}
                  style={{
                    marginBottom: 16,
                    padding: 12,
                    background: msg.role === 'user' ? '#f5f5f5' : '#e6f7ff',
                    borderRadius: 8,
                  }}
                >
                  <Tag color={msg.role === 'user' ? 'blue' : 'green'}>
                    {msg.role === 'user' ? '用户' : '助手'}
                  </Tag>
                  <div style={{ marginTop: 8 }}>{msg.content}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}

import { message } from 'antd';
