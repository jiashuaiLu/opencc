import { Config, Log, Conversation, Stats, Settings, ServiceStatus, UserInfo } from '../../shared/types';

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

interface CommunitySkill {
  id: string;
  name: string;
  description: string;
  author: string;
  domain: string;
  tags: string[];
  npmPackage: string;
  installCommand: string;
  downloadCount: number;
  skillIconUrl?: string;
  authorAvatar?: string;
  docUrl?: string;
  createdAt: string;
  updatedAt: string;
}

interface CommunitySkillListResult {
  total: number;
  page: number;
  pageSize: number;
  list: CommunitySkill[];
}

interface CommunitySkillQuery {
  keyword?: string;
  tags?: string;
  domain?: string;
  page?: number;
  pageSize?: number;
}

declare global {
  interface Window {
    electronAPI: {
      getConfig: (id: string) => Promise<Config | null>;
      saveConfig: (config: Config) => Promise<{ success: boolean }>;
      listConfigs: () => Promise<Config[]>;
      deleteConfig: (id: string) => Promise<{ success: boolean }>;
      testConnection: (
        clientType: 'claude' | 'codex',
        port: number,
        clientCfg: { apiKey: string; baseUrl: string; apiFormat: 'chat-completions' | 'responses' | 'anthropic' }
      ) => Promise<{
        items: Array<{
          id: string;
          title: string;
          level: 'pass' | 'warn' | 'fail';
          detail?: string;
          problem?: string;
          fix?: string;
        }>;
        overall: 'pass' | 'warn' | 'fail';
      }>;

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
      deleteAllConversations: () => Promise<{ success: boolean }>;

      getSettings: () => Promise<Settings>;
      saveSettings: (settings: Settings) => Promise<{ success: boolean }>;
      resetSettings: () => Promise<{ success: boolean }>;
      clearCache: () => Promise<{ success: boolean }>;

      getMcpServers: () => Promise<McpServer[]>;
      saveMcpServer: (server: McpServer) => Promise<{ success: boolean }>;
      deleteMcpServer: (id: string) => Promise<{ success: boolean }>;
      toggleMcpApp: (id: string, app: string, enabled: boolean) => Promise<{ success: boolean }>;
      getMcpPresets: () => Promise<McpPreset[]>;
      importMcpFromClaude: () => Promise<{ count: number; servers: McpServer[] }>;

      getSkills: () => Promise<InstalledSkill[]>;
      saveSkill: (skill: InstalledSkill) => Promise<{ success: boolean }>;
      deleteSkill: (id: string) => Promise<{ success: boolean }>;
      toggleSkillApp: (id: string, app: string, enabled: boolean) => Promise<{ success: boolean }>;
      scanUnmanagedSkills: () => Promise<UnmanagedSkill[]>;
      importSkill: (directory: string) => Promise<InstalledSkill | null>;
      importSkills: (directories: string[]) => Promise<InstalledSkill[]>;
      importSkillFromPath: (sourcePath: string, sourceType: 'global' | 'project', sourceProject?: string) => Promise<InstalledSkill | null>;
      listProjectsWithSkills: () => Promise<ProjectInfo[]>;
      scanCustomProject: (projectPath: string) => Promise<UnmanagedSkill[]>;
      getSkillDirectory: (id: string) => Promise<{ dir: string; exists: boolean }>;
      getSkillRepos: () => Promise<SkillRepo[]>;
      saveSkillRepo: (repo: SkillRepo) => Promise<void>;
      deleteSkillRepo: (owner: string, name: string) => Promise<{ success: boolean }>;

      // New Skills APIs
      openZipFileDialog: () => Promise<string | null>;
      installSkillsFromZip: (filePath: string, currentApp?: 'claude') => Promise<InstalledSkill[]>;
      installSkillsFromZipUrl: (url: string, currentApp?: 'claude') => Promise<InstalledSkill[]>;
      discoverSkills: () => Promise<DiscoverableSkill[]>;
      installSkillFromRepo: (skill: DiscoverableSkill, currentApp?: 'claude') => Promise<InstalledSkill>;
      installSkillByScript: (taskId: string, steps: { cmd: string; args: string[] }[]) => Promise<{ success: boolean; imported: number }>;
      getSkillInstallDir: () => Promise<string>;
      setSkillInstallDir: (dir: string) => Promise<{ success?: boolean; error?: string; message?: string }>;
      onInstallScriptLog: (handler: (data: { taskId: string; stream: 'stdout' | 'stderr' | 'meta'; line: string }) => void) => () => void;

      openExternal: (url: string) => Promise<void>;
      openInFinder: (filePath: string) => Promise<{ success: boolean }>;

      calculateCost: (modelId: string, inputTokens: number, outputTokens: number, cacheCreationTokens?: number, cacheReadTokens?: number) => Promise<{ cost: number }>;
      getPricing: (modelId?: string) => Promise<any>;
      estimateMonthlyCost: (modelId: string, dailyInputTokens: number, dailyOutputTokens: number) => Promise<{ monthlyCost: number }>;

      exportToCSV: (data: any, filename: string) => Promise<void>;
      exportToExcel: (data: any, filename: string) => Promise<void>;
      exportToJson: (data: any, filename: string) => Promise<void>;

      onServiceLog: (callback: (msg: string, level: string) => void) => void;
      removeServiceLogListener: () => void;

      checkForUpdates: () => Promise<{ available: boolean; version: string; currentVersion: string }>;
      downloadUpdate: () => Promise<{ success: boolean }>;
      installUpdate: () => void;
      getCurrentVersion: () => Promise<string>;
      onUpdateChecking: (callback: () => void) => void;
      onUpdateAvailable: (callback: (info: any) => void) => void;
      onUpdateNotAvailable: (callback: (info: any) => void) => void;
      onUpdateDownloadProgress: (callback: (progress: any) => void) => void;
      onUpdateDownloaded: (callback: (info: any) => void) => void;
      onUpdateError: (callback: (error: any) => void) => void;
      removeUpdateListeners: () => void;

      onRemoteNotice: (callback: (notice: { enabled: boolean; latestVersion: string; message: string; type: 'update' | 'info' | 'warning'; actionUrl?: string; dismissible?: boolean }) => void) => void;
      removeRemoteNoticeListener: () => void;
      getNotice: () => Promise<{ enabled: boolean; latestVersion: string; message: string; type: 'update' | 'info' | 'warning'; actionUrl?: string; dismissible?: boolean } | null>;

      getErp: () => Promise<string>;
      fetchRanking: (url: string) => Promise<any>;

      getUserInfo: () => Promise<UserInfo | null>;
      loginSSO: () => Promise<UserInfo | null>;
      onUserInfoUpdated: (callback: (info: UserInfo) => void) => void;
      removeUserInfoListener: () => void;

      getCommunitySkills: (query: CommunitySkillQuery) => Promise<CommunitySkillListResult>;
      publishCommunitySkill: (params: { name: string; description: string; npmPackage: string; installCommand: string; domain: string; tags: string[]; docUrl?: string; skillIconUrl?: string; authorAvatar?: string }) => Promise<CommunitySkill>;
      uploadSkillZip: (fileData: number[], fileName: string) => Promise<{ fileUrl: string }>;
      uploadSkillIcon: (fileData: number[], fileName: string) => Promise<{ fileUrl: string }>;
      installCommunitySkill: (skill: CommunitySkill) => Promise<{ success: boolean; imported: number }>;
      incrementCommunityDownload: (id: string) => Promise<number>;
      updateCommunitySkill: (id: string, params: { description?: string; domain?: string; tags?: string[]; docUrl?: string; skillIconUrl?: string }) => Promise<CommunitySkill>;
      deleteCommunitySkill: (id: string) => Promise<void>;
    };
  }
}

export {};
