import { app, BrowserWindow, net, ipcMain, session } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ProxyServer } from './proxy/server';
import { DatabaseManager } from './database';
import { setupIPC } from './ipc/handlers';
import { logger } from './logger';
import { appUpdater } from './updater';
import { fetchUserInfo, openSSOLoginWindow } from './auth/localAuth';

interface AppOptions {
  usageReporter?: any;
  authProvider?: {
    requireAuth: () => Promise<any>;
    getCachedUserInfo: () => any | null;
  };
  cookieInjection?: boolean;
  rankingProvider?: {
    fetchRanking: (url: string) => Promise<any>;
  };
}

let mainWindow: BrowserWindow | null = null;
let proxyServer: ProxyServer;
let database: DatabaseManager;
let usageReporter: any;
let appOptions: AppOptions | undefined;

let initialized = false;
let initPromise: Promise<DatabaseManager> | null = null;

let userInfoInitialized = false;

async function initUserInfo(authProvider?: AppOptions['authProvider']): Promise<void> {
  if (userInfoInitialized) return;
  userInfoInitialized = true;
  if (authProvider) {
    const info = await authProvider.requireAuth();
    if (info && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('user:info-updated', info);
    }
    return;
  }
  const info = await fetchUserInfo();
  if (info) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('user:info-updated', info);
    }
  }
}

export async function initialize(options?: AppOptions): Promise<DatabaseManager> {
  if (initialized) return database;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    appOptions = options;
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
          const isSuccess = requestData.statusCode < 400;
          await database.addRequest({
            method: requestData.method,
            url: requestData.url,
            statusCode: requestData.statusCode,
            duration: requestData.duration,
            success: isSuccess,
            model: requestData.model,
            inputTokens: requestData.inputTokens || 0,
            outputTokens: requestData.outputTokens || 0,
            cacheReadTokens: requestData.cacheReadTokens || 0,
            cacheCreationTokens: requestData.cacheCreationTokens || 0,
            isStreaming: requestData.isStreaming || false,
            errorMessage: !isSuccess ? (requestData.errorMessage || requestData.error || `HTTP ${requestData.statusCode}`) : undefined,
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

      if (options?.usageReporter) {
        usageReporter = options.usageReporter;
        await usageReporter.start();
        logger.info('UsageReporter initialized');
      }

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

      setupIPC(proxyServer, database, { 
        authProvider: options?.authProvider,
        rankingProvider: options?.rankingProvider,
      });
      logger.info('IPC handlers setup complete');

      // 从设置同步日志级别
      const settings = await database.getSettings();
      if (settings?.logLevel) {
        logger.setLogLevel(settings.logLevel);
      }

      // 清理旧的 debug 日志文件
      const oldDebugLog = path.join(os.homedir(), 'dongcc-debug.log');
      if (fs.existsSync(oldDebugLog)) {
        try {
          fs.unlinkSync(oldDebugLog);
          logger.info('Removed legacy debug log file');
        } catch {
          // ignore
        }
      }
      initialized = true;
      return database;
    } catch (error) {
      logger.error('Failed to initialize', error);
      throw error;
    }
  })();

  return initPromise;
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
    show: false,
    ...(process.platform === 'darwin'
      ? {
          vibrancy: 'under-window' as const,
          visualEffectState: 'active' as const,
        }
      : {
          backgroundColor: '#ffffff',
        }),
  });

  // 窗口准备好后再显示，避免白屏
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  // 去掉外部图片请求的 Referer，避免防盗链拦截
  // 内部版可在此添加需要去 Referer 的域名
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [] },
    (details, callback) => {
      delete details.requestHeaders['Referer'];
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('did-finish-load', () => {
    fetchRemoteNotice();
    initUserInfo(appOptions?.authProvider);
  });

  appUpdater.setMainWindow(mainWindow);

  logger.info('Main window created');
}

const NOTICE_URL = '';

let cachedNotice: any = null;
let noticeFetchedAt = 0;
let noticeFetching = false;
const NOTICE_TTL_MS = 30 * 60 * 1000;

async function fetchRemoteNotice() {
  if (noticeFetching) return;
  noticeFetching = true;
  try {
    const response = await net.fetch(`${NOTICE_URL}?t=${Date.now()}`, { method: 'GET' });
    if (!response.ok) return;
    const notice = await response.json() as any;
    if (notice?.enabled && notice?.message) {
      cachedNotice = notice;
      noticeFetchedAt = Date.now();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('remote-notice', notice);
      }
      // 远程通知指定 autoUpdate 时，自动触发检查更新并下载安装
      if (notice.autoUpdate) {
        appUpdater.checkAndAutoUpdate();
      }
      // type=update 且 autoUpdate=false：只检查版本，不下载，通知渲染进程弹窗
      else if (notice.type === 'update') {
        appUpdater.checkOnly();
      }
    }
  } catch {
    // 静默忽略，不影响正常使用
  } finally {
    noticeFetching = false;
  }
}

app.whenReady()
  .then(async () => {
    // 如果 initialize 已经被调用过（通过内部版入口），不再重复调用
    if (!initialized && !initPromise) {
      await initialize();
    } else if (initPromise) {
      await initPromise;
    }
    createWindow();

    ipcMain.handle('notice:get', async () => {
      const isExpired = !cachedNotice || (Date.now() - noticeFetchedAt > NOTICE_TTL_MS);
      if (isExpired) {
        await fetchRemoteNotice();
      }
      return cachedNotice;
    });

    // 启动后主动拉取远程通知（含自动更新检查）
    fetchRemoteNotice();
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
    if (usageReporter) {
      await Promise.race([
        usageReporter.reportNow(),
        new Promise(resolve => setTimeout(resolve, 4000)),
      ]);
      usageReporter.stop();
      logger.info('UsageReporter final report attempted and stopped');
    }
    if (database) {
      database.stopCleanupTimer();
    }
    if (proxyServer) {
      await proxyServer.stop();
      logger.info('Proxy server stopped');
    }
  } catch (error) {
    logger.error('Error during shutdown', error);
  }
});
