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

export interface McpPresetEnvHint {
  key: string;
  label: string;
  hint: string;
}

export interface McpPreset {
  id: string;
  name: string;
  tags?: string[];
  server: McpServerSpec;
  homepage?: string;
  docs?: string;
  description?: string;
  envHints?: McpPresetEnvHint[];
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
    id: 'github',
    name: 'GitHub',
    description: 'GitHub 官方，管理 issue、PR、仓库与代码搜索（需 Personal Access Token）',
    tags: ['stdio', 'github', 'git'],
    server: {
      type: 'stdio',
      ...createNpxCommand('@modelcontextprotocol/server-github', ['-y']),
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: 'YOUR_GITHUB_TOKEN_HERE',
      },
    },
    homepage: 'https://github.com/modelcontextprotocol/servers',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
    envHints: [
      { key: 'GITHUB_PERSONAL_ACCESS_TOKEN', label: 'GitHub Token', hint: '前往 GitHub → Settings → Developer settings → Personal access tokens 生成' },
    ],
  },
  {
    id: 'context7',
    name: 'Context7',
    description: '实时拉取最新的开源库文档与代码示例，告别过时 API',
    tags: ['http', 'docs', 'library'],
    server: {
      type: 'http',
      url: 'https://mcp.context7.com/mcp',
    },
    homepage: 'https://context7.com',
    docs: 'https://github.com/upstash/context7',
  },
  {
    id: 'chrome-devtools',
    name: 'Chrome DevTools',
    description: 'Google 官方，让 AI 通过 Chrome DevTools 调试和检查网页',
    tags: ['stdio', 'browser', 'debug'],
    server: {
      type: 'stdio',
      ...createNpxCommand('chrome-devtools-mcp@latest', ['-y']),
    },
    homepage: 'https://github.com/ChromeDevTools/chrome-devtools-mcp',
    docs: 'https://github.com/ChromeDevTools/chrome-devtools-mcp',
  },
  {
    id: 'playwright',
    name: '@playwright/mcp',
    description: '微软官方浏览器自动化，比 Puppeteer 更现代，支持多浏览器',
    tags: ['stdio', 'browser', 'automation', 'testing'],
    server: {
      type: 'stdio',
      ...createNpxCommand('@playwright/mcp@latest', ['-y']),
    },
    homepage: 'https://github.com/microsoft/playwright-mcp',
    docs: 'https://github.com/microsoft/playwright-mcp',
  },
  {
    id: 'deepwiki',
    name: 'DeepWiki',
    description: '对任意 GitHub 仓库提问，无需配置',
    tags: ['http', 'github', 'docs', 'qa'],
    server: {
      type: 'http',
      url: 'https://mcp.deepwiki.com/mcp',
    },
    homepage: 'https://deepwiki.com',
    docs: 'https://docs.devin.ai/work-with-devin/deepwiki-mcp',
  },
  {
    id: 'magic-ui',
    name: '@21st-dev/magic',
    description: '21st.dev 出品，AI 生成现代 UI 组件',
    tags: ['stdio', 'ui', 'component', 'design'],
    server: {
      type: 'stdio',
      ...createNpxCommand('@21st-dev/magic@latest', ['-y']),
      env: {
        API_KEY: 'YOUR_21ST_DEV_API_KEY_HERE',
      },
    },
    homepage: 'https://21st.dev',
    docs: 'https://github.com/21st-dev/magic-mcp',
    envHints: [
      { key: 'API_KEY', label: '21st.dev API Key', hint: '前往 https://21st.dev 注册并获取 API Key' },
    ],
  },
  {
    id: 'sentry',
    name: 'Sentry',
    description: '查询和分析 Sentry 上的错误与性能数据',
    tags: ['http', 'monitoring', 'error'],
    server: {
      type: 'http',
      url: 'https://mcp.sentry.dev/mcp',
    },
    homepage: 'https://sentry.io',
    docs: 'https://docs.sentry.io/product/sentry-mcp/',
  },
  {
    id: 'notion',
    name: 'Notion',
    description: '读写 Notion 页面、数据库与评论（OAuth 授权）',
    tags: ['http', 'notion', 'docs', 'collaboration'],
    server: {
      type: 'http',
      url: 'https://mcp.notion.com/mcp',
    },
    homepage: 'https://www.notion.so',
    docs: 'https://developers.notion.com/docs/mcp',
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Linear 官方，管理 issue、cycle 和 project（OAuth 授权）',
    tags: ['sse', 'linear', 'issue', 'pm'],
    server: {
      type: 'sse',
      url: 'https://mcp.linear.app/sse',
    },
    homepage: 'https://linear.app',
    docs: 'https://linear.app/changelog/2025-05-01-mcp',
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    description: '读写 Obsidian 笔记库（需安装 Local REST API 插件并填入 API Key）',
    tags: ['stdio', 'obsidian', 'notes', 'knowledge'],
    server: {
      type: 'stdio',
      command: 'uvx',
      args: ['mcp-obsidian'],
      env: {
        OBSIDIAN_API_KEY: 'YOUR_OBSIDIAN_API_KEY_HERE',
        OBSIDIAN_HOST: '127.0.0.1',
        OBSIDIAN_PORT: '27124',
      },
    },
    homepage: 'https://github.com/MarkusPfundstein/mcp-obsidian',
    docs: 'https://github.com/MarkusPfundstein/mcp-obsidian',
    envHints: [
      { key: 'OBSIDIAN_API_KEY', label: 'Obsidian API Key', hint: '在 Obsidian 中安装 Local REST API 插件，设置中可查看 API Key' },
      { key: 'OBSIDIAN_HOST', label: '主机地址', hint: '默认 127.0.0.1，一般无需修改' },
      { key: 'OBSIDIAN_PORT', label: '端口', hint: '默认 27124，需与 Local REST API 插件设置一致' },
    ],
  },
  {
    id: 'midscene',
    name: 'Midscene',
    description: '视觉驱动的 UI 自动化，无需 DOM 选择器（需 OpenAI 兼容模型 Key）',
    tags: ['stdio', 'browser', 'vision', 'automation'],
    server: {
      type: 'stdio',
      ...createNpxCommand('@midscene/mcp', ['-y']),
      env: {
        MIDSCENE_MODEL_NAME: 'gpt-4o-mini',
        OPENAI_API_KEY: 'YOUR_OPENAI_API_KEY_HERE',
        MCP_SERVER_REQUEST_TIMEOUT: '800000',
      },
    },
    homepage: 'https://midscenejs.com',
    docs: 'https://midscenejs.com/mcp.html',
    envHints: [
      { key: 'OPENAI_API_KEY', label: 'OpenAI API Key', hint: '前往 https://platform.openai.com/api-keys 获取，也支持兼容 API' },
      { key: 'MIDSCENE_MODEL_NAME', label: '模型名称', hint: '默认 gpt-4o-mini，可改为其他 OpenAI 兼容模型' },
      { key: 'MCP_SERVER_REQUEST_TIMEOUT', label: '请求超时(ms)', hint: '默认 800000，视觉分析较慢建议保持较大值' },
    ],
  },
  {
    id: 'codegraph',
    name: 'CodeGraph',
    description: '本地代码知识图谱，让 Claude 用 AST 而非 grep 理解大型仓库，省 Token 30%+（需先 npm i -g @colbymchenry/codegraph）',
    tags: ['stdio', 'code', 'graph', 'navigation'],
    server: {
      type: 'stdio',
      command: 'codegraph',
      args: ['serve', '--mcp'],
    },
    homepage: 'https://github.com/colbymchenry/codegraph',
    docs: 'https://github.com/colbymchenry/codegraph',
  },
  {
    id: 'mem0',
    name: 'Mem0 (永久记忆)',
    description: '给 Claude 加永久记忆，跨会话/跨工具记住你的偏好与历史对话，自动抽取事实并按相关性召回（需 mem0.ai 免费 API Key）',
    tags: ['http', 'memory', 'persistent', 'cross-session'],
    server: {
      type: 'http',
      url: 'https://mcp.mem0.ai/mcp',
      headers: {
        Authorization: 'Bearer YOUR_MEM0_API_KEY_HERE',
      },
    },
    homepage: 'https://mem0.ai',
    docs: 'https://docs.mem0.ai/platform/mem0-mcp',
    envHints: [
      { key: 'Authorization', label: 'Mem0 API Key', hint: '前往 https://app.mem0.ai 注册获取免费 API Key，填入格式：Bearer your-key' },
    ],
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
