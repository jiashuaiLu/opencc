# 🎉 DongCC v1.3.0 正式发布 —— 跨平台支持 + 京东云集成

> **发布日期**：2026-04-25  
> **版本号**：v1.3.0  
> **适用平台**：macOS (Universal) / Windows (x64)  
> **下载地址**：https://coding.jd.com/atop-qa/dongcc

---

## 📢 重要通知

各位同事，DongCC 经过两个月的持续迭代，终于迎来了 v1.3.0 大版本更新！

本次更新带来了**跨平台支持**和**京东云 Anthropic 兼容 API** 两大核心能力，同时修复了多个稳定性问题。强烈推荐所有用户升级！

---

## ✨ 新版本亮点

### 1. 🖥️ Windows 平台正式支持

**不再只是 Mac 用户的专属！**

DongCC 现在全面支持 Windows 10/11 系统，使用 Windows 笔记本的同事也可以体验图形化管理 Claude Code 代理的便利。

| 平台 | 架构 | 文件大小 | 下载方式 |
|-----|------|---------|---------|
| macOS | Universal (Intel + Apple Silicon) | 122 MB | DMG 安装包 |
| Windows | x64 | 98 MB | EXE 安装程序 |

> 💡 **macOS 用户注意**：v1.3.0 升级为 Universal 架构，一个安装包同时支持 Intel 和 M 系列芯片，无需再区分版本下载。

---

### 2. ☁️ 京东云 Anthropic 兼容 API 支持

**国内访问 Claude Code 更稳定！**

DongCC v1.3.0 新增对京东云 Anthropic 兼容 API 的支持，配置方式：

```
Base URL: http://ai-api.jdcloud.com/anthropic/v1
API Format: Anthropic (默认)
模型选择: Claude-Opus-4.6 / Claude-Sonnet-4.6
```

**配置步骤**：
1. 打开 DongCC → 配置管理
2. 点击"新建配置"
3. 填写配置名称（如：京东云-Production）
4. 输入京东云 API Key
5. Base URL 填入 `http://ai-api.jdcloud.com/anthropic/v1`
6. 选择对应模型
7. 保存并启动服务

> ⚠️ **重要提示**：当前版本默认使用 Anthropic 格式，请确保 Base URL 路径包含 `/anthropic/v1`，否则可能导致请求失败。

---

### 3. 🔧 代理服务参数清理优化

**更智能的云端适配！**

针对不同云服务商对请求参数的差异要求，v1.3.0 增强了参数自动清理能力：

| 优化项 | 说明 |
|-------|------|
| tool_use ID 清理 | 自动移除不符合 `^[a-zA-Z0-9_-]+$` 的非法字符 |
| function_response 格式转换 | 自动将字符串转换为对象格式 |
| 空文本过滤 | 自动过滤空内容块，避免 400 错误 |
| thinking 参数适配 | 根据模型类型自动调整 thinking 配置 |

---

### 4. 🐛 问题修复

本次更新修复了以下问题：

- ✅ **工具调用 ID 格式验证** — 解决京东云 API 返回 `String should match pattern` 错误
- ✅ **空文本内容处理** — 修复 `text content blocks must be non-empty` 报错
- ✅ **function_response 格式** — 解决 `Invalid value at 'function_response.response'` 错误
- ✅ **默认 anthropic-version** — 自动添加 `2023-06-01` 版本头

---

## 📥 立即升级

### macOS 用户

```bash
# 方式一：官网下载
wget https://joy-ai-test.s3-internal.cn-north-1.jdcloud-oss.com/dongcc/DongCC-1.3.0.dmg

# 方式二：直接覆盖安装
# 下载后打开 DMG，拖拽到 Applications 覆盖旧版本
```

### Windows 用户

```bash
# 下载安装程序
wget https://joy-ai-test.s3-internal.cn-north-1.jdcloud-oss.com/dongcc/DongCC%20Setup%201.3.0.exe

# 运行安装向导，自动覆盖旧版本
```

---

## 📊 版本对比

| 功能 | v1.2.0 | v1.3.0 |
|-----|--------|--------|
| macOS 支持 | ✅ (仅 arm64) | ✅ (Universal) |
| Windows 支持 | ❌ | ✅ |
| 京东云 API | ❌ | ✅ |
| OpenAI API | ✅ | ✅ |
| DeepSeek API | ✅ | ✅ |
| JoyBuilder API | ✅ | ✅ |
| 参数自动清理 | 基础 | 增强 |
| 暗黑模式 | ✅ | ✅ |
| MCP 管理 | ✅ | ✅ |
| Skills 管理 | ✅ | ✅ |

---

## 🆘 常见问题

### Q1: macOS M 芯片用户需要重新下载吗？

**不需要**。v1.3.0 采用 Universal 架构，一个安装包同时支持 Intel 和 Apple Silicon。直接下载 `DongCC-1.3.0.dmg` 即可。

### Q2: 升级后之前的配置会丢失吗？

**不会**。配置数据存储在本地数据库中，升级应用不会删除已有配置。

### Q3: 使用京东云 API 时提示 "参数解析失败"？

请检查：
1. Base URL 是否为 `http://ai-api.jdcloud.com/anthropic/v1`
2. API Format 是否选择 "Anthropic"
3. API Key 是否正确（以 `pk-` 开头）

### Q4: Windows 安装时提示 "Windows 已保护你的电脑"？

点击 "更多信息" → "仍要运行" 即可。这是因为应用尚未进行 Windows 签名认证。

---

## 💬 反馈与支持

遇到问题或有功能建议？欢迎通过以下方式联系我们：

- **用户交流群**：10227860158（扫码加入）
- **问题反馈**：https://coding.jd.com/atop-qa/dongcc/issues
- **内部联系人**：ERP lujiashuai.1

---

## 🙏 致谢

感谢每一位使用 DongCC 的同事，是你们的反馈让这个项目不断进步！

特别感谢：
- 京东云团队提供的 Anthropic 兼容 API 支持
- 所有参与内测和提出宝贵建议的同事

---

## 📌 附件

- **更新日志完整版**：https://coding.jd.com/atop-qa/dongcc/blob/dongcc/CHANGELOG.md
- **使用文档**：https://coding.jd.com/atop-qa/dongcc/blob/dongcc/README.md
- **技术博客**：http://shendeng.jd.com/shendeng/article/detail/60392

---

**DongCC Team**  
2026-04-25

> 🚀 **让 AI 开发更简单**
