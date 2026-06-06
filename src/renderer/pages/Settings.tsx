import { Card, Switch, Button, message, Space, Popconfirm, Select, InputNumber } from 'antd';
import { SaveOutlined, ReloadOutlined, DeleteOutlined, CloudDownloadOutlined } from '@ant-design/icons';
import { useState, useEffect, useCallback, memo } from 'react';

function Settings() {
  const [loading, setLoading] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [currentVersion, setCurrentVersion] = useState('');
  const [settings, setSettings] = useState<any>({});

  useEffect(() => {
    loadSettings();
    window.electronAPI.getCurrentVersion().then(setCurrentVersion).catch(() => {});
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const data = await window.electronAPI.getSettings();
      if (data) setSettings(data);
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }, []);

  const updateSetting = useCallback(async (key: string, value: any) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    try {
      await window.electronAPI.saveSettings(updated);
    } catch (error) {
      message.error('保存失败');
    }
  }, [settings]);

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

  const handleCheckUpdate = useCallback(async () => {
    setCheckingUpdate(true);
    try {
      await window.electronAPI.checkForUpdates();
    } catch (error) {
      message.error('检查更新失败');
    } finally {
      setCheckingUpdate(false);
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
        {/* 启动与行为 */}
        <div className="section-label">启动与行为</div>
        <Card className="content-card">
          <div className="setting-row">
            <div className="setting-row-info">
              <span className="setting-row-label">开机自启动</span>
              <span className="setting-row-desc">登录系统后自动启动 DongCC</span>
            </div>
            <Switch checked={settings.autoStart} onChange={(v) => updateSetting('autoStart', v)} />
          </div>
          <div className="setting-row">
            <div className="setting-row-info">
              <span className="setting-row-label">最小化到托盘</span>
              <span className="setting-row-desc">关闭窗口时保持在后台运行</span>
            </div>
            <Switch checked={settings.minimizeToTray} onChange={(v) => updateSetting('minimizeToTray', v)} />
          </div>
          <div className="setting-row">
            <div className="setting-row-info">
              <span className="setting-row-label">显示通知</span>
              <span className="setting-row-desc">服务状态变化时推送桌面通知</span>
            </div>
            <Switch checked={settings.showNotification} onChange={(v) => updateSetting('showNotification', v)} />
          </div>
        </Card>

        {/* 日志设置 */}
        <div className="section-label">日志</div>
        <Card className="content-card">
          <div className="setting-row">
            <div className="setting-row-info">
              <span className="setting-row-label">日志级别</span>
              <span className="setting-row-desc">控制记录日志的详细程度</span>
            </div>
            <Select
              value={settings.logLevel || 'info'}
              onChange={(v) => updateSetting('logLevel', v)}
              style={{ width: 120 }}
              options={[
                { label: 'INFO', value: 'info' },
                { label: 'WARN', value: 'warn' },
                { label: 'ERROR', value: 'error' },
              ]}
            />
          </div>
          <div className="setting-row">
            <div className="setting-row-info">
              <span className="setting-row-label">日志保留天数</span>
              <span className="setting-row-desc">超过该天数的日志将自动清理</span>
            </div>
            <InputNumber
              min={1}
              max={90}
              value={settings.logRetentionDays || 7}
              onChange={(v) => updateSetting('logRetentionDays', v)}
              style={{ width: 80 }}
              suffix="天"
            />
          </div>
        </Card>

        {/* 数据管理 */}
        <div className="section-label">数据管理</div>
        <Card className="content-card">
          <div className="setting-row">
            <div className="setting-row-info">
              <span className="setting-row-label">清除缓存</span>
              <span className="setting-row-desc">清除应用缓存数据，不影响配置和历史</span>
            </div>
            <Button size="small" onClick={handleClearCache} icon={<DeleteOutlined />}>清除</Button>
          </div>
          <div className="setting-row">
            <div className="setting-row-info">
              <span className="setting-row-label">重置应用</span>
              <span className="setting-row-desc">恢复所有设置到初始状态</span>
            </div>
            <Popconfirm title="确定要重置所有设置吗？" onConfirm={handleReset} okText="确定" cancelText="取消">
              <Button size="small" danger icon={<ReloadOutlined />}>重置</Button>
            </Popconfirm>
          </div>
        </Card>

        {/* 关于 */}
        <div className="section-label">关于</div>
        <Card className="content-card">
          <div className="setting-row">
            <div className="setting-row-info">
              <span className="setting-row-label">DongCC {currentVersion ? `v${currentVersion}` : ''}</span>
              <span className="setting-row-desc">Claude Code 本地代理服务管理工具</span>
            </div>
            <Button
              size="small"
              icon={<CloudDownloadOutlined />}
              loading={checkingUpdate}
              onClick={handleCheckUpdate}
            >
              检查更新
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default memo(Settings);
