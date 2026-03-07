import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

export interface McpServerSpec {
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface McpApps {
  claude: boolean;
}

export interface McpServer {
  id: string;
  name: string;
  server: McpServerSpec;
  apps: McpApps;
  description?: string;
  homepage?: string;
  docs?: string;
  tags?: string[];
}

export interface McpPreset {
  id: string;
  name: string;
  tags?: string[];
  server: McpServerSpec;
  homepage?: string;
  docs?: string;
  description?: string;
}

const isWindows = process.platform === 'win32';

const createNpxCommand = (
  packageName: string,
  extraArgs: string[] = [],
): { command: string; args: string[] } => {
  if (isWindows) {
    return {
      command: 'cmd',
      args: ['/c', 'npx', ...extraArgs, packageName],
    };
  } else {
    return {
      command: 'npx',
      args: [...extraArgs, packageName],
    };
  }
};

export const mcpPresets: McpPreset[] = [
  {
    id: 'fetch',
    name: 'mcp-server-fetch',
    tags: ['stdio', 'http', 'web'],
    server: {
      type: 'stdio',
      command: 'uvx',
      args: ['mcp-server-fetch'],
    },
    homepage: 'https://github.com/modelcontextprotocol/servers',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
  },
  {
    id: 'time',
    name: '@modelcontextprotocol/server-time',
    tags: ['stdio', 'time', 'utility'],
    server: {
      type: 'stdio',
      ...createNpxCommand('@modelcontextprotocol/server-time', ['-y']),
    },
    homepage: 'https://github.com/modelcontextprotocol/servers',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time',
  },
  {
    id: 'memory',
    name: '@modelcontextprotocol/server-memory',
    tags: ['stdio', 'memory', 'graph'],
    server: {
      type: 'stdio',
      ...createNpxCommand('@modelcontextprotocol/server-memory', ['-y']),
    },
    homepage: 'https://github.com/modelcontextprotocol/servers',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
  },
  {
    id: 'sequential-thinking',
    name: '@modelcontextprotocol/server-sequential-thinking',
    tags: ['stdio', 'thinking', 'reasoning'],
    server: {
      type: 'stdio',
      ...createNpxCommand('@modelcontextprotocol/server-sequential-thinking', ['-y']),
    },
    homepage: 'https://github.com/modelcontextprotocol/servers',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
  },
  {
    id: 'filesystem',
    name: '@modelcontextprotocol/server-filesystem',
    tags: ['stdio', 'filesystem', 'file'],
    server: {
      type: 'stdio',
      ...createNpxCommand('@modelcontextprotocol/server-filesystem', ['-y']),
    },
    homepage: 'https://github.com/modelcontextprotocol/servers',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
  },
  {
    id: 'brave-search',
    name: '@modelcontextprotocol/server-brave-search',
    tags: ['stdio', 'search', 'web'],
    server: {
      type: 'stdio',
      ...createNpxCommand('@modelcontextprotocol/server-brave-search', ['-y']),
    },
    homepage: 'https://github.com/modelcontextprotocol/servers',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
  },
  {
    id: 'puppeteer',
    name: '@modelcontextprotocol/server-puppeteer',
    tags: ['stdio', 'browser', 'automation'],
    server: {
      type: 'stdio',
      ...createNpxCommand('@modelcontextprotocol/server-puppeteer', ['-y']),
    },
    homepage: 'https://github.com/modelcontextprotocol/servers',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer',
  },
  {
    id: 'github',
    name: '@modelcontextprotocol/server-github',
    tags: ['stdio', 'github', 'git'],
    server: {
      type: 'stdio',
      ...createNpxCommand('@modelcontextprotocol/server-github', ['-y']),
    },
    homepage: 'https://github.com/modelcontextprotocol/servers',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
  },
];

export class McpService {
  private claudeMcpPath: string;
  private claudeSettingsPath: string;

  constructor() {
    this.claudeMcpPath = path.join(os.homedir(), '.claude.json');
    this.claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  }

  async syncServerToClaude(server: McpServer): Promise<void> {
    if (!server.apps.claude) {
      return;
    }

    try {
      let config: any = {};

      if (fs.existsSync(this.claudeMcpPath)) {
        const content = await readFile(this.claudeMcpPath, 'utf-8');
        config = JSON.parse(content);
      }

      if (!config.mcpServers) {
        config.mcpServers = {};
      }

      const mcpConfig: any = {};

      if (server.server.type === 'stdio') {
        mcpConfig.type = 'stdio';
        mcpConfig.command = server.server.command;
        if (server.server.args && server.server.args.length > 0) {
          mcpConfig.args = server.server.args;
        }
        if (server.server.env && Object.keys(server.server.env).length > 0) {
          mcpConfig.env = server.server.env;
        }
      } else if (server.server.type === 'http' || server.server.type === 'sse') {
        mcpConfig.type = server.server.type;
        mcpConfig.url = server.server.url;
        if (server.server.headers && Object.keys(server.server.headers).length > 0) {
          mcpConfig.headers = server.server.headers;
        }
      }

      config.mcpServers[server.id] = mcpConfig;
      await writeFile(this.claudeMcpPath, JSON.stringify(config, null, 2), 'utf-8');
      console.log(`[MCP] Synced server: ${server.name} (${server.id})`);
    } catch (error) {
      console.error(`[MCP] Failed to sync server ${server.id}:`, error);
      throw error;
    }
  }

  async removeServerFromClaude(serverId: string): Promise<void> {
    try {
      if (!fs.existsSync(this.claudeMcpPath)) {
        return;
      }

      const content = await readFile(this.claudeMcpPath, 'utf-8');
      const config = JSON.parse(content);

      if (!config.mcpServers) {
        return;
      }

      if (config.mcpServers[serverId]) {
        delete config.mcpServers[serverId];
        await writeFile(this.claudeMcpPath, JSON.stringify(config, null, 2), 'utf-8');
        console.log(`[MCP] Removed server: ${serverId}`);
      }
    } catch (error) {
      console.error(`[MCP] Failed to remove server ${serverId}:`, error);
      throw error;
    }
  }

  async syncAllServers(servers: McpServer[]): Promise<void> {
    for (const server of servers) {
      if (server.apps.claude) {
        await this.syncServerToClaude(server);
      }
    }
  }

  async importFromClaude(): Promise<McpServer[]> {
    const imported: McpServer[] = [];

    try {
      if (!fs.existsSync(this.claudeMcpPath)) {
        console.log('[MCP] ~/.claude.json not found');
        return imported;
      }

      const content = await readFile(this.claudeMcpPath, 'utf-8');
      const config = JSON.parse(content);

      if (!config.mcpServers) {
        console.log('[MCP] No mcpServers in ~/.claude.json');
        return imported;
      }

      for (const [id, serverConfig] of Object.entries(config.mcpServers) as [string, any][]) {
        const server: McpServer = {
          id,
          name: serverConfig.name || id,
          server: {
            type: serverConfig.type || 'stdio',
            command: serverConfig.command,
            args: serverConfig.args,
            env: serverConfig.env,
            url: serverConfig.url,
            headers: serverConfig.headers,
          },
          apps: { claude: true },
        };
        imported.push(server);
      }

      console.log(`[MCP] Imported ${imported.length} servers from ~/.claude.json`);
    } catch (error) {
      console.error('[MCP] Failed to import from Claude:', error);
    }

    return imported;
  }

  getPresets(): McpPreset[] {
    return mcpPresets;
  }

  validateServer(server: McpServer): { valid: boolean; message?: string } {
    if (!server.id || !server.id.trim()) {
      return { valid: false, message: 'ID 不能为空' };
    }

    if (!server.name || !server.name.trim()) {
      return { valid: false, message: '名称不能为空' };
    }

    if (server.server.type === 'stdio') {
      if (!server.server.command || !server.server.command.trim()) {
        return { valid: false, message: 'stdio 类型必须提供命令' };
      }
    } else if (server.server.type === 'http' || server.server.type === 'sse') {
      if (!server.server.url || !server.server.url.trim()) {
        return { valid: false, message: 'http/sse 类型必须提供 URL' };
      }
    }

    return { valid: true };
  }
}

export const mcpService = new McpService();
