import { Form, Input, Button, Card, message, Select, Space, Alert, Divider, Tag, Typography, Tabs, Collapse, Modal, List } from 'antd';
import { PlusOutlined, DeleteOutlined, SaveOutlined, ApiOutlined, ThunderboltOutlined, SettingOutlined, CheckCircleFilled, CloseCircleFilled, WarningFilled, CopyOutlined } from '@ant-design/icons';
import { useState, useEffect, useCallback, memo, useMemo } from 'react';

interface ModelConfig {
  id: string;
  name: string;
  modelId: string;
}

type ApiFormat = 'chat-completions' | 'responses' | 'anthropic';
type ClientType = 'claude' | 'codex';

type CheckLevel = 'pass' | 'warn' | 'fail';

interface CheckItem {
  id: string;
  title: string;
  level: CheckLevel;
  detail?: string;
  problem?: string;
  fix?: string;
}

interface TestReport {
  items: CheckItem[];
  overall: CheckLevel;
  clientType: ClientType;
}

interface ClientConfigState {
  apiKey: string;
  baseUrl: string;
  apiFormat: ApiFormat;
  models: ModelConfig[];
  defaultModel: string;
}

interface SavedConfig {
  id?: string;
  name?: string;
  port: number;
  claude?: ClientConfigState;
  codex?: ClientConfigState;
  startMode?: 'all' | 'claude' | 'codex';
  // legacy flat fields — only present when migrating from very old data
  apiKey?: string;
  baseUrl?: string;
  models?: ModelConfig[];
  defaultModel?: string;
  apiFormat?: ApiFormat;
}

interface PresetModel {
  name: string;
  modelId: string;
  provider?: string;
}

const claudePresetModels: PresetModel[] = [
  { name: 'Claude Sonnet 4.6-零售', modelId: 'Claude-Sonnet-4.6-joybuilder', provider: 'anthropic' },
  { name: 'Claude Opus 4.6-零售', modelId: 'Claude-Opus-4.6-joybuilder', provider: 'anthropic' },
  { name: 'Claude Opus 4.7-零售', modelId: 'Claude-Opus-4.7-joybuilder', provider: 'anthropic' },
  { name: 'GLM 5-零售', modelId: 'GLM-5-joybuilder' },
  { name: 'GLM 5.1-零售', modelId: 'GLM-5.1-joybuilder' },
  { name: 'DeepSeek-V4-Flash-零售', modelId: 'DeepSeek-V4-Flash' },
  { name: 'MiniMax M2.7-零售', modelId: 'MiniMax-M2.7-joybuilder' },
  { name: 'MiniMax M3-零售', modelId: 'MiniMax-M3-joybuilder' },
  { name: 'qwen3-coder-零售', modelId: 'qwen3-coder' },
  { name: 'Doubao-Seed-2.0-pro-零售', modelId: 'Doubao-Seed-2.0-pro-joybuilder' },
  { name: 'GPT 5.2-零售', modelId: 'GPT-5.2-joybuilder' },
  { name: 'Claude Sonnet 4.6', modelId: 'Claude-Sonnet-4.6', provider: 'anthropic' },
  { name: 'Claude Opus 4.6', modelId: 'Claude-Opus-4.6', provider: 'anthropic' },
  { name: 'Claude Opus 4.7', modelId: 'Claude-Opus-4.7', provider: 'anthropic' },
  { name: 'GLM 5', modelId: 'GLM-5' },
  { name: 'GLM 5.1', modelId: 'GLM-5.1' },
  { name: 'Kimi K2.5', modelId: 'Kimi-K2.5' },
  { name: 'Kimi K2.6', modelId: 'Kimi-K2.6' },
  { name: 'DeepSeek V4 Flash', modelId: 'DeepSeek-V4-Flash' },
  { name: 'MiniMax M2.7', modelId: 'MiniMax-M2.7' },
  { name: 'MiniMax M3', modelId: 'MiniMax-M3' },
  { name: 'qwen3-coder', modelId: 'qwen3-coder' },
  { name: 'Doubao-Seed-2.0-pro', modelId: 'Doubao-Seed-2.0-pro' },
  { name: 'GPT 5.2', modelId: 'GPT-5.2' },
];

const codexPresetModels: PresetModel[] = [
  { name: 'GPT 5.5-零售', modelId: 'GPT-5.5-joybuilder' },
  { name: 'GPT 5.2-零售', modelId: 'GPT-5.2-joybuilder' },
  { name: 'GPT 5.3 Codex-零售', modelId: 'GPT-5.3-codex-joybuilder' },
  { name: 'GPT 5 Codex-零售', modelId: 'GPT-5-codex-joybuilder' },
  { name: 'GPT 5.1 Codex Max-零售', modelId: 'GPT-5.1-codex-max-joybuilder' },
  { name: 'GPT 5.5', modelId: 'GPT-5.5' },
  { name: 'GPT 5.4', modelId: 'GPT-5.4' },
  { name: 'GPT 5.3 Codex', modelId: 'GPT-5.3-codex' },
  { name: 'GPT 5.2', modelId: 'GPT-5.2' },
  { name: 'GPT 5 Codex', modelId: 'GPT-5-codex' },
  { name: 'GPT 5.1 Codex', modelId: 'GPT-5.1-codex' },
];

const isClaudeModel = (modelId: string): boolean => modelId.toLowerCase().includes('claude');

function cleanApiKey(raw: string): string {
  return raw
    .replace(/^(api\s*key|apikey|bearer)\s*[:：]\s*/i, '')
    .replace(/\s/g, '');
}

function getPresets(clientType: ClientType): PresetModel[] {
  return clientType === 'codex' ? codexPresetModels : claudePresetModels;
}

function buildDefaultModels(clientType: ClientType): ModelConfig[] {
  return getPresets(clientType).map(p => ({
    id: `preset_${p.name}`,
    name: p.name,
    modelId: p.modelId,
  }));
}

function mergeModels(clientType: ClientType, savedModels: ModelConfig[]): ModelConfig[] {
  const presetNames = new Set(getPresets(clientType).map(p => p.name));
  const defaults = buildDefaultModels(clientType);
  const customModels = (savedModels || []).filter(m => !presetNames.has(m.name));
  return [...defaults, ...customModels];
}

function emptyClientState(clientType: ClientType): ClientConfigState {
  return {
    apiKey: '',
    baseUrl: '',
    // Codex CLI 当前仅支持 wire_api=responses
    apiFormat: clientType === 'codex' ? 'responses' : 'chat-completions',
    models: buildDefaultModels(clientType),
    defaultModel: '',
  };
}

interface ClientConfigFormProps {
  clientType: ClientType;
  state: ClientConfigState;
  onChange: (next: ClientConfigState) => void;
}

const ClientConfigForm = ({ clientType, state, onChange }: ClientConfigFormProps) => {
  const apiKeyLink = clientType === 'claude'
    ? ''
    : '';

  const apiFormatOptions = useMemo(() => {
    if (clientType === 'codex') {
      // Codex CLI 已不支持 wire_api="chat"，仅保留 responses
      return [
        { value: 'responses', label: 'OpenAI Responses API（/responses）' },
      ];
    }
    return [
      { value: 'anthropic', label: 'Anthropic 原生协议（/messages）' },
      { value: 'chat-completions', label: 'OpenAI Chat Completions（/chat/completions）' },
      { value: 'responses', label: 'OpenAI Responses API（/responses）' },
    ];
  }, [clientType]);

  const handleApiKey = (v: string) => onChange({ ...state, apiKey: v });
  const handleBaseUrl = (v: string) => onChange({ ...state, baseUrl: v });
  const handleApiFormat = (v: ApiFormat) => onChange({ ...state, apiFormat: v });
  const handleDefaultModelChange = (modelId: string) => {
    const next: ClientConfigState = { ...state, defaultModel: modelId };
    const model = state.models.find(m => m.id === modelId);
    if (!model) {
      onChange(next);
      return;
    }
    const preset = getPresets(clientType).find(p => p.modelId === model.modelId);
    const isRetail = model.name?.includes('零售');
    if (isRetail) {
      if (preset?.provider === 'anthropic') {
        next.baseUrl = 'http://llm-gw.jd.local/anthropic/v1';
        next.apiFormat = 'anthropic';
      } else {
        next.baseUrl = 'http://llm-gw.jd.local/v1';
        next.apiFormat = 'chat-completions';
      }
    } else if (preset?.provider === 'anthropic') {
      next.baseUrl = 'http://ai-api.jdcloud.com/anthropic/v1';
      next.apiFormat = 'anthropic';
    } else {
      next.baseUrl = 'http://ai-api.jdcloud.com/v1';
      next.apiFormat = 'chat-completions';
    }
    // Codex CLI 当前仅支持 responses，强制回退
    if (clientType === 'codex') {
      next.apiFormat = 'responses';
      if (next.baseUrl.includes('/anthropic/v1')) {
        next.baseUrl = next.baseUrl.replace('/anthropic/v1', '/v1');
      }
    }
    onChange(next);
  };

  const handleAddModel = () => {
    onChange({
      ...state,
      models: [...state.models, { id: `model_${Date.now()}`, name: '', modelId: '' }],
    });
  };

  const handleDeleteModel = (id: string) => {
    const nextModels = state.models.filter(m => m.id !== id);
    onChange({
      ...state,
      models: nextModels,
      defaultModel: state.defaultModel === id ? '' : state.defaultModel,
    });
  };

  const handleModelFieldChange = (id: string, field: 'name' | 'modelId', value: string) => {
    onChange({
      ...state,
      models: state.models.map(m => (m.id === id ? { ...m, [field]: value } : m)),
    });
  };

  const customModels = state.models.filter(m => !m.id.startsWith('preset_'));

  return (
    <div style={{ maxWidth: 800 }}>
      <div className="form-section-title">基本设置</div>

      <Form.Item
        label={(
          <Space>
            <span>API Key</span>
            {apiKeyLink && <a href={apiKeyLink} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }}>
              申请零售API Key
            </a>}
          </Space>
        )}
        required
      >
        <Input.Password
          placeholder="sk-xxxxx"
          value={state.apiKey}
          onChange={(e) => handleApiKey(e.target.value)}
        />
      </Form.Item>

      <Divider />

      <div className="form-section-title">
        <Space>模型配置<Tag color="red">必填</Tag></Space>
      </div>

      {state.models.length > 0 && (
        <Form.Item label="默认模型" style={{ marginBottom: 24 }}>
          <Select
            placeholder="选择默认模型"
            value={state.defaultModel || undefined}
            onChange={handleDefaultModelChange}
            allowClear
          >
            {state.models.map(model => (
              <Select.Option key={model.id} value={model.id}>
                {model.name || model.modelId || '未命名模型'}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>
      )}

      {clientType === 'claude' && state.apiFormat === 'anthropic' && (
        <Alert
          icon={<ThunderboltOutlined />}
          message="模型快捷切换"
          description={(
            <div>
              <Typography.Paragraph style={{ marginBottom: 8 }}>
                启动服务后，你可以在 Claude Code 中使用 <Typography.Text code>/model</Typography.Text> 命令快速切换模型：
              </Typography.Paragraph>
              {state.models.find(m => m.id === state.defaultModel)?.name?.includes('零售') ? (
                <div style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: '22px', background: 'var(--background-color)', padding: '8px 12px', borderRadius: 6 }}>
                  <div><Typography.Text code>/model sonnet</Typography.Text> → Claude-Sonnet-4.6-joybuilder</div>
                  <div><Typography.Text code>/model haiku</Typography.Text> → Claude-Opus-4.6-joybuilder（Opus 4.6）</div>
                  <div><Typography.Text code>/model opus</Typography.Text> → Claude-Opus-4.7-joybuilder</div>
                </div>
              ) : (
                <div style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: '22px', background: 'var(--background-color)', padding: '8px 12px', borderRadius: 6 }}>
                  <div><Typography.Text code>/model sonnet</Typography.Text> → Claude-Sonnet-4.6</div>
                  <div><Typography.Text code>/model haiku</Typography.Text> → Claude-Opus-4.6（Opus 4.6）</div>
                  <div><Typography.Text code>/model opus</Typography.Text> → Claude-Opus-4.7</div>
                </div>
              )}
            </div>
          )}
          type="info"
          showIcon
          style={{ marginBottom: 24 }}
        />
      )}

      {clientType === 'codex' && (
        <Alert
          icon={<ThunderboltOutlined />}
          message="Codex 使用提示"
          description={(
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              启动服务后将自动写入 <Typography.Text code>~/.codex/config.toml</Typography.Text>，
              你可以在终端直接运行 <Typography.Text code>codex</Typography.Text> 命令，
              请求会通过 DongCC 代理到上游。Codex 不支持 Anthropic 协议，
              因此预设里不会出现 Claude 模型。
            </Typography.Paragraph>
          )}
          type="info"
          showIcon
          style={{ marginBottom: 24 }}
        />
      )}

      <Collapse
        ghost
        items={[{
          key: 'advanced',
          label: (
            <Space>
              <SettingOutlined />
              <span>高级设置（baseUrl、协议格式、自定义模型）</span>
            </Space>
          ),
          children: (
            <div>
              <Form.Item label="Base URL" tooltip="选择默认模型时会自动填充推荐值，仅在需要覆盖时手动修改">
                <Input
                  placeholder="例如 http://llm-gw.jd.local/v1"
                  value={state.baseUrl}
                  onChange={(e) => handleBaseUrl(e.target.value)}
                />
              </Form.Item>

              <Form.Item label="接口协议" tooltip="决定 DongCC 与上游通信的格式">
                <Select
                  value={state.apiFormat}
                  onChange={handleApiFormat}
                  options={apiFormatOptions}
                />
              </Form.Item>

              <Divider dashed style={{ margin: '16px 0' }} />

              <div className="form-section-title" style={{ fontSize: 14 }}>自定义模型</div>
              <Alert
                message="如需添加预设列表之外的自定义模型，可在此手动添加。"
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />

              <Button
                type="dashed"
                onClick={handleAddModel}
                icon={<PlusOutlined />}
                style={{ width: '100%', marginBottom: 16 }}
              >
                添加自定义模型
              </Button>

              {customModels.map((model, index) => (
                <Card
                  key={model.id}
                  size="small"
                  style={{ marginBottom: 16, background: 'var(--background-color)' }}
                  title={(
                    <Space>
                      <Tag color="blue">自定义模型 {index + 1}</Tag>
                      {state.defaultModel === model.id && <Tag color="green">默认</Tag>}
                      {isClaudeModel(model.modelId) && clientType === 'claude' && (
                        <Tag color="purple">Anthropic 直联</Tag>
                      )}
                    </Space>
                  )}
                  extra={(
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleDeleteModel(model.id)}
                    />
                  )}
                >
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <div>
                      <label style={{ marginBottom: 4, display: 'block', fontWeight: 500 }}>
                        模型ID <span style={{ color: '#ff4d4f' }}>*</span>
                      </label>
                      <Input
                        placeholder="模型ID"
                        value={model.modelId}
                        onChange={(e) => handleModelFieldChange(model.id, 'modelId', e.target.value)}
                      />
                    </div>
                    <div>
                      <label style={{ marginBottom: 4, display: 'block', fontWeight: 500 }}>
                        显示名称
                      </label>
                      <Input
                        placeholder="显示名称（可选，默认使用模型ID）"
                        value={model.name}
                        onChange={(e) => handleModelFieldChange(model.id, 'name', e.target.value)}
                      />
                    </div>
                  </Space>
                </Card>
              ))}
            </div>
          ),
        }]}
      />
    </div>
  );
};

function Config() {
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [port, setPort] = useState<number>(8787);
  const [claudeState, setClaudeState] = useState<ClientConfigState>(() => emptyClientState('claude'));
  const [codexState, setCodexState] = useState<ClientConfigState>(() => emptyClientState('codex'));
  const [activeTab, setActiveTab] = useState<ClientType>('claude');
  const [testReport, setTestReport] = useState<TestReport | null>(null);
  const [testReportOpen, setTestReportOpen] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const config = await window.electronAPI.getConfig('default') as SavedConfig | null;
      if (!config) {
        setClaudeState(emptyClientState('claude'));
        setCodexState(emptyClientState('codex'));
        return;
      }
      setPort(config.port || 8787);

      // 兼容旧扁平结构
      const claudeSrc: Partial<ClientConfigState> = config.claude || (config.apiKey ? {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        apiFormat: config.apiFormat,
        models: config.models,
        defaultModel: config.defaultModel,
      } : {}) as Partial<ClientConfigState>;

      const claudeMergedModels = mergeModels('claude', claudeSrc.models || []);
      const claudeNext: ClientConfigState = {
        apiKey: claudeSrc.apiKey || '',
        baseUrl: claudeSrc.baseUrl || '',
        apiFormat: (claudeSrc.apiFormat as ApiFormat) || 'chat-completions',
        models: claudeMergedModels,
        defaultModel: claudeMergedModels.some(m => m.id === claudeSrc.defaultModel)
          ? (claudeSrc.defaultModel as string)
          : '',
      };
      setClaudeState(claudeNext);

      if (config.codex) {
        const codexMergedModels = mergeModels('codex', config.codex.models || []);
        const codexNext: ClientConfigState = {
          apiKey: config.codex.apiKey || '',
          baseUrl: config.codex.baseUrl || '',
          apiFormat: (config.codex.apiFormat as ApiFormat) || 'chat-completions',
          models: codexMergedModels,
          defaultModel: codexMergedModels.some(m => m.id === config.codex!.defaultModel)
            ? config.codex.defaultModel
            : '',
        };
        // Codex 仅支持 responses，规整旧数据
        if (codexNext.apiFormat !== 'responses') codexNext.apiFormat = 'responses';
        setCodexState(codexNext);
      } else {
        setCodexState(emptyClientState('codex'));
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const validateClient = (label: string, state: ClientConfigState, required: boolean): string | null => {
    if (!required && !state.apiKey) return null;
    if (!state.apiKey) return `${label} 的 API Key 不能为空`;
    if (!state.models || state.models.length === 0) return `${label} 至少需要一个模型`;
    if (state.models.some(m => !m.modelId.trim())) return `${label} 存在未填写的模型 ID`;
    return null;
  };

  const doSubmit = useCallback(async (startMode?: 'claude' | 'codex'): Promise<boolean> => {
    if (!startMode || startMode === 'claude') {
      const errClaude = validateClient('Claude Code', claudeState, true);
      if (errClaude) {
        message.error(errClaude);
        setActiveTab('claude');
        return false;
      }
    }
    if (!startMode || startMode === 'codex') {
      const errCodex = validateClient('Codex', codexState, false);
      if (errCodex) {
        message.error(errCodex);
        setActiveTab('codex');
        return false;
      }
    }
    setLoading(true);
    try {
      const savedConfig: SavedConfig = {
        id: 'default',
        port,
        claude: {
          ...claudeState,
          apiKey: cleanApiKey(claudeState.apiKey),
          defaultModel: claudeState.defaultModel || claudeState.models[0]?.id || '',
        },
        codex: codexState.apiKey ? {
          ...codexState,
          apiKey: cleanApiKey(codexState.apiKey),
          defaultModel: codexState.defaultModel || codexState.models[0]?.id || '',
        } : undefined,
        startMode: startMode || 'all',
      };

      await window.electronAPI.saveConfig(savedConfig as any);

      const status = await window.electronAPI.getServiceStatus();
      if (status.running) {
        await window.electronAPI.stopService();
      }
      await window.electronAPI.startService(savedConfig as any);
      return true;
    } catch (error) {
      console.error(error);
      message.error('配置保存失败');
      return false;
    } finally {
      setLoading(false);
    }
  }, [port, claudeState, codexState]);

  const handleStartClaude = useCallback(async () => {
    const ok = await doSubmit('claude');
    if (ok) message.success('配置已保存，Claude Code 服务已启动');
  }, [doSubmit]);

  const handleStartCodex = useCallback(async () => {
    const ok = await doSubmit('codex');
    if (ok) message.success('配置已保存，Codex 服务已启动');
  }, [doSubmit]);

  const handleTestConnection = useCallback(async () => {
    const current = activeTab === 'claude' ? claudeState : codexState;
    if (!current.apiKey || !current.apiKey.trim()) {
      message.warning(`请先在 ${activeTab === 'claude' ? 'Claude Code' : 'Codex'} Tab 填写 API Key`);
      return;
    }
    if (!current.baseUrl || !current.baseUrl.trim()) {
      message.warning('请先选择默认模型或在「高级设置」中填写 Base URL');
      return;
    }

    setTesting(true);
    try {
      // 先保存 + 重启服务（如果在跑），保证检测的是磁盘上真实文件
      const ok = await doSubmit();
      if (!ok) {
        setTesting(false);
        return;
      }

      const report = await window.electronAPI.testConnection(activeTab, port, {
        apiKey: cleanApiKey(current.apiKey),
        baseUrl: current.baseUrl,
        apiFormat: current.apiFormat,
      });

      setTestReport({ ...report, clientType: activeTab });
      setTestReportOpen(true);
    } catch (error: any) {
      console.error('Connection test failed:', error);
      message.error(`测试连接失败：${error?.message || error}`);
    } finally {
      setTesting(false);
    }
  }, [activeTab, claudeState, codexState, port, doSubmit]);

  const closeTestReport = useCallback(() => setTestReportOpen(false), []);

  const handleCopyFix = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success('修复命令已复制到剪贴板');
    } catch {
      message.error('复制失败，请手动选中文本复制');
    }
  }, []);

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-title-group">
          <h1>配置管理</h1>
          <p>分别设置 Claude Code 和 Codex CLI 的代理参数（共享同一端口）</p>
        </div>
        <div className="page-actions">
          <Button onClick={handleTestConnection} loading={testing} icon={<ApiOutlined />}>测试连接</Button>
          {activeTab === 'claude' ? (
            <Button type="primary" onClick={handleStartClaude} loading={loading} icon={<SaveOutlined />}>
              启动 Claude
            </Button>
          ) : (
            <Button type="primary" onClick={handleStartCodex} loading={loading} icon={<SaveOutlined />}>
              启动 Codex
            </Button>
          )}
        </div>
      </div>

      <div className="page-content">
        <Card className="content-card">
          <Form layout="vertical" style={{ maxWidth: 800 }}>
          </Form>

          <Tabs
            activeKey={activeTab}
            onChange={(k) => setActiveTab(k as ClientType)}
            items={[
              {
                key: 'claude',
                label: 'Claude Code',
                children: (
                  <Form layout="vertical">
                    <ClientConfigForm
                      clientType="claude"
                      state={claudeState}
                      onChange={setClaudeState}
                    />
                  </Form>
                ),
              },
              {
                key: 'codex',
                label: 'Codex',
                children: (
                  <Form layout="vertical">
                    <ClientConfigForm
                      clientType="codex"
                      state={codexState}
                      onChange={setCodexState}
                    />
                  </Form>
                ),
              },
            ]}
          />
        </Card>
      </div>

      <Modal
        title={
          <Space>
            {testReport?.overall === 'pass' && <CheckCircleFilled style={{ color: '#52c41a' }} />}
            {testReport?.overall === 'warn' && <WarningFilled style={{ color: '#faad14' }} />}
            {testReport?.overall === 'fail' && <CloseCircleFilled style={{ color: '#ff4d4f' }} />}
            <span>
              {testReport?.clientType === 'claude' ? 'Claude Code' : 'Codex'} 连接测试报告
            </span>
            <Tag color={testReport?.overall === 'pass' ? 'success' : testReport?.overall === 'warn' ? 'warning' : 'error'}>
              {testReport?.overall === 'pass' ? '全部通过' : testReport?.overall === 'warn' ? '存在警告' : '存在失败项'}
            </Tag>
          </Space>
        }
        open={testReportOpen}
        onCancel={closeTestReport}
        footer={[
          <Button key="ok" type="primary" onClick={closeTestReport}>
            关闭
          </Button>,
        ]}
        width={720}
      >
        {testReport && (
          <List
            dataSource={testReport.items}
            renderItem={(item) => (
              <List.Item key={item.id} style={{ alignItems: 'flex-start' }}>
                <div style={{ width: '100%' }}>
                  <Space style={{ marginBottom: 4 }}>
                    {item.level === 'pass' && <CheckCircleFilled style={{ color: '#52c41a' }} />}
                    {item.level === 'warn' && <WarningFilled style={{ color: '#faad14' }} />}
                    {item.level === 'fail' && <CloseCircleFilled style={{ color: '#ff4d4f' }} />}
                    <Typography.Text strong>{item.title}</Typography.Text>
                  </Space>
                  {item.detail && (
                    <Typography.Paragraph style={{ marginBottom: 0, marginLeft: 24, color: 'var(--text-secondary-color)' }}>
                      {item.detail}
                    </Typography.Paragraph>
                  )}
                  {item.problem && (
                    <Typography.Paragraph style={{ marginBottom: 8, marginLeft: 24, whiteSpace: 'pre-wrap' }}>
                      {item.problem}
                    </Typography.Paragraph>
                  )}
                  {item.fix && (
                    <div style={{ marginLeft: 24 }}>
                      <div style={{
                        background: 'var(--background-color)',
                        padding: '8px 12px',
                        borderRadius: 6,
                        fontFamily: 'monospace',
                        fontSize: 12,
                        whiteSpace: 'pre-wrap',
                        marginBottom: 4,
                      }}>
                        {item.fix}
                      </div>
                      <Button
                        type="text"
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={() => handleCopyFix(item.fix!)}
                      >
                        复制修复指令
                      </Button>
                    </div>
                  )}
                </div>
              </List.Item>
            )}
          />
        )}
      </Modal>
    </div>
  );
}

export default memo(Config);
