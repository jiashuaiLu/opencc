import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { McpServer, McpApps, McpServerSpec } from '../mcp/mcpService';
import { InstalledSkill, SkillApps, SkillRepo } from '../skills/skillService';
import { HotStore } from './hotStore';

function localTimestamp(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

interface MainSchema {
  configs: any[];
  settings: any;
  mcpServers: McpServer[];
  skills: InstalledSkill[];
  skillRepos: SkillRepo[];
}

const MAX_LOGS = 50000;
const KEEP_LOGS = 25000;
const MAX_REQUESTS = 200000;
const KEEP_REQUESTS = 100000;
const MAX_CONVERSATIONS = 5000;
const KEEP_CONVERSATIONS = 2500;

export class DatabaseManager {
  private mainPath: string;
  private hotDbPath: string;
  private main: MainSchema;
  private hot!: HotStore;

  constructor() {
    const dataDir = path.join(os.homedir(), '.dongcc', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.mainPath = path.join(dataDir, 'dongcc.json');
    this.hotDbPath = path.join(dataDir, 'dongcc-hot.db');

    this.main = {
      configs: [],
      settings: {},
      mcpServers: [],
      skills: [],
      skillRepos: [],
    };
  }

  async initialize(): Promise<void> {
    try {
      this.hot = new HotStore(this.hotDbPath);
    } catch (error) {
      console.error('[DB] Failed to open SQLite hot store, retrying with fresh db:', error);
      try {
        if (fs.existsSync(this.hotDbPath)) fs.unlinkSync(this.hotDbPath);
        if (fs.existsSync(this.hotDbPath + '-wal')) fs.unlinkSync(this.hotDbPath + '-wal');
        if (fs.existsSync(this.hotDbPath + '-shm')) fs.unlinkSync(this.hotDbPath + '-shm');
        this.hot = new HotStore(this.hotDbPath);
      } catch (e2) {
        console.error('[DB] SQLite still failed, falling back to in-memory:', e2);
        this.hot = new HotStore(':memory:');
      }
    }

    if (fs.existsSync(this.mainPath)) {
      try {
        const content = fs.readFileSync(this.mainPath, 'utf-8');
        const parsed = JSON.parse(content);

        this.main = {
          configs: parsed.configs || [],
          settings: parsed.settings || {},
          mcpServers: parsed.mcpServers || [],
          skills: parsed.skills || [],
          skillRepos: parsed.skillRepos || [],
        };

        // 旧版本曾经把 hot 数据塞在 main 文件里，迁移到 SQLite
        if (parsed.logs || parsed.requests || parsed.conversations) {
          try {
            this.hot.bulkInsertLogs(parsed.logs || []);
            this.hot.bulkInsertRequests(parsed.requests || []);
            this.hot.bulkInsertConversations(parsed.conversations || []);
            console.log('[DB] Migrated inline hot data from dongcc.json into SQLite');
          } catch (e) {
            console.error('[DB] Inline hot migration failed', e);
          }
          delete (parsed as any).logs;
          delete (parsed as any).requests;
          delete (parsed as any).conversations;
          this.writeMainSync();
        }
      } catch (error) {
        console.error('Failed to load main database, using defaults:', error);
      }
    }

    this.migrateData();
    this.cleanExpiredData();

    this.startCleanupTimer();
  }


  private migrateData(): void {
    if (!this.main.mcpServers) {
      this.main.mcpServers = [];
    }
    if (!this.main.skills) {
      this.main.skills = [];
    }
    if (!this.main.skillRepos) {
      this.main.skillRepos = [];
    }

    const needsMcpMigration = this.main.mcpServers.some((s: any) => s.command !== undefined && s.server === undefined);
    if (needsMcpMigration) {
      this.main.mcpServers = this.main.mcpServers.map((oldServer: any) => {
        if (oldServer.server) return oldServer;

        const newServer: McpServer = {
          id: oldServer.id,
          name: oldServer.name || oldServer.id,
          server: {
            type: 'stdio' as const,
            command: oldServer.command || '',
            args: oldServer.args,
            env: oldServer.env,
          },
          apps: {
            claude: oldServer.enabled ?? false,
          },
          description: oldServer.description,
          homepage: oldServer.homepage,
          docs: oldServer.docs,
          tags: oldServer.tags,
        };
        return newServer;
      });
      this.writeMainSync();
      console.log('[DB] Migrated MCP servers to new format');
    }

    const needsSkillMigration = this.main.skills.some((s: any) => s.content !== undefined && s.directory === undefined);
    if (needsSkillMigration) {
      this.main.skills = this.main.skills.map((oldSkill: any) => {
        if (oldSkill.directory) return oldSkill;

        const newSkill: InstalledSkill = {
          id: oldSkill.id,
          name: oldSkill.name || oldSkill.id,
          description: oldSkill.description,
          directory: oldSkill.id,
          apps: {
            claude: oldSkill.enabled ?? false,
          },
          installedAt: oldSkill.installedAt || Math.floor(Date.now() / 1000),
          sourceType: 'global',
        };
        return newSkill;
      });
      this.writeMainSync();
      console.log('[DB] Migrated skills to new format');
    }

    const needsSourceTypeMigration = this.main.skills.some((s: any) => s.sourceType === undefined);
    if (needsSourceTypeMigration) {
      this.main.skills = this.main.skills.map((skill: any) => ({
        ...skill,
        sourceType: skill.sourceType || 'global',
      }));
      this.writeMainSync();
      console.log('[DB] Added sourceType to skills');
    }

    // Clean up unwanted default skills (legacy data)
    const skillsToRemove = ['代码审查助手', '前端架构师'];
    const unwantedSkills = this.main.skills.filter(s => skillsToRemove.includes(s.name));

    if (unwantedSkills.length > 0) {
      this.main.skills = this.main.skills.filter(s => !skillsToRemove.includes(s.name));
      this.writeMainSync();

      const skillsDir = path.join(os.homedir(), '.dongcc', 'skills');
      unwantedSkills.forEach(skill => {
        try {
          if (skill.directory) {
            const skillPath = path.join(skillsDir, skill.directory);
            if (fs.existsSync(skillPath)) {
              fs.rmSync(skillPath, { recursive: true, force: true });
              console.log(`[DB] Removed skill directory: ${skillPath}`);
            }
          }
        } catch (error) {
          console.error(`[DB] Failed to remove skill directory for ${skill.name}:`, error);
        }
      });

      console.log('[DB] Removed unwanted default skills from database');
    }

    // Add apiFormat to configs missing it
    const needsApiFormatMigration = this.main.configs.some((c: any) => c.apiFormat === undefined && !c.claude);
    if (needsApiFormatMigration) {
      this.main.configs = this.main.configs.map((config: any) => {
        if (config.claude) return config;
        return {
          ...config,
          apiFormat: config.apiFormat || 'chat-completions',
        };
      });
      this.writeMainSync();
      console.log('[DB] Added apiFormat to configs');
    }

    // Migrate flat config → nested { port, claude: {...} }
    const needsClaudeNesting = this.main.configs.some((c: any) => c.apiKey !== undefined && !c.claude);
    if (needsClaudeNesting) {
      this.main.configs = this.main.configs.map((config: any) => {
        if (config.claude) return config;
        const claude = {
          apiKey: config.apiKey || '',
          baseUrl: config.baseUrl || '',
          apiFormat: config.apiFormat || 'chat-completions',
          models: config.models || [],
          defaultModel: config.defaultModel || '',
        };
        return {
          id: config.id,
          name: config.name,
          port: config.port || 8787,
          claude,
        };
      });
      this.writeMainSync();
      console.log('[DB] Migrated flat configs to {claude} nested shape');
    }
  }

  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  startCleanupTimer(): void {
    if (this.cleanupTimer) return;
    const interval = 60 * 60 * 1000;
    this.cleanupTimer = setInterval(() => {
      this.cleanExpiredData();
    }, interval);
  }

  stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private cleanExpiredData(): void {
    const retentionDays = this.main.settings?.logRetentionDays || 7;
    const cutoffISO = localTimestamp(new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000));

    const removedConv = this.hot.deleteConversationsBefore(cutoffISO);
    if (removedConv > 0) {
      console.log(`[DB] Cleaned ${removedConv} expired conversations (retention: ${retentionDays}d)`);
    }
    const removedReq = this.hot.deleteRequestsBefore(cutoffISO);
    if (removedReq > 0) {
      console.log(`[DB] Cleaned ${removedReq} expired requests (retention: ${retentionDays}d)`);
    }
    const removedLog = this.hot.deleteLogsBefore(cutoffISO);
    if (removedLog > 0) {
      console.log(`[DB] Cleaned ${removedLog} expired logs (retention: ${retentionDays}d)`);
    }

    // 同时按行数硬上限兜底，防止突发流量打爆
    this.hot.trimLogs(MAX_LOGS, KEEP_LOGS);
    this.hot.trimRequests(MAX_REQUESTS, KEEP_REQUESTS);
    this.hot.trimConversations(MAX_CONVERSATIONS, KEEP_CONVERSATIONS);
  }


  // --- Write methods ---

  private async writeMain(): Promise<void> {
    return new Promise((resolve, reject) => {
      fs.writeFile(this.mainPath, JSON.stringify(this.main, null, 2), 'utf-8', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private writeMainSync(): void {
    fs.writeFileSync(this.mainPath, JSON.stringify(this.main, null, 2), 'utf-8');
  }

  close(): void {
    this.stopCleanupTimer();
    this.hot.close();
  }

  // --- Config ---

  async getConfig(id: string): Promise<any> {
    return this.main.configs.find((c: any) => c.id === id);
  }

  async saveConfig(config: any): Promise<void> {
    const index = this.main.configs.findIndex((c: any) => c.id === config.id);
    if (index >= 0) {
      this.main.configs[index] = config;
    } else {
      this.main.configs.push(config);
    }
    await this.writeMain();
  }

  async listConfigs(): Promise<any[]> {
    return this.main.configs;
  }

  async deleteConfig(id: string): Promise<void> {
    this.main.configs = this.main.configs.filter((c: any) => c.id !== id);
    await this.writeMain();
  }

  // --- Logs ---

  async getLogs(filter: any): Promise<any[]> {
    return this.hot.queryLogs({
      level: filter?.level,
      search: filter?.search,
      limit: filter?.limit,
    });
  }

  async addLog(log: any): Promise<void> {
    this.hot.insertLog({ timestamp: localTimestamp(), ...log });
    this.hot.trimLogs(MAX_LOGS, KEEP_LOGS);
  }

  async clearLogs(): Promise<void> {
    this.hot.clearLogs();
  }

  // --- Stats ---

  async getStats(period: string): Promise<any> {
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      default:
        startDate = new Date(0);
    }

    const agg = this.hot.aggregateRequestsSince(localTimestamp(startDate));
    return {
      totalRequests: agg.totalRequests,
      successRate: agg.totalRequests > 0
        ? Math.round((agg.successRequests / agg.totalRequests) * 100)
        : 0,
      totalInputTokens: agg.totalInputTokens,
      totalOutputTokens: agg.totalOutputTokens,
      totalTokens: agg.totalInputTokens + agg.totalOutputTokens,
      avgDuration: agg.totalRequests > 0
        ? Math.round(agg.totalDuration / agg.totalRequests)
        : 0,
    };
  }

  // --- Requests ---

  async addRequest(request: any): Promise<void> {
    this.hot.insertRequest({ ...request, timestamp: localTimestamp() });
    // 不每次 trim，避免热路径开销；交给 startCleanupTimer 周期清理
  }

  // --- Conversations ---

  async getConversations(limit?: number): Promise<any[]> {
    const conversations = this.hot.listConversations(limit);

    return conversations.map((conv: any) => {
      const messages: Array<{ role: string; content: string }> = [];

      if (conv.request?.messages) {
        for (const msg of conv.request.messages) {
          if (msg.role !== 'user' && msg.role !== 'assistant') continue;
          const content = typeof msg.content === 'string'
            ? msg.content
            : (msg.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
          if (content) {
            messages.push({ role: msg.role, content });
          }
        }
      }

      if (conv.response?.content) {
        const content = Array.isArray(conv.response.content)
          ? conv.response.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
          : String(conv.response.content || '');
        if (content) {
          messages.push({ role: 'assistant', content });
        }
      }

      return {
        id: conv.id,
        model: conv.model,
        messageCount: messages.length,
        inputTokens: conv.inputTokens || 0,
        outputTokens: conv.outputTokens || 0,
        cacheCreationTokens: conv.cacheCreationTokens || 0,
        totalTokens: (conv.inputTokens || 0) + (conv.outputTokens || 0),
        createdAt: conv.timestamp,
        messages,
      };
    });
  }

  async addConversation(conversation: any): Promise<void> {
    this.hot.insertConversation({ ...conversation, timestamp: localTimestamp() });
  }

  async deleteConversation(id: string): Promise<void> {
    this.hot.deleteConversation(id);
  }

  async deleteAllConversations(): Promise<void> {
    this.hot.clearConversations();
  }

  // --- Settings ---

  async getSettings(): Promise<any> {
    return this.getSettingsSync();
  }

  /** 同步读取合并默认值后的设置。内存数据本就是同步的，供 close 拦截等需同步决策的场景使用。 */
  getSettingsSync(): any {
    // 合并默认值：全新安装时 this.main.settings 为空对象，若直接返回会导致
    // UI 开关（如 minimizeToTray checked=undefined 显示"关"）与运行时默认（!== false 视为真）不一致。
    return {
      autoStart: false,
      minimizeToTray: true,
      showNotification: true,
      logLevel: 'info',
      logRetentionDays: 7,
      ...this.main.settings,
    };
  }

  async saveSettings(settings: any): Promise<void> {
    this.main.settings = { ...this.main.settings, ...settings };
    await this.writeMain();
  }

  async resetSettings(): Promise<void> {
    this.main.settings = {
      autoStart: false,
      minimizeToTray: true,
      showNotification: true,
      logLevel: 'info',
      logRetentionDays: 7,
    };
    await this.writeMain();
  }

  async clearCache(): Promise<void> {
    this.hot.clearLogs();
    this.hot.clearRequests();
  }

  // --- Usage ---

  async getUsageSummary(startDate?: number, endDate?: number): Promise<any> {
    const now = new Date();
    const start = startDate ? new Date(startDate * 1000) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = endDate ? new Date(endDate * 1000) : now;

    const agg = this.hot.aggregateRequestsBetween(localTimestamp(start), localTimestamp(end));

    return {
      totalRequests: agg.totalRequests,
      totalCost: '0',
      totalInputTokens: agg.totalInputTokens,
      totalOutputTokens: agg.totalOutputTokens,
      totalCacheCreationTokens: agg.totalCacheCreationTokens,
      totalCacheReadTokens: agg.totalCacheReadTokens,
      totalTokensSaved: agg.totalTokensSaved,
      successRate: agg.totalRequests > 0
        ? Math.round((agg.successRequests / agg.totalRequests) * 100)
        : 0,
    };
  }

  async getUsageTrends(startDate?: number, endDate?: number): Promise<any[]> {
    const now = new Date();
    const start = startDate ? new Date(startDate * 1000) : new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate * 1000) : now;

    const isToday = start.toDateString() === end.toDateString();
    const trends: Map<string, any> = new Map();

    if (isToday) {
      for (let i = 0; i < 24; i++) {
        const hourKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}T${String(i).padStart(2, '0')}:00`;
        trends.set(hourKey, {
          date: hourKey,
          requestCount: 0,
          totalCost: '0',
          totalTokens: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCacheCreationTokens: 0,
          totalCacheReadTokens: 0,
        });
      }
    } else {
      const current = new Date(start);
      current.setHours(0, 0, 0, 0);
      while (current <= end) {
        const key = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
        trends.set(key, {
          date: key,
          requestCount: 0,
          totalCost: '0',
          totalTokens: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCacheCreationTokens: 0,
          totalCacheReadTokens: 0,
        });
        current.setDate(current.getDate() + 1);
      }
    }

    const requests = this.hot.requestsBetween(localTimestamp(start), localTimestamp(end));
    requests.forEach((r: any) => {
      const timestamp = new Date(r.timestamp);
      const key = isToday
        ? `${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, '0')}-${String(timestamp.getDate()).padStart(2, '0')}T${String(timestamp.getHours()).padStart(2, '0')}:00`
        : `${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, '0')}-${String(timestamp.getDate()).padStart(2, '0')}`;

      const existing = trends.get(key);
      if (existing) {
        existing.requestCount += 1;
        existing.totalInputTokens += r.inputTokens || 0;
        existing.totalOutputTokens += r.outputTokens || 0;
        existing.totalCacheCreationTokens += r.cacheCreationTokens || 0;
        existing.totalCacheReadTokens += r.cacheReadTokens || 0;
        existing.totalTokens = existing.totalInputTokens + existing.totalOutputTokens;
      }
    });

    return Array.from(trends.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  async getModelStats(): Promise<any[]> {
    const stats = this.hot.modelStatsAll().map((s) => ({
      ...s,
      totalCost: '0',
      avgCostPerRequest: '0',
    }));
    return stats;
  }

  async getRequestLogs(filters: any, page: number = 0, pageSize: number = 20): Promise<any> {
    const { total, sql: whereSql, params } = this.hot.queryRequests(filters || {});
    const rows = this.hot.pageRequests(whereSql, params, page, pageSize);

    const data = rows.map((r: any) => ({
      requestId: `req_${r.id}`,
      model: r.model || 'unknown',
      inputTokens: r.inputTokens || 0,
      outputTokens: r.outputTokens || 0,
      cacheReadTokens: r.cacheReadTokens || 0,
      cacheCreationTokens: r.cacheCreationTokens || 0,
      tokensSaved: r.tokensSaved || 0,
      compressionRatio: r.compressionRatio || 0,
      totalCostUsd: '0',
      isStreaming: r.isStreaming || false,
      latencyMs: r.duration || 0,
      durationMs: r.duration || 0,
      statusCode: r.statusCode || (r.success ? 200 : 500),
      createdAt: Math.floor(new Date(r.timestamp).getTime() / 1000),
      errorMessage: r.errorMessage || undefined,
    }));

    return { data, total, page, pageSize };
  }

  // --- MCP Servers ---

  async getMcpServers(): Promise<McpServer[]> {
    return this.main.mcpServers || [];
  }

  async saveMcpServer(server: McpServer): Promise<void> {
    if (!this.main.mcpServers) {
      this.main.mcpServers = [];
    }
    const index = this.main.mcpServers.findIndex((s) => s.id === server.id);
    if (index >= 0) {
      this.main.mcpServers[index] = server;
    } else {
      this.main.mcpServers.push(server);
    }
    await this.writeMain();
  }

  async deleteMcpServer(id: string): Promise<void> {
    if (this.main.mcpServers) {
      this.main.mcpServers = this.main.mcpServers.filter((s) => s.id !== id);
      await this.writeMain();
    }
  }

  async toggleMcpApp(id: string, app: 'claude', enabled: boolean): Promise<McpServer | null> {
    if (this.main.mcpServers) {
      const index = this.main.mcpServers.findIndex((s) => s.id === id);
      if (index >= 0) {
        this.main.mcpServers[index].apps[app] = enabled;
        await this.writeMain();
        return this.main.mcpServers[index];
      }
    }
    return null;
  }

  // --- Skills ---

  async getSkills(): Promise<InstalledSkill[]> {
    return this.main.skills || [];
  }

  async saveSkill(skill: InstalledSkill): Promise<void> {
    if (!this.main.skills) {
      this.main.skills = [];
    }
    const index = this.main.skills.findIndex((s) => s.id === skill.id);
    if (index >= 0) {
      this.main.skills[index] = skill;
    } else {
      this.main.skills.push(skill);
    }
    await this.writeMain();
  }

  async deleteSkill(id: string): Promise<void> {
    console.log(`[DB] Deleting skill with id: ${id}`);
    if (this.main.skills) {
      const beforeCount = this.main.skills.length;
      this.main.skills = this.main.skills.filter((s) => s.id !== id);
      const afterCount = this.main.skills.length;
      console.log(`[DB] Skills count: ${beforeCount} -> ${afterCount}`);
      await this.writeMain();
      console.log(`[DB] Database written successfully`);
    }
  }

  async toggleSkillApp(id: string, app: 'claude', enabled: boolean): Promise<InstalledSkill | null> {
    if (this.main.skills) {
      const index = this.main.skills.findIndex((s) => s.id === id);
      if (index >= 0) {
        this.main.skills[index].apps[app] = enabled;
        await this.writeMain();
        return this.main.skills[index];
      }
    }
    return null;
  }

  async renameSkill(id: string, name: string): Promise<InstalledSkill | null> {
    if (this.main.skills) {
      const index = this.main.skills.findIndex((s) => s.id === id);
      if (index >= 0) {
        this.main.skills[index].name = name;
        await this.writeMain();
        return this.main.skills[index];
      }
    }
    return null;
  }

  // --- Skill Repos ---

  async getSkillRepos(): Promise<SkillRepo[]> {
    return this.main.skillRepos || [];
  }

  async saveSkillRepo(repo: SkillRepo): Promise<void> {
    if (!this.main.skillRepos) {
      this.main.skillRepos = [];
    }
    const index = this.main.skillRepos.findIndex((r) => r.owner === repo.owner && r.name === repo.name);
    if (index >= 0) {
      this.main.skillRepos[index] = repo;
    } else {
      this.main.skillRepos.push(repo);
    }
    await this.writeMain();
  }

  async deleteSkillRepo(owner: string, name: string): Promise<void> {
    if (this.main.skillRepos) {
      this.main.skillRepos = this.main.skillRepos.filter((r) => !(r.owner === owner && r.name === name));
      await this.writeMain();
    }
  }

  // --- Incremental Usage ---

  async getIncrementalUsage(since: string, until: string): Promise<{
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    totalCacheCreationTokens: number;
    modelBreakdown: Array<{
      model: string;
      requests: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
    }>;
  }> {
    return this.hot.incrementalUsage(since, until);
  }
}
