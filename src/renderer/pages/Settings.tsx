import { Card, Form, Switch, Button, message, Divider, Space, Popconfirm, Select, InputNumber } from 'antd';
import { useState, useEffect } from 'react';

export default function Settings() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const settings = await window.electronAPI.getSettings();
      if (settings) {
        form.setFieldsValue(settings);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const handleSubmit = async (values: any) => {
    setLoading(true);
    try {
      await window.electronAPI.saveSettings(values);
      message.success('设置已保存');
    } catch (error) {
      message.error('保存设置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    try {
      await window.electronAPI.resetSettings();
      message.success('设置已重置');
      loadSettings();
    } catch (error) {
      message.error('重置设置失败');
    }
  };

  const handleClearCache = async () => {
    try {
      await window.electronAPI.clearCache();
      message.success('缓存已清除');
    } catch (error) {
      message.error('清除缓存失败');
    }
  };

  return (
    <div>
      <Card title="应用设置" style={{ marginBottom: 16 }}>
        <Form form={form} layout="vertical" onFinish={handleSubmit} style={{ maxWidth: 600 }}>
          <Form.Item name="autoStart" label="开机自启动" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item name="minimizeToTray" label="最小化到托盘" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item name="showNotification" label="显示通知" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item name="logLevel" label="日志级别">
            <Select
              options={[
                { label: 'INFO', value: 'info' },
                { label: 'WARN', value: 'warn' },
                { label: 'ERROR', value: 'error' },
              ]}
            />
          </Form.Item>

          <Form.Item name="logRetentionDays" label="日志保留天数">
            <InputNumber min={1} max={30} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={loading}>
                保存设置
              </Button>
              <Popconfirm
                title="确定要重置设置吗？"
                onConfirm={handleReset}
                okText="确定"
                cancelText="取消"
              >
                <Button>重置设置</Button>
              </Popconfirm>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <Card title="数据管理">
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <Button onClick={handleClearCache}>清除缓存</Button>
            <p style={{ color: '#8c8c8c', marginTop: 8, fontSize: 12 }}>
              清除应用缓存数据，不会影响配置和历史记录
            </p>
          </div>

          <Divider />

          <div>
            <Button danger>重置应用</Button>
            <p style={{ color: '#8c8c8c', marginTop: 8, fontSize: 12 }}>
              重置应用到初始状态，所有数据将被清除
            </p>
          </div>
        </Space>
      </Card>

      <Card title="关于" style={{ marginTop: 16 }}>
        <p>
          <strong>OpenCC</strong> v1.0.0
        </p>
        <p>Claude Code 本地代理服务管理工具</p>
        <p style={{ color: '#8c8c8c', marginTop: 8, fontSize: 12 }}>
          © 2026 OpenCC Team. All rights reserved.
        </p>
      </Card>
    </div>
  );
}
