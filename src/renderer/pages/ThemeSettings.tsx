import { Card, Space, Divider, ColorPicker, Button, message, Switch, Segmented } from 'antd';
import { SunOutlined, MoonOutlined, EyeOutlined } from '@ant-design/icons';
import { useCallback, memo } from 'react';
import { useTheme } from '../context/ThemeContext';
import { lightTheme, darkTheme, GlassLevel } from '../theme/manager';

const presetColors = [
  { label: '海蓝', color: '#3b82f6' },
  { label: '翡翠', color: '#10b981' },
  { label: '紫罗兰', color: '#8b5cf6' },
  { label: '琥珀', color: '#f59e0b' },
  { label: '珊瑚', color: '#f97316' },
  { label: '玫瑰', color: '#ec4899' },
  { label: '石墨', color: '#6b7280' },
  { label: '靛蓝', color: '#6366f1' },
];

const glassOptions = [
  { label: '清透', value: 'light' },
  { label: '标准', value: 'standard' },
  { label: '浓郁', value: 'heavy' },
];

function ThemeSettings() {
  const { mode, setMode, customColors, setCustomColors } = useTheme();

  const handleColorChange = useCallback((color: any) => {
    const primaryColor = typeof color === 'string' ? color : color.toHexString();
    setCustomColors({ ...customColors, primary: primaryColor });
    message.success('主题色已应用');
  }, [customColors, setCustomColors]);

  const handlePresetColor = useCallback((color: string) => {
    setCustomColors({ ...customColors, primary: color });
    message.success('主题色已应用');
  }, [customColors, setCustomColors]);

  const handleModeChange = useCallback((checked: boolean) => {
    setMode(checked ? 'dark' : 'light');
    message.success(`已切换至${checked ? '深色' : '浅色'}模式`);
  }, [setMode]);

  const handleGlassChange = useCallback((value: string) => {
    setCustomColors({ ...customColors, glassLevel: value as GlassLevel });
    message.success('毛玻璃强度已更新');
  }, [customColors, setCustomColors]);

  const handleReset = useCallback(() => {
    setCustomColors({});
    setMode('light');
    message.success('主题已重置为默认设置');
  }, [setCustomColors, setMode]);

  const currentPrimary = customColors.primary || (mode === 'dark' ? darkTheme.primary : lightTheme.primary);
  const currentGlass = (customColors as any).glassLevel || 'standard';

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-title-group">
          <h1>主题设置</h1>
          <p>自定义毛玻璃外观、配色与强度</p>
        </div>
      </div>

      <div className="page-content">
        {/* Theme Mode */}
        <Card className="content-card" title={
          <Space>
            {mode === 'dark' ? <MoonOutlined style={{ color: 'var(--primary-color)' }} /> : <SunOutlined style={{ color: '#f59e0b' }} />}
            <span>显示模式</span>
          </Space>
        }>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{
                width: 52, height: 52, borderRadius: 12,
                background: mode === 'dark'
                  ? 'linear-gradient(135deg, rgba(30,30,40,0.8) 0%, rgba(20,20,30,0.9) 100%)'
                  : 'linear-gradient(135deg, rgba(255,255,255,0.8) 0%, rgba(240,240,245,0.9) 100%)',
                border: '1px solid var(--glass-border)',
                backdropFilter: 'blur(10px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {mode === 'dark'
                  ? <MoonOutlined style={{ fontSize: 24, color: 'var(--primary-color)' }} />
                  : <SunOutlined style={{ fontSize: 24, color: '#f59e0b' }} />
                }
              </div>
              <div>
                <div style={{ fontWeight: 500, fontSize: 15, marginBottom: 2 }}>
                  {mode === 'dark' ? '深色模式' : '浅色模式'}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary-color)' }}>
                  {mode === 'dark' ? '暗色玻璃质感，适合夜间' : '明亮透明质感，日常使用'}
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

        {/* Glass Level */}
        <Card className="content-card" title={
          <Space>
            <EyeOutlined style={{ color: 'var(--primary-color)' }} />
            <span>毛玻璃强度</span>
          </Space>
        }>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary-color)' }}>
              调节面板的透明度与模糊程度
            </div>
            <Segmented
              value={currentGlass}
              onChange={handleGlassChange}
              options={glassOptions}
              block
              style={{ maxWidth: 360 }}
            />
          </div>
        </Card>

        {/* Theme Color */}
        <Card className="content-card" title="主题色">
          <Space direction="vertical" style={{ width: '100%' }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary-color)', marginBottom: 8 }}>
              主题色会同时渲染到按钮、图标高亮和毛玻璃 tint 染色
            </div>

            {/* Preset swatches */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              {presetColors.map((p) => (
                <div
                  key={p.color}
                  onClick={() => handlePresetColor(p.color)}
                  style={{
                    cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: p.color,
                    border: currentPrimary === p.color ? '3px solid var(--text-color)' : '2px solid transparent',
                    transition: 'all 0.2s',
                    boxShadow: `0 2px 8px ${p.color}40`,
                  }} />
                  <span style={{ fontSize: 11, color: 'var(--text-secondary-color)' }}>{p.label}</span>
                </div>
              ))}
            </div>

            <Divider style={{ margin: '8px 0' }} />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 500, marginBottom: 2 }}>自定义颜色</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary-color)' }}>选取任意颜色作为主题色</div>
              </div>
              <ColorPicker
                value={currentPrimary}
                onChange={handleColorChange}
                showText
              />
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <Button onClick={handleReset}>重置为默认</Button>
          </Space>
        </Card>

        {/* Live Preview */}
        <Card className="content-card" title="预览效果">
          <div style={{
            padding: 20, borderRadius: 12,
            background: 'var(--glass-bg)',
            backdropFilter: 'blur(var(--glass-blur)) saturate(var(--glass-saturate))',
            WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(var(--glass-saturate))',
            border: '1px solid var(--glass-border)',
          }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <div style={{ color: 'var(--text-color)', fontWeight: 600, fontSize: 16 }}>
                毛玻璃面板
              </div>
              <div style={{ color: 'var(--text-secondary-color)', fontSize: 14 }}>
                这是一段描述文字，展示了当前主题和玻璃效果的组合效果。
              </div>
              <Space style={{ marginTop: 8 }}>
                <Button type="primary">主要操作</Button>
                <Button>次要操作</Button>
              </Space>
            </Space>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default memo(ThemeSettings);
