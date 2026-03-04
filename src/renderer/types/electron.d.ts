import { Config, Log, Request, Conversation, Stats, Settings, ServiceStatus } from './shared/types';

declare global {
  interface Window {
    electronAPI: {
      // 配置相关
      getConfig: (id: string) => Promise<Config | null>;
      saveConfig: (config: Config) => Promise<{ success: boolean }>;
      listConfigs: () => Promise<Config[]>;
      deleteConfig: (id: string) => Promise<{ success: boolean }>;
      
      // 服务控制
      startService: (config: Config) => Promise<{ success: boolean }>;
      stopService: () => Promise<{ success: boolean }>;
      getServiceStatus: () => Promise<ServiceStatus>;
      
      // 日志相关
      getLogs: (filter: {
        level?: string;
        startTime?: Date;
        endTime?: Date;
        search?: string;
        limit?: number;
        offset?: number;
      }) => Promise<Log[]>;
      clearLogs: () => Promise<{ success: boolean }>;
      
      // 统计相关
      getStats: (period: string) => Promise<Stats>;
      
      // 对话历史相关
      getConversations: (limit?: number) => Promise<Conversation[]>;
      deleteConversation: (id: string) => Promise<{ success: boolean }>;
      
      // 设置相关
      getSettings: () => Promise<Settings>;
      saveSettings: (settings: Settings) => Promise<{ success: boolean }>;
    };
  }
}

export {};
