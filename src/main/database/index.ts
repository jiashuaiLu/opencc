import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { McpServer, McpApps, McpServerSpec } from '../mcp/mcpService';
import { InstalledSkill, SkillApps, SkillRepo } from '../skills/skillService';

interface DatabaseSchema {
  configs: any[];
  logs: any[];
  requests: any[];
  conversations: any[];
  settings: any;
  mcpServers: McpServer[];
  skills: InstalledSkill[];
  skillRepos: SkillRepo[];
}

export class DatabaseManager {
  private dbPath: string;
  private data: DatabaseSchema;

  constructor() {
    const dataDir = path.join(os.homedir(), '.opencc', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.dbPath = path.join(dataDir, 'opencc.json');

    this.data = {
      configs: [],
      logs: [],
      requests: [],
      conversations: [],
      settings: {},
      mcpServers: [],
      skills: [],
      skillRepos: [],
    };
  }

  async initialize(): Promise<void> {
    if (fs.existsSync(this.dbPath)) {
      try {
        const content = fs.readFileSync(this.dbPath, 'utf-8');
        this.data = JSON.parse(content);
        this.migrateData();
      } catch (error) {
        console.error('Failed to load database, using default data:', error);
      }
    }
  }

  private migrateData(): void {
    if (!this.data.mcpServers) {
      this.data.mcpServers = [];
    }
    if (!this.data.skills) {
      this.data.skills = [];
    }
    if (!this.data.skillRepos) {
      this.data.skillRepos = [];
    }

    const needsMigration = this.data.mcpServers.some((s: any) => s.command !== undefined && s.server === undefined);
    if (needsMigration) {
      this.data.mcpServers = this.data.mcpServers.map((oldServer: any) => {
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
      this.writeSync();
      console.log('[DB] Migrated MCP servers to new format');
    }

    const needsSkillMigration = this.data.skills.some((s: any) => s.content !== undefined && s.directory === undefined);
    if (needsSkillMigration) {
      this.data.skills = this.data.skills.map((oldSkill: any) => {
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
      this.writeSync();
      console.log('[DB] Migrated skills to new format');
    }

    const needsSourceTypeMigration = this.data.skills.some((s: any) => s.sourceType === undefined);
    if (needsSourceTypeMigration) {
      this.data.skills = this.data.skills.map((skill: any) => ({
        ...skill,
        sourceType: skill.sourceType || 'global',
      }));
      this.writeSync();
      console.log('[DB] Added sourceType to skills');
    }

    // Clean up unwanted default skills (legacy data)
    const skillsToRemove = ['代码审查助手', '前端架构师'];
    const unwantedSkills = this.data.skills.filter(s => skillsToRemove.includes(s.name));

    if (unwantedSkills.length > 0) {
      this.data.skills = this.data.skills.filter(s => !skillsToRemove.includes(s.name));
      this.writeSync();

      // Also try to remove the physical files to prevent them from reappearing as unmanaged
      const skillsDir = path.join(os.homedir(), '.opencc', 'skills');
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
    const needsApiFormatMigration = this.data.configs.some((c: any) => c.apiFormat === undefined);
    if (needsApiFormatMigration) {
      this.data.configs = this.data.configs.map((config: any) => ({
        ...config,
        apiFormat: config.apiFormat || 'chat-completions',
      }));
      this.writeSync();
      console.log('[DB] Added apiFormat to configs');
    }
  }

  private async write(): Promise<void> {
    return new Promise((resolve, reject) => {
      fs.writeFile(this.dbPath, JSON.stringify(this.data, null, 2), 'utf-8', (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  private writeSync(): void {
    fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  async getConfig(id: string): Promise<any> {
    return this.data.configs.find((c: any) => c.id === id);
  }

  async saveConfig(config: any): Promise<void> {
    const index = this.data.configs.findIndex((c: any) => c.id === config.id);
    if (index >= 0) {
      this.data.configs[index] = config;
    } else {
      this.data.configs.push(config);
    }
    await this.write();
  }

  async listConfigs(): Promise<any[]> {
    return this.data.configs;
  }

  async deleteConfig(id: string): Promise<void> {
    this.data.configs = this.data.configs.filter((c: any) => c.id !== id);
    await this.write();
  }

  async getLogs(filter: any): Promise<any[]> {
    let logs = this.data.logs;

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
    }));
  }

  async addLog(log: any): Promise<void> {
    this.data.logs.push({
      timestamp: new Date().toISOString(),
      ...log,
    });

    if (this.data.logs.length > 10000) {
      this.data.logs = this.data.logs.slice(-5000);
    }

    await this.write();
  }

  async clearLogs(): Promise<void> {
    this.data.logs = [];
    await this.write();
  }

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

    const requests = this.data.requests.filter((r: any) =>
      new Date(r.timestamp) >= startDate
    );

    const totalRequests = requests.length;
    const successRequests = requests.filter((r: any) => r.success).length;

    const conversations = this.data.conversations.filter((c: any) =>
      new Date(c.timestamp) >= startDate
    );
    const totalInputTokens = conversations.reduce((sum: number, c: any) =>
      sum + (c.inputTokens || 0), 0
    );
    const totalOutputTokens = conversations.reduce((sum: number, c: any) =>
      sum + (c.outputTokens || 0), 0
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

  async addRequest(request: any): Promise<void> {
    this.data.requests.push({
      ...request,
      timestamp: new Date().toISOString(),
    });

    if (this.data.requests.length > 50000) {
      this.data.requests = this.data.requests.slice(-25000);
    }

    await this.write();
  }

  async getConversations(limit?: number): Promise<any[]> {
    let conversations = this.data.conversations;

    if (limit) {
      conversations = conversations.slice(-limit);
    }

    return conversations.map((conv: any) => {
      const messageCount = (conv.request?.messages?.length || 0) + 1;

      const messages: any[] = [];

      if (conv.request?.messages) {
        conv.request.messages.forEach((msg: any) => {
          let content = '';
          if (typeof msg.content === 'string') {
            content = msg.content;
          } else if (Array.isArray(msg.content)) {
            content = msg.content.map((c: any) => c.text || JSON.stringify(c)).join('\n');
          }
          messages.push({
            role: msg.role,
            content: content,
            timestamp: conv.timestamp,
          });
        });
      }

      if (conv.response?.content) {
        let content = '';
        if (Array.isArray(conv.response.content)) {
          content = conv.response.content.map((c: any) => {
            if (c.type === 'text') return c.text;
            if (c.type === 'tool_use') return `[Tool: ${c.name}]`;
            return JSON.stringify(c);
          }).join('\n');
        } else {
          content = JSON.stringify(conv.response.content);
        }
        messages.push({
          role: 'assistant',
          content: content,
          timestamp: conv.timestamp,
        });
      }

      return {
        id: conv.id,
        model: conv.model,
        messageCount: messageCount,
        inputTokens: conv.inputTokens || 0,
        outputTokens: conv.outputTokens || 0,
        totalTokens: (conv.inputTokens || 0) + (conv.outputTokens || 0),
        createdAt: conv.timestamp,
        messages: messages,
      };
    });
  }

  async addConversation(conversation: any): Promise<void> {
    this.data.conversations.push({
      ...conversation,
      timestamp: new Date().toISOString(),
    });

    if (this.data.conversations.length > 1000) {
      this.data.conversations = this.data.conversations.slice(-500);
    }

    await this.write();
  }

  async deleteConversation(id: string): Promise<void> {
    this.data.conversations = this.data.conversations.filter(
      (c: any) => c.id !== id
    );
    await this.write();
  }

  async deleteAllConversations(): Promise<void> {
    this.data.conversations = [];
    await this.write();
  }

  async getSettings(): Promise<any> {
    return this.data.settings;
  }

  async saveSettings(settings: any): Promise<void> {
    this.data.settings = { ...this.data.settings, ...settings };
    await this.write();
  }

  async resetSettings(): Promise<void> {
    this.data.settings = {
      autoStart: false,
      minimizeToTray: true,
      showNotification: true,
      logLevel: 'info',
      logRetentionDays: 7,
    };
    await this.write();
  }

  async clearCache(): Promise<void> {
    this.data.logs = [];
    this.data.requests = [];
    await this.write();
  }

  async getUsageSummary(startDate?: number, endDate?: number): Promise<any> {
    const now = new Date();
    const start = startDate ? new Date(startDate * 1000) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = endDate ? new Date(endDate * 1000) : now;

    const conversations = this.data.conversations.filter((c: any) => {
      const timestamp = new Date(c.timestamp);
      return timestamp >= start && timestamp <= end;
    });

    const requests = this.data.requests.filter((r: any) => {
      const timestamp = new Date(r.timestamp);
      return timestamp >= start && timestamp <= end;
    });

    const totalRequests = requests.length;
    const successRequests = requests.filter((r: any) => r.success).length;

    const totalInputTokens = conversations.reduce((sum: number, c: any) => sum + (c.inputTokens || 0), 0);
    const totalOutputTokens = conversations.reduce((sum: number, c: any) => sum + (c.outputTokens || 0), 0);
    const totalCacheCreationTokens = conversations.reduce((sum: number, c: any) => sum + (c.cacheCreationTokens || 0), 0);
    const totalCacheReadTokens = conversations.reduce((sum: number, c: any) => sum + (c.cacheReadTokens || 0), 0);

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

    this.data.conversations.forEach((c: any) => {
      const timestamp = new Date(c.timestamp);
      if (timestamp >= start && timestamp <= end) {
        const key = isToday
          ? `${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, '0')}-${String(timestamp.getDate()).padStart(2, '0')}T${String(timestamp.getHours()).padStart(2, '0')}:00`
          : `${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, '0')}-${String(timestamp.getDate()).padStart(2, '0')}`;

        const existing = trends.get(key);
        if (existing) {
          existing.requestCount += 1;
          existing.totalInputTokens += c.inputTokens || 0;
          existing.totalOutputTokens += c.outputTokens || 0;
          existing.totalCacheCreationTokens += c.cacheCreationTokens || 0;
          existing.totalCacheReadTokens += c.cacheReadTokens || 0;
          existing.totalTokens = existing.totalInputTokens + existing.totalOutputTokens;
        }
      }
    });

    return Array.from(trends.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  async getModelStats(): Promise<any[]> {
    const modelMap: Map<string, any> = new Map();

    this.data.conversations.forEach((c: any) => {
      const model = c.model || 'unknown';
      const existing = modelMap.get(model) || {
        model,
        requestCount: 0,
        totalTokens: 0,
        totalCost: '0',
      };

      existing.requestCount += 1;
      existing.totalTokens += (c.inputTokens || 0) + (c.outputTokens || 0);
      modelMap.set(model, existing);
    });

    const stats = Array.from(modelMap.values());
    stats.forEach((s) => {
      s.avgCostPerRequest = '0';
    });

    return stats.sort((a, b) => b.requestCount - a.requestCount);
  }

  async getRequestLogs(filters: any, page: number = 0, pageSize: number = 20): Promise<any> {
    let logs = [...this.data.requests];

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
    }));

    return { data, total, page, pageSize };
  }

  async getMcpServers(): Promise<McpServer[]> {
    return this.data.mcpServers || [];
  }

  async saveMcpServer(server: McpServer): Promise<void> {
    if (!this.data.mcpServers) {
      this.data.mcpServers = [];
    }
    const index = this.data.mcpServers.findIndex((s) => s.id === server.id);
    if (index >= 0) {
      this.data.mcpServers[index] = server;
    } else {
      this.data.mcpServers.push(server);
    }
    await this.write();
  }

  async deleteMcpServer(id: string): Promise<void> {
    if (this.data.mcpServers) {
      this.data.mcpServers = this.data.mcpServers.filter((s) => s.id !== id);
      await this.write();
    }
  }

  async toggleMcpApp(id: string, app: 'claude', enabled: boolean): Promise<McpServer | null> {
    if (this.data.mcpServers) {
      const index = this.data.mcpServers.findIndex((s) => s.id === id);
      if (index >= 0) {
        this.data.mcpServers[index].apps[app] = enabled;
        await this.write();
        return this.data.mcpServers[index];
      }
    }
    return null;
  }

  async getSkills(): Promise<InstalledSkill[]> {
    return this.data.skills || [];
  }

  async saveSkill(skill: InstalledSkill): Promise<void> {
    if (!this.data.skills) {
      this.data.skills = [];
    }
    const index = this.data.skills.findIndex((s) => s.id === skill.id);
    if (index >= 0) {
      this.data.skills[index] = skill;
    } else {
      this.data.skills.push(skill);
    }
    await this.write();
  }

  async deleteSkill(id: string): Promise<void> {
    console.log(`[DB] Deleting skill with id: ${id}`);
    if (this.data.skills) {
      const beforeCount = this.data.skills.length;
      this.data.skills = this.data.skills.filter((s) => s.id !== id);
      const afterCount = this.data.skills.length;
      console.log(`[DB] Skills count: ${beforeCount} -> ${afterCount}`);
      await this.write();
      console.log(`[DB] Database written successfully`);
    }
  }

  async toggleSkillApp(id: string, app: 'claude', enabled: boolean): Promise<InstalledSkill | null> {
    if (this.data.skills) {
      const index = this.data.skills.findIndex((s) => s.id === id);
      if (index >= 0) {
        this.data.skills[index].apps[app] = enabled;
        await this.write();
        return this.data.skills[index];
      }
    }
    return null;
  }

  async getSkillRepos(): Promise<SkillRepo[]> {
    return this.data.skillRepos || [];
  }

  async saveSkillRepo(repo: SkillRepo): Promise<void> {
    if (!this.data.skillRepos) {
      this.data.skillRepos = [];
    }
    const index = this.data.skillRepos.findIndex((r) => r.owner === repo.owner && r.name === repo.name);
    if (index >= 0) {
      this.data.skillRepos[index] = repo;
    } else {
      this.data.skillRepos.push(repo);
    }
    await this.write();
  }

  async deleteSkillRepo(owner: string, name: string): Promise<void> {
    if (this.data.skillRepos) {
      this.data.skillRepos = this.data.skillRepos.filter((r) => !(r.owner === owner && r.name === name));
      await this.write();
    }
  }
}
