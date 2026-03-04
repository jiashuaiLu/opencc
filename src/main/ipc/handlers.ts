import { ipcMain } from 'electron';
import { ProxyServer } from '../proxy/server';
import { DatabaseManager } from '../database';
import { logger } from '../logger';
import { SystemChecker, EnvironmentStatus } from '../system/checker';

export function setupIPC(
  proxyServer: ProxyServer, 
  database: DatabaseManager,
  systemChecker: SystemChecker,
  initialEnvironmentStatus: EnvironmentStatus | null
): void {
  let environmentStatus = initialEnvironmentStatus;
  // 配置相关
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

  // 服务控制
  ipcMain.handle('service:start', async (event, config) => {
    try {
      // 1. 配置代理服务器
      proxyServer.configure(config);
      
      // 2. 自动配置 Claude 环境变量和模型配置
      await systemChecker.autoConfigureClaude(
        config.port, 
        config.apiKey,
        config.models,
        config.defaultModel
      );
      logger.info('Claude config updated', { 
        port: config.port,
        modelsCount: config.models?.length || 0,
        defaultModel: config.defaultModel
      });
      
      // 3. 启动代理服务
      await proxyServer.start(config.port);
      logger.info('Service started', { port: config.port });
      
      // 4. 验证环境配置
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

  // 日志相关
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

  // 统计相关
  ipcMain.handle('stats:get', async (event, period) => {
    try {
      const stats = await database.getStats(period);
      return stats;
    } catch (error) {
      logger.error('Failed to get stats', error);
      throw error;
    }
  });

  // 对话历史相关
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

  // 设置相关
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

  // 环境检查相关
  ipcMain.handle('environment:check', async (event, port?: number) => {
    try {
      environmentStatus = await systemChecker.checkEnvironment(port || 8787);
      const report = systemChecker.generateReport(environmentStatus);
      logger.info('Environment check completed\n' + report);
      return environmentStatus;
    } catch (error) {
      logger.error('Failed to check environment', error);
      throw error;
    }
  });

  ipcMain.handle('environment:getStatus', async () => {
    try {
      if (!environmentStatus) {
        environmentStatus = await systemChecker.checkEnvironment(8787);
      }
      return environmentStatus;
    } catch (error) {
      logger.error('Failed to get environment status', error);
      throw error;
    }
  });

  ipcMain.handle('environment:getReport', async () => {
    try {
      if (!environmentStatus) {
        environmentStatus = await systemChecker.checkEnvironment(8787);
      }
      return systemChecker.generateReport(environmentStatus);
    } catch (error) {
      logger.error('Failed to generate environment report', error);
      throw error;
    }
  });

  logger.info('IPC handlers setup complete');
}
