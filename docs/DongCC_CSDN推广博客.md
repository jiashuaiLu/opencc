# DongCC：让 Claude Code 更懂中国开发者的一站式代理管理工具

> **作者**：DongCC Team  
> **发布时间**：2026-04-25  
> **关键词**：Claude Code, 代理服务, Electron, AI开发工具, 大模型API  
> **GitHub**：https://coding.jd.com/atop-qa/dongcc

---

## 一、前言：为什么需要 DongCC？

自从 Anthropic 推出 Claude Code 以来，这款 AI 编程助手迅速成为开发者的新宠。但国内开发者在使用时面临几个痛点：

1. **网络访问受限**：直接访问 Anthropic API 不稳定
2. **配置复杂**：需要手动编辑配置文件，容易出错
3. **缺乏监控**：不知道 Token 消耗了多少，请求是否成功
4. **多环境切换**：工作和个人项目需要不同的 API 配置

**DongCC 就是为了解决这些问题而生的。**

---

## 二、DongCC 是什么？

DongCC 是一款基于 Electron 开发的桌面应用，为 Claude Code 提供本地代理服务管理功能。它让开发者能够通过图形化界面轻松配置代理、监控请求、管理对话历史，无需手动编辑任何配置文件。

### 核心功能一览

| 功能模块 | 说明 |
|---------|------|
| 🚀 **代理服务管理** | 一键启动/停止，支持 JoyBuilder、OpenAI、DeepSeek、京东云等多平台 |
| ⚙️ **可视化配置** | 图形化界面管理 API Key、Base URL、模型参数 |
| 📊 **实时监控** | Token 消耗、请求耗时、成功率实时统计 |
| 📝 **日志系统** | 多级别日志过滤、搜索、导出 |
| 💬 **对话历史** | 查看、搜索、导出所有对话记录 |
| 🔌 **MCP 管理** | 配置 Model Context Protocol 服务器 |
| 🎨 **主题切换** | 支持浅色/深色模式，跟随系统自动切换 |

---

## 三、技术架构解析

### 3.1 整体架构

DongCC 采用 Electron 主进程 + React 渲染进程的经典架构：

```
┌─────────────────────────────────────────┐
│           Electron 主进程                │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐ │
│  │ 代理服务 │  │ 数据库  │  │ 日志系统 │ │
│  │ (Node)  │  │ (LowDB) │  │(Winston)│ │
│  └────┬────┘  └─────────┘  └─────────┘ │
│       │                                 │
│  IPC 通信                               │
│       │                                 │
│  ┌────┴────┐                           │
│  │ Preload │                           │
│  └────┬────┘                           │
└───────┼─────────────────────────────────┘
        │
┌───────┼─────────────────────────────────┐
│       │      React 渲染进程              │
│  ┌────┴────┐  ┌─────────┐  ┌─────────┐ │
│  │ 页面路由 │  │ UI 组件 │  │ 状态管理 │ │
│  │(Router) │  │(AntD)   │  │(Zustand)│ │
│  └─────────┘  └─────────┘  └─────────┘ │
└─────────────────────────────────────────┘
```

### 3.2 代理服务核心设计

代理服务是 DongCC 的核心，负责将 Claude Code 的请求转发到不同的 AI 服务商。

**请求处理流程：**

```typescript
// 1. 接收 Claude Code 请求
app.post('/v1/messages', async (req, res) => {
  const claudeRequest: ClaudeMessagesRequest = req.body;
  
  // 2. 根据配置选择 API 格式
  const apiFormat = config.apiFormat; // 'anthropic' | 'chat-completions' | 'responses'
  
  // 3. 参数清理和转换
  const cleanBody = buildCleanAnthropicBody(claudeRequest);
  
  // 4. 转发到目标服务
  const response = await fetch(targetUrl, {
    headers: { Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(cleanBody)
  });
  
  // 5. 返回响应
  return response;
});
```

### 3.3 参数清理机制

不同云服务商对请求参数的要求不同。例如京东云要求：
- `tool_use.id` 必须符合 `^[a-zA-Z0-9_-]+$`
- `function_response.response` 必须是对象类型
- 空文本内容会被拒绝

DongCC 内置了智能参数清理：

```typescript
private buildCleanAnthropicBody(request: ClaudeMessagesRequest): any {
  // 清理 tool_use ID，移除非法字符
  const cleanId = block.id.replace(/[^a-zA-Z0-9_-]/g, '_');
  
  // 确保 function_response 是对象
  const responseData = typeof content === 'string' 
    ? { result: content } 
    : content;
  
  // 过滤空文本块
  const cleanMessages = messages.filter(msg => 
    msg.content.trim().length > 0
  );
  
  return { ... };
}
```

---

## 四、版本演进历程

### v1.0.0（2026-03-05）—— 基础框架

- ✅ 代理服务管理
- ✅ 配置管理
- ✅ 日志系统
- ✅ 基础统计
- ✅ 对话历史

**技术选型**：Electron + React 18 + TypeScript + Ant Design 5

### v1.1.0（2026-03-08）—— UI 革新

- ✨ 全新极简设计系统
- ✨ 暗黑模式支持
- ✨ MCP 管理功能
- ✨ Skills 管理功能

**设计理念**："让复杂的事情变得简单"

### v1.2.0（2026-03-10）—— 细节打磨

- 🎯 模型配置必填校验
- 🎨 MCP/Skills 页面样式优化
- 📊 度量看板字段修复
- 🌓 菜单栏主题适配

### v1.3.0（2026-04-25）—— 跨平台支持

- 🎉 **京东云 Anthropic 兼容 API**
- 🍎 **macOS Universal 架构**（Intel + Apple Silicon）
- 🖥️ **Windows 支持**
- 🔧 工具调用 ID 格式修复
- 📝 空内容处理优化

---

## 五、快速开始

### 5.1 安装

**macOS**：
```bash
# 下载 DMG 安装包
wget https://joy-ai-test.s3-internal.cn-north-1.jdcloud-oss.com/dongcc/DongCC-1.3.0.dmg

# 打开 DMG，拖拽到 Applications
```

**Windows**：
```bash
# 下载安装程序
wget https://joy-ai-test.s3-internal.cn-north-1.jdcloud-oss.com/dongcc/DongCC%20Setup%201.3.0.exe

# 运行安装向导
```

### 5.2 配置京东云 API

1. 打开 DongCC，进入"配置管理"
2. 填写配置名称：`京东云-Production`
3. 输入 API Key：`pk-xxxxx`
4. 设置 Base URL：`http://ai-api.jdcloud.com/anthropic/v1`
5. 选择模型：`Claude-Opus-4.6` 或 `Claude-Sonnet-4.6`
6. 保存配置

### 5.3 启动服务

1. 回到"仪表盘"页面
2. 点击"启动服务"按钮
3. 等待状态变为"运行中"
4. 配置 Claude Code 使用本地代理：

```bash
# 设置环境变量
export ANTHROPIC_BASE_URL=http://localhost:8787
export ANTHROPIC_AUTH_TOKEN=your_api_key
```

---

## 六、技术亮点

### 6.1 多 API 格式支持

DongCC 支持三种 API 格式自动转换：

| 格式 | 说明 | 适用场景 |
|-----|------|---------|
| **Anthropic** | 原生 Messages API | Anthropic、京东云等兼容服务 |
| **Chat Completions** | OpenAI 标准格式 | OpenAI、Azure、DeepSeek 等 |
| **Responses** | Anthropic 新格式 | 需要 function calling 的场景 |

### 6.2 本地数据安全

所有敏感数据（API Key、配置信息）均存储在本地：

```typescript
// 使用 LowDB 本地数据库
const db = new Low(new JSONFile('dongcc.json'));

// API Key 加密存储
const encryptedKey = encrypt(apiKey, machineId);
```

### 6.3 实时监控

通过 IPC 通信实现主进程与渲染进程的实时数据同步：

```typescript
// 主进程：发送统计数据
ipcMain.on('get-stats', async (event) => {
  const stats = await db.read();
  event.reply('stats-update', stats);
});

// 渲染进程：接收更新
ipcRenderer.on('stats-update', (event, data) => {
  setStats(data);
});
```

---

## 七、实际应用场景

### 场景一：企业内部 AI 开发

某电商团队使用 DongCC 管理京东云 API：
- **配置管理**：为开发、测试、生产环境分别配置
- **成本控制**：实时监控 Token 消耗，避免超支
- **团队协作**：导出配置分享给团队成员

### 场景二：个人开发者多平台切换

自由开发者同时使用多个 AI 平台：
- **快速切换**：一键切换 OpenAI、DeepSeek、京东云
- **对话管理**：按项目分类保存对话历史
- **技能扩展**：通过 MCP 添加自定义功能

---

## 八、未来规划

### 短期目标（v1.4.0）

- [ ] 支持阿里云、腾讯云等国内云服务商
- [ ] 插件市场，方便发现和安装 MCP 插件
- [ ] 自动更新功能

### 中期目标（v2.0.0）

- [ ] AI 助手智能推荐配置
- [ ] 团队协作功能，共享配置和对话
- [ ] 高级数据分析，生成使用报告

### 长期愿景

成为**中国开发者使用 Claude Code 的首选工具**，打造完整的 AI 开发工具生态。

---

## 九、参与贡献

DongCC 是开源项目，欢迎所有形式的贡献！

```bash
# 克隆仓库
git clone https://coding.jd.com/atop-qa/dongcc.git

# 安装依赖
npm install

# 开发模式
npm run electron:dev

# 构建打包
npm run electron:build
```

### 技术栈

- **前端**：React 18 + TypeScript + Ant Design 5
- **桌面**：Electron 25
- **构建**：Vite + Electron Builder
- **状态**：Zustand + React Context
- **图表**：Recharts

---

## 十、结语

DongCC 的诞生源于我们自己使用 Claude Code 时的痛点。从 v1.0.0 的简单代理工具，到 v1.3.0 的跨平台综合管理工具，我们始终坚持**"让 AI 开发更简单"**的理念。

如果你也在使用 Claude Code，不妨试试 DongCC。一个工具，解决所有代理配置烦恼。

> **下载地址**：https://coding.jd.com/atop-qa/dongcc  
> **用户交流群**：10227860158（扫码加入）  
> **问题反馈**：https://coding.jd.com/atop-qa/dongcc/issues

---

**#ClaudeCode #AI开发工具 #Electron #代理服务 #大模型API**
