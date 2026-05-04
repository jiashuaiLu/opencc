import { Card, Space, Divider, ColorPicker, Button, message, Alert, Switch } from 'antd';
import { SunOutlined, MoonOutlined, CheckOutlined } from '@ant-design/icons';
import { useCallback, memo } from 'react';
import { useTheme } from '../context/ThemeContext';
import { lightTheme, darkTheme } from '../theme/manager';

function ThemeSettings() {
  const { mode, setMode, customColors, setCustomColors } = useTheme();

  const handleColorChange = useCallback((color: any) => {
    const primaryColor = typeof color === 'string' ? color : color.toHexString();
    setCustomColors({ ...customColors, primary: primaryColor });
    message.success('颜色设置已应用');
  }, [customColors, setCustomColors]);

  const handleModeChange = useCallback((checked: boolean) => {
    setMode(checked ? 'dark' : 'light');
    message.success(`已切换至${checked ? '深色' : '浅色'}模式`);
  }, [setMode]);

  const handleReset = useCallback(() => {
    setCustomColors({});
    setMode('light');
    message.success('主题已重置为默认设置');
  }, [setCustomColors, setMode]);

  const currentPrimary = customColors.primary || (mode === 'dark' ? darkTheme.primary : lightTheme.primary);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>主题设置</h1>
        <p style={{ margin: '8px 0 0 0', color: 'var(--text-secondary-color)', fontSize: 14 }}>
          自定义应用的外观和配色方案
        </p>
      </div>

      <Alert
        message={mode === 'dark' ? "深色主题" : "浅色主题"}
        description={mode === 'dark' ? "应用当前使用深色主题，适合低光环境。" : "应用当前使用浅色主题，界面简洁清晰，适合日常使用。"}
        type="info"
        showIcon
        style={{ marginBottom: 24, borderRadius: 8 }}
      />

      <Card 
        title={
          <Space>
            {mode === 'dark' ? <MoonOutlined style={{ color: '#1890ff' }} /> : <SunOutlined style={{ color: '#faad14' }} />}
            <span>主题模式</span>
          </Space>
        } 
        style={{ marginBottom: 24, borderRadius: 12 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: 12,
                background: mode === 'dark' ? 'linear-gradient(135deg, #1f1f1f 0%, #141414 100%)' : 'linear-gradient(135deg, #f0f2f5 0%, #ffffff 100%)',
                border: `2px solid ${mode === 'dark' ? '#434343' : '#d9d9d9'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {mode === 'dark' ? 
                <MoonOutlined style={{ fontSize: 28, color: '#1890ff' }} /> : 
                <SunOutlined style={{ fontSize: 28, color: '#faad14' }} />
              }
            </div>
            <div>
              <div style={{ fontWeight: 500, fontSize: 16, marginBottom: 4 }}>
                {mode === 'dark' ? '深色模式' : '浅色模式'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary-color)' }}>
                {mode === 'dark' ? '界面柔和护眼，适合夜间使用' : '界面明亮清晰，适合日常使用'}
              </div>
            </div>
          </div>
          <Switch 
            checkedChildren={<MoonOutlined />} 
            unCheckedChildren={<SunOutlined />} 
            checked={mode === 'dark'}
            onChange={handleModeChange}
          />
        </div>
      </Card>

      <Card title="自定义颜色" style={{ marginBottom: 24, borderRadius: 12 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>主题色</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary-color)' }}>自定义应用的主题颜色</div>
            </div>
            <ColorPicker
              value={currentPrimary}
              onChange={handleColorChange}
              showText
            />
          </div>

          <Divider style={{ margin: '16px 0' }} />

          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={handleReset}>重置为默认</Button>
          </div>
        </Space>
      </Card>

      <Card title="预览效果" style={{ borderRadius: 12 }}>
        <div style={{ padding: 16, background: 'var(--background-color)', borderRadius: 8, border: '1px solid var(--border-color)' }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <div style={{ color: 'var(--text-color)', fontWeight: 500 }}>
              这是一个标题
            </div>
            <div style={{ color: 'var(--text-secondary-color)', fontSize: 14 }}>
              这是一段描述文字，展示了当前主题下的文本颜色。
            </div>
            <Space>
              <Button type="primary">
                主要按钮
              </Button>
              <Button>次要按钮</Button>
            </Space>
          </Space>
        </div>
      </Card>
    </div>
  );
}

export default memo(ThemeSettings);
