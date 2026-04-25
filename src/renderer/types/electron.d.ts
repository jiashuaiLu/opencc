import { Config, Log, Conversation, Stats, Settings, ServiceStatus } from '../../shared/types';

interface UsageSummary {
  totalRequests: number;
  totalCost: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  successRate: number;
}

interface DailyStats {
  date: string;
  requestCount: number;
  totalCost: string;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
}

interface ModelStats {
  model: string;
  requestCount: number;
  totalTokens: number;
  totalCost: string;
  avgCostPerRequest: string;
}

interface RequestLog {
  requestId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalCostUsd: string;
  isStreaming: boolean;
  latencyMs: number;
  durationMs: number;
  statusCode: number;
  errorMessage?: string;
  createdAt: number;
}

interface PaginatedLogs {
  data: RequestLog[];
  total: number;
  page: number;
  pageSize: number;
}

interface McpServerSpec {
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

interface McpApps {
  claude: boolean;
}

interface McpServer {
  id: string;
  name: string;
  server: McpServerSpec;
  apps: McpApps;
  description?: string;
  homepage?: string;
  docs?: string;
  tags?: string[];
}

interface McpPreset {
  id: string;
  name: string;
  tags?: string[];
  server: McpServerSpec;
  homepage?: string;
  docs?: string;
  description?: string;
}

interface SkillApps {
  claude: boolean;
}

interface InstalledSkill {
  id: string;
  name: string;
  description?: string;
  directory: string;
  repoOwner?: string;
  repoName?: string;
  repoBranch?: string;
  readmeUrl?: string;
  apps: SkillApps;
  installedAt: number;
  sourceType: 'global' | 'project';
  sourceProject?: string;
}

interface SkillRepo {
  owner: string;
  name: string;
  branch: string;
  enabled: boolean;
}

interface UnmanagedSkill {
  directory: string;
  name: string;
  description?: string;
  path: string;
  sourceType: 'global' | 'project';
  sourceProject?: string;
  foundIn: string[];
}

interface ProjectInfo {
  path: string;
  name: string;
  hasSkills: boolean;
}

interface DiscoverableSkill {
  key: string;
  name: string;
  description: string;
  directory: string;
  readmeUrl?: string;
  repoOwner: string;
  repoName: string;
  repoBranch: string;
}

declare global {
  interface Window {
    electronAPI: {
      getConfig: (id: string) => Promise<Config | null>;
      saveConfig: (config: Config) => Promise<{ success: boolean }>;
      listConfigs: () => Promise<Config[]>;
      deleteConfig: (id: string) => Promise<{ success: boolean }>;

      startService: (config: Config) => Promise<{ success: boolean }>;
      stopService: () => Promise<{ success: boolean }>;
      getServiceStatus: () => Promise<ServiceStatus>;

      getLogs: (filter: {
        level?: string;
        startTime?: Date;
        endTime?: Date;
        search?: string;
        limit?: number;
        offset?: number;
      }) => Promise<Log[]>;
      clearLogs: () => Promise<{ success: boolean }>;

      getStats: (period: string) => Promise<Stats>;

      getUsageSummary: (startDate?: number, endDate?: number) => Promise<UsageSummary>;
      getUsageTrends: (startDate?: number, endDate?: number) => Promise<DailyStats[]>;
      getModelStats: () => Promise<ModelStats[]>;
      getRequestLogs: (filters?: {
        model?: string;
        statusCode?: number;
        startDate?: number;
        endDate?: number;
      }, page?: number, pageSize?: number) => Promise<PaginatedLogs>;

      getConversations: (limit?: number) => Promise<Conversation[]>;
      deleteConversation: (id: string) => Promise<{ success: boolean }>;
      clearAllConversations: () => Promise<{ success: boolean }>;

      getSettings: () => Promise<Settings>;
      saveSettings: (settings: Settings) => Promise<{ success: boolean }>;
      resetSettings: () => Promise<{ success: boolean }>;
      clearCache: () => Promise<{ success: boolean }>;

      getMcpServers: () => Promise<McpServer[]>;
      saveMcpServer: (server: McpServer) => Promise<void>;
      deleteMcpServer: (id: string) => Promise<{ success: boolean }>;
      toggleMcpApp: (id: string, app: string, enabled: boolean) => Promise<void>;
      getMcpPresets: () => Promise<McpPreset[]>;
      importMcpFromClaude: () => Promise<{ count: number }>;

      getSkills: () => Promise<InstalledSkill[]>;
      saveSkill: (skill: InstalledSkill) => Promise<void>;
      deleteSkill: (id: string) => Promise<void>;
      toggleSkillApp: (id: string, app: string, enabled: boolean) => Promise<void>;
      scanUnmanagedSkills: () => Promise<UnmanagedSkill[]>;
      importSkill: (directory: string) => Promise<InstalledSkill | null>;
      importSkills: (directories: string[]) => Promise<InstalledSkill[]>;
      importSkillFromPath: (sourcePath: string, sourceType: 'global' | 'project', sourceProject?: string) => Promise<InstalledSkill | null>;
      promoteSkillToGlobal: (id: string) => Promise<InstalledSkill>;
      listProjectsWithSkills: () => Promise<ProjectInfo[]>;
      scanCustomProject: (projectPath: string) => Promise<UnmanagedSkill[]>;
      getSkillDirectory: (id: string) => Promise<{ dir: string; exists: boolean }>;
      getSkillRepos: () => Promise<SkillRepo[]>;
      saveSkillRepo: (repo: SkillRepo) => Promise<void>;
      deleteSkillRepo: (owner: string, name: string) => Promise<{ success: boolean }>;

      // New Skills APIs
      openZipFileDialog: () => Promise<string | null>;
      installSkillsFromZip: (filePath: string, currentApp?: 'claude') => Promise<InstalledSkill[]>;
      discoverSkills: () => Promise<DiscoverableSkill[]>;
      installSkillFromRepo: (skill: DiscoverableSkill, currentApp?: 'claude') => Promise<InstalledSkill>;

      openExternal: (url: string) => Promise<void>;
      openInFinder: (filePath: string) => Promise<{ success: boolean }>;

      calculateCost: (modelId: string, inputTokens: number, outputTokens: number, cacheCreationTokens?: number, cacheReadTokens?: number) => Promise<{ cost: number }>;
      getPricing: (modelId?: string) => Promise<any>;
      estimateMonthlyCost: (modelId: string, dailyInputTokens: number, dailyOutputTokens: number) => Promise<{ monthlyCost: number }>;

      exportToCSV: (data: any, filename: string) => Promise<void>;
      exportToExcel: (data: any, filename: string) => Promise<void>;
      exportToJson: (data: any, filename: string) => Promise<void>;
    };
  }
}

export {};
