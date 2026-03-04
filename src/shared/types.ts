export interface Config {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  port: number;
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
}

export interface ServiceStatus {
  running: boolean;
  uptime: number;
  totalRequests: number;
  successRate: number;
}
