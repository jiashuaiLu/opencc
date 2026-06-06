export type ApiFormat = 'chat-completions' | 'responses' | 'anthropic';

export interface ModelConfig {
  id: string;
  name: string;
  modelId: string;
}

export interface ClientConfig {
  apiKey: string;
  baseUrl: string;
  apiFormat: ApiFormat;
  models: ModelConfig[];
  defaultModel: string;
}

export interface Config {
  id: string;
  name?: string;
  port: number;
  claude?: ClientConfig;
  codex?: ClientConfig;

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
  id: string;
  name: string;
  avatar?: string;
}
