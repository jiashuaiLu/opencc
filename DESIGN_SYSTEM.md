# DongCC Design System & Style Guide

## 1. 核心理念 (Core Principles)

- **极简主义 (Minimalism)**: 减少视觉噪音，强调内容本身。
- **一致性 (Consistency)**: 统一的间距、色彩、字体和组件行为。
- **响应式 (Responsiveness)**: 适配不同尺寸的屏幕和设备。
- **暗黑模式 (Dark Mode)**: 原生支持深色主题，自动切换。

## 2. 色彩体系 (Color System)

我们使用 CSS 变量来管理主题颜色，确保实时切换和一致性。

| 变量名 | 描述 | Light Mode | Dark Mode |
| :--- | :--- | :--- | :--- |
| `--primary-color` | 主色调 (品牌色) | `#1677ff` | `#1668dc` |
| `--success-color` | 成功/安全 | `#52c41a` | `#49aa19` |
| `--warning-color` | 警告/注意 | `#faad14` | `#d89614` |
| `--danger-color` | 错误/危险 | `#ff4d4f` | `#a61d24` |
| `--background-color` | 应用背景色 | `#f5f7fa` | `#141414` |
| `--surface-color` | 卡片/容器背景色 | `#ffffff` | `#1f1f1f` |
| `--text-color` | 主要文本颜色 | `#1f1f1f` | `rgba(255, 255, 255, 0.85)` |
| `--text-secondary-color` | 次要文本颜色 | `#8c8c8c` | `rgba(255, 255, 255, 0.45)` |
| `--border-color` | 边框/分割线颜色 | `#f0f0f0` | `#303030` |

## 3. 布局规范 (Layout)

### 页面结构
所有页面应遵循以下 DOM 结构：

```tsx
<div className="page-container">
  <div className="page-header">
    <div className="page-title-group">
      <h1>页面标题</h1>
      <p>页面描述</p>
    </div>
    <div className="page-actions">
      {/* 操作按钮 */}
    </div>
  </div>

  <div className="page-content">
    {/* 页面主要内容 */}
  </div>
</div>
```

### 间距 (Spacing)
- **基础单位**: 4px
- **组件间距**: 8px / 16px / 24px
- **页面内边距**: 24px (由 `.app-content` 控制)
- **卡片内边距**: 24px (Ant Design 默认)

## 4. 组件规范 (Components)

### 卡片 (Card)
- **圆角**: 12px
- **阴影**: `0 1px 2px 0 rgba(0, 0, 0, 0.03)`
- **使用**: 使用 `.content-card` 类名。

### 按钮 (Button)
- **圆角**: 6px
- **高度**: 36px (中等尺寸)

### 列表项 (List Item)
- **悬停效果**: 使用 `.list-item-hover` 类名添加统一的悬停背景色。
- **管理列表**: 参见 `src/renderer/styles/management.css` 中的 `.list-item-row`。

## 5. CSS 文件结构

- **global.css**: 全局重置、滚动条样式、通用工具类。
- **layout.css**: 应用整体框架布局 (Sidebar, Content Area)。
- **common.css**: 通用页面布局、排版、状态徽章、代码块样式。
- **dashboard.css**: 仪表盘专用样式。
- **history.css**: 对话历史及聊天气泡样式。
- **management.css**: MCP 和 Skills 管理页面的列表及统计条样式。

## 6. 开发指南

1. **新增页面**: 务必引入 `common.css` 并使用 `.page-container` 结构。
2. **颜色使用**: **严禁**使用硬编码的 Hex 颜色值（如 `#000`）。必须使用 `var(--variable-name)` 或 Ant Design 的 Token。
3. **图标**: 统一使用 `@ant-design/icons`，大小通常为 14px - 20px。
