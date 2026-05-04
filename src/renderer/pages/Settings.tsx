import { Card, Form, Switch, Button, message, Divider, Space, Popconfirm, Select, InputNumber } from 'antd';
import { SaveOutlined, ReloadOutlined, DeleteOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { useState, useEffect, useCallback, memo } from 'react';

function Settings() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const settings = await window.electronAPI.getSettings();
      if (settings) {
        form.setFieldsValue(settings);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }, [form]);

  const handleSubmit = useCallback(async (values: any) => {
    setLoading(true);
    try {
      await window.electronAPI.saveSettings(values);
      message.success('设置已保存');
    } catch (error) {
      message.error('保存设置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleReset = useCallback(async () => {
    try {
      await window.electronAPI.resetSettings();
      message.success('设置已重置');
      loadSettings();
    } catch (error) {
      message.error('重置设置失败');
    }
  }, [loadSettings]);

  const handleClearCache = useCallback(async () => {
    try {
      await window.electronAPI.clearCache();
      message.success('缓存已清除');
    } catch (error) {
      message.error('清除缓存失败');
    }
  }, []);

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-title-group">
          <h1>系统设置</h1>
          <p>管理应用程序的通用设置和数据</p>
        </div>
      </div>

      <div className="page-content">
        <Card className="content-card" title="通用设置">
          <Form form={form} layout="vertical" onFinish={handleSubmit} style={{ maxWidth: 800 }}>
            <div className="form-section-title">启动与行为</div>
            <Form.Item name="autoStart" label="开机自启动" valuePropName="checked">
              <Switch />
            </Form.Item>

            <Form.Item name="minimizeToTray" label="最小化到托盘" valuePropName="checked">
              <Switch />
            </Form.Item>

            <Form.Item name="showNotification" label="显示通知" valuePropName="checked">
              <Switch />
            </Form.Item>

            <Divider />

            <div className="form-section-title">日志设置</div>
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

            <Form.Item style={{ marginTop: 24 }}>
              <Space>
                <Button type="primary" htmlType="submit" loading={loading} icon={<SaveOutlined />}>
                  保存设置
                </Button>
                <Popconfirm
                  title="确定要重置设置吗？"
                  onConfirm={handleReset}
                  okText="确定"
                  cancelText="取消"
                >
                  <Button icon={<ReloadOutlined />}>重置设置</Button>
                </Popconfirm>
              </Space>
            </Form.Item>
          </Form>
        </Card>

        <Card className="content-card" title="数据管理">
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <div>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>应用缓存</div>
              <div style={{ color: 'var(--text-secondary-color)', marginBottom: 16, fontSize: 13 }}>
                清除应用缓存数据，不会影响配置和历史记录
              </div>
              <Button onClick={handleClearCache} icon={<DeleteOutlined />}>清除缓存</Button>
            </div>

            <Divider style={{ margin: '0' }} />

            <div>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>重置应用</div>
              <div style={{ color: 'var(--text-secondary-color)', marginBottom: 16, fontSize: 13 }}>
                重置应用到初始状态，所有数据将被清除
              </div>
              <Button danger icon={<DeleteOutlined />}>重置应用</Button>
            </div>
          </Space>
        </Card>

        <Card className="content-card" title="关于">
          <Space align="start">
            <InfoCircleOutlined style={{ fontSize: 24, color: 'var(--primary-color)' }} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>OpenCC v1.4.0</div>
              <div style={{ marginBottom: 8 }}>Claude Code 本地代理服务管理工具</div>
              <div style={{ color: 'var(--text-secondary-color)', fontSize: 12 }}>
                © 2026 OpenCC Team. All rights reserved.
              </div>
            </div>
          </Space>
        </Card>
      </div>
    </div>
  );
}

export default memo(Settings);
