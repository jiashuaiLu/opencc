import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

interface DatabaseSchema {
  configs: any[];
  logs: any[];
  requests: any[];
  conversations: any[];
  settings: any;
}

export class DatabaseManager {
  private dbPath: string;
  private data: DatabaseSchema;

  constructor() {
    const dataDir = path.join(os.homedir(), '.dongcc', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.dbPath = path.join(dataDir, 'dongcc.json');
    
    this.data = {
      configs: [],
      logs: [],
      requests: [],
      conversations: [],
      settings: {},
    };
  }

  async initialize(): Promise<void> {
    if (fs.existsSync(this.dbPath)) {
      try {
        const content = fs.readFileSync(this.dbPath, 'utf-8');
        this.data = JSON.parse(content);
      } catch (error) {
        console.error('Failed to load database, using default data:', error);
      }
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
    
    // 为每条日志添加 id
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
    
    // 从对话历史中分别计算输入和输出 token
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
    
    // 转换数据结构以匹配前端期望
    return conversations.map((conv: any) => {
      // 计算消息数量
      const messageCount = (conv.request?.messages?.length || 0) + 1; // request messages + 1 response
      
      // 提取消息内容
      const messages: any[] = [];
      
      // 添加请求消息
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
      
      // 添加响应消息
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

  async getSettings(): Promise<any> {
    return this.data.settings;
  }

  async saveSettings(settings: any): Promise<void> {
    this.data.settings = { ...this.data.settings, ...settings };
    await this.write();
  }
}
