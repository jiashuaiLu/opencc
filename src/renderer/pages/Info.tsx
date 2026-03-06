import { Card, Typography, Divider, Space, Tag, List } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';

const { Title, Paragraph, Text } = Typography;

export default function Info() {
  const features = [
    {
      title: '代理服务管理',
      description: '一键启动/停止代理服务，支持多种 API 服务提供商',
      status: 'stable',
    },
    {
      title: '配置管理',
      description: '图形化配置界面，支持多个配置方案，配置导入/导出',
      status: 'stable',
    },
    {
      title: '日志系统',
      description: '实时运行日志，多级别日志过滤，日志搜索和导出',
      status: 'stable',
    },
    {
      title: '监控统计',
      description: 'Token 消耗统计，请求耗时分析，成功率统计',
      status: 'stable',
    },
    {
      title: '对话历史',
      description: '查看和管理所有对话历史，支持搜索和导出',
      status: 'stable',
    },
    {
      title: '使用文档',
      description: '详细的使用指南和常见问题解答',
      status: 'stable',
    },
  ];

  const getStatusTag = (status: string) => {
    const statusMap: Record<string, { color: string; text: string }> = {
      stable: { color: 'green', text: '稳定' },
      beta: { color: 'blue', text: '测试' },
      dev: { color: 'orange', text: '开发中' },
    };
    const config = statusMap[status] || statusMap.stable;
    return <Tag color={config.color}>{config.text}</Tag>;
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <Title level={2}>
        <InfoCircleOutlined /> 应用资讯
      </Title>
      <Paragraph type="secondary">
        了解 OpenCC 的最新动态和功能特性
      </Paragraph>

      <Divider />

      {/* 功能特性 */}
      <Card
        title={
          <Space>
            <InfoCircleOutlined />
            <span>功能特性</span>
          </Space>
        }
        style={{ marginBottom: 24 }}
      >
        <List
          dataSource={features}
          renderItem={(item) => (
            <List.Item>
              <List.Item.Meta
                title={
                  <Space>
                    <Text strong>{item.title}</Text>
                    {getStatusTag(item.status)}
                  </Space>
                }
                description={item.description}
              />
            </List.Item>
          )}
        />
      </Card>

      {/* 版本信息 */}
      <Card
        title={
          <Space>
            <InfoCircleOutlined />
            <span>版本信息</span>
          </Space>
        }
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <Text strong>当前版本：</Text>
            <Tag color="blue">v1.0.0</Tag>
          </div>
          <div>
            <Text strong>技术栈：</Text>
            <Space wrap>
              <Tag color="geekblue">Electron 33</Tag>
              <Tag color="cyan">React 18</Tag>
              <Tag color="purple">TypeScript 5.5</Tag>
              <Tag color="green">Ant Design 5</Tag>
            </Space>
          </div>
          <div>
            <Text strong>支持平台：</Text>
            <Tag color="orange">macOS (Apple Silicon)</Tag>
          </div>
        </Space>
      </Card>
    </div>
  );
}
