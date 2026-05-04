# OpenCC

<div align="center">

**OpenCC - Claude Code 代理服务管理工具**

一个专为 macOS 设计的桌面应用，用于管理和监控 Claude Code 代理服务

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.4.0-green.svg)](package.json)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)](https://www.apple.com/macos)

</div>

---

## 📖 项目简介

OpenCC 是一个功能强大的 macOS/Windows 桌面应用，旨在简化 Claude Code 代理服务的管理和监控。通过图形化界面，用户可以轻松配置代理服务、查看运行日志、监控 Token 消耗、管理对话历史等。

### ✨ 核心特性

- 🎯 **图形化配置** - 无需手动编辑配置文件，通过界面轻松配置代理服务
- 📊 **实时监控** - 实时查看运行日志、Token 消耗（含缓存命中）、请求统计
- 💬 **对话历史** - 查看和管理所有对话历史，支持搜索和导出
- 🔧 **环境检查** - 自动检测本地环境，确保依赖完整
- 📈 **数据统计** - 可视化展示 Token 消耗、请求耗时、成功率等数据
- 🎨 **极简设计** - 采用全新的极简主义设计系统，提供清晰的视觉层次和信息架构
- 🌓 **暗黑模式** - 原生支持深色模式，可跟随系统自动切换或手动设置
- 🔌 **插件管理** - 完善的 MCP (Model Context Protocol) 和 Skills 管理功能
- 🔀 **默认模型** - 启动服务后 Claude Code 自动使用配置的默认模型，`/model` 命令热切换生效

---

## 🚀 快速开始

### 系统要求

- **操作系统**: macOS 10.15 (Catalina) 或更高版本 / Windows 10/11
- **Node.js**: v16.0.0 或更高版本
- **Claude Code**: 已安装并配置

### 安装方式

#### 方式一：下载安装包（推荐）

1. 访问官网下载页面
2. 下载最新版本的安装包
3. 双击打开安装文件
4. 将应用拖拽到 Applications 文件夹（macOS）或按向导安装（Windows）
5. 打开应用，开始使用

#### 方式二：从源码构建

```bash
# 1. 克隆仓库
git clone https://github.com/jiashuaiLu/opencc.git
cd opencc

# 2. 安装依赖
npm install

# 3. 开发模式运行
npm run electron:dev

# 4. 构建生产版本
npm run electron:build
```

---

## 📚 使用指南

### 1. 配置代理

首次使用时，需要进行基础配置：

1. 打开应用，进入"配置管理"页面
2. 输入配置名称（如："OpenAI-Production"）
3. 输入 API Key（例如：`sk-xxxxx`）
4. 选择或输入 Base URL（例如：`https://api.openai.com/v1`）
5. 设置代理端口（默认：8787）
6. 点击"保存配置"

### 2. 启动服务

配置完成后：

1. 回到"仪表盘"页面
2. 点击"启动服务"按钮
3. 等待服务启动完成（状态变为"运行中"）
4. 现在可以使用 Claude Code 了！

### 3. 查看日志

在"运行日志"页面可以：

- 查看实时运行日志
- 按级别过滤日志（INFO/WARN/ERROR）
- 搜索特定日志
- 导出日志文件

### 4. 查看统计

在"仪表盘"页面可以查看：

- 总请求数
- 成功率
- Token 消耗
- 平均响应时间

### 5. 管理对话历史

在"对话历史"页面可以：

- 查看所有对话记录
- 搜索特定对话
- 查看对话详情
- 删除历史记录

### 6. 插件管理

- **MCP 管理**: 配置和管理 Model Context Protocol 服务器
- **Skills 管理**: 管理和发现 Claude Code 技能插件，支持从 ZIP 安装、扫描本地目录或从仓库安装

---

## 🛠️ 开发指南

### 项目结构

```
opencc/
├── src/
│   ├── main/                 # Electron 主进程
│   │   ├── index.ts         # 主进程入口
│   │   ├── preload.ts       # Preload 脚本
│   │   ├── proxy/           # 代理服务
│   │   ├── database/        # 数据库
│   │   ├── logger/          # 日志系统
│   │   └── ipc/             # IPC 通信
│   ├── renderer/            # 渲染进程（React）
│   │   ├── index.tsx        # 渲染进程入口
│   │   ├── App.tsx          # 应用根组件
│   │   ├── pages/           # 页面组件
│   │   ├── components/      # 通用组件
│   │   ├── styles/          # 样式文件 (common.css, global.css 等)
│   │   ├── theme/           # 主题配置
│   │   └── context/         # React Context (ThemeContext 等)
│   └── shared/              # 共享代码
│       └── types.ts         # 类型定义
├── resources/               # 资源文件
│   └── icons/              # 应用图标
├── tests/                  # 测试文件
├── package.json           # 项目配置
├── tsconfig.json          # TypeScript 配置
├── vite.config.ts         # Vite 配置
├── DESIGN_SYSTEM.md       # 设计规范文档
└── README.md              # 项目文档
```

### 技术栈

- **前端框架**: React 18 + TypeScript
- **桌面框架**: Electron
- **UI 组件**: Ant Design 5
- **样式方案**: CSS Variables + Ant Design Token
- **状态管理**: Zustand + React Context
- **路由**: React Router
- **图表**: Recharts
- **数据库**: LowDB
- **日志**: Winston
- **构建工具**: Vite + Electron Builder

### 开发命令

```bash
# 开发模式
npm run dev                  # 启动 Vite 开发服务器
npm run electron:dev         # 启动 Electron 开发模式

# 构建
npm run build               # 构建前端代码
npm run electron:build      # 构建并打包应用

# 代码质量
npm run lint                # 运行 ESLint
npm run lint:fix            # 自动修复 ESLint 问题
npm run format              # 格式化代码
```

---

## 🎯 功能路线图

### v1.4.0 (当前版本)

- [x] 修复默认模型配置：启动后 Claude Code 自动使用 OpenCC 配置的默认模型（写入 `settings.json` 顶层 `model` 字段）
- [x] 代理服务器新增 `GET /v1/models` 端点，返回已配置模型列表
- [x] 缓存 token 统计（cache_read / cache_creation）
- [x] cache control 透传支持（text / image / tool_use / tool_result block）
- [x] thinking / redacted_thinking 块过滤（防止 Invalid signature 错误）
- [x] Skills 目录路径安全校验（防止路径遍历）
- [x] YAML frontmatter 多行块解析优化
- [x] 性能优化：管理页面组件 memo 化

### v1.3.0 (已发布)

- [x] 支持 Anthropic 兼容 API
- [x] 优化代理服务参数清理逻辑
- [x] 支持 macOS Universal 架构（Intel + Apple Silicon）
- [x] Windows 平台支持
- [x] 修复工具调用 ID 格式验证问题
- [x] 修复空文本内容处理

### v1.2.0 (已发布)

- [x] 配置优化：模型配置改为必填项，添加默认值和说明
- [x] UI 升级：优化 MCP 和 Skills 管理页面样式
- [x] Skill 管理：移除项目级 Skill 提升功能，符合官方设计
- [x] 度量看板：修复请求日志字段显示问题
- [x] 主题优化：非暗黑模式下菜单栏白色背景

### v1.1.0 (已发布)

- [x] MCP & Skills 管理
- [x] 全新 UI/UX 设计
- [x] 暗黑模式支持
- [x] 修复已知问题

### v1.0.0 (已发布)

- [x] 基础框架搭建
- [x] 代理服务管理
- [x] 配置管理
- [x] 日志查看
- [x] 基础统计
- [x] 对话历史
- [x] 使用文档
- [x] 应用资讯页面

---

## 🤝 贡献指南

我们欢迎所有形式的贡献！

### 如何贡献

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

### 代码规范

- 使用 TypeScript 编写代码
- 遵循 ESLint 规则
- 使用 Prettier 格式化代码
- 编写清晰的提交信息

---

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

---

## 🙏 致谢

感谢以下开源项目：

- [Electron](https://www.electronjs.org/)
- [React](https://react.dev/)
- [Ant Design](https://ant.design/)
- [Vite](https://vitejs.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [Recharts](https://recharts.org/)

---

## 📞 联系方式

- **GitHub**: [jiashuaiLu](https://github.com/jiashuaiLu)
- **项目仓库**: [https://github.com/jiashuaiLu/opencc](https://github.com/jiashuaiLu/opencc)

---

<div align="center">

**Made with ❤️ by OpenCC Team**

</div>
