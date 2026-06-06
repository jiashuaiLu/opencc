import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const access = promisify(fs.access);

export interface McpServer {
  id: string;
  name: string;
  description?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
  homepage?: string;
  docs?: string;
  tags?: string[];
}

export class McpConfigManager {
  private claudeConfigPath: string;

  constructor() {
    this.claudeConfigPath = path.join(os.homedir(), '.claude', 'settings.json');
  }

  async syncMcpConfig(servers: McpServer[]): Promise<void> {
    try {
      const enabledServers = servers.filter(s => s.enabled);
      
      if (enabledServers.length === 0) {
        console.log('[MCP] No enabled MCP servers to sync');
        return;
      }

      let config: any = {};
      
      if (fs.existsSync(this.claudeConfigPath)) {
        const content = await readFile(this.claudeConfigPath, 'utf-8');
        config = JSON.parse(content);
      }

      if (!config.mcpServers) {
        config.mcpServers = {};
      }

      for (const server of enabledServers) {
        const mcpConfig: any = {
          command: server.command,
        };

        if (server.args && server.args.length > 0) {
          mcpConfig.args = server.args;
        }

        if (server.env && Object.keys(server.env).length > 0) {
          mcpConfig.env = server.env;
        }

        config.mcpServers[server.id] = mcpConfig;
        console.log(`[MCP] Synced MCP server: ${server.name} (${server.id})`);
      }

      await writeFile(this.claudeConfigPath, JSON.stringify(config, null, 2), 'utf-8');
      console.log(`[MCP] Successfully synced ${enabledServers.length} MCP servers to Claude Code`);
    } catch (error) {
      console.error('[MCP] Failed to sync MCP config:', error);
      throw error;
    }
  }

  async removeMcpConfig(serverIds: string[]): Promise<void> {
    try {
      if (!fs.existsSync(this.claudeConfigPath)) {
        return;
      }

      const content = await readFile(this.claudeConfigPath, 'utf-8');
      const config = JSON.parse(content);

      if (!config.mcpServers) {
        return;
      }

      for (const serverId of serverIds) {
        if (config.mcpServers[serverId]) {
          delete config.mcpServers[serverId];
          console.log(`[MCP] Removed MCP server: ${serverId}`);
        }
      }

      await writeFile(this.claudeConfigPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
      console.error('[MCP] Failed to remove MCP config:', error);
      throw error;
    }
  }

  async getMcpConfig(): Promise<Record<string, any>> {
    try {
      if (!fs.existsSync(this.claudeConfigPath)) {
        return {};
      }

      const content = await readFile(this.claudeConfigPath, 'utf-8');
      const config = JSON.parse(content);

      return config.mcpServers || {};
    } catch (error) {
      console.error('[MCP] Failed to get MCP config:', error);
      return {};
    }
  }

  async validateMcpServer(server: McpServer): Promise<{ valid: boolean; message?: string }> {
    if (!server.command) {
      return { valid: false, message: 'Command is required' };
    }

    if (!server.id) {
      return { valid: false, message: 'Server ID is required' };
    }

    return { valid: true };
  }
}
