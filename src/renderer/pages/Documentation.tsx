import { Card, Typography, Collapse, Divider, Tag, Space, Alert } from 'antd';
import {
  RocketOutlined,
  ToolOutlined,
  BulbOutlined,
  CheckCircleOutlined,
  CodeOutlined,
  ApiOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  FileTextOutlined,
} from '@ant-design/icons';

const { Title, Paragraph, Text } = Typography;
const { Panel } = Collapse;

export default function Documentation() {
  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-title-group">
          <h1>使用文档</h1>
          <p>详细的使用指南和常见问题解答</p>
        </div>
      </div>

      <div className="page-content">
        <Alert
          message="使用 DongCC 前需要安装依赖"
          description="请确保您的系统已安装 Node.js 和 Claude Code"
          type="warning"
          showIcon
          style={{ marginBottom: 24 }}
        />

        {/* 环境要求 */}
        <Card
          className="content-card"
          title={
            <Space>
              <ToolOutlined />
              <span>环境要求</span>
            </Space>
          }
        >
          <Collapse accordion ghost>
            <Panel header="安装 Node.js" key="nodejs">
              <Paragraph>
                <Title level={5}>方式一：使用 NVM 安装（推荐）</Title>
                <div className="code-block">
{`# 安装 NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# 安装 Node.js
nvm install 16

# 使用 Node.js 16
nvm use 16

# 验证安装
node --version  # 应显示 v16.x.x
npm --version   # 应显示 8.x.x`}</div>
                
                <Title level={5} style={{ marginTop: 16 }}>方式二：使用 Homebrew 安装</Title>
                <div className="code-block">
{`# 安装 Node.js
brew install node@16

# 验证安装
node --version  # 应显示 v16.x.x
npm --version   # 应显示 8.x.x`}</div>
                
                <Title level={5} style={{ marginTop: 16 }}>方式三：官网下载安装</Title>
                <Paragraph>
                  访问 <a href="https://nodejs.org/" target="_blank">Node.js 官网</a> 下载安装包并安装。
                </Paragraph>
              </Paragraph>
            </Panel>

            <Panel header="安装 Claude Code" key="claude">
              <Paragraph>
                <Title level={5}>使用 npm 全局安装</Title>
                <div className="code-block">
{`# 安装 Claude Code
npm install -g @anthropic-ai/claude-code

# 验证安装
claude --version  # 应显示版本号`}</div>
                
                <Title level={5} style={{ marginTop: 16 }}>配置 Claude Code</Title>
                <Paragraph>
                  安装完成后，需要进行基础配置：
                  <div className="code-block" style={{ marginTop: 8 }}>
{`# 首次运行会提示输入 API Key
claude

# 或手动配置
export ANTHROPIC_API_KEY=your-api-key-here`}</div>
                </Paragraph>
              </Paragraph>
            </Panel>

            <Panel header="验证环境" key="verify">
              <Paragraph>
                <div className="code-block">
{`# 检查 Node.js 版本
node --version

# 检查 Claude Code 版本
claude --version

# 检查 npm 版本
npm --version`}</div>
                
                <Alert
                  message="提示"
                  description="如果命令无法识别，请确保已将 Node.js 和 Claude Code 添加到系统 PATH 中，或重启终端后再试。"
                  type="info"
                  showIcon
                  style={{ marginTop: 16 }}
                />
              </Paragraph>
            </Panel>
          </Collapse>
        </Card>

        {/* 快速开始 */}
        <Card
          className="content-card"
          title={
            <Space>
              <RocketOutlined />
              <span>快速开始</span>
            </Space>
          }
        >
          <Collapse accordion ghost>
            <Panel header="步骤 1: 配置代理服务" key="1">
              <Paragraph>
                <ul>
                  <li>打开 DongCC 应用，进入"配置管理"页面</li>
                  <li>填写配置信息：
                    <ul>
                      <li><Text code>配置名称</Text>: 例如 JoyBuilder-Production</li>
                      <li><Text code>API Key</Text>: 你的 API 密钥</li>
                      <li><Text code>服务提供商</Text>: 选择 JoyBuilder (京东云) 或其他</li>
                      <li><Text code>代理端口</Text>: 默认 8787</li>
                    </ul>
                  </li>
                  <li>点击"保存配置"</li>
                </ul>
              </Paragraph>
            </Panel>

            <Panel header="步骤 2: 启动代理服务" key="2">
              <Paragraph>
                <ul>
                  <li>回到"仪表盘"页面</li>
                  <li>点击"启动服务"按钮</li>
                  <li>等待服务启动完成（状态变为"运行中"）</li>
                  <li>DongCC 会自动配置 Claude Code</li>
                </ul>
              </Paragraph>
            </Panel>

            <Panel header="步骤 3: 使用 Claude Code" key="3">
              <Paragraph>
                <ul>
                  <li>配置完成后，直接使用 Claude Code：
                    <div className="code-block" style={{ marginTop: 8 }}>
                      cd /path/to/your_project_dir<br/>
                      cloude<br/>
                      /model GLM-5(推荐)<br/>
                      "你好，请帮我写一个 Python 函数"
                    </div>
                  </li>
                  <li style={{ marginTop: 8 }}>所有请求都会通过本地代理服务转发，一切行为在本地，绝对安全！</li>
                </ul>
              </Paragraph>
            </Panel>
          </Collapse>
        </Card>

        {/* 技术原理 */}
        <Card
          className="content-card"
          title={
            <Space>
              <BulbOutlined />
              <span>技术原理</span>
            </Space>
          }
        >
          <Title level={5}>架构设计</Title>
          <Paragraph>
            DongCC 采用 Electron + React + TypeScript 架构，实现了完整的桌面应用解决方案。
          </Paragraph>

          <Divider />

          <Title level={5}>核心流程</Title>
          <div className="code-block">
{`Claude Code 客户端
    ↓ (发送 Claude API 格式请求)
本地代理服务 (localhost:8787)
    ↓ (转换为 OpenAI API 格式)
实际 API 服务 (如 JoyBuilder、OpenAI)
    ↓ (返回响应)
本地代理服务
    ↓ (转换回 Claude API 格式)
Claude Code 客户端`}
          </div>

          <Divider />

          <Title level={5}>技术栈</Title>
          <Space wrap style={{ marginBottom: 16 }}>
            <Tag color="blue" icon={<CodeOutlined />}>Electron</Tag>
            <Tag color="cyan" icon={<CodeOutlined />}>React 18</Tag>
            <Tag color="geekblue" icon={<CodeOutlined />}>TypeScript</Tag>
            <Tag color="purple" icon={<ApiOutlined />}>Express</Tag>
            <Tag color="green" icon={<DatabaseOutlined />}>LowDB</Tag>
            <Tag color="orange" icon={<FileTextOutlined />}>Winston</Tag>
          </Space>

          <Collapse accordion ghost>
            <Panel header="主进程架构" key="main">
              <Paragraph>
                <ul>
                  <li><Text strong>代理服务器</Text>: Express + http-proxy-middleware</li>
                  <li><Text strong>数据库管理</Text>: LowDB (轻量级 JSON 数据库)</li>
                  <li><Text strong>日志系统</Text>: Winston (多级别日志记录)</li>
                  <li><Text strong>IPC 通信</Text>: 主进程与渲染进程通信桥梁</li>
                </ul>
              </Paragraph>
            </Panel>

            <Panel header="渲染进程架构" key="renderer">
              <Paragraph>
                <ul>
                  <li><Text strong>UI 框架</Text>: React 18 + Ant Design</li>
                  <li><Text strong>状态管理</Text>: Zustand</li>
                  <li><Text strong>路由管理</Text>: React Router</li>
                  <li><Text strong>数据可视化</Text>: Chart.js</li>
                </ul>
              </Paragraph>
            </Panel>

            <Panel header="数据存储" key="storage">
              <Paragraph>
                <ul>
                  <li><Text strong>配置数据</Text>: ~/.dongcc/data/dongcc.json</li>
                  <li><Text strong>日志文件</Text>: ~/.dongcc/logs/</li>
                  <li><Text strong>Claude 配置</Text>: ~/.claude/settings.json</li>
                </ul>
              </Paragraph>
            </Panel>
          </Collapse>
        </Card>

        {/* 常见问题 */}
        <Card
          className="content-card"
          title={
            <Space>
              <CheckCircleOutlined />
              <span>常见问题</span>
            </Space>
          }
        >
          <Collapse accordion ghost>
            <Panel header="Q: 如何检查代理服务是否正常运行？" key="q1">
              <Paragraph>
                <ul>
                  <li>在 DongCC 仪表盘查看服务状态</li>
                  <li>访问 <Text code>http://localhost:8787/health</Text></li>
                  <li>预期返回：<Text code>{'{"status":"ok","running":true}'}</Text></li>
                </ul>
              </Paragraph>
            </Panel>

            <Panel header="Q: 端口被占用怎么办？" key="q2">
              <Paragraph>
                <ul>
                  <li>检查端口占用：<Text code>lsof -i :8787</Text></li>
                  <li>关闭占用进程：<Text code>kill -9 {'<PID>'}</Text></li>
                  <li>或在 DongCC 配置页面修改端口</li>
                </ul>
              </Paragraph>
            </Panel>

            <Panel header="Q: 如何查看 Claude Code 配置？" key="q3">
              <Paragraph>
                <ul>
                  <li>配置文件路径：<Text code>~/.claude/settings.json</Text></li>
                  <li>查看命令：<Text code>cat ~/.claude/settings.json</Text></li>
                  <li>DongCC 会自动配置此文件</li>
                </ul>
              </Paragraph>
            </Panel>

            <Panel header="Q: API Key 如何获取？" key="q4">
              <Paragraph>
                <ul>
                  <li><Text strong>JoyBuilder</Text>: 访问京东云控制台</li>
                  <li><Text strong>OpenAI</Text>: https://platform.openai.com/api-keys</li>
                  <li><Text strong>DeepSeek</Text>: https://platform.deepseek.com/</li>
                </ul>
              </Paragraph>
            </Panel>
          </Collapse>
        </Card>

        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            如有问题或建议，请联系管理员：ERP: lujiashuai.1 | 邮箱: lujiashuai.1@jd.com
          </Text>
        </div>
      </div>
    </div>
  );
}
