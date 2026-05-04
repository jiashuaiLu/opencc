import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { ProxyServer } from './proxy/server';
import { DatabaseManager } from './database';
import { setupIPC } from './ipc/handlers';
import { logger } from './logger';
import { appUpdater } from './updater';

let mainWindow: BrowserWindow | null = null;
let proxyServer: ProxyServer;
let database: DatabaseManager;

async function initialize() {
  try {
    database = new DatabaseManager();
    await database.initialize();
    logger.info('Database initialized');

    proxyServer = new ProxyServer();
    logger.info('Proxy server initialized');

    // 监听代理服务器事件并保存到数据库
    proxyServer.on('request', async (requestData: any) => {
      try {
        // 保存请求日志
        await database.addLog({
          level: 'info',
          message: `Proxy request: ${requestData.method} ${requestData.url}`,
          ...requestData,
        });

        // 保存请求统计
        await database.addRequest({
          method: requestData.method,
          url: requestData.url,
          statusCode: requestData.statusCode,
          duration: requestData.duration,
          success: requestData.statusCode < 400,
          model: requestData.model,
          inputTokens: requestData.inputTokens || 0,
          outputTokens: requestData.outputTokens || 0,
          cacheReadTokens: requestData.cacheReadTokens || 0,
          cacheCreationTokens: requestData.cacheCreationTokens || 0,
          isStreaming: requestData.isStreaming || false,
        });

        logger.info('Request logged', requestData);
      } catch (error) {
        logger.error('Failed to log request', error);
      }
    });

    proxyServer.on('error', async (error: Error) => {
      try {
        await database.addLog({
          level: 'error',
          message: `Proxy error: ${error.message}`,
          error: error.stack,
        });
        logger.error('Proxy error logged', error);
      } catch (err) {
        logger.error('Failed to log error', err);
      }
    });

    // 监听对话事件并保存到数据库
    proxyServer.on('conversation', async (conversation: any) => {
      try {
        await database.addConversation(conversation);
        logger.info('Conversation saved', { 
          id: conversation.id, 
          model: conversation.model,
          tokens: conversation.tokens 
        });
      } catch (error) {
        logger.error('Failed to save conversation', error);
      }
    });

    setupIPC(proxyServer, database);
    logger.info('IPC handlers setup complete');
  } catch (error) {
    logger.error('Failed to initialize', error);
    throw error;
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // 生产环境优化：禁用不必要的功能
      devTools: process.env.NODE_ENV === 'development',
      webSecurity: true,
      allowRunningInsecureContent: false,
      // 启用硬件加速
      offscreen: false,
    },
    titleBarStyle: 'hiddenInset',
    icon: path.join(__dirname, '../public/icon.png'),
    // 优化窗口显示，减少白屏时间
    show: false,
    backgroundColor: '#ffffff',
  });

  // 窗口准备好后再显示，避免白屏
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  appUpdater.setMainWindow(mainWindow);

  logger.info('Main window created');
}

app.whenReady()
  .then(async () => {
    await initialize();
    createWindow();
    
    if (process.env.NODE_ENV !== 'development') {
      setTimeout(() => {
        appUpdater.checkForUpdates(true).catch((err) => {
          logger.error('Auto update check failed:', err);
        });
      }, 3000);
    }
  })
  .catch((error) => {
    logger.error('Failed to start application', error);
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('before-quit', async () => {
  try {
    if (proxyServer) {
      await proxyServer.stop();
      logger.info('Proxy server stopped');
    }
  } catch (error) {
    logger.error('Error during shutdown', error);
  }
});
