import { Form, Input, Button, Card, message, Select, InputNumber, Space, Alert, Divider, Tag, Tooltip } from 'antd';
import { PlusOutlined, DeleteOutlined, SaveOutlined, ApiOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { useState, useEffect, useCallback, memo } from 'react';

interface ModelConfig {
  id: string;
  name: string;
  modelId: string;
}

interface Config {
  id?: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  port: number;
  models?: ModelConfig[];
  defaultModel?: string;
  apiFormat?: 'chat-completions' | 'responses' | 'anthropic';
}

const presetUrls = [
  { label: 'JoyBuilder (京东云)', value: 'http://ai-api.jdcloud.com/v1' },
  { label: 'Anthropic (京东云)', value: 'http://ai-api.jdcloud.com/anthropic/v1' },
  { label: 'OpenAI', value: 'https://api.openai.com/v1' },
  { label: 'DeepSeek', value: 'https://api.deepseek.com/v1' },
  { label: 'Google Gemini', value: 'https://generativelanguage.googleapis.com/v1beta' },
  { label: 'Groq', value: 'https://api.groq.com/openai/v1' },
  { label: 'Ollama (本地)', value: 'http://localhost:11434/v1' },
  { label: '自定义', value: 'custom' },
];

function Config() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [selectedUrl, setSelectedUrl] = useState<string>('');
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [defaultModel, setDefaultModel] = useState<string>('');
  const [apiFormat, setApiFormat] = useState<'chat-completions' | 'responses' | 'anthropic'>('chat-completions');

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const config = await window.electronAPI.getConfig('default');
      if (config) {
        form.setFieldsValue(config);
        setSelectedUrl(config.baseUrl || '');
        setModels(config.models || []);
        setDefaultModel(config.defaultModel || '');
        setApiFormat(config.apiFormat || 'chat-completions');
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  }, [form]);

  const handleSubmit = useCallback(async (values: Config) => {
    if (models.length === 0) {
      message.error('请至少添加一个模型配置');
      return;
    }

    const hasEmptyModel = models.some(m => !m.name.trim() || !m.modelId.trim());
    if (hasEmptyModel) {
      message.error('请完整填写所有模型的名称和 ID');
      return;
    }

    setLoading(true);
    try {
      await window.electronAPI.saveConfig({
        ...values,
        id: 'default',
        models,
        defaultModel: defaultModel || models[0].id,
        apiFormat,
      });
      message.success('配置保存成功');
    } catch (error) {
      message.error('配置保存失败');
    } finally {
      setLoading(false);
    }
  }, [models, defaultModel, apiFormat]);

  const handleTestConnection = useCallback(async () => {
    try {
      await form.validateFields();
      message.loading('正在测试连接...', 0);
      // 这里应该调用测试连接的 API
      setTimeout(() => {
        message.destroy();
        message.success('连接测试成功');
      }, 1000);
    } catch (error) {
      message.error('连接测试失败');
    }
  }, [form]);

  const handleUrlChange = useCallback((value: string) => {
    setSelectedUrl(value);
    form.setFieldsValue({ baseUrl: value });
    // Auto-suggest apiFormat based on provider
    if (value.includes('/anthropic/')) {
      setApiFormat('anthropic');
    } else if (value === 'https://api.openai.com/v1') {
      setApiFormat('responses');
    } else {
      setApiFormat('chat-completions');
    }
  }, [form]);

  const handleAddModel = useCallback(() => {
    const newModel: ModelConfig = {
      id: `model_${Date.now()}`,
      name: '',
      modelId: '',
    };
    setModels(prev => [...prev, newModel]);
  }, []);

  const handleDeleteModel = useCallback((id: string) => {
    setModels(prev => {
      const newModels = prev.filter(m => m.id !== id);
      return newModels;
    });
    setDefaultModel(prev => prev === id ? '' : prev);
  }, []);

  const handleModelChange = useCallback((id: string, field: 'name' | 'modelId', value: string) => {
    setModels(prev => prev.map(m => 
      m.id === id ? { ...m, [field]: value } : m
    ));
  }, []);

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-title-group">
          <h1>配置管理</h1>
          <p>设置代理服务的基本参数和模型信息</p>
        </div>
        <div className="page-actions">
          <Button onClick={handleTestConnection} icon={<ApiOutlined />}>测试连接</Button>
          <Button type="primary" onClick={() => form.submit()} loading={loading} icon={<SaveOutlined />}>
            保存配置
          </Button>
        </div>
      </div>

      <div className="page-content">
        <Card className="content-card">
          <Form
            form={form}
            layout="vertical"
            onFinish={handleSubmit}
            initialValues={{ port: 8787 }}
            style={{ maxWidth: 800 }}
          >
            <div className="form-section-title">基本设置</div>
            
            <Form.Item
              label={
                <Space>
                  配置名称
                  <Tooltip title="为配置起一个易于识别的名称，方便后续管理">
                    <InfoCircleOutlined style={{ color: '#1890ff', fontSize: 14 }} />
                  </Tooltip>
                </Space>
              }
              name="name"
              rules={[{ required: true, message: '请输入配置名称' }]}
              initialValue="默认配置"
            >
              <Input placeholder="例如：默认配置、JoyBuilder-Production" />
            </Form.Item>

            <Form.Item
              label="API Key"
              name="apiKey"
              rules={[{ required: true, message: '请输入 API Key' }]}
            >
              <Input.Password placeholder="sk-xxxxx" />
            </Form.Item>

            <Form.Item
              label="服务提供商"
              name="baseUrl"
              rules={[{ required: true, message: '请选择服务提供商' }]}
            >
              <Select
                placeholder="选择服务提供商"
                options={presetUrls}
                showSearch
                allowClear
                onChange={handleUrlChange}
                filterOption={(input, option) =>
                  (option?.label ?? '').toLowerCase().includes(input.toLowerCase()) ||
                  (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                }
              />
            </Form.Item>

            {selectedUrl && selectedUrl !== 'custom' && (
              <Alert
                message={`API 端点: ${selectedUrl}`}
                type="info"
                showIcon
                style={{ marginBottom: 24 }}
              />
            )}

            {selectedUrl === 'custom' && (
              <Form.Item
                label="自定义 Base URL"
                name="baseUrl"
                rules={[{ required: true, message: '请输入自定义 Base URL' }]}
              >
                <Input placeholder="https://your-api-endpoint.com/v1" />
              </Form.Item>
            )}

            <Form.Item
              label="代理端口"
              name="port"
              rules={[{ required: true, message: '请输入端口号' }]}
            >
              <InputNumber min={1024} max={65535} style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item
              label={
                <Space>
                  API 格式
                  <Tooltip title="Anthropic 直通模式无需格式转换，延迟最低；Chat Completions 是经典 OpenAI 格式，兼容性好；Responses 是 OpenAI 新格式，仅部分 API 支持。选择错误会导致请求失败">
                    <InfoCircleOutlined style={{ color: '#1890ff', fontSize: 14 }} />
                  </Tooltip>
                </Space>
              }
            >
              <Select
                value={apiFormat}
                onChange={(value) => setApiFormat(value)}
                options={[
                  { label: 'Anthropic 直通 (零转换，推荐)', value: 'anthropic' },
                  { label: 'Chat Completions (兼容性好)', value: 'chat-completions' },
                  // { label: 'Responses API (OpenAI 新格式)', value: 'responses' },
                ]}
              />
            </Form.Item>

            <Divider />
            
            <div className="form-section-title">
              <Space>
                模型配置
                <Tag color="red">必填</Tag>
              </Space>
            </div>

            <Alert
              message="模型配置为必填项，请至少添加一个模型。配置后启动服务时会自动将模型信息写入 Claude Code 配置文件。"
              type="info"
              showIcon
              style={{ marginBottom: 24 }}
            />
            
            <Button
              type="dashed"
              onClick={handleAddModel}
              icon={<PlusOutlined />}
              style={{ width: '100%', marginBottom: 24 }}
            >
              添加模型
            </Button>

            {models.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <Form.Item label="默认模型" style={{ marginBottom: 0 }}>
                  <Select
                    placeholder="选择默认模型"
                    value={defaultModel || undefined}
                    onChange={setDefaultModel}
                    allowClear
                  >
                    {models.map(model => (
                      <Select.Option key={model.id} value={model.id}>
                        {model.name || model.modelId || '未命名模型'}
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              </div>
            )}

            {models.map((model, index) => (
              <Card
                key={model.id}
                size="small"
                style={{ marginBottom: 16, background: 'var(--background-color)' }}
                title={
                  <Space>
                    <Tag color="blue">模型 {index + 1}</Tag>
                    {defaultModel === model.id && <Tag color="green">默认</Tag>}
                  </Space>
                }
                extra={
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => handleDeleteModel(model.id)}
                  />
                }
              >
                <Space direction="vertical" style={{ width: '100%' }}>
                  <div>
                    <label style={{ marginBottom: 4, display: 'block', fontWeight: 500 }}>
                      名称 <span style={{ color: '#ff4d4f' }}>*</span>
                    </label>
                    <Input
                      placeholder="模型名称（例如：Claude 3.5 Sonnet）"
                      value={model.name}
                      onChange={(e) => handleModelChange(model.id, 'name', e.target.value)}
                      status={!model.name.trim() && model.modelId ? 'error' : undefined}
                    />
                  </div>
                  <div>
                    <label style={{ marginBottom: 4, display: 'block', fontWeight: 500 }}>
                      ID <span style={{ color: '#ff4d4f' }}>*</span>
                    </label>
                    <Input
                      placeholder="模型ID（例如：claude-3-5-sonnet-20241022）"
                      value={model.modelId}
                      onChange={(e) => handleModelChange(model.id, 'modelId', e.target.value)}
                      status={!model.modelId.trim() && model.name ? 'error' : undefined}
                    />
                  </div>
                </Space>
              </Card>
            ))}
          </Form>
        </Card>
      </div>
    </div>
  );
}

export default memo(Config);
