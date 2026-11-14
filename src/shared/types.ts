export type ApiFormat = 'chat-completions' | 'responses' | 'anthropic';

/** 模型 API 端点类型（来自网关 open-api，用于推断 wireApi：responses vs chat/completions） */
export interface ModelApiType {
  apiType: string;
  path: string;
}

export interface ModelConfig {
  id: string;
  name: string;
  modelId: string;
  // ── 路由元数据（来自网关 open-api，均可选，向后兼容）──
  // 代理层按「元数据优先、名字正则兜底」消费；老配置无这些字段则退回名字启发式。
  /** 网关协议族：OpenAI / Claude / Gemini / Other（推断 anthropic vs openai） */
  protocol?: string;
  /** 网关各 API 类型的 path（推断该走 /responses 还是 /chat/completions） */
  apiTypes?: ModelApiType[];
  /** 能力标签：文本生成 / 代码生成 / 图像理解 等（推断 vision，过滤媒体块） */
  capabilities?: string[];
}

export interface ClientConfig {
  apiKey: string;
  baseUrl: string;
  apiFormat: ApiFormat;
  models: ModelConfig[];
  defaultModel: string;
  /** 当前所选 Provider（jd_retail / jd_cloud / custom_*）；决定模型列表来源。 */
  providerId?: string;
}

export interface Config {
  id: string;
  name?: string;
  port: number;
  claude?: ClientConfig;
  codex?: ClientConfig;

  // Headroom（token 压缩代理）开关与地址；代理层与仪表盘在运行时读取。
  headroom?: {
    enabled: boolean;
    proxyUrl?: string;
    hfMirrorUrl?: string;
  };

  // Legacy flat fields — kept optional for backwards compat with old persisted data.
  // Migration code in DatabaseManager moves these into `claude` on first load.
  apiKey?: string;
  baseUrl?: string;
  models?: ModelConfig[];
  defaultModel?: string;
  apiFormat?: ApiFormat;
  isDefault?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface Log {
  id: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: Date;
  metadata?: any;
}

export interface Request {
  id: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  duration: number;
  status: 'success' | 'error';
  timestamp: Date;
  error?: string;
}

export interface Conversation {
  id: string;
  model: string;
  messages: Message[];
  totalTokens: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface Stats {
  totalRequests: number;
  successRate: number;
  totalTokens: number;
  avgDuration: number;
}

export interface Settings {
  autoStart: boolean;
  minimizeToTray: boolean;
  showNotification: boolean;
  logLevel: 'info' | 'warn' | 'error';
  logRetentionDays: number;
  theme?: {
    mode: 'light' | 'dark' | 'auto';
    customColors?: any;
  };
}

export interface ServiceStatus {
  running: boolean;
  uptime: number;
  totalRequests: number;
  successRate: number;
}

export interface UserInfo {
  avatar: string;
  erp: string;
  name: string;
  orgFullPath: string;
  organizationName: string;
  positionName: string;
}
