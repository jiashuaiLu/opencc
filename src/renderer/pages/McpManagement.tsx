import { Card, Button, Space, Tag, Modal, Form, Input, message, Empty, Tooltip, Badge, Radio, Divider, Spin } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, LinkOutlined, CloudServerOutlined, DownOutlined, UpOutlined, ImportOutlined, CheckOutlined, ExclamationCircleOutlined, SettingOutlined } from '@ant-design/icons';
import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import '../styles/management.css';

interface McpServerSpec {
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

interface McpApps {
  claude: boolean;
}

interface McpServer {
  id: string;
  name: string;
  server: McpServerSpec;
  apps: McpApps;
  description?: string;
  homepage?: string;
  docs?: string;
  tags?: string[];
}

interface McpPresetEnvHint {
  key: string;
  label: string;
  hint: string;
}

interface McpPreset {
  id: string;
  name: string;
  tags?: string[];
  server: McpServerSpec;
  homepage?: string;
  docs?: string;
  description?: string;
  envHints?: McpPresetEnvHint[];
}

const APP_CONFIG = {
  claude: {
    label: 'Claude',
    color: '#f97316',
    bgColor: 'rgba(249, 115, 22, 0.1)',
    activeColor: 'rgba(249, 115, 22, 0.2)',
  },
};

type AppId = keyof typeof APP_CONFIG;

function AppCountBar({ totalLabel, counts }: { totalLabel: string; counts: Record<AppId, number> }) {
  return (
    <div className="count-bar">
      <div className="count-bar-left">
        <CloudServerOutlined className="count-bar-icon" />
        <Badge 
          count={totalLabel} 
          className="count-badge"
        />
      </div>
      <div className="count-bar-right">
        {Object.entries(APP_CONFIG).map(([app, config]) => (
          <div
            key={app}
            className="count-item"
            style={{
              background: config.bgColor,
              border: `1px solid ${config.activeColor}`,
            }}
          >
            <span style={{ fontSize: 12, color: 'var(--text-secondary-color)' }}>{config.label}</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: config.color }}>{counts[app as AppId]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AppToggleGroup({
  apps,
  onToggle,
}: {
  apps: Record<AppId, boolean>;
  onToggle: (app: AppId, enabled: boolean) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {Object.entries(APP_CONFIG).map(([app, config]) => {
        const enabled = apps[app as AppId];
        return (
          <Tooltip key={app} title={`${config.label}${enabled ? ' ✓' : ''}`}>
            <button
              type="button"
              onClick={() => onToggle(app as AppId, !enabled)}
              className="app-toggle-btn"
              style={{
                border: enabled ? `2px solid ${config.color}` : '2px solid var(--border-color)',
                background: enabled ? config.activeColor : 'transparent',
                boxShadow: enabled ? `0 2px 8px ${config.activeColor}` : 'none',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: enabled ? config.color : 'var(--text-disabled-color)' }}>C</span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

function ListItemRow({
  isLast,
  children,
}: {
  isLast?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="list-item-row" style={{ borderBottom: isLast ? 'none' : undefined }}>
      {children}
    </div>
  );
}

function McpManagement() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [presets, setPresets] = useState<McpPreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServer | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<number | null>(-1);
  const [showMetadata, setShowMetadata] = useState(false);
  const [serverType, setServerType] = useState<'stdio' | 'http' | 'sse'>('stdio');
  const [enabledClaude, setEnabledClaude] = useState(true);
  const [form] = Form.useForm();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [serverData, presetData] = await Promise.all([
        window.electronAPI.getMcpServers(),
        window.electronAPI.getMcpPresets()
      ]);
      setServers(serverData || []);
      setPresets(presetData || []);
    } catch (error) {
      console.error('Failed to load MCP data:', error);
      message.error('加载 MCP 数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleAdd = useCallback(() => {
    setEditingServer(null);
    setSelectedPreset(-1);
    setShowMetadata(false);
    setServerType('stdio');
    setEnabledClaude(true);
    form.resetFields();
    setModalVisible(true);
  }, [form]);

  const handleEdit = useCallback((server: McpServer) => {
    setEditingServer(server);
    setSelectedPreset(null);
    setShowMetadata(!!(server.description || server.tags?.length || server.homepage || server.docs));
    setServerType(server.server.type);
    setEnabledClaude(server.apps.claude);
    form.setFieldsValue({
      id: server.id,
      name: server.name,
      description: server.description,
      serverType: server.server.type,
      command: server.server.command,
      argsStr: server.server.args?.join(' ') || '',
      envStr: server.server.env ? Object.entries(server.server.env).map(([k, v]) => `${k}=${v}`).join('\n') : '',
      url: server.server.url,
      headersStr: server.server.headers ? Object.entries(server.server.headers).map(([k, v]) => `${k}: ${v}`).join('\n') : '',
      homepage: server.homepage,
      docs: server.docs,
      tags: server.tags?.join(', ') || '',
      enabledClaude: server.apps.claude,
    });
    setModalVisible(true);
  }, [form]);

  const handleDelete = useCallback((id: string) => {
    Modal.confirm({
      title: '删除确认',
      icon: <ExclamationCircleOutlined />,
      content: `确定要删除 MCP 服务器 "${id}" 吗？`,
      okText: '确定',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await window.electronAPI.deleteMcpServer(id);
          message.success('删除成功');
          loadData();
        } catch (error) {
          message.error('删除失败');
        }
      },
    });
  }, [loadData]);

  const handleToggleApp = useCallback(async (id: string, app: 'claude', enabled: boolean) => {
    try {
      await window.electronAPI.toggleMcpApp(id, app, enabled);
      loadData();
    } catch (error) {
      message.error('操作失败');
    }
  }, [loadData]);

  const handleImport = useCallback(async () => {
    try {
      const result = await window.electronAPI.importMcpFromClaude();
      if (result.count === 0) {
        message.info('没有发现新的 MCP 服务器');
      } else {
        message.success(`成功导入 ${result.count} 个 MCP 服务器`);
        loadData();
      }
    } catch (error) {
      message.error('导入失败');
    }
  }, [loadData]);

  const applyPreset = useCallback((index: number) => {
    if (index === -1) {
      setSelectedPreset(-1);
      form.resetFields(['id', 'name', 'description', 'command', 'argsStr', 'homepage', 'docs', 'tags']);
      return;
    }

    const preset = presets[index];
    setSelectedPreset(index);
    setServerType(preset.server.type);
    setEnabledClaude(true);
    form.setFieldsValue({
      id: preset.id,
      name: preset.name,
      description: preset.description,
      serverType: preset.server.type,
      command: preset.server.command,
      argsStr: preset.server.args?.join(' ') || '',
      url: preset.server.url,
      homepage: preset.homepage,
      docs: preset.docs,
      tags: preset.tags?.join(', ') || '',
      enabledClaude: true,
    });
  }, [presets, form]);

  const handleSubmit = useCallback(async () => {
    try {
      const values = await form.validateFields();

      if (!values.id?.trim()) {
        message.error('ID 不能为空');
        return;
      }

      if (!editingServer && servers.some(s => s.id === values.id.trim())) {
        message.error('ID 已存在');
        return;
      }

      const type = values.serverType || 'stdio';

      if (type === 'stdio' && !values.command?.trim()) {
        message.error('stdio 类型必须提供命令');
        return;
      }

      if ((type === 'http' || type === 'sse') && !values.url?.trim()) {
        message.error('http/sse 类型必须提供 URL');
        return;
      }

      const serverSpec: McpServerSpec = {
        type,
      };

      if (type === 'stdio') {
        serverSpec.command = values.command?.trim() || '';
        serverSpec.args = values.argsStr ? values.argsStr.split(' ').filter(Boolean) : [];
        serverSpec.env = values.envStr
          ? values.envStr.split('\n').reduce((acc: any, line: string) => {
              const [key, ...valueParts] = line.split('=');
              if (key && valueParts.length > 0) {
                acc[key.trim()] = valueParts.join('=').trim();
              }
              return acc;
            }, {})
          : undefined;
      } else {
        serverSpec.url = values.url?.trim() || '';
        serverSpec.headers = values.headersStr
          ? values.headersStr.split('\n').reduce((acc: any, line: string) => {
              const colonIdx = line.indexOf(':');
              if (colonIdx > 0) {
                acc[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
              }
              return acc;
            }, {})
          : undefined;
      }

      const server: McpServer = {
        id: values.id.trim(),
        name: values.name?.trim() || values.id.trim(),
        description: values.description?.trim() || undefined,
        server: serverSpec,
        apps: {
          claude: values.enabledClaude ?? false,
        },
        homepage: values.homepage?.trim() || undefined,
        docs: values.docs?.trim() || undefined,
        tags: values.tags ? values.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : undefined,
      };

      await window.electronAPI.saveMcpServer(server);
      message.success(editingServer ? '更新成功' : '添加成功');
      setModalVisible(false);
      loadData();
    } catch (error) {
      message.error('保存失败');
    }
  }, [editingServer, servers, form, loadData]);

  const openExternal = useCallback(async (url: string) => {
    try {
      await window.electronAPI.openExternal(url);
    } catch (error) {
      console.error('Failed to open URL:', error);
    }
  }, []);

  const enabledCounts = useMemo(() => {
    const counts = { claude: 0 };
    servers.forEach((server) => {
      if (server.apps.claude) counts.claude++;
    });
    return counts;
  }, [servers]);

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-title-group">
          <h1>MCP 管理</h1>
          <p>配置和管理 Model Context Protocol 服务器</p>
        </div>
      </div>

      <div className="page-content">
        <AppCountBar
          totalLabel={`共 ${servers.length} 个服务器`}
          counts={enabledCounts}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20, gap: 12 }}>
          <Button 
            icon={<ImportOutlined />} 
            onClick={handleImport}
            style={{ borderRadius: 8, height: 36 }}
          >
            从 Claude 导入
          </Button>
          <Button 
            type="primary" 
            icon={<PlusOutlined />} 
            onClick={handleAdd}
            style={{ borderRadius: 8, height: 36, fontWeight: 500 }}
          >
            添加 MCP 服务器
          </Button>
        </div>

        <div className="management-list-container">
          {loading ? (
            <div className="loading-container">
              <Spin size="large" />
            </div>
          ) : servers.length === 0 ? (
            <div className="empty-state-container">
              <div className="empty-placeholder-icon">
                <CloudServerOutlined style={{ fontSize: 32, color: 'var(--primary-color)' }} />
              </div>
              <h3 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 600, color: 'var(--text-color)' }}>
                暂无 MCP 服务器
              </h3>
              <p style={{ margin: 0, color: 'var(--text-secondary-color)', fontSize: 14, lineHeight: 1.6 }}>
                点击上方按钮添加 MCP 服务器<br />或从 Claude 导入已有配置
              </p>
            </div>
          ) : (
            servers.map((server, index) => {
              const name = server.name || server.id;
              const description = server.description || '';
              const docsUrl = server.docs || server.homepage;
              const tags = server.tags;

              return (
                <ListItemRow key={server.id} isLast={index === servers.length - 1}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-color)' }}>
                        {name}
                      </span>
                      {docsUrl && (
                        <Tooltip title="查看文档">
                          <button
                            type="button"
                            onClick={() => openExternal(docsUrl)}
                            style={{
                              border: 'none',
                              background: 'transparent',
                              cursor: 'pointer',
                              padding: 0,
                              color: 'var(--primary-color)',
                              display: 'flex',
                              alignItems: 'center',
                              transition: 'all 0.2s',
                            }}
                          >
                            <LinkOutlined style={{ fontSize: 14 }} />
                          </button>
                        </Tooltip>
                      )}
                      <Tag className={`server-type-tag server-type-${server.server.type}`}>
                        {server.server.type?.toUpperCase()}
                      </Tag>
                    </div>
                    {description && (
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary-color)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {description}
                      </p>
                    )}
                    {!description && tags && tags.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        {tags.slice(0, 3).map(tag => (
                          <Tag key={tag} style={{ margin: 0, fontSize: 11, padding: '0 8px', borderRadius: 4 }}>
                            {tag}
                          </Tag>
                        ))}
                      </div>
                    )}
                  </div>

                  <AppToggleGroup
                    apps={server.apps}
                    onToggle={(app, enabled) => handleToggleApp(server.id, app, enabled)}
                  />

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Tooltip title="编辑">
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined style={{ fontSize: 15 }} />}
                        onClick={() => handleEdit(server)}
                        style={{ 
                          width: 32, 
                          height: 32, 
                          padding: 0,
                          borderRadius: 8,
                          color: 'var(--primary-color)',
                        }}
                      />
                    </Tooltip>
                    <Tooltip title="删除">
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined style={{ fontSize: 15 }} />}
                        onClick={() => handleDelete(server.id)}
                        style={{ width: 32, height: 32, padding: 0, borderRadius: 8 }}
                      />
                    </Tooltip>
                  </div>
                </ListItemRow>
              );
            })
          )}
        </div>

        <Modal
          title={
            <div className="form-section-title">
              <SettingOutlined style={{ color: 'var(--primary-color)', marginRight: 8 }} />
              {editingServer ? '编辑 MCP 服务器' : '添加 MCP 服务器'}
            </div>
          }
          open={modalVisible}
          onOk={handleSubmit}
          onCancel={() => setModalVisible(false)}
          width={720}
          okText="保存"
          cancelText="取消"
          styles={{
            body: { maxHeight: '60vh', overflowY: 'auto' }
          }}
        >
          {/* ... (Modal content remains largely the same but can be optimized if needed) ... */}
          {/* For brevity, keeping Form content as is but ensuring styles are consistent */}
          <Form form={form} layout="vertical" style={{ marginTop: 20 }}>
            {/* ... Form fields ... */}
            {!editingServer && (
            <Form.Item label={<span style={{ fontWeight: 600 }}>选择预设</span>}>
              <div className="preset-grid">
                <button
                  type="button"
                  className={`preset-card custom${selectedPreset === -1 ? ' selected' : ''}`}
                  onClick={() => applyPreset(-1)}
                >
                  {selectedPreset === -1 && (
                    <span className="preset-card-check">
                      <CheckOutlined />
                    </span>
                  )}
                  <PlusOutlined style={{ fontSize: 18, marginBottom: 4 }} />
                  <span>自定义配置</span>
                </button>
                {presets.map((preset, idx) => {
                  const isSelected = selectedPreset === idx;
                  const type = preset.server.type;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={`preset-card${isSelected ? ' selected' : ''}`}
                      onClick={() => applyPreset(idx)}
                    >
                      {isSelected && (
                        <span className="preset-card-check">
                          <CheckOutlined />
                        </span>
                      )}
                      <div className="preset-card-header">
                        <span className="preset-card-title">{preset.name || preset.id}</span>
                        <Tag className={`preset-card-type server-type-${type}`} style={{ margin: 0, fontSize: 10, padding: '0 6px', lineHeight: '16px', border: 'none' }}>
                          {type.toUpperCase()}
                        </Tag>
                      </div>
                      {preset.description && (
                        <p className="preset-card-desc">{preset.description}</p>
                      )}
                      {preset.docs && (
                        <span
                          className="preset-card-docs"
                          onClick={(e) => { e.stopPropagation(); window.electronAPI?.openExternal?.(preset.docs!); }}
                        >
                          <LinkOutlined style={{ marginRight: 3 }} />配置文档
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </Form.Item>
          )}

          <Form.Item
            label={<span style={{ fontWeight: 600 }}>ID <span style={{ color: '#ff4d4f' }}>*</span></span>}
            name="id"
            rules={[{ required: true, message: '请输入 ID' }]}
          >
            <Input placeholder="例如：mcp-server-fetch" disabled={!!editingServer} style={{ borderRadius: 8 }} />
          </Form.Item>

          <Form.Item label={<span style={{ fontWeight: 600 }}>名称</span>} name="name">
            <Input placeholder="例如：MCP Server Fetch" style={{ borderRadius: 8 }} />
          </Form.Item>

          <Form.Item label={<span style={{ fontWeight: 600 }}>服务器类型</span>} name="serverType">
            <Radio.Group
              value={form.getFieldValue('serverType') || 'stdio'}
              onChange={(e) => {
                setServerType(e.target.value);
                form.setFieldValue('serverType', e.target.value);
              }}
            >
              <Radio value="stdio">STDIO</Radio>
              <Radio value="http">HTTP</Radio>
              <Radio value="sse">SSE</Radio>
            </Radio.Group>
          </Form.Item>

          {serverType === 'stdio' && (
            <>
              <Form.Item
                label={<span style={{ fontWeight: 600 }}>命令 <span style={{ color: '#ff4d4f' }}>*</span></span>}
                name="command"
                rules={[{ required: true, message: '请输入命令' }]}
              >
                <Input placeholder="例如：npx 或 uvx" style={{ borderRadius: 8 }} />
              </Form.Item>

              <Form.Item label={<span style={{ fontWeight: 600 }}>参数</span>} name="argsStr">
                <Input placeholder="用空格分隔，例如：-y @modelcontextprotocol/server-time" style={{ borderRadius: 8 }} />
              </Form.Item>

              <Form.Item label={<span style={{ fontWeight: 600 }}>环境变量</span>} name="envStr">
                <Input.TextArea
                  rows={3}
                  placeholder="每行一个，格式：KEY=value&#10;例如：&#10;API_KEY=xxx&#10;DEBUG=true"
                  style={{ borderRadius: 8 }}
                />
              </Form.Item>
              {selectedPreset != null && selectedPreset >= 0 && presets[selectedPreset]?.envHints && (
                <div className="env-hints">
                  {presets[selectedPreset].envHints!.map((h) => (
                    <div key={h.key} className="env-hint-item">
                      <code className="env-hint-key">{h.key}</code>
                      <span className="env-hint-text">{h.hint}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {(serverType === 'http' || serverType === 'sse') && (
            <>
              <Form.Item
                label={<span style={{ fontWeight: 600 }}>URL <span style={{ color: '#ff4d4f' }}>*</span></span>}
                name="url"
                rules={[{ required: true, message: '请输入 URL' }]}
              >
                <Input placeholder="例如：http://localhost:8080/mcp" style={{ borderRadius: 8 }} />
              </Form.Item>

              <Form.Item label={<span style={{ fontWeight: 600 }}>请求头</span>} name="headersStr">
                <Input.TextArea
                  rows={3}
                  placeholder="每行一个，格式：KEY: value&#10;例如：&#10;Authorization: Bearer xxx&#10;Content-Type: application/json"
                  style={{ borderRadius: 8 }}
                />
              </Form.Item>
              {selectedPreset != null && selectedPreset >= 0 && presets[selectedPreset]?.envHints && (
                <div className="env-hints">
                  {presets[selectedPreset].envHints!.map((h) => (
                    <div key={h.key} className="env-hint-item">
                      <code className="env-hint-key">{h.key}</code>
                      <span className="env-hint-text">{h.hint}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <Form.Item label={<span style={{ fontWeight: 600 }}>启用到应用</span>}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={enabledClaude}
                onChange={(e) => {
                  setEnabledClaude(e.target.checked);
                  form.setFieldValue('enabledClaude', e.target.checked);
                }}
                style={{ width: 18, height: 18, borderRadius: 4 }}
              />
              <span style={{ fontSize: 14 }}>Claude Code</span>
            </label>
          </Form.Item>

          <div style={{ marginBottom: 16 }}>
            <Button
              type="link"
              onClick={() => setShowMetadata(!showMetadata)}
              icon={showMetadata ? <UpOutlined /> : <DownOutlined />}
              style={{ padding: 0, fontWeight: 500 }}
            >
              附加信息
            </Button>
          </div>

          {showMetadata && (
            <>
              <Form.Item label={<span style={{ fontWeight: 600 }}>描述</span>} name="description">
                <Input placeholder="简要描述这个 MCP 服务器的功能" style={{ borderRadius: 8 }} />
              </Form.Item>

              <Form.Item label={<span style={{ fontWeight: 600 }}>标签</span>} name="tags">
                <Input placeholder="用逗号分隔，例如：http, web, fetch" style={{ borderRadius: 8 }} />
              </Form.Item>

              <Form.Item label={<span style={{ fontWeight: 600 }}>主页 URL</span>} name="homepage">
                <Input placeholder="https://github.com/..." style={{ borderRadius: 8 }} />
              </Form.Item>

              <Form.Item label={<span style={{ fontWeight: 600 }}>文档 URL</span>} name="docs">
                <Input placeholder="https://github.com/.../docs" style={{ borderRadius: 8 }} />
              </Form.Item>
            </>
          )}
          </Form>
        </Modal>
      </div>
    </div>
  );
}

export default memo(McpManagement);
