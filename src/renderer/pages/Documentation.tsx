import { Card, Typography, Collapse, Tag, Space, Alert } from 'antd';
import {
  RocketOutlined,
  ToolOutlined,
  BulbOutlined,
  CheckCircleOutlined,
  CodeOutlined,
  ApiOutlined,
  DatabaseOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { memo } from 'react';

const { Title, Paragraph, Text } = Typography;
const { Panel } = Collapse;

function Documentation() {
  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-title-group">
          <h1>使用文档</h1>
          <p>使用指南和常见问题解答</p>
        </div>
      </div>

      <div className="page-content">
        <Alert
          message="使用 DongCC 前需要安装 Node.js 和 Claude Code"
          type="warning"
          showIcon
          style={{ marginBottom: 20, borderRadius: 10 }}
        />

        <Card className="content-card" title={<Space><ToolOutlined /><span>环境要求</span></Space>}>
          <Collapse accordion ghost expandIconPosition="end">
            <Panel header={<Text strong>安装 Node.js</Text>} key="nodejs">
              <div className="section-label" style={{ marginTop: 0 }}>方式一：NVM 安装（推荐）</div>
              <div className="code-block">
{`curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install 22
nvm use 22
node --version`}</div>

              <div className="section-label">方式二：Homebrew 安装</div>
              <div className="code-block">
{`brew install node@22
node --version`}</div>
            </Panel>

            <Panel header={<Text strong>安装 Claude Code</Text>} key="claude">
              <div className="code-block">
{`npm install -g @anthropic-ai/claude-code
claude --version`}</div>
              <div className="section-label">配置</div>
              <div className="code-block">
{`claude
# 或手动: export ANTHROPIC_API_KEY=your-key`}</div>
            </Panel>

            <Panel header={<Text strong>验证环境</Text>} key="verify">
              <div className="code-block">
{`node --version
claude --version
npm --version`}</div>
              <Alert
                message="如果命令无法识别，请重启终端或确认 PATH 配置"
                type="info"
                showIcon
                style={{ marginTop: 12, borderRadius: 8 }}
              />
            </Panel>
          </Collapse>
        </Card>

        <Card className="content-card" title={<Space><RocketOutlined /><span>快速开始</span></Space>}>
          <Collapse accordion ghost expandIconPosition="end">
            <Panel header={<Text strong>步骤 1: 配置代理服务</Text>} key="1">
              <Paragraph>
                <ul style={{ paddingLeft: 16, lineHeight: 2 }}>
                  <li>打开「配置管理」页面</li>
                  <li>填写 API Key、服务地址和端口</li>
                  <li>添加至少一个模型（如 Claude Sonnet 4.6）</li>
                  <li>点击「保存配置」</li>
                </ul>
              </Paragraph>
            </Panel>

            <Panel header={<Text strong>步骤 2: 启动代理服务</Text>} key="2">
              <Paragraph>
                <ul style={{ paddingLeft: 16, lineHeight: 2 }}>
                  <li>回到仪表盘，点击「启动服务」</li>
                  <li>等待状态变为"运行中"</li>
                  <li>DongCC 自动配置 Claude Code 连接</li>
                </ul>
              </Paragraph>
            </Panel>

            <Panel header={<Text strong>步骤 3: 使用 Claude Code</Text>} key="3">
              <div className="code-block">
{`cd /path/to/your-project
claude
"你好，请帮我写一个 Python 函数"`}</div>
              <Paragraph style={{ marginTop: 12, fontSize: 13 }}>
                所有请求通过本地代理转发，数据安全不出境。
              </Paragraph>
            </Panel>
          </Collapse>
        </Card>

        <Card className="content-card" title={<Space><BulbOutlined /><span>技术原理</span></Space>}>
          <div className="section-label" style={{ marginTop: 0 }}>核心架构</div>
          <div className="code-block" style={{ marginBottom: 16 }}>
{`Claude Code → 本地代理(localhost:8787) → API 服务(JoyBuilder/OpenAI)
           ← 格式转换 ← 响应返回`}</div>

          <div className="section-label">技术栈</div>
          <Space wrap>
            <Tag color="blue" icon={<CodeOutlined />}>Electron</Tag>
            <Tag color="cyan" icon={<CodeOutlined />}>React 18</Tag>
            <Tag color="geekblue" icon={<CodeOutlined />}>TypeScript</Tag>
            <Tag color="purple" icon={<ApiOutlined />}>Express</Tag>
            <Tag color="green" icon={<DatabaseOutlined />}>LowDB</Tag>
            <Tag color="orange" icon={<FileTextOutlined />}>Winston</Tag>
          </Space>
        </Card>

        <Card className="content-card" title={<Space><CheckCircleOutlined /><span>常见问题</span></Space>}>
          <Collapse accordion ghost expandIconPosition="end">
            <Panel header="代理服务是否正常运行？" key="q1">
              <div className="code-block">
{`# 访问健康检查端点
curl http://localhost:8787/health
# 返回: {"status":"ok","running":true}`}</div>
            </Panel>
            <Panel header="端口被占用？" key="q2">
              <div className="code-block">
{`lsof -i :8787
kill -9 <PID>
# 或在配置页面修改端口`}</div>
            </Panel>
            <Panel header="Claude Code 配置路径？" key="q3">
              <div className="code-block">
{`cat ~/.claude/settings.json
# DongCC 会自动配置此文件`}</div>
            </Panel>
          </Collapse>
        </Card>

        <div style={{ textAlign: 'center', padding: '12px 0' }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            问题或建议请联系：opencc@example.com
          </Text>
        </div>
      </div>
    </div>
  );
}

export default memo(Documentation);
