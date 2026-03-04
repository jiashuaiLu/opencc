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
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <Title level={2}>
        <RocketOutlined /> DongCC 使用文档
      </Title>
      <Paragraph type="secondary">
        DongCC 是一个功能强大的 Claude Code 代理服务管理工具，帮助您轻松管理和监控代理服务。
      </Paragraph>

      <Divider />

      {/* 快速开始 */}
      <Card
        title={
          <Space>
            <RocketOutlined />
            <span>快速开始</span>
          </Space>
        }
        style={{ marginBottom: 24 }}
      >
        <Alert
          message="5分钟快速上手"
          description="按照以下步骤，快速配置并使用 DongCC"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />

        <Collapse accordion>
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
                  <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 4 }}>
                    cd /path/to/your_project_dir
                  </pre>
                  <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 4 }}>
                    cloude
                  </pre>
                  <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 4 }}>
                    /model GLM-5(推荐)
                  </pre>
                  <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 4 }}>
                    "你好，请帮我写一个 Python 函数"
                  </pre>
                </li>
                <li>所有请求都会通过本地代理服务转发，一切行为在本地，绝对安全！</li>
              </ul>
            </Paragraph>
          </Panel>
        </Collapse>
      </Card>

      {/* 技术原理 */}
      <Card
        title={
          <Space>
            <BulbOutlined />
            <span>技术原理</span>
          </Space>
        }
        style={{ marginBottom: 24 }}
      >
        <Title level={4}>架构设计</Title>
        <Paragraph>
          DongCC 采用 Electron + React + TypeScript 架构，实现了完整的桌面应用解决方案。
        </Paragraph>

        <Divider />

        <Title level={4}>核心流程</Title>
        <div style={{ background: '#f5f5f5', padding: 16, borderRadius: 8, marginBottom: 16 }}>
          <pre style={{ margin: 0 }}>
{`Claude Code 客户端
    ↓ (发送 Claude API 格式请求)
本地代理服务 (localhost:8787)
    ↓ (转换为 OpenAI API 格式)
实际 API 服务 (如 JoyBuilder、OpenAI)
    ↓ (返回响应)
本地代理服务
    ↓ (转换回 Claude API 格式)
Claude Code 客户端`}
          </pre>
        </div>

        <Divider />

        <Title level={4}>技术栈</Title>
        <Space wrap style={{ marginBottom: 16 }}>
          <Tag color="blue" icon={<CodeOutlined />}>Electron</Tag>
          <Tag color="cyan" icon={<CodeOutlined />}>React 18</Tag>
          <Tag color="geekblue" icon={<CodeOutlined />}>TypeScript</Tag>
          <Tag color="purple" icon={<ApiOutlined />}>Express</Tag>
          <Tag color="green" icon={<DatabaseOutlined />}>LowDB</Tag>
          <Tag color="orange" icon={<FileTextOutlined />}>Winston</Tag>
        </Space>

        <Collapse accordion style={{ marginTop: 16 }}>
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

      {/* 功能特性 */}
      <Card
        title={
          <Space>
            <ToolOutlined />
            <span>功能特性</span>
          </Space>
        }
        style={{ marginBottom: 24 }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Card type="inner" title={<Space><CloudServerOutlined />代理服务管理</Space>}>
            <ul>
              <li><CheckCircleOutlined style={{ color: '#52c41a' }} /> 一键启动/停止代理服务</li>
              <li><CheckCircleOutlined style={{ color: '#52c41a' }} /> 支持多种 API 服务提供商</li>
              <li><CheckCircleOutlined style={{ color: '#52c41a' }} /> 自动配置 Claude Code</li>
              <li><CheckCircleOutlined style={{ color: '#52c41a' }} /> 实时监控服务状态</li>
            </ul>
          </Card>

          <Card type="inner" title={<Space><DatabaseOutlined />配置管理</Space>}>
            <ul>
              <li><CheckCircleOutlined style={{ color: '#52c41a' }} /> 图形化配置界面</li>
              <li><CheckCircleOutlined style={{ color: '#52c41a' }} /> 支持多个配置方案</li>
              <li><CheckCircleOutlined style={{ color: '#52c41a' }} /> 配置导入/导出</li>
              <li><CheckCircleOutlined style={{ color: '#52c41a' }} /> 连接测试功能</li>
            </ul>
          </Card>

          <Card type="inner" title={<Space><FileTextOutlined />日志系统</Space>}>
            <ul>
              <li><CheckCircleOutlined style={{ color: '#52c41a' }} /> 实时运行日志</li>
              <li><CheckCircleOutlined style={{ color: '#52c41a' }} /> 多级别日志过滤</li>
              <li><CheckCircleOutlined style={{ color: '#52c41a' }} /> 日志搜索功能</li>
              <li><CheckCircleOutlined style={{ color: '#52c41a' }} /> 日志导出功能</li>
            </ul>
          </Card>

          <Card type="inner" title={<Space><ApiOutlined />监控统计</Space>}>
            <ul>
              <li><CheckCircleOutlined style={{ color: '#52c41a' }} /> Token 消耗统计</li>
              <li><CheckCircleOutlined style={{ color: '#52c41a' }} /> 请求耗时分析</li>
              <li><CheckCircleOutlined style={{ color: '#52c41a' }} /> 成功率统计</li>
              <li><CheckCircleOutlined style={{ color: '#52c41a' }} /> 数据可视化图表</li>
            </ul>
          </Card>
        </Space>
      </Card>

      {/* 使用场景 */}
      <Card
        title={
          <Space>
            <RocketOutlined />
            <span>使用场景</span>
          </Space>
        }
        style={{ marginBottom: 24 }}
      >
        <Collapse accordion>
          <Panel header="场景 1: 使用 JoyBuilder (京东云)" key="joybuilder">
            <Paragraph>
              <ul>
                <li>配置：
                  <ul>
                    <li>API Key: 你的京东云 API Key</li>
                    <li>服务提供商: JoyBuilder (京东云)</li>
                    <li>API 端点: http://ai-api.jdcloud.com/v1</li>
                  </ul>
                </li>
                <li>优势：国内访问速度快，稳定可靠</li>
              </ul>
            </Paragraph>
          </Panel>

          <Panel header="场景 2: 使用 OpenAI" key="openai">
            <Paragraph>
              <ul>
                <li>配置：
                  <ul>
                    <li>API Key: 你的 OpenAI API Key</li>
                    <li>服务提供商: OpenAI</li>
                    <li>API 端点: https://api.openai.com/v1</li>
                  </ul>
                </li>
                <li>优势：官方 API，功能最全</li>
              </ul>
            </Paragraph>
          </Panel>

          <Panel header="场景 3: 使用本地 Ollama" key="ollama">
            <Paragraph>
              <ul>
                <li>前提：已安装并运行 Ollama</li>
                <li>配置：
                  <ul>
                    <li>API Key: ollama (任意字符串)</li>
                    <li>服务提供商: Ollama (本地)</li>
                    <li>API 端点: http://localhost:11434/v1</li>
                  </ul>
                </li>
                <li>优势：完全免费，离线使用</li>
              </ul>
            </Paragraph>
          </Panel>
        </Collapse>
      </Card>

      {/* 常见问题 */}
      <Card
        title={
          <Space>
            <CheckCircleOutlined />
            <span>常见问题</span>
          </Space>
        }
      >
        <Collapse accordion>
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
    </div>
  );
}
