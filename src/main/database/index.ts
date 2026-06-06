import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { McpServer, McpApps, McpServerSpec } from '../mcp/mcpService';
import { InstalledSkill, SkillApps, SkillRepo } from '../skills/skillService';

function localTimestamp(): string {
  const d = new Date();
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

interface HotSchema {
  logs: any[];
  requests: any[];
  conversations: any[];
}

export class DatabaseManager {
  private mainPath: string;
  private hotPath: string;
  private main: MainSchema;
  private hot: HotSchema;

  constructor() {
    const dataDir = path.join(os.homedir(), '.dongcc', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.mainPath = path.join(dataDir, 'dongcc.json');
    this.hotPath = path.join(dataDir, 'dongcc-hot.json');

    this.main = {
      configs: [],
      settings: {},
      mcpServers: [],
      skills: [],
      skillRepos: [],
    };

    this.hot = {
      logs: [],
      requests: [],
      conversations: [],
    };
  }

  async initialize(): Promise<void> {
    let needsMigration = false;

    // Load main data
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

        // Migrate: if old single-file format has hot data, extract it
        if (parsed.logs || parsed.requests || parsed.conversations) {
          needsMigration = true;
          this.hot = {
            logs: parsed.logs || [],
            requests: parsed.requests || [],
            conversations: parsed.conversations || [],
          };
        }
      } catch (error) {
        console.error('Failed to load main database, using defaults:', error);
      }
    }

    // Load hot data (only if no migration needed — migration data takes precedence)
    if (!needsMigration && fs.existsSync(this.hotPath)) {
      try {
        const content = fs.readFileSync(this.hotPath, 'utf-8');
        this.hot = JSON.parse(content);
      } catch (error) {
        console.error('Failed to load hot database, using defaults:', error);
        this.hot = { logs: [], requests: [], conversations: [] };
      }
    }

    this.migrateData();
    this.cleanExpiredData();

    if (needsMigration) {
      // Write split files and remove hot data from main
      this.writeHotSync();
      this.writeMainSync();
      console.log('[DB] Migrated hot data (logs/requests/conversations) to dongcc-hot.json');
    }

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
    const interval = 24 * 60 * 60 * 1000;
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
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    let changed = false;

    const origConvLen = this.hot.conversations.length;
    this.hot.conversations = this.hot.conversations.filter((c: any) => {
      if (!c.timestamp) return true;
      return new Date(c.timestamp) >= cutoff;
    });
    if (this.hot.conversations.length !== origConvLen) {
      changed = true;
      console.log(`[DB] Cleaned expired conversations: ${origConvLen} -> ${this.hot.conversations.length} (retention: ${retentionDays}d)`);
    }

    const origReqLen = this.hot.requests.length;
    this.hot.requests = this.hot.requests.filter((r: any) => {
      if (!r.timestamp) return true;
      return new Date(r.timestamp) >= cutoff;
    });
    if (this.hot.requests.length !== origReqLen) {
      changed = true;
      console.log(`[DB] Cleaned expired requests: ${origReqLen} -> ${this.hot.requests.length} (retention: ${retentionDays}d)`);
    }

    const origLogLen = this.hot.logs.length;
    this.hot.logs = this.hot.logs.filter((l: any) => {
      if (!l.timestamp) return true;
      return new Date(l.timestamp) >= cutoff;
    });
    if (this.hot.logs.length !== origLogLen) {
      changed = true;
      console.log(`[DB] Cleaned expired logs: ${origLogLen} -> ${this.hot.logs.length} (retention: ${retentionDays}d)`);
    }

    if (changed) {
      this.writeHotSync();
    }
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

  private async writeHot(): Promise<void> {
    return new Promise((resolve, reject) => {
      fs.writeFile(this.hotPath, JSON.stringify(this.hot, null, 2), 'utf-8', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private writeHotSync(): void {
    fs.writeFileSync(this.hotPath, JSON.stringify(this.hot, null, 2), 'utf-8');
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
    let logs = this.hot.logs;

    if (filter && filter.level) {
      logs = logs.filter((log: any) => log.level === filter.level);
    }

    if (filter && filter.search) {
      const search = filter.search.toLowerCase();
      logs = logs.filter((log: any) =>
        log.message && log.message.toLowerCase().includes(search)
      );
    }

    if (filter && filter.limit) {
      logs = logs.slice(-filter.limit);
    }

    return logs.map((log: any, index: number) => ({
      id: `log_${index}_${Date.now()}`,
      ...log,
    })).reverse();
  }

  async addLog(log: any): Promise<void> {
    this.hot.logs.push({
      timestamp: localTimestamp(),
      ...log,
    });

    if (this.hot.logs.length > 10000) {
      this.hot.logs = this.hot.logs.slice(-5000);
    }

    await this.writeHot();
  }

  async clearLogs(): Promise<void> {
    this.hot.logs = [];
    await this.writeHot();
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

    const requests = this.hot.requests.filter((r: any) =>
      new Date(r.timestamp) >= startDate
    );

    const totalRequests = requests.length;
    const successRequests = requests.filter((r: any) => r.success).length;

    const totalInputTokens = requests.reduce((sum: number, r: any) =>
      sum + (r.inputTokens || 0), 0
    );
    const totalOutputTokens = requests.reduce((sum: number, r: any) =>
      sum + (r.outputTokens || 0), 0
    );

    const totalDuration = requests.reduce((sum: number, r: any) =>
      sum + (r.duration || 0), 0
    );

    return {
      totalRequests,
      successRate: totalRequests > 0
        ? Math.round((successRequests / totalRequests) * 100)
        : 0,
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      avgDuration: totalRequests > 0
        ? Math.round(totalDuration / totalRequests)
        : 0,
    };
  }

  // --- Requests ---

  async addRequest(request: any): Promise<void> {
    const entry: any = {
      method: request.method,
      url: request.url,
      statusCode: request.statusCode,
      duration: request.duration,
      model: request.model,
      inputTokens: request.inputTokens,
      outputTokens: request.outputTokens,
      cacheReadTokens: request.cacheReadTokens,
      cacheCreationTokens: request.cacheCreationTokens,
      isStreaming: request.isStreaming,
      success: request.success,
      timestamp: localTimestamp(),
    };
    if (request.errorMessage) {
      entry.errorMessage = request.errorMessage;
    }
    this.hot.requests.push(entry);

    if (this.hot.requests.length > 10000) {
      this.hot.requests = this.hot.requests.slice(-5000);
    }

    await this.writeHot();
  }

  // --- Conversations ---

  async getConversations(limit?: number): Promise<any[]> {
    let conversations = this.hot.conversations;

    if (limit) {
      conversations = conversations.slice(-limit);
    }

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
        totalTokens: (conv.inputTokens || 0) + (conv.outputTokens || 0),
        createdAt: conv.timestamp,
        messages,
      };
    }).reverse();
  }

  async addConversation(conversation: any): Promise<void> {
    this.hot.conversations.push({
      id: conversation.id,
      model: conversation.model,
      inputTokens: conversation.inputTokens,
      outputTokens: conversation.outputTokens,
      cacheReadTokens: conversation.cacheReadTokens,
      cacheCreationTokens: conversation.cacheCreationTokens,
      duration: conversation.duration,
      request: conversation.request,
      response: conversation.response,
      timestamp: localTimestamp(),
    });

    if (this.hot.conversations.length > 1000) {
      this.hot.conversations = this.hot.conversations.slice(-500);
    }

    await this.writeHot();
  }

  async deleteConversation(id: string): Promise<void> {
    this.hot.conversations = this.hot.conversations.filter(
      (c: any) => c.id !== id
    );
    await this.writeHot();
  }

  async deleteAllConversations(): Promise<void> {
    this.hot.conversations = [];
    await this.writeHot();
  }

  // --- Settings ---

  async getSettings(): Promise<any> {
    return this.main.settings;
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
    this.hot.logs = [];
    this.hot.requests = [];
    await this.writeHot();
  }

  // --- Usage ---

  async getUsageSummary(startDate?: number, endDate?: number): Promise<any> {
    const now = new Date();
    const start = startDate ? new Date(startDate * 1000) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = endDate ? new Date(endDate * 1000) : now;

    const requests = this.hot.requests.filter((r: any) => {
      const timestamp = new Date(r.timestamp);
      return timestamp >= start && timestamp <= end;
    });

    const totalRequests = requests.length;
    const successRequests = requests.filter((r: any) => r.success).length;

    const totalInputTokens = requests.reduce((sum: number, r: any) => sum + (r.inputTokens || 0), 0);
    const totalOutputTokens = requests.reduce((sum: number, r: any) => sum + (r.outputTokens || 0), 0);
    const totalCacheCreationTokens = requests.reduce((sum: number, r: any) => sum + (r.cacheCreationTokens || 0), 0);
    const totalCacheReadTokens = requests.reduce((sum: number, r: any) => sum + (r.cacheReadTokens || 0), 0);

    return {
      totalRequests,
      totalCost: '0',
      totalInputTokens,
      totalOutputTokens,
      totalCacheCreationTokens,
      totalCacheReadTokens,
      successRate: totalRequests > 0 ? Math.round((successRequests / totalRequests) * 100) : 0,
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

    this.hot.requests.forEach((r: any) => {
      const timestamp = new Date(r.timestamp);
      if (timestamp >= start && timestamp <= end) {
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
      }
    });

    return Array.from(trends.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  async getModelStats(): Promise<any[]> {
    const modelMap: Map<string, any> = new Map();

    this.hot.requests.forEach((r: any) => {
      const model = r.model || 'unknown';
      const existing = modelMap.get(model) || {
        model,
        requestCount: 0,
        totalTokens: 0,
        totalCost: '0',
      };

      existing.requestCount += 1;
      existing.totalTokens += (r.inputTokens || 0) + (r.outputTokens || 0);
      modelMap.set(model, existing);
    });

    const stats = Array.from(modelMap.values());
    stats.forEach((s) => {
      s.avgCostPerRequest = '0';
    });

    return stats.sort((a, b) => b.requestCount - a.requestCount);
  }

  async getRequestLogs(filters: any, page: number = 0, pageSize: number = 20): Promise<any> {
    let logs = [...this.hot.requests];

    if (filters.model) {
      logs = logs.filter((l: any) => l.model?.toLowerCase().includes(filters.model.toLowerCase()));
    }
    if (filters.statusCode) {
      logs = logs.filter((l: any) => l.statusCode === filters.statusCode);
    }
    if (filters.startDate) {
      const start = new Date(filters.startDate * 1000);
      logs = logs.filter((l: any) => new Date(l.timestamp) >= start);
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate * 1000);
      logs = logs.filter((l: any) => new Date(l.timestamp) <= end);
    }

    const total = logs.length;

    logs.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const startIndex = page * pageSize;
    const paginatedLogs = logs.slice(startIndex, startIndex + pageSize);

    const data = paginatedLogs.map((r: any, index: number) => ({
      requestId: `req_${index}_${Date.now()}`,
      model: r.model || 'unknown',
      inputTokens: r.inputTokens || 0,
      outputTokens: r.outputTokens || 0,
      cacheReadTokens: r.cacheReadTokens || 0,
      cacheCreationTokens: r.cacheCreationTokens || 0,
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
    const sinceDate = new Date(since);
    const untilDate = new Date(until);

    const requests = this.hot.requests.filter((r: any) => {
      const ts = new Date(r.timestamp);
      return ts >= sinceDate && ts < untilDate;
    });

    const modelMap = new Map<string, {
      model: string;
      requests: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
    }>();

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheCreationTokens = 0;

    for (const r of requests) {
      const input = r.inputTokens || 0;
      const output = r.outputTokens || 0;
      const cacheRead = r.cacheReadTokens || 0;
      const cacheCreation = r.cacheCreationTokens || 0;

      totalInputTokens += input;
      totalOutputTokens += output;
      totalCacheReadTokens += cacheRead;
      totalCacheCreationTokens += cacheCreation;

      const model = r.model || 'unknown';
      const existing = modelMap.get(model);
      if (existing) {
        existing.requests += 1;
        existing.inputTokens += input;
        existing.outputTokens += output;
        existing.cacheReadTokens += cacheRead;
        existing.cacheCreationTokens += cacheCreation;
      } else {
        modelMap.set(model, {
          model,
          requests: 1,
          inputTokens: input,
          outputTokens: output,
          cacheReadTokens: cacheRead,
          cacheCreationTokens: cacheCreation,
        });
      }
    }

    return {
      totalRequests: requests.length,
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      totalCacheCreationTokens,
      modelBreakdown: Array.from(modelMap.values()),
    };
  }
}
