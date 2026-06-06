import { ipcMain, shell, dialog, app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { ProxyServer } from '../proxy/server';
import { DatabaseManager } from '../database';
import { logger } from '../logger';
import { SystemChecker } from '../system/checker';
import { mcpService, McpServer } from '../mcp/mcpService';
import { skillService, InstalledSkill, DiscoverableSkill } from '../skills/skillService';
import { CostCalculator, defaultPricing } from '../cost/calculator';
import { DataExporter } from '../export/dataExporter';
import { zipInstaller } from '../skills/zipInstaller';
import { getCachedUserInfo } from '../auth/localAuth';

interface IPCHandlersOptions {
  authProvider?: {
    requireAuth: () => Promise<any>;
    getCachedUserInfo: () => any | null;
  };
  rankingProvider?: {
    fetchRanking: (url: string) => Promise<any>;
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

  ipcMain.handle('config:testConnection', async (_event, clientType: 'claude' | 'codex', port: number, clientCfg: { apiKey: string; baseUrl: string; apiFormat: 'chat-completions' | 'responses' | 'anthropic' }) => {
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
        sendLog(`[登录] 已登录: ${userInfo.name}`);
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
          claudeCfg.baseUrl
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

      sendLog(`[代理] 正在启动代理服务，端口 ${config.port}...`);
      await proxyServer.start(config.port);
      sendLog(`[代理] 代理服务已启动，监听 http://127.0.0.1:${config.port}`);
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
      await proxyServer.stop();
      sendLog('[配置] 正在还原 Claude Code 配置...');
      await systemChecker.restoreClaudeConfig();
      sendLog('[配置] 正在还原 Codex CLI 配置...');
      await systemChecker.restoreCodexConfig();
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
      throw error;
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

    const loginShell = process.env.SHELL || '/bin/zsh';
    let shellPath = process.env.PATH || '';
    try {
      shellPath = execSync(`${loginShell} -l -i -c 'echo $PATH'`, { encoding: 'utf-8', timeout: 10000 }).trim();
    } catch {
      try {
        shellPath = execSync(`${loginShell} -l -c 'echo $PATH'`, { encoding: 'utf-8', timeout: 5000 }).trim();
      } catch {}
    }

    const extraPaths = [
      '/usr/local/bin',
      '/opt/homebrew/bin',
      pathModule.join(os.homedir(), '.nvm/versions/node'),
      pathModule.join(os.homedir(), '.fnm/aliases/default/bin'),
      pathModule.join(os.homedir(), '.local/bin'),
    ];
    for (const p of extraPaths) {
      if (!shellPath.includes(p)) {
        shellPath = `${shellPath}:${p}`;
      }
    }

    // Try to resolve nvm current node bin path
    try {
      const nvmDir = process.env.NVM_DIR || pathModule.join(os.homedir(), '.nvm');
      const nvmNodeBin = execSync(
        `source "${nvmDir}/nvm.sh" && dirname "$(which node)"`,
        { encoding: 'utf-8', timeout: 5000, shell: loginShell }
      ).trim();
      if (nvmNodeBin && !shellPath.includes(nvmNodeBin)) {
        shellPath = `${nvmNodeBin}:${shellPath}`;
      }
    } catch {}

    const npmGlobalPrefix = pathModule.join(os.homedir(), '.dongcc', 'npm-global');
    const npmGlobalBin = pathModule.join(npmGlobalPrefix, 'bin');
    if (!shellPath.includes(npmGlobalBin)) {
      shellPath = `${npmGlobalBin}:${shellPath}`;
    }

    const runStep = (cmd: string, args: string[]) => new Promise<void>((resolve, reject) => {
      const finalArgs = [...args];
      if (cmd === 'npm' && finalArgs.includes('-g') && (finalArgs.includes('install') || finalArgs.includes('i'))) {
        if (!finalArgs.some(a => a.startsWith('--prefix'))) {
          finalArgs.push('--prefix', npmGlobalPrefix);
        }
      }
      send('meta', `$ ${cmd} ${finalArgs.join(' ')}`);
      const child = spawn(cmd, finalArgs, {
        cwd: os.homedir(),
        env: { ...process.env, PATH: shellPath, HOME: os.homedir() },
        shell: loginShell,
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

      // 只导入安装前后新增的目录，不全量扫描
      if (fs.existsSync(claudeSkillsDir)) {
        const currentEntries = new Set(fs.readdirSync(claudeSkillsDir).filter(e => !e.startsWith('.')));
        const newEntries = [...currentEntries].filter(e => !entriesBeforeInstall.has(e));

        for (const entry of newEntries) {
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

  ipcMain.handle('skills:community:publish', async (_event, params: { name: string; description: string; npmPackage: string; installCommand: string; domain: string; tags: string[]; docUrl?: string; skillIconUrl?: string; authorAvatar?: string }) => {
    const username = require('os').userInfo().username;
    return skillService.publishCommunitySkill(params, username);
  });

  ipcMain.handle('skills:community:upload-icon', async (_event, fileData: number[], fileName: string) => {
    // 开源版不支持 OSS 上传，内部版需通过 authProvider 或配置注入
    throw new Error('OSS upload not available in open-source version');
  });

  ipcMain.handle('skills:community:upload-zip', async (_event, fileData: number[], fileName: string) => {
    // 开源版不支持 OSS 上传，内部版需通过 authProvider 或配置注入
    throw new Error('OSS upload not available in open-source version');
  });

  ipcMain.handle('skills:community:install', async (_event, communitySkill: any) => {
    return { installCommand: communitySkill.installCommand };
  });

  ipcMain.handle('skills:community:incrementDownload', async (_event, id: string) => {
    const username = require('os').userInfo().username;
    return skillService.incrementCommunityDownload(id, username);
  });

  ipcMain.handle('skills:community:update', async (_event, id: string, params: { description?: string; domain?: string; tags?: string[]; docUrl?: string; skillIconUrl?: string }) => {
    const username = require('os').userInfo().username;
    return skillService.updateCommunitySkill(id, params, username);
  });

  ipcMain.handle('skills:community:delete', async (_event, id: string) => {
    const username = require('os').userInfo().username;
    return skillService.deleteCommunitySkill(id, username);
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

  logger.info('IPC handlers setup complete');

}
