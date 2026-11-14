import { Card, Row, Col, Statistic, Spin, message, Segmented, Tooltip } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  ApiOutlined,
  DollarOutlined,
  ThunderboltOutlined,
  DatabaseOutlined,
  CompressOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { useState, useEffect } from 'react';
import { fmtTokens } from '../../utils/format';

// 网关模型监控（API Key 用量）页面：「总 Token 消耗」tooltip 里的外链，展示网关侧完整消耗。
const TOKEN_MONITOR_URL = '';

interface UsageSummary {
  totalRequests: number;
  successRate: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalTokensSaved: number;
}

interface ServiceStatus {
  running: boolean;
  uptime: number;
}

interface UsageSummaryCardsProps {
  days: number;
  onRefresh?: () => void;
}

interface UsageSummaryCardsProps {
  days: number;
  refreshIntervalMs?: number;
  onRefresh?: () => void;
}

export default function UsageSummaryCards({ days, refreshIntervalMs = 30000, onRefresh }: UsageSummaryCardsProps) {
  const [initialLoading, setInitialLoading] = useState(true);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>({ running: false, uptime: 0 });
  const [headroomEnabled, setHeadroomEnabled] = useState(false);
  // 节省卡片视图:compression=压缩节省(headroom 真实删减的 token);cache=缓存节省(缓存读取量)。
  // Claude 走「缓存安全压缩」:为保护 Anthropic prompt cache,冻结已缓存的稳定前缀、只压每轮新增增量,
  // 故压缩节省通常较小,主要收益在缓存(前缀逐字节复用命中缓存,按约 0.1× 计费)。
  // Codex/GPT 缓存机制不同、无冻结前缀约束,能实打实删减更多 → 压缩节省数值更大。
  const [savingView, setSavingView] = useState<'compression' | 'cache'>('compression');
  const [summary, setSummary] = useState<UsageSummary>({
    totalRequests: 0,
    successRate: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    totalTokensSaved: 0,
  });

  useEffect(() => {
    loadData();
    if (refreshIntervalMs > 0) {
      const interval = setInterval(loadData, refreshIntervalMs);
      return () => clearInterval(interval);
    }
  }, [days, refreshIntervalMs]);

  const loadData = async () => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const startOfToday = Math.floor(today.getTime() / 1000);
      const startTime = days === 1 ? startOfToday : startOfToday - (days - 1) * 24 * 60 * 60;
      const data = await window.electronAPI.getUsageSummary(startTime, now);
      if (data) {
        setSummary(data);
      }

      const status = await window.electronAPI.getServiceStatus();
      setServiceStatus(status);

      const config = await window.electronAPI.getConfig('default');
      setHeadroomEnabled(config?.headroom?.enabled === true);
    } catch (error) {
      console.error('Failed to load summary:', error);
    } finally {
      setInitialLoading(false);
    }
  };

  const handleStartService = async () => {
    try {
      const config = await window.electronAPI.getConfig('default') as any;
      // 兼容新嵌套结构 {claude, codex} 与旧扁平结构
      const claude = config?.claude || (config?.apiKey ? {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      } : null);
      const codex = config?.codex;
      const hasValid = (claude && claude.apiKey && claude.baseUrl) || (codex && codex.apiKey && codex.baseUrl);
      if (!config || !hasValid) {
        message.error('请先在配置页面设置 API Key 和 Base URL');
        return;
      }
      // 仪表盘启动时默认启动所有服务
      config.startMode = 'all';
      await window.electronAPI.startService(config);
      setServiceStatus({ running: true, uptime: 0 });
      message.success('代理服务已启动');
    } catch (error) {
      message.error('启动服务失败');
    }
  };

  const handleStopService = async () => {
    try {
      await window.electronAPI.stopService();
      setServiceStatus({ running: false, uptime: 0 });
      message.success('代理服务已停止');
    } catch (error) {
      message.error('停止服务失败');
    }
  };


  if (initialLoading) {
    return (
      <div className="loading-container">
        <Spin size="large" />
      </div>
    );
  }

  // 总 Token 消耗 = 输入 + 输出 + 命中缓存。三者在 Anthropic usage 里是互不重叠的独立字段
  // （input=未命中的新输入、cache_read=命中缓存的读取量、output=输出），相加才是经 DongCC 路由的真实处理总量。
  // 缓存创建（cache_creation）属写入开销、单独在「命中缓存数」卡的副标题展示，不计入此总量。
  const totalTokens = summary.totalInputTokens + summary.totalOutputTokens + summary.totalCacheReadTokens;
  const totalCacheTokens = summary.totalCacheCreationTokens + summary.totalCacheReadTokens;

  // 「总 Token 消耗」悬浮说明：此处仅覆盖经 DongCC 代理路由的流量；网关侧完整消耗去模型监控看。
  const totalTokenTooltip = (
    <span>
      仅统计经 DongCC 代理路由产生的 Token（已含命中缓存）。<br />
      网关侧的完整消耗请前往
      <a
        onClick={(e) => { e.preventDefault(); window.electronAPI.openExternal(TOKEN_MONITOR_URL); }}
        style={{ color: '#69c0ff', marginLeft: 2 }}
      >
        模型监控
      </a>
      查看。
    </span>
  );

  // 节省卡片:headroom 开启时可切换压缩/缓存两种口径;未开启时仅显示缓存读取。
  const savingMode: 'compression' | 'cache' = headroomEnabled ? savingView : 'cache';
  const savingIsComp = savingMode === 'compression';
  const savingValue = savingIsComp ? (summary.totalTokensSaved || 0) : (summary.totalCacheReadTokens || 0);
  // 缓存视图恒为「命中缓存数」(原始缓存读取量,准确)。「缓存是主要节省来源」的叙事交给悬浮说明,
  // 不再叫「缓存节省」——避免与命中缓存数同值不同名造成"节省=读取"的误导。
  const savingTitle = savingIsComp ? '节省 Token' : '命中缓存数';
  const savingSubtext = savingIsComp
    ? (summary.totalTokensSaved > 0
        ? `压缩率 ${((1 - totalTokens / (totalTokens + summary.totalTokensSaved)) * 100).toFixed(0)}%`
        : '本期无压缩节省')
    : (summary.totalCacheReadTokens > 0
        ? `缓存创建: ${fmtTokens(summary.totalCacheCreationTokens || 0)}`
        : '暂无缓存');
  // 视图说明(悬浮提示):仅在开启 headroom 时显示;未开启时原缓存卡片不加说明。
  const savingTooltip = !headroomEnabled
    ? ''
    : (savingIsComp
        ? 'Headroom 为保护 Anthropic 缓存,只压缩每轮新增的增量、冻结已缓存的稳定前缀,故 Claude 的压缩节省通常较小;主要成本收益请看「缓存」口径。Codex/GPT 无此约束,压缩节省更大。'
        : 'Claude Code 每轮复用庞大的稳定前缀并命中缓存,是节省成本的主要来源。');

  return (
    <div className="summary-cards-container">
      {/* 服务状态卡片 */}
      <Card className="service-status-card">
        <Row gutter={16} align="middle">
          <Col span={12}>
            <Statistic
              title="服务状态"
              value={serviceStatus.running ? '运行中' : '已停止'}
              prefix={
                serviceStatus.running ? (
                  <CheckCircleOutlined style={{ color: '#52c41a' }} />
                ) : (
                  <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                )
              }
              valueStyle={{
                color: serviceStatus.running ? '#52c41a' : '#ff4d4f',
              }}
              className="service-status-value"
            />
          </Col>
          <Col span={12} style={{ textAlign: 'right' }}>
            {serviceStatus.running ? (
              <button
                onClick={handleStopService}
                className="service-status-btn btn-stop"
              >
                <PauseCircleOutlined /> 停止服务
              </button>
            ) : (
              <button
                onClick={handleStartService}
                className="service-status-btn btn-start"
              >
                <PlayCircleOutlined /> 启动全部服务
              </button>
            )}
          </Col>
        </Row>
      </Card>

      {/* 统计卡片 */}
      <Row gutter={16}>
        <Col span={6}>
          <Card hoverable className="stat-card">
            <Statistic
              title={
                <span className="stat-card-title" style={{ color: '#1890ff' }}>
                  <ApiOutlined />
                  总请求数
                </span>
              }
              value={summary.totalRequests}
              valueStyle={{ color: '#1890ff' }}
              className="stat-value"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card hoverable className="stat-card">
            <Statistic
              title={
                <span className="stat-card-title" style={{ color: '#52c41a' }}>
                  <DollarOutlined />
                  成功率
                </span>
              }
              value={summary.successRate}
              suffix="%"
              valueStyle={{ color: '#52c41a' }}
              className="stat-value"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card hoverable className="stat-card">
            <Statistic
              title={
                <Tooltip title={totalTokenTooltip}>
                  <span className="stat-card-title" style={{ color: '#fa8c16', cursor: 'help' }}>
                    <ThunderboltOutlined />
                    总 Token 消耗
                    <InfoCircleOutlined style={{ marginLeft: 4, fontSize: 12, opacity: 0.65 }} />
                  </span>
                </Tooltip>
              }
              value={fmtTokens(totalTokens)}
              valueStyle={{ color: '#fa8c16' }}
              className="stat-value"
            />
            <div className="stat-subtext">
              输入: {fmtTokens(summary.totalInputTokens)} / 输出: {fmtTokens(summary.totalOutputTokens)} / 命中缓存: {fmtTokens(summary.totalCacheReadTokens)}
            </div>
          </Card>
        </Col>
        <Col span={6}>
          <Card hoverable className="stat-card" style={{ position: 'relative' }}>
            {headroomEnabled && (
              <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1 }}>
                <Segmented
                  size="small"
                  value={savingView}
                  onChange={(v) => setSavingView(v as 'compression' | 'cache')}
                  options={[
                    { label: '压缩', value: 'compression' },
                    { label: '缓存', value: 'cache' },
                  ]}
                />
              </div>
            )}
            <Statistic
              title={
                savingTooltip ? (
                  <Tooltip title={savingTooltip}>
                    <span className="stat-card-title" style={{ color: '#13c2c2', cursor: 'help' }}>
                      {savingIsComp ? <CompressOutlined /> : <DatabaseOutlined />}
                      {savingTitle}
                    </span>
                  </Tooltip>
                ) : (
                  <span className="stat-card-title" style={{ color: '#13c2c2' }}>
                    {savingIsComp ? <CompressOutlined /> : <DatabaseOutlined />}
                    {savingTitle}
                  </span>
                )
              }
              value={fmtTokens(savingValue)}
              valueStyle={{ color: '#13c2c2' }}
              className="stat-value"
            />
            <div className="stat-subtext">{savingSubtext}</div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
