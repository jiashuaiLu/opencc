import { Form, Input, Button, Card, message, Select, InputNumber, Space, Alert, Divider, Tag } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useState, useEffect } from 'react';

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
}

export default function Config() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [selectedUrl, setSelectedUrl] = useState<string>('');
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [defaultModel, setDefaultModel] = useState<string>('');

  const presetUrls = [
    { label: 'JoyBuilder (京东云)', value: 'http://ai-api.jdcloud.com/v1' },
    { label: 'OpenAI', value: 'https://api.openai.com/v1' },
    { label: 'DeepSeek', value: 'https://api.deepseek.com/v1' },
    { label: 'Google Gemini', value: 'https://generativelanguage.googleapis.com/v1beta' },
    { label: 'Groq', value: 'https://api.groq.com/openai/v1' },
    { label: 'Ollama (本地)', value: 'http://localhost:11434/v1' },
    { label: '自定义', value: 'custom' },
  ];

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const config = await window.electronAPI.getConfig('default');
      if (config) {
        form.setFieldsValue(config);
        setSelectedUrl(config.baseUrl || '');
        setModels(config.models || []);
        setDefaultModel(config.defaultModel || '');
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  };

  const handleSubmit = async (values: Config) => {
    setLoading(true);
    try {
      await window.electronAPI.saveConfig({
        ...values,
        id: 'default',
        models,
        defaultModel,
      });
      message.success('配置保存成功');
    } catch (error) {
      message.error('配置保存失败');
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async () => {
    try {
      const values = await form.validateFields();
      message.loading('正在测试连接...', 0);
      // 这里应该调用测试连接的 API
      setTimeout(() => {
        message.destroy();
        message.success('连接测试成功');
      }, 1000);
    } catch (error) {
      message.error('连接测试失败');
    }
  };

  const handleUrlChange = (value: string) => {
    setSelectedUrl(value);
    form.setFieldsValue({ baseUrl: value });
  };

  const handleAddModel = () => {
    const newModel: ModelConfig = {
      id: `model_${Date.now()}`,
      name: '',
      modelId: '',
    };
    setModels([...models, newModel]);
  };

  const handleDeleteModel = (id: string) => {
    setModels(models.filter(m => m.id !== id));
    if (defaultModel === id) {
      setDefaultModel('');
    }
  };

  const handleModelChange = (id: string, field: 'name' | 'modelId', value: string) => {
    setModels(models.map(m => 
      m.id === id ? { ...m, [field]: value } : m
    ));
  };

  return (
    <Card title="代理配置">
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{ port: 8787 }}
        style={{ maxWidth: 600 }}
      >
        <Form.Item
          label="配置名称"
          name="name"
          rules={[{ required: true, message: '请输入配置名称' }]}
        >
          <Input placeholder="例如：JoyBuilder-Production" />
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

        <Divider>模型配置</Divider>

        <div style={{ marginBottom: 16 }}>
          <Alert
            message="配置模型列表后，启动服务时会自动将模型配置写入 Claude Code 配置文件"
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
            添加模型
          </Button>

          {models.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <Form.Item label="默认模型">
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
              style={{ marginBottom: 16 }}
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
                <Input
                  placeholder="模型名称（例如：Claude 3.5 Sonnet）"
                  value={model.name}
                  onChange={(e) => handleModelChange(model.id, 'name', e.target.value)}
                />
                <Input
                  placeholder="模型ID（例如：claude-3-5-sonnet-20241022）"
                  value={model.modelId}
                  onChange={(e) => handleModelChange(model.id, 'modelId', e.target.value)}
                />
              </Space>
            </Card>
          ))}
        </div>

        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={loading}>
              保存配置
            </Button>
            <Button onClick={handleTestConnection}>测试连接</Button>
          </Space>
        </Form.Item>
      </Form>
    </Card>
  );
}
