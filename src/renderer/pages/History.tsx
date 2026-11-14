import { Card, Table, Tag, Space, Button, Modal, Tabs, Input, List, Empty, Popconfirm, message, Spin, Tooltip } from 'antd';
import { EyeOutlined, DeleteOutlined, ReloadOutlined, ClearOutlined, ExclamationCircleOutlined, SearchOutlined, PlayCircleOutlined, FolderOutlined, ClockCircleOutlined, MessageOutlined } from '@ant-design/icons';
import { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
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
  cacheCreationTokens?: number;
}

// ── 代理记录 Tab（原有内容） ──

function ProxyRecordsTab() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  useEffect(() => { loadConversations(); }, []);

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
      title: '时间', dataIndex: 'createdAt', key: 'createdAt', width: 170,
      render: (text: Date) => (
        <span style={{ fontSize: 12, color: 'var(--text-secondary-color)' }}>
          {new Date(text).toLocaleString()}
        </span>
      ),
    },
    {
      title: '模型', dataIndex: 'model', key: 'model', width: 140,
      render: (model: string) => (
        <span style={{ fontSize: 11, fontFamily: "'SF Mono', monospace", background: 'var(--glass-bg)', padding: '2px 8px', borderRadius: 5, border: '1px solid var(--glass-border)' }}>{model}</span>
      ),
    },
    { title: '消息', dataIndex: 'messageCount', key: 'messageCount', width: 70, align: 'right' as const, render: (n: number) => <span style={{ fontSize: 12 }}>{n}</span> },
    { title: '输入', key: 'inputTokens', width: 80, align: 'right' as const, render: (_: any, record: Conversation) => <span style={{ fontSize: 12 }}>{((record.inputTokens || 0) + (record.cacheCreationTokens || 0)).toLocaleString()}</span> },
    { title: '输出', dataIndex: 'outputTokens', key: 'outputTokens', width: 80, align: 'right' as const, render: (n: number) => <span style={{ fontSize: 12 }}>{n?.toLocaleString() || '-'}</span> },
    {
      title: '', key: 'action', width: 120,
      render: (_: any, record: Conversation) => (
        <Space size={4}>
          <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => handleViewConversation(record)} />
          <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteConversation(record.id)} />
        </Space>
      ),
    },
  ], [handleViewConversation, handleDeleteConversation]);

  return (
    <>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button size="small" icon={<ReloadOutlined />} onClick={loadConversations}>刷新</Button>
        <Popconfirm
          title="清空所有对话" description="此操作不可恢复"
          icon={<ExclamationCircleOutlined style={{ color: 'var(--danger-color)' }} />}
          onConfirm={handleDeleteAllConversations} okText="确定" cancelText="取消"
          okButtonProps={{ danger: true }} disabled={conversations.length === 0}
        >
          <Button size="small" danger icon={<ClearOutlined />} disabled={conversations.length === 0}>清空</Button>
        </Popconfirm>
      </div>
      <Card className="content-card content-card-no-padding">
        <Table columns={columns} dataSource={conversations} rowKey="id" loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: true, size: 'small', showTotal: (t) => `共 ${t} 条` }}
          size="small" />
      </Card>

      <Modal title={<span style={{ fontWeight: 600 }}>对话详情</span>} open={modalVisible} onCancel={() => setModalVisible(false)} width={800} footer={null}>
        {selectedConversation && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20, padding: 14, borderRadius: 10, background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
              <div><div style={{ fontSize: 11, color: 'var(--text-secondary-color)', marginBottom: 2 }}>模型</div><div style={{ fontSize: 13, fontWeight: 500 }}>{selectedConversation.model}</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--text-secondary-color)', marginBottom: 2 }}>消息数</div><div style={{ fontSize: 13, fontWeight: 500 }}>{selectedConversation.messageCount}</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--text-secondary-color)', marginBottom: 2 }}>总 Token</div><div style={{ fontSize: 13, fontWeight: 500 }}>{selectedConversation.totalTokens?.toLocaleString()}</div></div>
            </div>
            <div className="chat-container">
              {selectedConversation.messages.map((msg, index) => (
                <div key={index} className={`chat-message ${msg.role === 'user' ? 'chat-message-user' : 'chat-message-assistant'}`}>
                  <div className="chat-role-tag"><Tag color={msg.role === 'user' ? 'blue' : 'green'} style={{ fontSize: 11 }}>{msg.role === 'user' ? '用户' : '助手'}</Tag></div>
                  <div className="chat-content">{msg.content}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

// ── Claude Code 会话 Tab ──

interface SessionMeta {
  sessionId: string;
  title: string;
  projectDir: string;
  sourcePath: string;
  createdAt: number;
  lastActiveAt: number;
  messageCount: number;
}

interface SessionMessage {
  role: string;
  content: string;
  timestamp?: number;
}

function ClaudeSessionsTab() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [selectedSession, setSelectedSession] = useState<SessionMeta | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const messageContainerRef = useRef<HTMLDivElement>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.electronAPI.scanSessions();
      setSessions(data || []);
    } catch (error) {
      console.error('Failed to scan sessions:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const filteredSessions = useMemo(() => {
    if (!searchText) return sessions;
    const lower = searchText.toLowerCase();
    return sessions.filter(s =>
      s.title.toLowerCase().includes(lower) ||
      s.projectDir.toLowerCase().includes(lower) ||
      s.sessionId.toLowerCase().includes(lower)
    );
  }, [sessions, searchText]);

  const handleSelectSession = useCallback(async (session: SessionMeta) => {
    setSelectedSession(session);
    setMessagesLoading(true);
    try {
      const msgs = await window.electronAPI.loadSessionMessages(session.sourcePath);
      setMessages(msgs || []);
    } catch (error) {
      console.error('Failed to load messages:', error);
      setMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  const handleResume = useCallback(async (session: SessionMeta) => {
    try {
      await window.electronAPI.launchSessionResume(session.sessionId, session.projectDir);
      message.success('已在终端打开会话');
    } catch (error) {
      message.error('打开终端失败');
    }
  }, []);

  const formatTime = (ts: number) => {
    if (!ts) return '-';
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${diffMin} 分钟前`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} 小时前`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay} 天前`;
    return d.toLocaleDateString();
  };

  const shortPath = (p: string) => {
    if (!p) return '';
    const parts = p.split('/');
    if (parts.length <= 3) return p;
    return '~/' + parts.slice(-2).join('/');
  };

  return (
    <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 260px)', minHeight: 400 }}>
      {/* 左侧会话列表 */}
      <div style={{ width: 340, minWidth: 280, display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
          <Input placeholder="搜索会话..." prefix={<SearchOutlined />} value={searchText}
            onChange={e => setSearchText(e.target.value)} size="small" allowClear style={{ flex: 1 }} />
          <Button size="small" icon={<ReloadOutlined />} onClick={loadSessions} loading={loading} />
        </div>
        <Card className="content-card" style={{ flex: 1, overflow: 'auto', padding: 0 }}
          styles={{ body: { padding: 0 } }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
          ) : filteredSessions.length === 0 ? (
            <Empty description={sessions.length === 0 ? '未找到 Claude Code 会话' : '无匹配结果'}
              image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: 40 }} />
          ) : (
            <List dataSource={filteredSessions} size="small" renderItem={(session) => (
              <List.Item
                key={session.sessionId}
                onClick={() => handleSelectSession(session)}
                style={{
                  cursor: 'pointer', padding: '10px 14px', borderLeft: selectedSession?.sessionId === session.sessionId ? '3px solid var(--primary-color)' : '3px solid transparent',
                  background: selectedSession?.sessionId === session.sessionId ? 'var(--glass-bg)' : 'transparent',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ width: '100%', overflow: 'hidden' }}>
                  <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 4 }}>
                    {session.title}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--text-secondary-color)' }}>
                    <Tooltip title={session.projectDir}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <FolderOutlined /> {shortPath(session.projectDir)}
                      </span>
                    </Tooltip>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <ClockCircleOutlined /> {formatTime(session.lastActiveAt)}
                    </span>
                  </div>
                </div>
              </List.Item>
            )} />
          )}
        </Card>
        <div style={{ fontSize: 11, color: 'var(--text-secondary-color)', marginTop: 6, textAlign: 'center' }}>
          共 {filteredSessions.length} 个会话
        </div>
      </div>

      {/* 右侧消息面板 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {!selectedSession ? (
          <Card className="content-card" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty description="选择左侧会话查看详情" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </Card>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, padding: '8px 14px', borderRadius: 10, background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
              <div style={{ overflow: 'hidden' }}>
                <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedSession.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary-color)' }}>
                  <FolderOutlined /> {selectedSession.projectDir}
                  <span style={{ marginLeft: 12 }}><MessageOutlined /> {selectedSession.messageCount} 条消息</span>
                </div>
              </div>
              <Popconfirm title="在终端 Resume" description={`将打开终端并恢复会话 ${selectedSession.sessionId.substring(0, 8)}...`}
                onConfirm={() => handleResume(selectedSession)} okText="确定" cancelText="取消">
                <Button type="primary" size="small" icon={<PlayCircleOutlined />}>Resume</Button>
              </Popconfirm>
            </div>
            <Card className="content-card" style={{ flex: 1, overflow: 'auto' }}
              styles={{ body: { padding: 0 } }}>
              {messagesLoading ? (
                <div style={{ textAlign: 'center', padding: 40 }}><Spin tip="加载消息中..." /></div>
              ) : messages.length === 0 ? (
                <Empty description="无消息内容" style={{ padding: 40 }} />
              ) : (
                <div ref={messageContainerRef} className="chat-container" style={{ maxHeight: 'none', border: 'none', borderRadius: 0 }}>
                  {messages.map((msg, index) => (
                    <div key={index} className={`chat-message ${msg.role === 'user' ? 'chat-message-user' : 'chat-message-assistant'}`}>
                      <div className="chat-role-tag">
                        <Tag color={msg.role === 'user' ? 'blue' : msg.role === 'assistant' ? 'green' : 'default'} style={{ fontSize: 11 }}>
                          {msg.role === 'user' ? '用户' : msg.role === 'assistant' ? '助手' : msg.role}
                        </Tag>
                        {msg.timestamp && (
                          <span style={{ fontSize: 11, color: 'var(--text-secondary-color)', marginLeft: 8 }}>
                            {new Date(msg.timestamp).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                      <div className="chat-content">
                        {msg.content ? renderContent(msg.content) : <span style={{ color: 'var(--text-secondary-color)', fontStyle: 'italic' }}>[工具调用]</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function renderContent(text: string) {
  if (!text) return null;
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    if (part.startsWith('```') && part.endsWith('```')) {
      const content = part.slice(3, -3);
      const newlineIndex = content.indexOf('\n');
      const code = newlineIndex >= 0 ? content.slice(newlineIndex + 1) : content;
      return <pre key={i} style={{ background: 'var(--glass-bg)', padding: 12, borderRadius: 8, fontSize: 12, overflow: 'auto', margin: '8px 0', border: '1px solid var(--glass-border)' }}>{code}</pre>;
    }
    return <span key={i}>{part}</span>;
  });
}

// ── 主页面 ──

function History() {
  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-title-group">
          <h1>对话历史</h1>
          <p>查看代理请求记录和 Claude Code 本地会话</p>
        </div>
      </div>
      <div className="page-content">
        <Tabs defaultActiveKey="proxy" items={[
          { key: 'proxy', label: '代理记录', children: <ProxyRecordsTab /> },
          { key: 'sessions', label: 'Claude Code 会话', children: <ClaudeSessionsTab /> },
        ]} />
      </div>
    </div>
  );
}

export default memo(History);
