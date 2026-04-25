import { ipcMain, shell, dialog, app } from 'electron';
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

export function setupIPC(
  proxyServer: ProxyServer,
  database: DatabaseManager
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

  ipcMain.handle('service:start', async (event, config) => {
    try {
      proxyServer.configure(config);

      await systemChecker.autoConfigureClaude(
        config.port,
        config.apiKey,
        config.models,
        config.defaultModel,
        config.apiFormat
      );
      logger.info('Claude config updated', {
        port: config.port,
        modelsCount: config.models?.length || 0,
        defaultModel: config.defaultModel
      });

      const mcpServers = await database.getMcpServers();
      const enabledServers = mcpServers.filter(s => s.apps.claude);
      if (enabledServers.length > 0) {
        for (const server of enabledServers) {
          await mcpService.syncServerToClaude(server);
        }
        logger.info('MCP config synced', { count: enabledServers.length });
      }

      const skills = await database.getSkills();
      const enabledSkills = skills.filter(s => s.apps.claude);
      if (enabledSkills.length > 0) {
        for (const skill of enabledSkills) {
          await skillService.syncToClaude(skill);
        }
        logger.info('Skills config synced', { count: enabledSkills.length });
      }

      await proxyServer.start(config.port);
      logger.info('Service started', { port: config.port });

      const configCheck = await systemChecker.checkClaudeConfig();
      if (!configCheck.valid) {
        logger.warn('Claude config validation failed', configCheck);
        throw new Error('环境配置验证失败，请检查配置文件');
      }

      logger.info('Environment check passed', { configPath: configCheck.path });
      return { success: true };
    } catch (error) {
      logger.error('Failed to start service', error);
      throw error;
    }
  });

  ipcMain.handle('service:stop', async () => {
    try {
      await proxyServer.stop();
      await systemChecker.restoreClaudeConfig();
      logger.info('Service stopped and config restored');
      return { success: true };
    } catch (error) {
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
      let newCount = 0;

      for (const server of imported) {
        const existing = await database.getMcpServers();
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
    try {
      const projects = await skillService.listProjectsWithSkills();
      return projects;
    } catch (error) {
      logger.error('Failed to list projects with skills', error);
      throw error;
    }
  });



  ipcMain.handle('skills:scanCustomProject', async (event, projectPath: string) => {
    try {
      const unmanaged = await skillService.scanCustomProjectPath(projectPath);
      return unmanaged;
    } catch (error) {
      logger.error('Failed to scan custom project', error);
      throw error;
    }
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
        logger.info('Skill installed from ZIP', { id: skill.id, name: skill.name });
      }

      logger.info('Skills installed from ZIP successfully', { count: skills.length, filePath });
      return skills;
    } catch (error) {
      logger.error('Failed to install skills from ZIP', error);
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

  logger.info('IPC handlers setup complete');
}
