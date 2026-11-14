import { ipcMain, shell, dialog, app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { ProxyServer } from '../proxy/server';
import { DatabaseManager } from '../database';
import { logger } from '../logger';
import { SystemChecker } from '../system/checker';
import { mcpService, McpServer } from '../mcp/mcpService';
import { skillService, SkillService, InstalledSkill, DiscoverableSkill } from '../skills/skillService';
import { CostCalculator, defaultPricing } from '../cost/calculator';
import { DataExporter } from '../export/dataExporter';
import { zipInstaller } from '../skills/zipInstaller';
import { installPresetSkills, PresetSkillSpec } from '../skills/presetSkills';
import { getCachedUserInfo, logout as coreLogout } from '../auth/localAuth';
import { getInstanceId, resetInstanceId } from '../instance/instanceId';
import { startHeadroomProxy, stopHeadroomProxy, installHeadroom, downloadHeadroomModels, cancelHeadroomModelDownload } from '../index';

function parseSessionMeta(filePath: string, claudeProjectsDir: string): any | null {
  const stat = fs.statSync(filePath);
  if (stat.size === 0) return null;

  const fd = fs.openSync(filePath, 'r');
  const headBuf = Buffer.alloc(Math.min(stat.size, 8192));
  fs.readSync(fd, headBuf, 0, headBuf.length, 0);
  const tailBuf = Buffer.alloc(Math.min(stat.size, 8192));
  const tailOffset = Math.max(0, stat.size - tailBuf.length);
  fs.readSync(fd, tailBuf, 0, tailBuf.length, tailOffset);
  fs.closeSync(fd);

  const headLines = headBuf.toString('utf-8').split('\n').filter(l => l.trim());
  const tailLines = tailBuf.toString('utf-8').split('\n').filter(l => l.trim());

  const sessionId = path.basename(filePath, '.jsonl');
  let title = '';
  let projectDir = '';
  let createdAt = stat.mtimeMs;
  let lastActiveAt = stat.mtimeMs;
  let messageCount = 0;

  for (const line of headLines) {
    try {
      const entry = JSON.parse(line);
      if (entry.cwd && !projectDir) projectDir = entry.cwd;
      if (entry.timestamp && !title) {
        createdAt = new Date(entry.timestamp).getTime();
      }
      if (entry.customTitle && !title) {
        title = entry.customTitle;
      }
      if (!entry.isMeta) {
        messageCount++;
        if (!title && (entry.type === 'human' || entry.role === 'user')) {
          const c = entry.message?.content || entry.content || '';
          title = (typeof c === 'string' ? c : '').substring(0, 100);
        }
      }
    } catch { /* skip */ }
  }

  for (const line of tailLines.reverse()) {
    try {
      const entry = JSON.parse(line);
      if (entry.timestamp) {
        lastActiveAt = new Date(entry.timestamp).getTime();
        break;
      }
    } catch { /* skip */ }
  }

  if (!title) {
    const relPath = path.relative(claudeProjectsDir, path.dirname(filePath));
    title = relPath || sessionId;
  }

  return { sessionId, title, projectDir, sourcePath: filePath, createdAt, lastActiveAt, messageCount };
}

interface IPCHandlersOptions {
  authProvider?: {
    requireAuth: () => Promise<any>;
    getCachedUserInfo: () => any | null;
    logout?: () => Promise<void>;
  };
  rankingProvider?: {
    fetchRanking: (url: string) => Promise<any>;
  };
  communityProvider?: {
    fetch: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<any>;
  };
  ossUploader?: {
    uploadFile: (fileData: number[], fileName: string, prefix: string) => Promise<{ fileUrl: string }>;
  };
  presetSkillProvider?: {
    getPresetSkills: () => PresetSkillSpec[];
  };
}

export function setupIPC(
  proxyServer: ProxyServer,
  database: DatabaseManager,
  options?: IPCHandlersOptions
): void {
  const systemChecker = new SystemChecker();
  const costCalculator = new CostCalculator();
  const dataExporter = new DataExporter();

  // 注入 communityProvider 到 SkillService
  if (options?.communityProvider) {
    SkillService.setCommunityProvider(options.communityProvider);
  }

  /**
   * 同步 Headroom 压缩代理到「运行中的」proxy server。
   * service:start（首次启动）与 config:save（翻开关热切换）共用，确保：
   *  - 启用时：Headroom 进程已起（startHeadroomProxy 幂等，已运行则秒回）+ 设好上游 hosts，
   *    使 getTargetUrl 的 `matchHost && baseUrl.includes(matchHost)` 判定成立、请求真正经过压缩；
   *  - 禁用时：关闭路由并停止进程。
   * 修复「开关打开但 config:save 只热重配 configure()、从不设 hosts/不起进程 → 请求全部旁路
   * Headroom → 节省 Token 恒为 0」的问题。
   */
  const syncHeadroomProxy = async (
    config: any,
    sendLog?: (msg: string, level?: 'info' | 'error') => void
  ): Promise<void> => {
    if (config.headroom?.enabled) {
      const upstreamUrls: { anthropic?: string; openai?: string } = {};
      const claudeBaseUrl = config.claude?.baseUrl || config.baseUrl;
      if (claudeBaseUrl) {
        upstreamUrls.anthropic = claudeBaseUrl.replace(/\/v1\/?$/, '').replace(/\/messages\/?$/, '');
      }
      const codexBaseUrl = config.codex?.baseUrl;
      if (codexBaseUrl) {
        upstreamUrls.openai = codexBaseUrl.replace(/\/v1\/?$/, '');
      }
      const headroomResult = await startHeadroomProxy(
        config.headroom.proxyUrl,
        upstreamUrls,
        config.port,
        config.headroom.hfMirrorUrl || 'https://hf-mirror.com'
      );
      if (headroomResult.success) {
        const actualUrl = headroomResult.actualPort
          ? `http://127.0.0.1:${headroomResult.actualPort}`
          : config.headroom.proxyUrl || 'http://127.0.0.1:8788';
        const upstreamHosts: { anthropic?: string; openai?: string } = {};
        try { if (upstreamUrls.anthropic) upstreamHosts.anthropic = new URL(upstreamUrls.anthropic).hostname; } catch {}
        try { if (upstreamUrls.openai) upstreamHosts.openai = new URL(upstreamUrls.openai).hostname; } catch {}
        proxyServer.setHeadroomEnabled(true, actualUrl, upstreamHosts);
        sendLog?.(`[Headroom] 压缩代理已就绪 (${actualUrl})，请求将通过 Headroom 透明代理转发`);
      } else {
        sendLog?.(`[Headroom] 启动失败: ${headroomResult.reason}，回退为直连模式`, 'error');
        proxyServer.setHeadroomEnabled(false);
      }
    } else {
      // 禁用：关闭路由并停止进程（getTargetUrl 见 headroomEnabled=false 即直连上游）
      proxyServer.setHeadroomEnabled(false);
      stopHeadroomProxy();
    }
  };

  // 同步暴露后端 base URL 给渲染层(经 preload sendSync 读取)。

  // 实例匿名 ID(PRD 4.1.7):供设置页读取/重置
  ipcMain.handle('instance:get', async () => getInstanceId(database));
  ipcMain.handle('instance:reset', async () => resetInstanceId(database));

  ipcMain.handle('config:get', async (event, id) => {
    try {
      const config = await database.getConfig(id);
      return config;
    } catch (error) {
      logger.error('Failed to get config', error);
      throw error;
    }
  });

  ipcMain.handle('config:save', async (event, config) => {
    try {
      if (config.apiKey) {
        config.apiKey = config.apiKey.replace(/\s/g, '');
      }
      await database.saveConfig(config);
      // 若代理服务正在运行，热重配，使模型等改动无需重启/新开会话即时生效
      try {
        if (proxyServer.getStatus().running) {
          proxyServer.configure(config);
          // 热同步 Headroom：翻开关即生效（起进程 + 设上游 hosts），无需手动"保存并重启"
          await syncHeadroomProxy(config);
          logger.info('Config hot-reloaded into running proxy', { id: config.id });
        }
      } catch (e) {
        logger.warn('Config hot-reload skipped', e);
      }
      logger.info('Config saved', { id: config.id });
      return { success: true };
    } catch (error) {
      logger.error('Failed to save config', error);
      throw error;
    }
  });

  ipcMain.handle('config:list', async () => {
    try {
      const configs = await database.listConfigs();
      return configs;
    } catch (error) {
      logger.error('Failed to list configs', error);
      throw error;
    }
  });

  ipcMain.handle('config:delete', async (event, id) => {
    try {
      await database.deleteConfig(id);
      logger.info('Config deleted', { id });
      return { success: true };
    } catch (error) {
      logger.error('Failed to delete config', error);
      throw error;
    }
  });

  ipcMain.handle('config:testConnection', async (_event, clientType: 'claude' | 'codex' | 'cursor' | 'opencode', port: number, clientCfg: { apiKey: string; baseUrl: string; apiFormat: 'chat-completions' | 'responses' | 'anthropic'; defaultModel?: string; models?: Array<{ id: string; name: string; modelId: string }> }) => {
    try {
      const report = await systemChecker.runConnectionTest(clientType, port, clientCfg);
      return report;
    } catch (error) {
      logger.error('Failed to run connection test', error);
      throw error;
    }
  });

  ipcMain.handle('service:start', async (event, config) => {
    const sendLog = (msg: string, level: 'info' | 'error' = 'info') => {
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send('service:log', msg, level));
    };

    try {
      // 如果提供了 authProvider，则执行认证检查
      if (options?.authProvider) {
        let userInfo = options.authProvider.getCachedUserInfo();
        if (!userInfo) {
          try {
            userInfo = await options.authProvider.requireAuth();
          } catch {
            userInfo = null;
          }
        }
        if (!userInfo) {
          sendLog('[登录] 登录失败或取消，无法启动服务', 'error');
          throw new Error('Authentication required');
        }
        sendLog(`[登录] 已登录: ${userInfo.name}${userInfo.erp ? ` (${userInfo.erp})` : ''}`);
        BrowserWindow.getAllWindows().forEach(w => w.webContents.send('user:info-updated', userInfo));
      }

      sendLog('[配置] 正在配置代理服务...');
      proxyServer.configure(config);
      const claudeBaseUrl = config.claude?.baseUrl || config.baseUrl || '';
      sendLog(`[配置] 代理服务配置完成 (Claude baseUrl: ${claudeBaseUrl}${config.codex ? `, Codex baseUrl: ${config.codex.baseUrl}` : ''})`);

      const startMode = config.startMode || 'all';

      // Claude 自动配置（兼容新旧结构：claude 子对象优先，否则用扁平字段）
      const claudeCfg = config.claude || (config.apiKey ? {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        apiFormat: config.apiFormat,
        models: config.models,
        defaultModel: config.defaultModel,
      } : null);

      if ((startMode === 'all' || startMode === 'claude') && claudeCfg && claudeCfg.apiKey) {
        sendLog('[配置] 正在更新 Claude Code 配置...');
        await systemChecker.autoConfigureClaude(
          config.port,
          claudeCfg.apiKey,
          claudeCfg.models,
          claudeCfg.defaultModel,
          claudeCfg.apiFormat,
          claudeCfg.baseUrl,
          claudeCfg.modelRoutes,
        );
        sendLog(`[配置] Claude settings.json 已更新 (port: ${config.port}, models: ${claudeCfg.models?.length || 0})`);
        logger.info('Claude config updated', {
          port: config.port,
          modelsCount: claudeCfg.models?.length || 0,
          defaultModel: claudeCfg.defaultModel
        });
      }

      // Codex 自动配置
      if ((startMode === 'all' || startMode === 'codex') && config.codex && config.codex.apiKey) {
        sendLog('[配置] 正在更新 Codex CLI 配置...');
        await systemChecker.autoConfigureCodex(config.port, config.codex);
        sendLog(`[配置] ~/.codex/config.toml 已更新 (wire_api: ${config.codex.apiFormat === 'responses' ? 'responses' : 'chat'})`);
        logger.info('Codex config updated', {
          port: config.port,
          apiFormat: config.codex.apiFormat,
          defaultModel: config.codex.defaultModel,
        });
      }

      // Cursor 自动配置
      if ((startMode === 'all' || startMode === 'cursor') && config.cursor && config.cursor.apiKey) {
        sendLog('[配置] 正在更新 Cursor 配置...');
        await systemChecker.autoConfigureCursor(config.port, config.cursor);
        sendLog(`[配置] ~/.cursor/settings.json 已更新 (apiFormat: ${config.cursor.apiFormat || 'chat-completions'})`);
        logger.info('Cursor config updated', {
          port: config.port,
          apiFormat: config.cursor.apiFormat,
          defaultModel: config.cursor.defaultModel,
        });
      }

      // OpenCode 自动配置
      if ((startMode === 'all' || startMode === 'opencode') && config.opencode && config.opencode.apiKey) {
        sendLog('[配置] 正在更新 OpenCode 配置...');
        await systemChecker.autoConfigureOpenCode(config.port, config.opencode);
        sendLog(`[配置] ~/.config/opencode/config.json 已更新 (apiFormat: ${config.opencode.apiFormat || 'chat-completions'})`);
        logger.info('OpenCode config updated', {
          port: config.port,
          apiFormat: config.opencode.apiFormat,
          defaultModel: config.opencode.defaultModel,
        });
      }

      // Claude Desktop 自动配置
      if ((startMode === 'all' || startMode === 'claude-desktop') && config.claudeDesktop && config.claudeDesktop.apiKey) {
        sendLog('[配置] 正在更新 Claude Desktop 3P 配置...');
        await systemChecker.autoConfigureClaudeDesktop(
          config.port,
          config.claudeDesktop.apiKey,
          config.claudeDesktop.modelRoutes,
        );
        sendLog(`[配置] Claude Desktop 3P Profile 已更新 (routes: ${config.claudeDesktop.modelRoutes?.length || 0})`);
        logger.info('Claude Desktop config updated', {
          port: config.port,
          routes: config.claudeDesktop.modelRoutes?.length || 0,
        });
      }

      if (startMode === 'all' || startMode === 'claude') {
        const mcpServers = await database.getMcpServers();
        const enabledServers = mcpServers.filter(s => s.apps.claude);
        if (enabledServers.length > 0) {
          sendLog(`[MCP] 正在同步 ${enabledServers.length} 个 MCP 服务器...`);
          for (const server of enabledServers) {
            await mcpService.syncServerToClaude(server);
          }
          sendLog(`[MCP] ${enabledServers.length} 个 MCP 服务器同步完成`);
          logger.info('MCP config synced', { count: enabledServers.length });
        }

        const skills = await database.getSkills();
        const enabledSkills = skills.filter(s => s.apps.claude);
        if (enabledSkills.length > 0) {
          sendLog(`[Skills] 正在检查 ${enabledSkills.length} 个 Skills...`);
          let syncedCount = 0;
          for (const skill of enabledSkills) {
            const destDir = path.join(skillService.getClaudeSkillsDir(), skill.directory);
            if (!fs.existsSync(destDir)) {
              await skillService.syncToClaude(skill);
              syncedCount++;
            }
          }
          if (syncedCount > 0) {
            sendLog(`[Skills] 新同步 ${syncedCount} 个 Skills`);
          } else {
            sendLog(`[Skills] ${enabledSkills.length} 个 Skills 均已就绪`);
          }
          logger.info('Skills check done', { total: enabledSkills.length, synced: syncedCount });
        }
      }

      // 预置 skill:随 dongcc 打包,启动 claude / codex / opencode 服务时自动装入用户 skill 目录。
      // 幂等(符号链接优先,失败回退拷贝);按 spec.apps 投放到各端目录。
      if (
        (startMode === 'all' || startMode === 'claude' || startMode === 'codex' || startMode === 'opencode') &&
        options?.presetSkillProvider
      ) {
        try {
          await installPresetSkills(options.presetSkillProvider.getPresetSkills(), database, sendLog);
        } catch (e: any) {
          sendLog(`[预置Skill] 安装异常: ${e.message}`);
        }
      }

      sendLog(`[代理] 正在启动代理服务，端口 ${config.port}...`);
      await proxyServer.start(config.port);
      sendLog(`[代理] 代理服务已启动，监听 http://127.0.0.1:${config.port}`);

      // Headroom 压缩代理（仅启动，安装由配置页面负责）
      // Headroom 是透明代理：DongCC → Headroom → 上游API
      if (config.headroom?.enabled) {
        sendLog('[Headroom] 正在启动压缩代理...');
      }
      // 与 config:save 共用同一套启动/接线逻辑（起进程 + 设上游 hosts）
      await syncHeadroomProxy(config, sendLog);

      logger.info('Service started', { port: config.port });

      if (startMode === 'all' || startMode === 'claude') {
        sendLog('[验证] 正在验证环境配置...');
        const configCheck = await systemChecker.checkClaudeConfig();
        if (!configCheck.valid) {
          sendLog('[错误] 环境配置验证失败，请检查配置文件', 'error');
          logger.warn('Claude config validation failed', configCheck);
          throw new Error('环境配置验证失败，请检查配置文件');
        }
        sendLog('[验证] 环境配置验证通过');
        logger.info('Environment check passed', { configPath: configCheck.path });
      }

      sendLog('[完成] 服务启动成功');
      return { success: true };
    } catch (error: any) {
      const errMsg = error?.message || String(error);
      sendLog(`[错误] 启动失败: ${errMsg}`, 'error');
      logger.error('Failed to start service', error);
      throw error;
    }
  });

  ipcMain.handle('service:stop', async () => {
    const sendLog = (msg: string, level: 'info' | 'error' = 'info') => {
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send('service:log', msg, level));
    };

    try {
      sendLog('[代理] 正在停止代理服务...');
      stopHeadroomProxy();
      await proxyServer.stop();
      sendLog('[配置] 正在还原 Claude Code 配置...');
      await systemChecker.restoreClaudeConfig();
      sendLog('[配置] 正在还原 Codex CLI 配置...');
      await systemChecker.restoreCodexConfig();
      sendLog('[配置] 正在还原 Cursor 配置...');
      await systemChecker.restoreCursorConfig();
      sendLog('[配置] 正在还原 OpenCode 配置...');
      await systemChecker.restoreOpenCodeConfig();
      sendLog('[配置] 正在还原 Claude Desktop 配置...');
      await systemChecker.restoreClaudeDesktopConfig();
      await systemChecker.clearBackup();
      sendLog('[完成] 服务已停止');
      logger.info('Service stopped and config restored');
      return { success: true };
    } catch (error: any) {
      const errMsg = error?.message || String(error);
      sendLog(`[错误] 停止失败: ${errMsg}`, 'error');
      logger.error('Failed to stop service', error);
      throw error;
    }
  });

  ipcMain.handle('service:status', async () => {
    try {
      const status = proxyServer.getStatus();
      return status;
    } catch (error) {
      logger.error('Failed to get service status', error);
      throw error;
    }
  });

  // Headroom 安装 + 模型下载（由配置页面开关触发）
  ipcMain.handle('headroom:install', async (_event, hfMirrorUrl?: string) => {
    try {
      const installResult = await installHeadroom();
      if (!installResult.success) return installResult;

      const downloadResult = await downloadHeadroomModels(hfMirrorUrl || 'https://hf-mirror.com');
      return downloadResult;
    } catch (error: any) {
      logger.error('Failed to install headroom', error);
      return { success: false, reason: error.message };
    }
  });

  // Headroom 取消模型下载
  ipcMain.handle('headroom:cancelDownload', async () => {
    try {
      cancelHeadroomModelDownload();
      return { success: true };
    } catch (error: any) {
      logger.error('Failed to cancel headroom download', error);
      return { success: false, reason: error.message };
    }
  });


  ipcMain.handle('logs:get', async (event, filter) => {
    try {
      const logs = await database.getLogs(filter);
      return logs;
    } catch (error) {
      logger.error('Failed to get logs', error);
      throw error;
    }
  });

  ipcMain.handle('logs:clear', async () => {
    try {
      await database.clearLogs();
      logger.info('Logs cleared');
      return { success: true };
    } catch (error) {
      logger.error('Failed to clear logs', error);
      throw error;
    }
  });

  ipcMain.handle('stats:get', async (event, period) => {
    try {
      const stats = await database.getStats(period);
      return stats;
    } catch (error) {
      logger.error('Failed to get stats', error);
      throw error;
    }
  });

  ipcMain.handle('conversations:get', async (event, limit) => {
    try {
      const conversations = await database.getConversations(limit);
      return conversations;
    } catch (error) {
      logger.error('Failed to get conversations', error);
      throw error;
    }
  });

  ipcMain.handle('conversations:delete', async (event, id) => {
    try {
      await database.deleteConversation(id);
      logger.info('Conversation deleted', { id });
      return { success: true };
    } catch (error) {
      logger.error('Failed to delete conversation', error);
      throw error;
    }
  });

  ipcMain.handle('conversations:deleteAll', async () => {
    try {
      await database.deleteAllConversations();
      logger.info('All conversations deleted');
      return { success: true };
    } catch (error) {
      logger.error('Failed to delete all conversations', error);
      throw error;
    }
  });

  // ── Claude Code 会话浏览器 ──

  ipcMain.handle('sessions:scan', async () => {
    try {
      const homeDir = require('os').homedir();
      const claudeProjectsDir = path.join(homeDir, '.claude', 'projects');
      if (!fs.existsSync(claudeProjectsDir)) return [];

      const sessions: any[] = [];
      const walkDir = (dir: string) => {
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walkDir(fullPath);
          } else if (entry.name.endsWith('.jsonl') && !entry.name.startsWith('agent-')) {
            try {
              const meta = parseSessionMeta(fullPath, claudeProjectsDir);
              if (meta) sessions.push(meta);
            } catch { /* skip broken files */ }
          }
        }
      };
      walkDir(claudeProjectsDir);
      sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
      return sessions;
    } catch (error) {
      logger.error('Failed to scan sessions', error);
      return [];
    }
  });

  ipcMain.handle('sessions:messages', async (_, sessionPath: string) => {
    try {
      if (!fs.existsSync(sessionPath)) return [];
      const content = fs.readFileSync(sessionPath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      const messages: any[] = [];
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.isMeta) continue;
          const role = entry.type === 'human' ? 'user'
            : entry.type === 'assistant' ? 'assistant'
            : entry.role || 'unknown';
          let content = '';
          if (typeof entry.message?.content === 'string') {
            content = entry.message.content;
          } else if (Array.isArray(entry.message?.content)) {
            content = entry.message.content
              .filter((b: any) => b.type === 'text')
              .map((b: any) => b.text || '')
              .join('\n');
          } else if (typeof entry.content === 'string') {
            content = entry.content;
          } else if (Array.isArray(entry.content)) {
            content = entry.content
              .filter((b: any) => b.type === 'text')
              .map((b: any) => b.text || '')
              .join('\n');
          }
          if (!content && !role) continue;
          messages.push({
            role,
            content,
            timestamp: entry.timestamp ? new Date(entry.timestamp).getTime() : undefined,
          });
        } catch { /* skip unparseable lines */ }
      }
      return messages;
    } catch (error) {
      logger.error('Failed to load session messages', error);
      return [];
    }
  });

  ipcMain.handle('sessions:launch', async (_, sessionId: string, cwd: string) => {
    try {
      const { spawn } = require('child_process');
      const command = `cd "${cwd}" && claude --resume "${sessionId}"`;
      if (process.platform === 'darwin') {
        spawn('osascript', ['-e', `tell application "Terminal" to do script "${command.replace(/"/g, '\\"')}"`], { detached: true, stdio: 'ignore' });
      } else if (process.platform === 'win32') {
        spawn('cmd', ['/c', 'start', 'cmd', '/k', command], { detached: true, stdio: 'ignore' });
      } else {
        spawn('sh', ['-c', `x-terminal-emulator -e '${command}' || xterm -e '${command}'`], { detached: true, stdio: 'ignore' });
      }
      return { success: true };
    } catch (error) {
      logger.error('Failed to launch terminal resume', error);
      return { success: false };
    }
  });

  // ── Prompt 管理 ──

  ipcMain.handle('prompt:list', async () => {
    try {
      const config = await database.getConfig('default');
      return (config as any)?.prompts || [];
    } catch (error) {
      logger.error('Failed to list prompts', error);
      return [];
    }
  });

  ipcMain.handle('prompt:save', async (_, prompt: any) => {
    try {
      const config = (await database.getConfig('default')) || { id: 'default' } as any;
      const prompts: any[] = (config as any).prompts || [];
      const idx = prompts.findIndex((p: any) => p.id === prompt.id);
      if (idx >= 0) {
        prompts[idx] = { ...prompt, updatedAt: Date.now() };
      } else {
        prompts.push({ ...prompt, createdAt: Date.now(), updatedAt: Date.now() });
      }
      (config as any).prompts = prompts;
      await database.saveConfig(config as any);
      return { success: true };
    } catch (error) {
      logger.error('Failed to save prompt', error);
      throw error;
    }
  });

  ipcMain.handle('prompt:delete', async (_, id: string) => {
    try {
      const config = (await database.getConfig('default')) || { id: 'default' } as any;
      (config as any).prompts = ((config as any).prompts || []).filter((p: any) => p.id !== id);
      await database.saveConfig(config as any);
      return { success: true };
    } catch (error) {
      logger.error('Failed to delete prompt', error);
      throw error;
    }
  });

  ipcMain.handle('prompt:read-file', async (_, target: string) => {
    try {
      const homeDir = require('os').homedir();
      const filePaths: Record<string, string> = {
        claude: path.join(homeDir, '.claude', 'CLAUDE.md'),
        codex: path.join(homeDir, '.codex', 'AGENTS.md'),
        opencode: path.join(homeDir, '.opencode', 'AGENTS.md'),
      };
      const filePath = filePaths[target];
      if (!filePath) return { content: '', exists: false };
      if (!fs.existsSync(filePath)) return { content: '', exists: false };
      return { content: fs.readFileSync(filePath, 'utf-8'), exists: true };
    } catch (error) {
      logger.error('Failed to read prompt file', error);
      return { content: '', exists: false };
    }
  });

  ipcMain.handle('prompt:write-file', async (_, target: string, content: string) => {
    try {
      const homeDir = require('os').homedir();
      const filePaths: Record<string, string> = {
        claude: path.join(homeDir, '.claude', 'CLAUDE.md'),
        codex: path.join(homeDir, '.codex', 'AGENTS.md'),
        opencode: path.join(homeDir, '.opencode', 'AGENTS.md'),
      };
      const filePath = filePaths[target];
      if (!filePath) throw new Error(`Unknown target: ${target}`);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true };
    } catch (error) {
      logger.error('Failed to write prompt file', error);
      throw error;
    }
  });

  // ── Deep Link ──

  ipcMain.handle('deeplink:generate', async (_, payload: any) => {
    try {
      const json = JSON.stringify(payload);
      const b64 = Buffer.from(json).toString('base64url');
      return `dongcc://import?config=${b64}`;
    } catch (error) {
      logger.error('Failed to generate deep link', error);
      throw error;
    }
  });

  ipcMain.handle('settings:get', async () => {
    try {
      const settings = await database.getSettings();
      return settings;
    } catch (error) {
      logger.error('Failed to get settings', error);
      throw error;
    }
  });

  ipcMain.handle('settings:save', async (event, settings) => {
    try {
      await database.saveSettings(settings);
      if (settings.logLevel) {
        logger.setLogLevel(settings.logLevel);
      }
      if (settings.autoStart !== undefined) {
        app.setLoginItemSettings({ openAtLogin: settings.autoStart });
      }
      // 广播设置变更，供主进程刷新缓存（如"最小化到托盘"即时生效）
      app.emit('dongcc:settings-updated', settings);
      logger.info('Settings saved');
      return { success: true };
    } catch (error) {
      logger.error('Failed to save settings', error);
      throw error;
    }
  });

  ipcMain.handle('settings:reset', async () => {
    try {
      await database.resetSettings();
      logger.info('Settings reset to default');
      return { success: true };
    } catch (error) {
      logger.error('Failed to reset settings', error);
      throw error;
    }
  });

  ipcMain.handle('cache:clear', async () => {
    try {
      await database.clearCache();
      logger.info('Cache cleared');
      return { success: true };
    } catch (error) {
      logger.error('Failed to clear cache', error);
      throw error;
    }
  });

  ipcMain.handle('usage:summary', async (event, startDate?: number, endDate?: number) => {
    try {
      const summary = await database.getUsageSummary(startDate, endDate);
      return summary;
    } catch (error) {
      logger.error('Failed to get usage summary', error);
      throw error;
    }
  });

  ipcMain.handle('usage:trends', async (event, startDate?: number, endDate?: number) => {
    try {
      const trends = await database.getUsageTrends(startDate, endDate);
      return trends;
    } catch (error) {
      logger.error('Failed to get usage trends', error);
      throw error;
    }
  });

  ipcMain.handle('usage:modelStats', async () => {
    try {
      const stats = await database.getModelStats();
      return stats;
    } catch (error) {
      logger.error('Failed to get model stats', error);
      throw error;
    }
  });

  ipcMain.handle('usage:logs', async (event, filters?, page?, pageSize?) => {
    try {
      const logs = await database.getRequestLogs(filters || {}, page || 0, pageSize || 20);
      return logs;
    } catch (error) {
      logger.error('Failed to get request logs', error);
      throw error;
    }
  });

  ipcMain.handle('mcp:list', async () => {
    try {
      const servers = await database.getMcpServers();
      return servers;
    } catch (error) {
      logger.error('Failed to list MCP servers', error);
      throw error;
    }
  });

  ipcMain.handle('mcp:save', async (event, server: McpServer) => {
    try {
      const validation = mcpService.validateServer(server);
      if (!validation.valid) {
        throw new Error(validation.message);
      }

      await database.saveMcpServer(server);

      if (server.apps.claude) {
        await mcpService.syncServerToClaude(server);
      } else {
        await mcpService.removeServerFromClaude(server.id);
      }

      logger.info('MCP server saved', { id: server.id });
      return { success: true };
    } catch (error) {
      logger.error('Failed to save MCP server', error);
      throw error;
    }
  });

  ipcMain.handle('mcp:delete', async (event, id: string) => {
    try {
      const servers = await database.getMcpServers();
      const server = servers.find(s => s.id === id);

      if (server && server.apps.claude) {
        await mcpService.removeServerFromClaude(id);
      }

      await database.deleteMcpServer(id);
      logger.info('MCP server deleted', { id });
      return { success: true };
    } catch (error) {
      logger.error('Failed to delete MCP server', error);
      throw error;
    }
  });

  ipcMain.handle('mcp:toggleApp', async (event, id: string, app: 'claude', enabled: boolean) => {
    try {
      const server = await database.toggleMcpApp(id, app, enabled);

      if (server) {
        if (enabled) {
          await mcpService.syncServerToClaude(server);
        } else {
          await mcpService.removeServerFromClaude(id);
        }
      }

      logger.info('MCP server app toggled', { id, app, enabled });
      return { success: true };
    } catch (error) {
      logger.error('Failed to toggle MCP server app', error);
      throw error;
    }
  });

  ipcMain.handle('mcp:getPresets', async () => {
    try {
      return mcpService.getPresets();
    } catch (error) {
      logger.error('Failed to get MCP presets', error);
      throw error;
    }
  });

  ipcMain.handle('mcp:importFromClaude', async () => {
    try {
      const imported = await mcpService.importFromClaude();
      const existing = await database.getMcpServers();
      let newCount = 0;

      for (const server of imported) {
        if (!existing.find(s => s.id === server.id)) {
          await database.saveMcpServer(server);
          newCount++;
        }
      }

      logger.info('MCP servers imported from Claude', { count: newCount });
      return { count: newCount, servers: imported };
    } catch (error) {
      logger.error('Failed to import MCP from Claude', error);
      throw error;
    }
  });

  ipcMain.handle('skills:list', async () => {
    try {
      const skills = await database.getSkills();
      return skills;
    } catch (error) {
      logger.error('Failed to list skills', error);
      throw error;
    }
  });

  ipcMain.handle('skills:save', async (event, skill: InstalledSkill) => {
    try {
      await database.saveSkill(skill);

      if (skill.apps.claude) {
        await skillService.syncToClaude(skill);
      } else {
        await skillService.removeFromClaude(skill.directory);
      }

      logger.info('Skill saved', { id: skill.id });
      return { success: true };
    } catch (error) {
      logger.error('Failed to save skill', error);
      throw error;
    }
  });

  ipcMain.handle('skills:delete', async (event, id: string) => {
    try {
      logger.info('Deleting skill', { id });
      const skills = await database.getSkills();
      const skill = skills.find(s => s.id === id);

      if (skill) {
        logger.info('Found skill to delete', { id, name: skill.name });
        await skillService.uninstallSkill(skill);
        await database.deleteSkill(id);
        logger.info('Skill deleted successfully', { id });
      } else {
        logger.warn('Skill not found for deletion', { id });
      }

      return { success: true };
    } catch (error) {
      logger.error('Failed to delete skill', error);
      throw error;
    }
  });

  ipcMain.handle('skills:toggleApp', async (event, id: string, app: 'claude', enabled: boolean) => {
    try {
      const skill = await database.toggleSkillApp(id, app, enabled);

      if (skill) {
        if (enabled) {
          await skillService.syncToClaude(skill);
        } else {
          await skillService.removeFromClaude(skill.directory);
        }
      }

      logger.info('Skill app toggled', { id, app, enabled });
      return { success: true };
    } catch (error) {
      logger.error('Failed to toggle skill app', error);
      throw error;
    }
  });

  ipcMain.handle('skills:rename', async (event, id: string, name: string) => {
    try {
      const trimmed = (name || '').trim();
      if (!trimmed) {
        return { success: false, error: 'EMPTY_NAME' };
      }
      const skill = await database.renameSkill(id, trimmed);
      if (!skill) {
        return { success: false, error: 'NOT_FOUND' };
      }
      logger.info('Skill renamed', { id, name: trimmed });
      return { success: true };
    } catch (error) {
      logger.error('Failed to rename skill', error);
      throw error;
    }
  });

  ipcMain.handle('skills:scanUnmanaged', async () => {
    try {
      logger.info('Scanning unmanaged skills...');
      const installed = await database.getSkills();
      logger.info('Installed skills count', { count: installed.length });
      const unmanaged = await skillService.scanUnmanagedSkills(installed);
      logger.info('Found unmanaged skills', { count: unmanaged.length });
      return unmanaged;
    } catch (error) {
      logger.error('Failed to scan unmanaged skills', error);
      throw error;
    }
  });

  ipcMain.handle('skills:import', async (event, directory: string) => {
    try {
      const skill = await skillService.importSkill(directory, 'claude');
      if (skill) {
        await database.saveSkill(skill);
        logger.info('Skill imported', { id: skill.id });
        return skill;
      }
      return null;
    } catch (error) {
      logger.error('Failed to import skill', error);
      throw error;
    }
  });

  ipcMain.handle('skills:importFromPath', async (event, sourcePath: string, sourceType: 'global' | 'project', sourceProject?: string) => {
    try {
      const skill = await skillService.importSkillFromPath(sourcePath, sourceType, sourceProject);
      if (skill) {
        await database.saveSkill(skill);
        logger.info('Skill imported from path', { id: skill.id, sourcePath, sourceType, sourceProject });
        return skill;
      }
      return null;
    } catch (error) {
      logger.error('Failed to import skill from path', error);
      throw error;
    }
  });

  ipcMain.handle('skills:importMultiple', async (event, directories: string[]) => {
    try {
      const imported: InstalledSkill[] = [];
      for (const directory of directories) {
        const skill = await skillService.importSkill(directory, 'claude');
        if (skill) {
          await database.saveSkill(skill);
          imported.push(skill);
        }
      }
      logger.info('Skills imported', { count: imported.length });
      return imported;
    } catch (error) {
      logger.error('Failed to import skills', error);
      throw error;
    }
  });

  ipcMain.handle('skills:getRepos', async () => {
    try {
      const repos = await skillService.getRepos();
      return repos;
    } catch (error) {
      logger.error('Failed to get skill repos', error);
      throw error;
    }
  });

  ipcMain.handle('skills:saveRepo', async (event, repo) => {
    try {
      await skillService.saveRepo(repo);
      await database.saveSkillRepo(repo);
      logger.info('Skill repo saved', { owner: repo.owner, name: repo.name });
      return { success: true };
    } catch (error) {
      logger.error('Failed to save skill repo', error);
      throw error;
    }
  });

  ipcMain.handle('skills:deleteRepo', async (event, owner: string, name: string) => {
    try {
      await skillService.deleteRepo(owner, name);
      await database.deleteSkillRepo(owner, name);
      logger.info('Skill repo deleted', { owner, name });
      return { success: true };
    } catch (error) {
      logger.error('Failed to delete skill repo', error);
      throw error;
    }
  });

  ipcMain.handle('skills:listProjects', async () => {
    return [];
  });



  ipcMain.handle('skills:scanCustomProject', async (event, projectPath: string) => {
    return [];
  });

  ipcMain.handle('skills:getDirectory', async (event, id: string) => {
    try {
      const skills = await database.getSkills();
      const skill = skills.find(s => s.id === id);
      if (!skill) {
        logger.error('Skill not found', { id });
        throw new Error('Skill not found');
      }
      logger.info('Found skill', { 
        id, 
        directory: skill.directory, 
        sourceType: skill.sourceType, 
        sourceProject: skill.sourceProject 
      });
      const dir = skillService.getSkillDirectory(skill);
      const exists = skillService.skillDirectoryExists(skill);
      logger.info('Got skill directory', { id, dir, exists });
      
      if (!exists) {
        logger.warn('Skill directory does not exist, skill may need to be re-imported', { id, dir });
      }
      
      return { dir, exists };
    } catch (error) {
      logger.error('Failed to get skill directory', error);
      throw error;
    }
  });

  ipcMain.handle('openInFinder', async (event, filePath: string) => {
    try {
      logger.info('Opening in Finder', { filePath });
      if (!fs.existsSync(filePath)) {
        logger.warn('Path does not exist, creating parent directories', { filePath });
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
      }
      shell.showItemInFolder(filePath);
      return { success: true };
    } catch (error) {
      logger.error('Failed to open in Finder', error);
      throw error;
    }
  });

  ipcMain.handle('openExternal', async (event, url: string) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      logger.error('Failed to open external URL', error);
      throw error;
    }
  });

  ipcMain.handle('cost:calculate', async (event, modelId, inputTokens, outputTokens, cacheCreationTokens?, cacheReadTokens?) => {
    try {
      const cost = costCalculator.calculateCost(modelId, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens);
      return cost;
    } catch (error) {
      logger.error('Failed to calculate cost', error);
      throw error;
    }
  });

  ipcMain.handle('cost:getPricing', async (event, modelId?) => {
    try {
      if (modelId) {
        return costCalculator.getModelPricing(modelId);
      }
      return costCalculator.getAllPricing();
    } catch (error) {
      logger.error('Failed to get pricing', error);
      throw error;
    }
  });

  ipcMain.handle('cost:estimateMonthly', async (event, modelId, dailyInputTokens, dailyOutputTokens) => {
    try {
      const monthlyCost = costCalculator.estimateMonthlyCost(modelId, dailyInputTokens, dailyOutputTokens);
      return monthlyCost;
    } catch (error) {
      logger.error('Failed to estimate monthly cost', error);
      throw error;
    }
  });

  ipcMain.handle('export:csv', async (event, data, filename) => {
    try {
      const filePath = await dataExporter.exportToCSV(data, filename);
      logger.info('Data exported to CSV', { filePath });
      return filePath;
    } catch (error) {
      logger.error('Failed to export to CSV', error);
      throw error;
    }
  });

  ipcMain.handle('export:excel', async (event, data, filename) => {
    try {
      const filePath = await dataExporter.exportToExcel(data, filename);
      logger.info('Data exported to Excel', { filePath });
      return filePath;
    } catch (error) {
      logger.error('Failed to export to Excel', error);
      throw error;
    }
  });

  ipcMain.handle('export:json', async (event, data, filename) => {
    try {
      const filePath = await dataExporter.exportToJson(data, filename);
      logger.info('Data exported to JSON', { filePath });
      return filePath;
    } catch (error) {
      logger.error('Failed to export to JSON', error);
      throw error;
    }
  });

  // Skills: Open ZIP file dialog
  ipcMain.handle('skills:openZipFileDialog', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'ZIP Files', extensions: ['zip'] }],
      });
      logger.info('ZIP file dialog result', { canceled: result.canceled, filePaths: result.filePaths });
      return result.filePaths[0] || null;
    } catch (error) {
      logger.error('Failed to open ZIP file dialog', error);
      throw error;
    }
  });

  // Skills: Install from ZIP
  ipcMain.handle('skills:installFromZip', async (event, filePath: string, currentApp: 'claude' = 'claude') => {
    try {
      logger.info('Installing skills from ZIP', { filePath, currentApp });
      const skills = await zipInstaller.installFromZip(filePath, currentApp);

      for (const skill of skills) {
        await database.saveSkill(skill);
        await skillService.syncToClaude(skill);
        logger.info('Skill installed from ZIP', { id: skill.id, name: skill.name });
      }

      logger.info('Skills installed from ZIP successfully', { count: skills.length, filePath });
      return skills;
    } catch (error) {
      logger.error('Failed to install skills from ZIP', error);
      throw error;
    }
  });

  // Skills: Install from ZIP URL (download then install)
  ipcMain.handle('skills:installFromZipUrl', async (event, url: string, currentApp: 'claude' = 'claude') => {
    const os = require('os');
    const { net } = require('electron');
    const tempZipPath = path.join(os.tmpdir(), `dongcc-download-${Date.now()}.zip`);

    try {
      logger.info('Downloading skill ZIP from URL', { url });

      const response = await net.fetch(url);
      if (!response.ok) {
        throw new Error(`下载失败: HTTP ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(tempZipPath, buffer);

      logger.info('ZIP downloaded, installing...', { tempZipPath });
      const skills = await zipInstaller.installFromZip(tempZipPath, currentApp);

      for (const skill of skills) {
        await database.saveSkill(skill);
        await skillService.syncToClaude(skill);
        logger.info('Skill installed from ZIP URL', { id: skill.id, name: skill.name });
      }

      logger.info('Skills installed from ZIP URL successfully', { count: skills.length, url });
      return skills;
    } catch (error) {
      logger.error('Failed to install skills from ZIP URL', error);
      throw error;
    } finally {
      try { fs.unlinkSync(tempZipPath); } catch {}
    }
  });

  // Skills: Reinstall from new ZIP (re-upload for zip-type skills)
  ipcMain.handle('skills:reinstallFromZip', async (event, id: string, filePath: string) => {
    try {
      logger.info('Reinstalling skill from ZIP', { id, filePath });
      const existingSkills = await database.getSkills();
      const existing = existingSkills.find((s: any) => s.id === id);

      const skills = await zipInstaller.installFromZip(filePath, 'claude');
      if (skills.length === 0) {
        throw new Error('ZIP 文件中未找到有效的 Skill');
      }

      const newSkillData = skills[0];
      // Preserve original id and apps config, update content from new ZIP
      const updatedSkill = {
        ...newSkillData,
        id,
        apps: existing?.apps || newSkillData.apps,
      };

      await database.saveSkill(updatedSkill);
      await skillService.syncToClaude(updatedSkill);
      logger.info('Skill reinstalled from ZIP', { id, name: updatedSkill.name });
      return updatedSkill;
    } catch (error) {
      logger.error('Failed to reinstall skill from ZIP', error);
      throw error;
    }
  });

  // Skills: Update name/description metadata
  ipcMain.handle('skills:updateMeta', async (event, id: string, meta: { name?: string; description?: string }) => {
    try {
      const skills = await database.getSkills();
      const skill = skills.find((s: any) => s.id === id);
      if (!skill) throw new Error('Skill not found');
      const updated = { ...skill, ...meta };
      await database.saveSkill(updated);
      logger.info('Skill meta updated', { id, meta });
      return updated;
    } catch (error) {
      logger.error('Failed to update skill meta', error);
      throw error;
    }
  });

  // Skills: Discover available skills from repos
  ipcMain.handle('skills:discover', async () => {
    try {
      logger.info('Discovering available skills from repos');
      const repos = await skillService.getRepos();
      const enabledRepos = repos.filter(r => r.enabled);
      logger.info('Found enabled repos', { count: enabledRepos.length, repos: enabledRepos.map(r => `${r.owner}/${r.name}`) });

      const skills = await skillService.discoverAvailableSkills(enabledRepos);
      logger.info('Discovered skills', { count: skills.length });

      return skills;
    } catch (error) {
      logger.error('Failed to discover skills', error);
      return [];
    }
  });

  // Skills: Install from repo
  ipcMain.handle('skills:installFromRepo', async (event, skill: DiscoverableSkill, currentApp: 'claude' = 'claude') => {
    try {
      logger.info('Installing skill from repo', {
        name: skill.name,
        directory: skill.directory,
        repo: `${skill.repoOwner}/${skill.repoName}`
      });

      const installedSkill = await skillService.installSkillFromRepo(skill, currentApp);
      await database.saveSkill(installedSkill);
      await skillService.syncToClaude(installedSkill);

      logger.info('Skill installed from repo successfully', {
        id: installedSkill.id,
        name: installedSkill.name
      });

      return installedSkill;
    } catch (error) {
      logger.error('Failed to install skill from repo', error);
      throw error;
    }
  });

  ipcMain.handle('skills:installByScript', async (event, taskId: string, steps: { cmd: string; args: string[] }[]) => {
    const { spawn, execSync } = require('child_process');
    const os = require('os');
    const pathModule = require('path');
    const sender = event.sender;
    const send = (stream: 'stdout' | 'stderr' | 'meta', line: string) => {
      if (!sender.isDestroyed()) {
        sender.send('skills:installScriptLog', { taskId, stream, line });
      }
    };

    const loginShell = process.platform === 'win32'
      ? (process.env.COMSPEC || 'cmd.exe')
      : (process.env.SHELL || '/bin/bash');
    let shellPath = process.env.PATH || '';
    if (process.platform !== 'win32') {
      try {
        shellPath = execSync(`${loginShell} -l -i -c 'echo $PATH'`, { encoding: 'utf-8', timeout: 10000 }).trim();
      } catch {
        try {
          shellPath = execSync(`${loginShell} -l -c 'echo $PATH'`, { encoding: 'utf-8', timeout: 5000 }).trim();
        } catch {}
      }
    }

    const isWin = process.platform === 'win32';
    const pathSep = isWin ? ';' : ':';
    const extraPaths = isWin ? [] : [
      '/usr/local/bin',
      '/opt/homebrew/bin',
      pathModule.join(os.homedir(), '.nvm/versions/node'),
      pathModule.join(os.homedir(), '.fnm/aliases/default/bin'),
      pathModule.join(os.homedir(), '.local/bin'),
    ];
    for (const p of extraPaths) {
      if (!shellPath.includes(p)) {
        shellPath = `${shellPath}${pathSep}${p}`;
      }
    }

    // Try to resolve nvm current node bin path
    if (!isWin) {
      try {
        const nvmDir = process.env.NVM_DIR || pathModule.join(os.homedir(), '.nvm');
        const nvmNodeBin = execSync(
          `source "${nvmDir}/nvm.sh" && dirname "$(which node)"`,
          { encoding: 'utf-8', timeout: 5000, shell: loginShell }
        ).trim();
        if (nvmNodeBin && !shellPath.includes(nvmNodeBin)) {
          shellPath = `${nvmNodeBin}${pathSep}${shellPath}`;
        }
      } catch {}
    }

    const npmGlobalPrefix = pathModule.join(os.homedir(), '.dongcc', 'npm-global');
    const npmGlobalBin = pathModule.join(npmGlobalPrefix, isWin ? '' : 'bin');
    if (!shellPath.includes(npmGlobalBin)) {
      shellPath = `${npmGlobalBin}${pathSep}${shellPath}`;
    }

    const runStep = (cmd: string, args: string[]) => new Promise<void>((resolve, reject) => {
      const finalArgs = [...args];
      if (cmd === 'npm' && finalArgs.includes('-g') && (finalArgs.includes('install') || finalArgs.includes('i'))) {
        if (!finalArgs.some(a => a.startsWith('--prefix'))) {
          finalArgs.push('--prefix', npmGlobalPrefix);
        }
        // 使用独立 cache 目录，避免和系统 npm cache 权限冲突 (EEXIST/EACCES)
        if (!finalArgs.some(a => a.startsWith('--cache'))) {
          finalArgs.push('--cache', pathModule.join(npmGlobalPrefix, '.npm-cache'));
        }
      }
      send('meta', `$ ${cmd} ${finalArgs.join(' ')}`);
      const child = spawn(cmd, finalArgs, {
        cwd: os.homedir(),
        env: { ...process.env, PATH: shellPath, HOME: os.homedir() },
        shell: isWin ? true : loginShell,
      });
      child.stdout?.on('data', (buf: Buffer) => {
        buf.toString().split('\n').forEach((l) => l && send('stdout', l));
      });
      child.stderr?.on('data', (buf: Buffer) => {
        buf.toString().split('\n').forEach((l) => l && send('stderr', l));
      });
      child.on('error', (err: Error) => reject(err));
      child.on('close', (code: number) => {
        if (code === 0) resolve();
        else reject(new Error(`命令退出码 ${code}`));
      });
    });

    try {
      fs.mkdirSync(npmGlobalPrefix, { recursive: true });

      // 记录安装前的 skill 目录快照
      const claudeSkillsDirSnap = skillService.getClaudeSkillsDir();
      const entriesBeforeInstall = new Set(
        fs.existsSync(claudeSkillsDirSnap)
          ? fs.readdirSync(claudeSkillsDirSnap).filter(e => !e.startsWith('.'))
          : []
      );

      // 清理 ~/.claude/skills/ 下的失效软链（指向 node_modules 但旧版本路径已失效）
      const claudeSkillsDirEarly = skillService.getClaudeSkillsDir();
      if (fs.existsSync(claudeSkillsDirEarly)) {
        for (const entry of fs.readdirSync(claudeSkillsDirEarly)) {
          const linkPath = pathModule.join(claudeSkillsDirEarly, entry);
          try {
            const lst = fs.lstatSync(linkPath);
            if (!lst.isSymbolicLink()) continue;
            const target = fs.readlinkSync(linkPath);
            const looksLikeNodeModules = target.includes('node_modules');
            if (!looksLikeNodeModules) continue;
            const exists = fs.existsSync(linkPath);
            const pointsToOldPrefix = !target.startsWith(npmGlobalPrefix);
            if (!exists || pointsToOldPrefix) {
              fs.unlinkSync(linkPath);
              send('meta', `🧹 已清理旧软链: ${entry}`);
            }
          } catch {}
        }
      }

      for (const step of steps) {
        await runStep(step.cmd, step.args);
      }
      send('meta', '✅ 全部步骤执行完成，开始导入 skill...');

      const installedNow = await database.getSkills();
      const installedDirs = new Map(installedNow.map(s => [s.directory, s] as const));
      const claudeSkillsDir = skillService.getClaudeSkillsDir();
      let importedCount = 0;
      let updatedCount = 0;

      // 导入新增目录 + 更新已存在目录（覆盖安装场景）
      if (fs.existsSync(claudeSkillsDir)) {
        const currentEntries = new Set(fs.readdirSync(claudeSkillsDir).filter(e => !e.startsWith('.')));
        const newEntries = [...currentEntries].filter(e => !entriesBeforeInstall.has(e));
        const existingEntries = [...currentEntries].filter(e => entriesBeforeInstall.has(e));
        const allEntries = [...newEntries, ...existingEntries];

        for (const entry of allEntries) {
          const fullPath = path.join(claudeSkillsDir, entry);
          try {
            const st = fs.statSync(fullPath);
            if (!st.isDirectory()) continue;
            if (!fs.existsSync(path.join(fullPath, 'SKILL.md'))) continue;
          } catch {
            continue;
          }
          const existing = installedDirs.get(entry);
          try {
            const imported = await skillService.importSkillFromPath(fullPath, 'global');
            if (!imported) continue;
            if (existing) {
              imported.id = existing.id;
              imported.installedAt = existing.installedAt;
              imported.apps = existing.apps;
            }
            await database.saveSkill(imported);
            if (imported.apps.claude) {
              await skillService.syncToClaude(imported);
            }
            if (existing) updatedCount++;
            else importedCount++;
          } catch (err) {
            send('stderr', `导入 ${entry} 失败: ${(err as Error).message}`);
          }
        }
      }

      const summary = updatedCount > 0
        ? `🎉 新增 ${importedCount} 个 / 更新 ${updatedCount} 个 skill`
        : `🎉 已导入 ${importedCount} 个 skill 到管理列表`;
      send('meta', summary);
      return { success: true, imported: importedCount, updated: updatedCount };
    } catch (err) {
      send('stderr', `❌ 失败: ${(err as Error).message}`);
      throw err;
    }
  });


  ipcMain.handle('skills:getInstallDir', () => {
    return skillService.getClaudeSkillsDir();
  });

  ipcMain.handle('skills:setInstallDir', (_event, dir: string) => {
    const result = skillService.validateInstallDir(dir.trim());
    if (result.error) {
      return result;
    }
    skillService.setClaudeSkillsDir(dir.trim());
    logger.info('Skill install dir updated', { dir: dir.trim() });
    return { success: true };
  });

  ipcMain.handle('skills:community:list', async (_event, query: any) => {
    return skillService.fetchCommunitySkills(query || {});
  });

  ipcMain.handle('skills:community:publish', async (_event, params: { name: string; description: string; npmPackage: string; installCommand: string; domain: string; tags: string[]; docUrl?: string; skillIconUrl?: string; authorAvatar?: string; authorName?: string; authorDepartment?: string; authorOrgFullPath?: string; authorPosition?: string }) => {
    const erp = require('os').userInfo().username;
    return skillService.publishCommunitySkill(params, erp);
  });

  ipcMain.handle('skills:community:upload-icon', async (_event, fileData: number[], fileName: string) => {
    if (!options?.ossUploader) {
      throw new Error('OSS upload not available in open-source version');
    }
    return options.ossUploader.uploadFile(fileData, fileName, 'skill-icons');
  });

  ipcMain.handle('skills:community:upload-zip', async (_event, fileData: number[], fileName: string) => {
    if (!options?.ossUploader) {
      throw new Error('OSS upload not available in open-source version');
    }
    return options.ossUploader.uploadFile(fileData, fileName, 'skill-zips');
  });

  ipcMain.handle('skills:community:install', async (_event, communitySkill: any) => {
    return { installCommand: communitySkill.installCommand };
  });

  ipcMain.handle('skills:community:incrementDownload', async (_event, id: string) => {
    const erp = require('os').userInfo().username;
    return skillService.incrementCommunityDownload(id, erp);
  });

  ipcMain.handle('skills:community:star', async (_event, id: string) => {
    const erp = require('os').userInfo().username;
    return skillService.starCommunitySkill(id, erp);
  });

  ipcMain.handle('skills:community:unstar', async (_event, id: string) => {
    const erp = require('os').userInfo().username;
    return skillService.unstarCommunitySkill(id, erp);
  });

  ipcMain.handle('skills:community:update', async (_event, id: string, params: { name?: string; description?: string; domain?: string; tags?: string[]; docUrl?: string; skillIconUrl?: string; installCommand?: string }) => {
    const erp = require('os').userInfo().username;
    return skillService.updateCommunitySkill(id, params, erp);
  });

  ipcMain.handle('skills:community:delete', async (_event, id: string) => {
    const erp = require('os').userInfo().username;
    return skillService.deleteCommunitySkill(id, erp);
  });

  ipcMain.handle('system:getErp', () => {
    return require('os').userInfo().username;
  });

  ipcMain.handle('ranking:fetch', async (_event, url: string) => {
    if (options?.rankingProvider) {
      return options.rankingProvider.fetchRanking(url);
    }
    throw new Error('Ranking feature not available in open-source version');
  });

  ipcMain.handle('user:getInfo', async () => {
    if (options?.authProvider) {
      let info = options.authProvider.getCachedUserInfo();
      if (!info) {
        try {
          info = await options.authProvider.requireAuth();
        } catch {
          info = null;
        }
      }
      return info;
    }
    return getCachedUserInfo();
  });

  ipcMain.handle('user:login', async () => {
    if (options?.authProvider) {
      return options.authProvider.requireAuth();
    }
    return getCachedUserInfo();
  });

  // 只读当前缓存用户,不触发登录弹窗(供设置页展示账号)
  ipcMain.handle('user:getCached', () => {
    return options?.authProvider?.getCachedUserInfo() ?? getCachedUserInfo();
  });

  // 退出登录:清缓存 + 清 SSO cookie,并通知渲染层清空用户展示
  ipcMain.handle('user:logout', async () => {
    try {
      if (options?.authProvider?.logout) {
        await options.authProvider.logout();
      } else {
        await coreLogout();
      }
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send('user:info-updated', null));
      logger.info('User logged out via settings');
      return { success: true };
    } catch (error: any) {
      logger.error('Logout failed', error);
      return { success: false, reason: error?.message };
    }
  });

  logger.info('IPC handlers setup complete');

}
