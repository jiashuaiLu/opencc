# OpenCC

<div align="center">

**OpenCC - Claude Code 代理服务管理工具（开源版）**

一个跨平台桌面应用，用于管理和监控 Claude Code 代理服务

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-2.0.0-green.svg)](package.json)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)](https://www.apple.com/macos)

</div>

---

## 📖 项目简介

OpenCC 是一个功能强大的跨平台桌面应用，旨在简化 Claude Code 代理服务的管理和监控。通过图形化界面，用户可以轻松配置代理服务、查看运行日志、监控 Token 消耗、管理对话历史等。

### ✨ 核心特性

- 🎯 **图形化配置** - 无需手动编辑配置文件，通过界面轻松配置代理服务
- 📊 **实时监控** - 实时查看运行日志、Token 消耗、请求统计
- 💬 **对话历史** - 查看和管理所有对话历史，支持搜索和导出
- 🔧 **环境检查** - 自动检测本地环境，确保依赖完整
- 📈 **数据统计** - 可视化展示 Token 消耗、请求耗时、成功率等数据
- 🎨 **极简设计** - 采用全新的极简主义设计系统，提供清晰的视觉层次和信息架构
- 🌓 **暗黑模式** - 原生支持深色模式，可跟随系统自动切换或手动设置
- 🔌 **插件管理** - 完善的 MCP (Model Context Protocol) 和 Skills 管理功能

---

## 🚀 快速开始

### 系统要求

- **操作系统**: macOS 10.15 (Catalina) 或更高版本
- **Node.js**: v16.0.0 或更高版本
- **Claude Code**: 已安装并配置

### 安装方式

#### 方式一：下载安装包（推荐）

1. 下载链接 [Releases]() 页面
2. 下载最新版本的 `OpenCC-x.x.x.dmg`
3. 双击打开 DMG 文件
4. 将应用拖拽到 Applications 文件夹
5. 打开 Applications 文件夹，双击启动应用

#### 方式二：从源码构建

```bash
# 1. 克隆仓库
git clone https://github.com/jiashuaiLu/opencc.git
cd OpenCC

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

### v1.1.0 (当前版本)

- [ ] 高级统计分析
- [ ] 多配置管理
- [ ] 配置导入/导出
- [ ] 自动更新功能

### v1.0.0 (已发布)

- [x] 基础框架搭建
- [x] 代理服务管理
- [x] 配置管理
- [x] 日志查看
- [x] 基础统计
- [x] 对话历史
- [x] MCP & Skills 管理
- [x] 全新 UI/UX 设计
- [x] 暗黑模式支持

### v1.2.0 (计划中)

- [ ] 性能优化
- [ ] 插件系统增强
- [ ] 主题定制增强

---

## 🔄 OpenCC vs CC Switch

| 对比维度 | OpenCC | CC Switch |
|---------|--------|-----------|
| **定位** | Claude Code 专用代理服务管理 | 多 CLI 工具配置切换器（Claude Code / Codex / Gemini CLI / OpenCode / OpenClaw） |
| **核心能力** | 本地代理服务器 + 请求转发 + 协议转换 | 配置文件写入 + 供应商切换 |
| **工作原理** | 启动本地 HTTP 代理，拦截并转发 API 请求，支持 Anthropic ↔ OpenAI 格式互转 | 直接修改各 CLI 工具的配置文件（settings.json / .env） |
| **模型管理** | 配置默认模型后 Claude Code 启动即生效，`/model` 热切换透传 | 供应商级别切换，需重启终端生效（Claude Code 除外） |
| **协议适配** | 内置 Anthropic / OpenAI Chat Completions 双格式代理，任何兼容接口均可接入 | 依赖上游 API 本身兼容目标 CLI 格式 |
| **监控统计** | Token 消耗、请求耗时、成功率、模型维度统计、度量看板 | 用量仪表盘（v3.8+ 新增） |
| **MCP / Skills** | 支持管理并同步到 Claude Code | 统一管理 4 个应用的 MCP / Skills，双向同步 |
| **代理/故障转移** | 单代理服务，稳定转发 | 内置本地代理热切换、自动故障转移、熔断器 |
| **平台支持** | macOS (Universal) + Windows | macOS + Windows + Linux |
| **技术栈** | Electron + React + TypeScript | Tauri 2 + React + Rust |
| **安装体积** | ~122 MB | ~15 MB（Tauri 原生） |
| **数据存储** | JSON 文件 (~/.opencc/) | SQLite (~/.cc-switch/) |
| **适用场景** | 企业内网 API 网关接入、需要协议转换、需要请求级监控和审计 | 多供应商频繁切换、多 CLI 工具统一管理、需要云同步配置 |

### 总结

- **选 OpenCC**：你需要协议转换（如 OpenAI 格式转 Anthropic 格式）、请求级监控统计、或需要一个本地代理层来统一管理 API 转发。
- **选 CC Switch**：你同时使用多个 AI CLI 工具（不只是 Claude Code），需要在多家第三方供应商之间频繁切换，或需要跨设备云同步配置。

---

## 🤝 贡献指南

我们欢迎所有形式的贡献！

### 如何贡献

1. clone 本仓库
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

- **erp**: lujiashuai.1

---

<div align="center">

**Made with ❤️ by OpenCC Team**

</div>
