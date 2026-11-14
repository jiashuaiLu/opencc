import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { Card, Button, Input, Select, Space, List, Empty, Modal, message, Tag, Popconfirm, Tooltip } from 'antd';
import { PlusOutlined, DeleteOutlined, SaveOutlined, EditOutlined, FileTextOutlined, DownloadOutlined, UploadOutlined, CopyOutlined, ExclamationCircleOutlined } from '@ant-design/icons';

const { TextArea } = Input;

interface PromptItem {
  id: string;
  name: string;
  content: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
}

type PromptTarget = 'claude' | 'codex' | 'opencode';

const TARGET_CONFIG: Record<PromptTarget, { label: string; file: string; color: string }> = {
  claude: { label: 'Claude Code', file: '~/.claude/CLAUDE.md', color: '#f59e0b' },
  codex: { label: 'Codex', file: '~/.codex/AGENTS.md', color: '#3b82f6' },
  opencode: { label: 'OpenCode', file: '~/.opencode/AGENTS.md', color: '#10b981' },
};

function PromptManager() {
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editContent, setEditContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [target, setTarget] = useState<PromptTarget>('claude');

  const selectedPrompt = useMemo(() => prompts.find(p => p.id === selectedId), [prompts, selectedId]);

  const loadPrompts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.electronAPI.getPrompts();
      setPrompts(data || []);
    } catch (error) {
      console.error('Failed to load prompts:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPrompts(); }, [loadPrompts]);

  useEffect(() => {
    if (selectedPrompt) {
      setEditName(selectedPrompt.name);
      setEditDescription(selectedPrompt.description || '');
      setEditContent(selectedPrompt.content);
      setDirty(false);
    }
  }, [selectedPrompt]);

  const handleCreate = useCallback(() => {
    const newPrompt: PromptItem = {
      id: `prompt_${Date.now()}`,
      name: '新建 Prompt',
      content: '',
      description: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setPrompts(prev => [newPrompt, ...prev]);
    setSelectedId(newPrompt.id);
    setEditName(newPrompt.name);
    setEditDescription('');
    setEditContent('');
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedId) return;
    const prompt: PromptItem = {
      id: selectedId,
      name: editName || '未命名',
      content: editContent,
      description: editDescription,
      createdAt: selectedPrompt?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    try {
      await window.electronAPI.savePrompt(prompt);
      setPrompts(prev => prev.map(p => p.id === selectedId ? prompt : p));
      setDirty(false);
      message.success('已保存');
    } catch {
      message.error('保存失败');
    }
  }, [selectedId, editName, editContent, editDescription, selectedPrompt]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await window.electronAPI.deletePrompt(id);
      setPrompts(prev => prev.filter(p => p.id !== id));
      if (selectedId === id) {
        setSelectedId(null);
        setEditName('');
        setEditContent('');
        setEditDescription('');
      }
      message.success('已删除');
    } catch {
      message.error('删除失败');
    }
  }, [selectedId]);

  const handleApplyToFile = useCallback(async () => {
    if (!editContent) {
      message.warning('Prompt 内容为空');
      return;
    }
    Modal.confirm({
      title: `写入到 ${TARGET_CONFIG[target].file}`,
      content: `将覆盖 ${TARGET_CONFIG[target].file} 的内容，确认继续？`,
      icon: <ExclamationCircleOutlined />,
      okText: '写入',
      cancelText: '取消',
      onOk: async () => {
        try {
          await window.electronAPI.writePromptFile(target, editContent);
          message.success(`已写入 ${TARGET_CONFIG[target].file}`);
        } catch {
          message.error('写入失败');
        }
      },
    });
  }, [editContent, target]);

  const handleReadFromFile = useCallback(async () => {
    try {
      const result = await window.electronAPI.readPromptFile(target);
      if (!result.exists) {
        message.info(`${TARGET_CONFIG[target].file} 不存在`);
        return;
      }
      setEditContent(result.content);
      setDirty(true);
      message.success('已读取文件内容');
    } catch {
      message.error('读取失败');
    }
  }, [target]);

  const formatDate = (ts: number) => {
    if (!ts) return '-';
    return new Date(ts).toLocaleString();
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-title-group">
          <h1>Prompt 管理</h1>
          <p>管理多套 CLAUDE.md / AGENTS.md，一键切换写入</p>
        </div>
      </div>

      <div className="page-content">
        <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 200px)', minHeight: 500 }}>
          {/* 左侧 Prompt 列表 */}
          <div style={{ width: 300, minWidth: 240, display: 'flex', flexDirection: 'column' }}>
            <Button type="dashed" icon={<PlusOutlined />} onClick={handleCreate} block style={{ marginBottom: 12 }}>
              新建 Prompt
            </Button>
            <Card className="content-card" style={{ flex: 1, overflow: 'auto' }} styles={{ body: { padding: 0 } }}>
              {prompts.length === 0 ? (
                <Empty description="暂无 Prompt" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: 40 }} />
              ) : (
                <List dataSource={prompts} size="small" renderItem={(item) => (
                  <List.Item
                    key={item.id}
                    onClick={() => { if (dirty && selectedId !== item.id) { handleSave(); } setSelectedId(item.id); }}
                    style={{
                      cursor: 'pointer', padding: '10px 14px',
                      borderLeft: selectedId === item.id ? '3px solid var(--primary-color)' : '3px solid transparent',
                      background: selectedId === item.id ? 'var(--glass-bg)' : 'transparent',
                      transition: 'all 0.15s',
                    }}
                    actions={[
                      <Popconfirm key="del" title="确认删除？" onConfirm={(e) => { e?.stopPropagation(); handleDelete(item.id); }}
                        okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
                        <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={e => e.stopPropagation()} />
                      </Popconfirm>,
                    ]}
                  >
                    <div style={{ overflow: 'hidden', flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.name}
                        {dirty && selectedId === item.id && <Tag color="orange" style={{ marginLeft: 6, fontSize: 10 }}>未保存</Tag>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary-color)', marginTop: 2 }}>
                        {item.description || formatDate(item.updatedAt)}
                      </div>
                    </div>
                  </List.Item>
                )} />
              )}
            </Card>
          </div>

          {/* 右侧编辑区 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {!selectedId ? (
              <Card className="content-card" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Empty description="选择或新建一个 Prompt" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              </Card>
            ) : (
              <>
                {/* 操作栏 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, padding: '8px 14px', borderRadius: 10, background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                  <Space>
                    <Select value={target} onChange={v => setTarget(v)} style={{ width: 150 }} size="small">
                      {Object.entries(TARGET_CONFIG).map(([key, cfg]) => (
                        <Select.Option key={key} value={key}>
                          <Tag color={cfg.color} style={{ margin: 0, fontSize: 11 }}>{cfg.label}</Tag>
                        </Select.Option>
                      ))}
                    </Select>
                    <Tooltip title={`从 ${TARGET_CONFIG[target].file} 读取当前内容`}>
                      <Button size="small" icon={<DownloadOutlined />} onClick={handleReadFromFile}>读取文件</Button>
                    </Tooltip>
                    <Tooltip title={`写入到 ${TARGET_CONFIG[target].file}`}>
                      <Button size="small" type="primary" icon={<UploadOutlined />} onClick={handleApplyToFile}>应用到文件</Button>
                    </Tooltip>
                  </Space>
                  <Button size="small" type="primary" icon={<SaveOutlined />} onClick={handleSave} disabled={!dirty}>
                    保存
                  </Button>
                </div>

                {/* 编辑表单 */}
                <Card className="content-card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
                  styles={{ body: { display: 'flex', flexDirection: 'column', flex: 1, padding: 16 } }}>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                    <Input placeholder="Prompt 名称" value={editName}
                      onChange={e => { setEditName(e.target.value); setDirty(true); }}
                      style={{ flex: 1 }} size="small" />
                    <Input placeholder="简短描述（可选）" value={editDescription}
                      onChange={e => { setEditDescription(e.target.value); setDirty(true); }}
                      style={{ flex: 1 }} size="small" />
                  </div>
                  <TextArea
                    value={editContent}
                    onChange={e => { setEditContent(e.target.value); setDirty(true); }}
                    placeholder="在此输入 Prompt 内容（Markdown 格式）..."
                    style={{ flex: 1, fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: 13, resize: 'none' }}
                    autoSize={false}
                  />
                </Card>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(PromptManager);
