import { app, BrowserWindow, net, ipcMain, session, screen, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import { ProxyServer } from './proxy/server';
import { DatabaseManager } from './database';
import { setupIPC } from './ipc/handlers';
import { logger } from './logger';
import { appUpdater } from './updater';
import { fetchUserInfo, openSSOLoginWindow } from './auth/localAuth';

interface AppOptions {
  usageReporterFactory?: (database: DatabaseManager) => any;
  queryLogReporterFactory?: () => any;
  authProvider?: {
    requireAuth: () => Promise<any>;
    getCachedUserInfo: () => any | null;
    logout?: () => Promise<void>;
  };
  cookieInjection?: boolean;
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
    getPresetSkills: () => import('./skills/presetSkills').PresetSkillSpec[];
  };
}

let mainWindow: BrowserWindow | null = null;
let floatingWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;          // 真正退出（区别于"关闭到托盘"）
let shuttingDown = false;        // before-quit 清理进行中,避免重复清理/重入
let quittingForUpdate = false;   // 正为"安装更新"而退出:交给 quitAndInstall/Squirrel 接管,before-quit 不强杀
let minimizeToTray = true;       // 缓存的设置值（close 拦截需同步读取）
let trayBalloonShown = false;    // 首次最小化到托盘的提示只弹一次
let proxyServer: ProxyServer;
let database: DatabaseManager;
let usageReporter: any;
let queryLogReporter: any;
let appOptions: AppOptions | undefined;
let headroomProcess: ChildProcess | null = null;

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
            tokensSaved: requestData.tokensSaved || 0,
            compressionRatio: requestData.compressionRatio || 1,
            errorMessage: !isSuccess ? (requestData.errorMessage || requestData.error || `HTTP ${requestData.statusCode}`) : undefined,
          });

          logger.info('Request logged', requestData);
        } catch (error) {
          logger.error('Failed to log request', error);
        }
      });

      // 网关级日志(PRD 7 大类)。有 internal 上报器则交它补齐/缓冲/上报;
      // 否则(开源版)落一行紧凑日志用于观测。
      proxyServer.on('requestLog', (log: any) => {
        if (queryLogReporter) {
          try { queryLogReporter.collect(log); } catch (e) { logger.warn('[LogReporting] collect 失败', e); }
        } else {
          logger.info('[LogReporting] requestLog', {
            request_id: log?.request_id,
            model_name: log?.model_name,
            base_url: log?.base_url,
            http_status_code: log?.http_status_code,
            error_type: log?.error_type,
            total_tokens: log?.total_tokens,
            stream: log?.stream,
            instance_id: log?.instance_id,
            dongcc_version: log?.dongcc_version,
          });
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

      if (options?.usageReporterFactory) {
        usageReporter = options.usageReporterFactory(database);
        await usageReporter.start();
        logger.info('UsageReporter initialized');
      }

      if (options?.queryLogReporterFactory) {
        queryLogReporter = options.queryLogReporterFactory();
        await queryLogReporter.start();
        logger.info('QueryLogReporter initialized');
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
        communityProvider: options?.communityProvider,
        ossUploader: options?.ossUploader,
        presetSkillProvider: options?.presetSkillProvider,
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
      console.error('Failed to initialize:', error);
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
    icon: resolveTrayIconPath() || path.join(__dirname, '../public/icon.png'),
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
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://*.360buyimg.com/*'] },
    (details, callback) => {
      delete details.requestHeaders['Referer'];
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
  }

  // 拦截关闭：启用"最小化到托盘"且托盘可用时，隐藏窗口而非退出应用。
  // 关窗时同步读取当前设置（而非依赖可能陈旧的缓存变量），确保开关即时、准确生效。
  mainWindow.on('close', (event) => {
    let wantTray = minimizeToTray; // 兜底：读取失败时用缓存
    try {
      if (database?.getSettingsSync) {
        wantTray = database.getSettingsSync().minimizeToTray !== false;
      }
    } catch { /* 用兜底缓存 */ }
    if (!isQuitting && wantTray && tray && !tray.isDestroyed()) {
      event.preventDefault();
      mainWindow?.hide();
      if (process.platform === 'win32') {
        mainWindow?.setSkipTaskbar(true);
        // 首次隐藏时提示用户应用仍在后台，避免以为已退出
        if (!trayBalloonShown) {
          trayBalloonShown = true;
          try {
            tray.displayBalloon({
              title: 'DongCC 仍在后台运行',
              content: '应用已最小化到系统托盘，点击托盘图标可重新打开。可在“系统设置”中关闭此行为。',
            });
          } catch { /* 部分系统不支持 balloon，忽略 */ }
        }
      }
      return;
    }
    // 不最小化到托盘：关主窗即退出应用（Win/Linux）。显式 app.quit() 确保悬浮窗等
    // 辅助窗口不会单独把进程挂住（否则 window-all-closed 不触发，导致关不掉）。
    // macOS 保留"关窗不退、留在 dock"的系统约定，不在此强制退出。
    if (!isQuitting && process.platform !== 'darwin') {
      isQuitting = true;
      app.quit();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('did-finish-load', () => {
    fetchRemoteNotice();
    initUserInfo(appOptions?.authProvider);
  });

  appUpdater.setMainWindow(mainWindow);
  // 安装更新前:置 isQuitting(避免关窗被"最小化到托盘"拦截、进程不退→更新卡住)+ quittingForUpdate
  // (让 before-quit 放行,由 quitAndInstall/Squirrel 完成安装+重启,而非被 app.exit 强杀打断)。
  // 释放持有 activation ref 的 UI:tray 必须 destroy——macOS 上 tray 是隐式 accessory activation ref,
  // 只要活着 app.quit 就收不了尾,ShipIt 见主进程仍在运行会 abort("App Still Running Error")。
  appUpdater.setQuitForInstallHook(() => {
    isQuitting = true;
    quittingForUpdate = true;
    try { if (tray && !tray.isDestroyed()) tray.destroy(); } catch { /* ignore */ }
    BrowserWindow.getAllWindows().forEach(w => {
      try { w.destroy(); } catch { /* ignore */ }
    });
  });

  logger.info('Main window created');
}

/**
 * 创建/显示 Token 消耗悬浮窗。
 * 复用同一渲染进程包，通过 HashRouter 路由 #/floating 渲染独立的悬浮框视图。
 * 窗口参数（frame/transparent/alwaysOnTop/resizable）在 macOS 与 Windows 上均生效，
 * 不使用 macOS 专属的 vibrancy，改由渲染层的 CSS 毛玻璃保证两平台外观一致。
 */
function createFloatingWindow(): void {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.show();
    floatingWindow.focus();
    refreshTrayMenu();
    return;
  }

  const width = 190;
  const height = 190;

  // 默认停靠在主显示器工作区右上角
  const primary = screen.getPrimaryDisplay();
  const { x: areaX, y: areaY, width: areaW } = primary.workArea;
  const margin = 20;

  floatingWindow = new BrowserWindow({
    width,
    height,
    x: areaX + areaW - width - margin,
    y: areaY + margin,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // 透明窗口下关闭原生阴影/加粗边框，避免 Windows 绘制贴合窗口矩形的非圆角衬底；
    // 圆角与投影全部交由渲染层 CSS 处理，Mac/Windows 表现一致
    hasShadow: false,
    thickFrame: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      devTools: process.env.NODE_ENV === 'development',
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // macOS: 让悬浮窗浮在普通窗口之上（含全屏应用切换时）
  floatingWindow.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') {
    floatingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  floatingWindow.once('ready-to-show', () => {
    floatingWindow?.show();
  });

  if (process.env.NODE_ENV === 'development') {
    floatingWindow.loadURL('http://localhost:5173/#/floating');
  } else {
    floatingWindow.loadFile(path.join(__dirname, '../../renderer/index.html'), {
      hash: '/floating',
    });
  }

  floatingWindow.on('closed', () => {
    floatingWindow = null;
    refreshTrayMenu(); // 悬浮窗自身关闭后，同步托盘菜单文案回到"显示"
  });

  logger.info('Floating window created');
  refreshTrayMenu(); // 无论从仪表盘按钮 / IPC / 托盘打开，都同步托盘菜单文案为"隐藏"
}

function closeFloatingWindow(): void {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.close();
  }
  floatingWindow = null;
}

/** 显示并聚焦主窗口（不存在则重建），从托盘/dock 恢复时调用 */
function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (process.platform === 'win32') mainWindow.setSkipTaskbar(false);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else if (app.isReady()) {
    // 仅在 app ready 后才创建窗口。macOS 冷启动/重启时 activate 可能早于 whenReady 触发，
    // 此时 createWindow 会抛 "Cannot create BrowserWindow before app is ready"；
    // 未 ready 时直接跳过，交由 whenReady().then() 里的 createWindow 正常建窗。
    createWindow();
  }
}

/** 解析托盘图标路径，兼容开发/生产：vite 会把 public/ 复制到 dist/renderer/ */
function resolveTrayIconPath(): string | null {
  const candidates = [
    path.join(__dirname, '../../renderer/icon.png'), // 生产/已构建渲染进程
    path.join(process.cwd(), 'public', 'icon.png'),  // 开发（cwd = 仓库根）
    path.join(__dirname, '../public/icon.png'),       // 兜底
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
  }
  return null;
}

/** 解析 Mac 托盘模板图（透明底 + 纯色剪影，随明暗菜单栏自动变色，避免白板） */
function resolveTrayTemplatePath(): string | null {
  const candidates = [
    path.join(__dirname, '../../renderer/trayTemplate.png'),
    path.join(process.cwd(), 'public', 'trayTemplate.png'),
    path.join(__dirname, '../public/trayTemplate.png'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
  }
  return null;
}

/** 解析 Windows/Linux 托盘彩色图标：Windows 优先多尺寸 .ico（系统按 DPI 选尺寸，防高分屏放大糊） */
function resolveTrayColorPath(): string | null {
  const name = process.platform === 'win32' ? 'trayIcon.ico' : 'trayIcon.png';
  const candidates = [
    path.join(__dirname, `../../renderer/${name}`),
    path.join(process.cwd(), 'public', name),
    path.join(__dirname, `../public/${name}`),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
  }
  return null;
}

/** 构建托盘右键菜单（悬浮窗项随其开关状态显示"显示/隐藏"） */
function buildTrayMenu(): Menu {
  const floatingOpen = !!(floatingWindow && !floatingWindow.isDestroyed());
  return Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => showMainWindow() },
    {
      label: floatingOpen ? '隐藏 Token 悬浮窗' : '显示 Token 悬浮窗',
      click: () => toggleFloatingFromTray(),
    },
    { type: 'separator' },
    {
      label: '退出 DongCC',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

/** 刷新托盘菜单（悬浮窗开/关后调用，使菜单项文案同步） */
function refreshTrayMenu(): void {
  if (tray && !tray.isDestroyed()) tray.setContextMenu(buildTrayMenu());
}

/** 托盘菜单里切换悬浮窗：开着则关、没开则开 */
function toggleFloatingFromTray(): void {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    closeFloatingWindow();
  } else {
    createFloatingWindow();
  }
  refreshTrayMenu();
}

/**
 * 创建系统托盘。
 * 解决"关闭窗口即退出、无法最小化到托盘"的问题（Windows/macOS/Linux 通用）。
 * macOS 用模板剪影（透明底，自动适配明暗菜单栏）；Windows/Linux 用彩色应用图标。
 * 菜单：显示主窗口 / 显示·隐藏 Token 悬浮窗 / 退出。
 */
function createTray(): void {
  if (tray && !tray.isDestroyed()) return;

  let trayImage: Electron.NativeImage;
  if (process.platform === 'darwin') {
    // Mac：模板剪影（透明底 + 纯色形状），createFromPath 会自动加载 @2x
    const tmplPath = resolveTrayTemplatePath();
    trayImage = tmplPath ? nativeImage.createFromPath(tmplPath) : nativeImage.createEmpty();
    if (!trayImage.isEmpty()) trayImage.setTemplateImage(true);
  } else {
    // Windows/Linux：优先用专用托盘图（Win 多尺寸 .ico 由系统按 DPI 选尺寸；Linux 16 PNG），不缩放
    const trayPath = resolveTrayColorPath();
    if (trayPath) {
      trayImage = nativeImage.createFromPath(trayPath);
    } else {
      // 兜底：旧的 512 应用图标，缩到 16
      const iconPath = resolveTrayIconPath();
      const img = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
      trayImage = img.isEmpty() ? img : img.resize({ width: 16, height: 16 });
    }
  }
  if (trayImage.isEmpty()) {
    logger.warn('[Tray] 未找到有效图标，跳过托盘创建（关闭将不再最小化到托盘）');
    return; // 无有效图标时不创建托盘，避免"关闭后隐藏却无法恢复"
  }

  try {
    tray = new Tray(trayImage);
  } catch (err: any) {
    logger.warn(`[Tray] 创建失败: ${err?.message}`);
    return;
  }

  tray.setToolTip('DongCC');
  tray.setContextMenu(buildTrayMenu());
  // Windows/Linux：单击托盘图标直接显示窗口（macOS 保留默认点击弹出菜单）
  tray.on('click', () => {
    if (process.platform !== 'darwin') showMainWindow();
  });
  tray.on('double-click', () => showMainWindow());

  logger.info('Tray created');
}

const NOTICE_URL = process.env.DONGCC_NOTICE_URL || '';

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

app.setAsDefaultProtocolClient('dongcc');

// 单例锁:防止多开(第二个实例会去 bind 8787 → EADDRINUSE)。拿不到锁说明已有实例在运行
// (常见于"关窗最小化到托盘后再打开"),直接退出本实例,并唤起已运行实例的窗口。
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}
app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady()
  .then(async () => {
    // 输掉单例锁的第二个实例:不初始化、不建窗、不 bind 端口,交给上面的 app.quit()
    if (!gotSingleInstanceLock) return;
    // 如果 initialize 已经被调用过（通过内部版入口），不再重复调用
    if (!initialized && !initPromise) {
      await initialize();
    } else if (initPromise) {
      await initPromise;
    }
    createWindow();

    // 初始化"最小化到托盘"设置并创建托盘
    try {
      const settings = await database.getSettings();
      minimizeToTray = settings?.minimizeToTray !== false; // 默认 true
    } catch { /* 读取失败则用默认 true */ }
    createTray();

    // 设置变更时刷新缓存，使"最小化到托盘"开关即时生效（settings:save 通过 app 广播）
    app.on('dongcc:settings-updated' as any, (updated: any) => {
      if (updated && typeof updated.minimizeToTray === 'boolean') {
        minimizeToTray = updated.minimizeToTray;
      }
    });

    ipcMain.handle('notice:get', async () => {
      const isExpired = !cachedNotice || (Date.now() - noticeFetchedAt > NOTICE_TTL_MS);
      if (isExpired) {
        await fetchRemoteNotice();
      }
      return cachedNotice;
    });

    // Token 消耗悬浮窗控制
    ipcMain.handle('floating:open', () => {
      createFloatingWindow();
      return { success: true };
    });
    ipcMain.handle('floating:close', () => {
      closeFloatingWindow();
      return { success: true };
    });
    ipcMain.handle('floating:toggle', () => {
      if (floatingWindow && !floatingWindow.isDestroyed()) {
        closeFloatingWindow();
        return { success: true, visible: false };
      }
      createFloatingWindow();
      return { success: true, visible: true };
    });
    ipcMain.handle('floating:isOpen', () => {
      return !!(floatingWindow && !floatingWindow.isDestroyed());
    });

    // 启动后主动拉取远程通知（含自动更新检查）
    fetchRemoteNotice();
  })
  .catch((error) => {
    console.error('Failed to start application:', error);
    logger.error('Failed to start application', error);
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // macOS 点击 dock 图标：显示（或重建）主窗口
  showMainWindow();
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('deep-link:import', url);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('before-quit', async (event) => {
  if (shuttingDown) return; // 已在清理,放行第二次 before-quit
  // 为"安装更新"而退出:不 preventDefault、不 app.exit(强杀会打断 quitAndInstall/Squirrel 的安装+重启)。
  // 尽力(不阻塞)停代理/Headroom 释放端口,然后放行,让更新器完成落地并自动重启。
  if (quittingForUpdate) {
    isQuitting = true;
    try { if (proxyServer) proxyServer.stop().catch(() => { /* ignore */ }); } catch { /* ignore */ }
    try { stopHeadroomProxy(); } catch { /* ignore */ }
    logger.info('Quitting for update install — yielding to updater (no force-exit)');
    return;
  }
  event.preventDefault();   // 拦住默认退出,等清理(尤其停代理释放 8787)跑完再真正退出
  shuttingDown = true;
  isQuitting = true; // 标记真正退出，避免 close 被拦截到托盘
  try {
    if (usageReporter) {
      await Promise.race([
        usageReporter.reportNow(),
        new Promise(resolve => setTimeout(resolve, 4000)),
      ]);
      usageReporter.stop();
      logger.info('UsageReporter final report attempted and stopped');
    }
    if (queryLogReporter) {
      await Promise.race([
        queryLogReporter.reportNow(),
        new Promise(resolve => setTimeout(resolve, 3000)),
      ]);
      queryLogReporter.stop();
      logger.info('QueryLogReporter final flush attempted and stopped');
    }
    if (database) {
      database.stopCleanupTimer();
    }
    if (proxyServer) {
      await proxyServer.stop();
      logger.info('Proxy server stopped');
    }
    stopHeadroomProxy();
  } catch (error) {
    logger.error('Error during shutdown', error);
  } finally {
    app.exit(0); // 强制退出,不再触发 before-quit,确保端口已释放
  }
});

/**
 * 检测并安装 Headroom（由配置页面开关触发）
 * 返回 { success, reason }
 */
function isHeadroomInstalledViaUv(): boolean {
  const uvBin = findUvBin();
  if (!uvBin) return false;
  try {
    const result = spawnSync(uvBin, ['tool', 'list'], { timeout: 10_000, encoding: 'utf-8' });
    if (result.status === 0 && result.stdout.includes('headroom-ai')) {
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

export async function installHeadroom(): Promise<{ success: boolean; reason?: string }> {
  // 只认 uv 安装的 headroom，确保运行时不依赖系统 Python
  if (isHeadroomInstalledViaUv()) {
    logger.info('[Headroom] 已通过 uv 安装');
    return { success: true };
  }

  logger.info('[Headroom] 未检测到 uv 安装的 headroom，开始安装...');
  const installResult = await autoInstallHeadroom();
  return installResult;
}

function sendToAllWindows(channel: string, ...args: any[]): void {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) {
      w.webContents.send(channel, ...args);
    }
  });
}

let modelDownloadProcess: ChildProcess | null = null;

/**
 * 检测 headroom 所需模型是否已在本地 huggingface 缓存中
 */
function checkHeadroomModelsExist(): boolean {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  // huggingface_hub 默认缓存路径，支持 HF_HOME 和 XDG_CACHE_HOME 自定义
  const hfHome = process.env.HF_HOME || path.join(process.env.XDG_CACHE_HOME || path.join(home, '.cache'), 'huggingface');
  const hubDir = path.join(hfHome, 'hub');

  // 检测 models--chopratejas--kompress-base 和 models--answerdotai--ModernBERT-base 目录存在
  const requiredRepos = [
    'models--chopratejas--kompress-base',
    'models--answerdotai--ModernBERT-base',
  ];

  for (const repo of requiredRepos) {
    const repoDir = path.join(hubDir, repo, 'snapshots');
    if (!fs.existsSync(repoDir)) {
      return false;
    }
    // snapshots 下至少有一个版本目录
    try {
      const entries = fs.readdirSync(repoDir);
      if (entries.length === 0) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * 下载 Headroom ONNX 模型（独立于 proxy 启动）
 * 通过 Python 脚本调用 huggingface_hub 下载，实时输出进度
 */
export async function downloadHeadroomModels(hfMirrorUrl?: string): Promise<{ success: boolean; reason?: string }> {
  if (modelDownloadProcess) {
    return { success: false, reason: '模型下载正在进行中' };
  }

  // 快速检测：模型文件是否已在 huggingface 缓存中
  if (checkHeadroomModelsExist()) {
    logger.info('[Headroom] 模型已在本地缓存中，跳过下载');
    return { success: true };
  }

  // 直接使用 headroom venv 中的 Python（uv tool install 后自带 huggingface_hub）
  let pythonBin: string | null = null;

  // 1. headroom 的 venv Python（最可靠，已经有 huggingface_hub）
  const headroomVenvPython = getHeadroomVenvPython();
  if (headroomVenvPython) {
    const check = spawnSync(headroomVenvPython, ['-c', 'import huggingface_hub'], { timeout: 10_000, encoding: 'utf-8' });
    if (check.status === 0) {
      pythonBin = headroomVenvPython;
      logger.info(`[Headroom] 使用 headroom venv Python: ${pythonBin}`);
    } else {
      // venv 存在但缺 huggingface_hub，前置补装（清华源）
      if (ensureHeadroomVenvHasHuggingfaceHub()) {
        pythonBin = headroomVenvPython;
        logger.info(`[Headroom] 补装后使用 headroom venv Python: ${pythonBin}`);
      }
    }
  }

  // 2. 兜底：系统 Python
  if (!pythonBin) {
    const sysPython = findPythonBin();
    if (sysPython) {
      let hfOk = spawnSync(sysPython, ['-c', 'import huggingface_hub'], { timeout: 10_000, encoding: 'utf-8' }).status === 0;
      if (!hfOk) {
        // 尝试用 uv pip 安装（加清华源，内网 pypi.org 不通）
        const uvBin = findUvBin();
        if (uvBin) {
          spawnSync(uvBin, ['pip', 'install', 'huggingface_hub', '--python', sysPython,
            '--index-url', 'https://pypi.tuna.tsinghua.edu.cn/simple',
          ], { timeout: 120_000, encoding: 'utf-8' });
          // 复核：补装后必须真的能 import，否则别用它跑脚本（避免崩在 ModuleNotFoundError）
          hfOk = spawnSync(sysPython, ['-c', 'import huggingface_hub'], { timeout: 10_000, encoding: 'utf-8' }).status === 0;
        }
      }
      if (hfOk) pythonBin = sysPython;
    }
  }

  if (!pythonBin) {
    return { success: false, reason: '未找到含 huggingface_hub 的 Python 环境，请在配置页关闭再重新开启 Headroom 以重新安装依赖' };
  }

  const script = `
import os, sys, json
from huggingface_hub import hf_hub_download

# 多镜像源 fallback：依次尝试，任一成功即停
mirrors = [
    os.environ.get('HF_ENDPOINT', ''),
    'https://hf-mirror.com',
    'https://hf-api.gitee.com',
    'https://huggingface.co',
]
mirrors = [m for m in mirrors if m]

models = [
    ('chopratejas/kompress-base', 'onnx/kompress-int8.onnx', 'Kompress INT8'),
    ('answerdotai/ModernBERT-base', 'tokenizer.json', 'ModernBERT Tokenizer'),
]

total = len(models)
for i, (repo, filename, label) in enumerate(models):
    progress = {"step": i+1, "total": total, "model": label, "status": "downloading"}
    print(json.dumps(progress), flush=True)
    downloaded = False
    last_err = ""
    for mirror in mirrors:
        try:
            hf_hub_download(repo_id=repo, filename=filename, endpoint=mirror)
            progress["status"] = "done"
            print(json.dumps(progress), flush=True)
            downloaded = True
            break
        except Exception as e:
            last_err = str(e)[:200]
            continue
    if not downloaded:
        progress["status"] = "error"
        progress["error"] = f"All mirrors failed. Last: {last_err}"
        print(json.dumps(progress), flush=True)
        sys.exit(1)
print(json.dumps({"step": total, "total": total, "status": "complete"}), flush=True)
`;

  const spawnEnv: Record<string, string | undefined> = { ...process.env };
  spawnEnv.HF_ENDPOINT = hfMirrorUrl || 'https://hf-mirror.com';
  spawnEnv.HF_HUB_ENABLE_HF_TRANSFER = '0';
  spawnEnv.HF_HUB_DISABLE_XET = '1';

  return new Promise((resolve) => {
    modelDownloadProcess = spawn(pythonBin, ['-c', script], {
      stdio: 'pipe',
      env: spawnEnv,
    });

    sendToAllWindows('headroom:download-status', { status: 'downloading', message: '正在下载 ONNX 模型...' });

    let stdoutBuffer = '';
    modelDownloadProcess.stdout?.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const progress = JSON.parse(line);
          logger.info(`[Headroom] 模型下载: ${JSON.stringify(progress)}`);
          sendToAllWindows('headroom:download-progress', progress);

          if (progress.status === 'complete') {
            sendToAllWindows('headroom:download-status', { status: 'ready' });
          } else if (progress.status === 'error') {
            sendToAllWindows('headroom:download-status', { status: 'error', message: progress.error });
          }
        } catch {
          logger.info(`[Headroom] ${line}`);
        }
      }
    });

    modelDownloadProcess.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().trim().split('\n');
      lines.forEach(line => logger.info(`[Headroom] stderr: ${line}`));
    });

    modelDownloadProcess.on('exit', (code) => {
      modelDownloadProcess = null;
      if (code === 0) {
        resolve({ success: true });
      } else if (code === null) {
        resolve({ success: false, reason: '下载已取消' });
      } else {
        resolve({ success: false, reason: `模型下载失败 (exit code: ${code})` });
      }
    });

    modelDownloadProcess.on('error', (err) => {
      modelDownloadProcess = null;
      sendToAllWindows('headroom:download-status', { status: 'error', message: err.message });
      resolve({ success: false, reason: err.message });
    });
  });
}

/**
 * 取消模型下载
 */
export function cancelHeadroomModelDownload(): void {
  if (modelDownloadProcess) {
    modelDownloadProcess.kill();
    modelDownloadProcess = null;
    sendToAllWindows('headroom:download-status', { status: 'cancelled' });
    logger.info('[Headroom] 模型下载已取消');
  }
}

/**
 * 确保 Headroom venv 的 Python 装了 huggingface_hub。
 * Headroom 内部可能延迟导入 huggingface_hub —— 此时进程不会立即退出，
 * 事后型补装分支永远走不到，导致 stderr 反复抛 ModuleNotFoundError。
 * 因此启动前主动检查一次，缺就装（清华源，内网可达）。
 * 返回 true 表示依赖就绪或补装成功；false 表示 venv 不存在（走系统 Python 兜底）。
 */
function ensureHeadroomVenvHasHuggingfaceHub(): boolean {
  const venvPy = getHeadroomVenvPython();
  if (!venvPy) return false;

  const check = spawnSync(venvPy, ['-c', 'import huggingface_hub'], { timeout: 5000, encoding: 'utf-8' });
  if (check.status === 0) return true;

  const uvBin = findUvBin();
  if (!uvBin) {
    logger.warn('[Headroom] 缺少 huggingface_hub 且未找到 uv，无法自动补装');
    return false;
  }
  logger.info('[Headroom] 启动前检测到缺少 huggingface_hub，正在补装...');
  const install = spawnSync(uvBin, ['pip', 'install', 'huggingface_hub', '--python', venvPy,
    '--index-url', 'https://pypi.tuna.tsinghua.edu.cn/simple',
  ], { timeout: 120_000, encoding: 'utf-8' });
  if (install.status !== 0) {
    logger.warn(`[Headroom] huggingface_hub 补装失败: ${(install.stderr || '').substring(0, 500)}`);
    return false;
  }
  logger.info('[Headroom] huggingface_hub 补装完成');
  return true;
}

/**
 * 启动 Headroom 代理子进程（仅启动，不安装/不下载模型）
 * Headroom 是透明代理：接收请求 → 压缩 → 转发到上游
 * 使用 --no-optimize 模式以避免启动时下载模型
 */
export async function startHeadroomProxy(
  proxyUrl?: string,
  upstreamUrls?: { anthropic?: string; openai?: string },
  dongccPort?: number,
  hfMirrorUrl?: string,
): Promise<{ success: boolean; reason?: string; actualPort?: string }> {
  if (headroomProcess) return { success: true };

  const bin = findHeadroomBin();
  if (!bin) {
    return { success: false, reason: 'Headroom 未安装，请在配置页面开启开关安装' };
  }

  let port = proxyUrl ? new URL(proxyUrl).port : '8788';
  const mainPort = dongccPort ? String(dongccPort) : '8787';
  if (port === mainPort) {
    logger.warn(`[Headroom] 端口 ${port} 与 DongCC 代理冲突，自动切换到 8788`);
    port = '8788';
  }

  try {
    const healthResp = await fetch(`http://127.0.0.1:${port}/health`);
    if (healthResp.ok) {
      const health = await healthResp.json() as any;
      if (health?.ok || (health?.service === 'headroom-proxy' && health?.ready)) {
        // 检查上游配置是否和当前一致，不一致则停掉重启
        const currentAnthropicUrl = health?.config?.anthropic_api_url || '';
        const currentOpenaiUrl = health?.config?.openai_api_url || '';
        const wantAnthropicUrl = upstreamUrls?.anthropic?.replace(/\/v1\/?$/, '').replace(/\/messages\/?$/, '') || '';
        const wantOpenaiUrl = upstreamUrls?.openai?.replace(/\/v1\/?$/, '') || '';
        const normalizeUpstreamUrl = (u: string) => u.replace(/\/v1\/?$/, '').replace(/\/messages\/?$/, '').replace(/\/$/, '').toLowerCase();
        const anthropicMatch = !wantAnthropicUrl || normalizeUpstreamUrl(currentAnthropicUrl) === normalizeUpstreamUrl(wantAnthropicUrl);
        const openaiMatch = !wantOpenaiUrl || normalizeUpstreamUrl(currentOpenaiUrl) === normalizeUpstreamUrl(wantOpenaiUrl);
        if (anthropicMatch && openaiMatch) {
          logger.info(`[Headroom] 检测到端口 ${port} 已有 Headroom 代理在运行且上游匹配，直接复用`);
          headroomProcess = {} as any;
          return { success: true, actualPort: port };
        }
        // 上游不匹配，停掉旧进程重新启动
        logger.info(`[Headroom] 端口 ${port} 已有 Headroom 但上游配置不匹配，正在重启...`);
        const pid = health?.config?.pid;
        if (pid) {
          try { process.kill(pid); } catch {}
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  } catch {
    // 端口无服务，正常启动
  }

  // 模型已在开关打开时预下载，启动时直接加载（从本地缓存）
  const args = ['proxy', '--port', port];

  if (upstreamUrls?.anthropic) {
    const url = upstreamUrls.anthropic.replace(/\/v1\/?$/, '').replace(/\/messages\/?$/, '');
    args.push('--anthropic-api-url', url);
  }
  if (upstreamUrls?.openai) {
    const url = upstreamUrls.openai.replace(/\/v1\/?$/, '');
    args.push('--openai-api-url', url);
  }

  const spawnEnv: Record<string, string | undefined> = { ...process.env };
  spawnEnv.HF_ENDPOINT = hfMirrorUrl || 'https://hf-mirror.com';

  // 启动前置检查：Headroom 内部对 huggingface_hub 是延迟导入，
  // 缺失时不会导致进程立即退出（health 端口仍打开），
  // 仅在具体 API 被调用时 stderr 抛 ModuleNotFoundError。
  // 事后型补装分支永远走不到，故在此主动补装一次。
  ensureHeadroomVenvHasHuggingfaceHub();

  try {
    headroomProcess = spawn(bin, args, {
      stdio: 'pipe',
      detached: false,
      env: spawnEnv,
      shell: process.platform === 'win32',
    });

    headroomProcess.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().trim().split('\n');
      lines.forEach(line => logger.info(`[Headroom] ${line}`));
    });

    headroomProcess.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().trim().split('\n');
      lines.forEach(line => logger.info(`[Headroom] ${line}`));
    });

    headroomProcess.on('error', (err: Error) => {
      logger.warn(`[Headroom] 进程启动失败: ${err.message}`);
      headroomProcess = null;
    });

    headroomProcess.on('exit', (code: number) => {
      logger.info(`[Headroom] 进程退出，code=${code}`);
      headroomProcess = null;
    });

    // --no-optimize 模式启动很快，15 秒足够
    const maxWait = 30_000;
    const startAt = Date.now();
    while (Date.now() - startAt < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/health`);
        if (resp.ok) {
          const health = await resp.json() as any;
          if (health?.ok || (health?.service === 'headroom-proxy' && health?.ready)) {
            logger.info(`[Headroom] 代理已就绪，端口=${port}`);
            return { success: true, actualPort: port };
          }
        }
      } catch {
        // 还没启动好，继续等
      }
    }

    if (!headroomProcess || (headroomProcess as any).exitCode !== null) {
      // 检测是否 Python 环境损坏（shebang 指向的 Python 不可用）
      const shebangCheck = spawnSync(bin, ['--version'], { timeout: 5000, encoding: 'utf-8' });
      if (shebangCheck.status !== 0) {
        return { success: false, reason: 'headroom 的 Python 运行环境损坏，请在配置页面关闭再重新开启 Headroom 以重新安装' };
      }
      // Windows [proxy] extras 安装后可能缺少 huggingface_hub，自动补装后重试一次
      const venvPy = getHeadroomVenvPython();
      const uvBin2 = findUvBin();
      if (venvPy && uvBin2) {
        const hfCheck = spawnSync(venvPy, ['-c', 'import huggingface_hub'], { timeout: 5000, encoding: 'utf-8' });
        if (hfCheck.status !== 0) {
          logger.info('[Headroom] 检测到缺少 huggingface_hub，正在补装...');
          spawnSync(uvBin2, ['pip', 'install', 'huggingface_hub', '--python', venvPy,
            '--index-url', 'https://pypi.tuna.tsinghua.edu.cn/simple',
          ], { timeout: 120_000, encoding: 'utf-8' });
          // 补装后重新启动
          headroomProcess = spawn(bin, args, { stdio: 'pipe', detached: false, env: spawnEnv, shell: process.platform === 'win32' });
          headroomProcess.stderr?.on('data', (d: Buffer) => d.toString().trim().split('\n').forEach(l => logger.info(`[Headroom] ${l}`)));
          headroomProcess.on('exit', (code: number) => { logger.info(`[Headroom] 进程退出，code=${code}`); headroomProcess = null; });
          const retryStart = Date.now();
          while (Date.now() - retryStart < 15_000) {
            await new Promise(r => setTimeout(r, 1000));
            try {
              const r = await fetch(`http://127.0.0.1:${port}/health`);
              if (r.ok) { const h = await r.json() as any; if (h?.ok || (h?.service === 'headroom-proxy' && h?.ready)) return { success: true, actualPort: port }; }
            } catch { /* 继续等 */ }
          }
        }
      }
      return { success: false, reason: 'headroom proxy 启动后立即退出，请检查端口是否被占用' };
    }
    return { success: false, reason: 'headroom proxy 启动超时，请检查网络' };
  } catch (err: any) {
    logger.warn(`[Headroom] 启动失败: ${err.message}`);
    headroomProcess = null;
    if (process.platform === 'win32' && (err.message?.includes('1385') || err.message?.includes('CreateProcessWithLogonW'))) {
      return { success: false, reason: '系统安全策略阻止了进程创建（错误码 1385）。请尝试以管理员身份运行 DongCC，或联系 IT 部门解除进程创建限制。' };
    }
    return { success: false, reason: `启动失败: ${err.message}` };
  }
}

/**
 * 检测 headroom 命令是否可用，返回路径或 null
 */
function findHeadroomBin(): string | null {
  const candidates = process.platform === 'win32' ? ['headroom.exe', 'headroom.cmd'] : ['headroom'];

  // 1. 优先搜索 uv tool 的 bin 目录（uv 安装的不依赖系统 Python）
  const uvBin = findUvBin();
  if (uvBin) {
    try {
      const uvDir = spawnSync(uvBin, ['tool', 'dir', '--bin'], { timeout: 5000, encoding: 'utf-8' });
      if (uvDir.status === 0) {
        for (const cmd of candidates) {
          const fullPath = path.join(uvDir.stdout.trim(), cmd);
          if (fs.existsSync(fullPath)) {
            const result = spawnSync(fullPath, ['--version'], { timeout: 5000, encoding: 'utf-8' });
            if (result.status === 0) {
              logger.info(`[Headroom] 找到 headroom (uv): ${fullPath}`);
              return fullPath;
            }
          }
        }
      }
    } catch { /* ignore */ }
  }

  // 2. 在 PATH 中查找（兜底）
  for (const cmd of candidates) {
    try {
      const result = spawnSync(cmd, ['--version'], { timeout: 5000, encoding: 'utf-8' });
      if (result.status === 0) {
        logger.info(`[Headroom] 在 PATH 中找到 headroom`);
        return cmd;
      }
    } catch { /* ignore */ }
  }

  // 3. 搜索用户 Python bin 路径（兜底）
  const userBinPaths = getUserPythonBinPaths();
  for (const binPath of userBinPaths) {
    for (const cmd of candidates) {
      const fullPath = path.join(binPath, cmd);
      try {
        if (fs.existsSync(fullPath)) {
          const result = spawnSync(fullPath, ['--version'], { timeout: 5000, encoding: 'utf-8' });
          if (result.status === 0) {
            logger.info(`[Headroom] 找到 headroom: ${fullPath}`);
            return fullPath;
          }
        }
      } catch { /* ignore */ }
    }
  }

  logger.warn(`[Headroom] 未找到 headroom CLI`);
  return null;
}

/**
 * 定位 headroom-ai venv 的 Python 解释器。
 * 关键：uv 的 tools 目录随平台不同——Windows 为 %APPDATA%\uv\tools，
 * macOS/Linux 为 ~/.local/share/uv/tools。必须用 `uv tool dir` 动态查询，
 * 不能硬编码 XDG 布局；否则 Windows 上永远找不到 venv，退到不含
 * huggingface_hub 的系统 Python，导致模型下载报 ModuleNotFoundError。
 */
function getHeadroomVenvPython(): string | null {
  const rel = process.platform === 'win32'
    ? path.join('headroom-ai', 'Scripts', 'python.exe')
    : path.join('headroom-ai', 'bin', 'python');
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const legacy = path.join(home, '.local', 'share', 'uv', 'tools', rel);

  // macOS/Linux：uv 的 tools 目录就是 ~/.local/share/uv/tools，直接用 fs.existsSync（瞬时、不阻塞主进程）。
  // 避免为取路径而跑 findUvBin/`uv tool dir` 那串 spawnSync 冻结 UI —— 旧版正是瞬时判断，这里恢复该行为。
  if (process.platform !== 'win32' && fs.existsSync(legacy)) return legacy;

  // Windows（uv tools 目录为 %APPDATA%\uv\tools，legacy 布局不对）或非 win 但 legacy 缺失时，
  // 用 `uv tool dir` 动态定位。
  const uvBin = findUvBin();
  if (uvBin) {
    try {
      const r = spawnSync(uvBin, ['tool', 'dir'], { timeout: 5000, encoding: 'utf-8' });
      if (r.status === 0 && r.stdout.trim()) {
        const p = path.join(r.stdout.trim(), rel);
        if (fs.existsSync(p)) return p;
      }
    } catch { /* ignore */ }
  }

  // 最后兜底：legacy 路径
  if (fs.existsSync(legacy)) return legacy;

  return null;
}

/**
 * 获取 --user 安装的可执行文件路径列表
 */
function getUserPythonBinPaths(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const paths: string[] = [];

  if (process.platform === 'darwin') {
    // macOS: ~/Library/Python/X.Y/bin/
    const pythonBase = path.join(home, 'Library', 'Python');
    try {
      const versions = fs.readdirSync(pythonBase);
      for (const v of versions) {
        const binDir = path.join(pythonBase, v, 'bin');
        if (fs.existsSync(binDir)) paths.push(binDir);
      }
    } catch { /* ignore */ }
  }

  // Linux/通用: ~/.local/bin/
  const localBin = path.join(home, '.local', 'bin');
  if (fs.existsSync(localBin)) paths.push(localBin);

  return paths;
}

/**
 * 查找可用的 Python 命令
 */
function findPythonBin(): string | null {
  const candidates = process.platform === 'win32'
    ? ['python', 'python3', 'py']
    : ['python3', 'python'];

  for (const cmd of candidates) {
    try {
      const result = spawnSync(cmd, ['--version'], { timeout: 5000, encoding: 'utf-8' });
      if (result.status === 0) return cmd;
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * 自动安装 headroom-ai
 */
function findUvBin(): string | null {
  const platform = process.platform;
  const arch = process.arch;
  const uvName = platform === 'win32' ? 'uv.exe' : 'uv';

  // 1. 优先使用内嵌在应用资源中的 uv
  let embeddedSubdir = '';
  if (platform === 'darwin') {
    embeddedSubdir = arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  } else if (platform === 'win32') {
    embeddedSubdir = 'win-x64';
  }
  if (embeddedSubdir) {
    const embeddedPath = path.join(process.resourcesPath, 'uv', embeddedSubdir, uvName);
    if (fs.existsSync(embeddedPath)) {
      try {
        const result = spawnSync(embeddedPath, ['--version'], { timeout: 5000, encoding: 'utf-8' });
        if (result.status === 0) return embeddedPath;
      } catch { /* ignore */ }
    }
  }

  // 2. 在系统 PATH 和常见位置中查找
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const searchPaths = [
    'uv',
    path.join(home, '.cargo', 'bin', 'uv'),
    path.join(home, '.local', 'bin', 'uv'),
  ];
  for (const p of searchPaths) {
    try {
      const result = spawnSync(p, ['--version'], { timeout: 5000, encoding: 'utf-8' });
      if (result.status === 0) return p;
    } catch { /* ignore */ }
  }

  return null;
}

function getPipVersion(pythonBin: string): number | null {
  try {
    const result = spawnSync(pythonBin, ['-m', 'pip', '--version'], { timeout: 10_000, encoding: 'utf-8' });
    if (result.status === 0) {
      // 输出格式: "pip 21.2.4 from ..."
      const match = result.stdout.match(/pip (\d+)/);
      if (match) return parseInt(match[1], 10);
    }
  } catch { /* ignore */ }
  return null;
}

async function autoInstallHeadroom(): Promise<{ success: boolean; reason?: string }> {
  // === 使用内嵌 uv 安装（自带 Python 管理，只用预编译 wheel，不需编译器） ===
  const uvBin = findUvBin();
  if (!uvBin) {
    return { success: false, reason: '未找到 uv，请重新安装 DongCC' };
  }
  if (uvBin) {
    // [all] 依赖 hnswlib（vector extra，无任何平台预编译轮，必须现场编译 C++），
    // 全平台统一用 [proxy]：代理压缩走 ONNX 后端，proxy extras 已含 onnxruntime/
    // transformers/huggingface_hub，压缩能力完整，且所有依赖均有预编译轮。
    const headroomPkg = 'headroom-ai[proxy]';
    logger.info(`[Headroom] 检测到 uv (${uvBin})，使用 uv tool install 安装...`);
    // 双保险之一（约束文件）：litellm 自 1.92.0 起不再发纯 Python 轮、只发 Linux 编译轮，
    // Win/Mac 拉 sdist 现场编译必败。这里写一个「约束」而非直接依赖——它只在某条路径真的要装
    // litellm 时才把版本压到 <1.92(落 1.91.4，有 py3-none-any 通用轮)，不会主动引入 litellm。
    const constraintFile = path.join(os.tmpdir(), 'dongcc-headroom-constraints.txt');
    let hasConstraint = false;
    try {
      fs.writeFileSync(constraintFile, 'litellm<1.92\n', 'utf-8');
      hasConstraint = true;
    } catch (e: any) {
      logger.warn(`[Headroom] 写约束文件失败(忽略，继续): ${e?.message}`);
    }
    const installArgs = [
      'tool', 'install', headroomPkg,
      '--python-preference', 'only-managed',
      // 双保险之二（主保险）：锁定 Python 3.14。headroom-ai 的 litellm 依赖带 marker
      // `python_full_version < '3.14'`——即 3.14 上【根本不依赖 litellm】，彻底绕开其发轮坑；
      // 且 onnxruntime(cp314)/tokenizers(abi3)/transformers(纯Py) 在 3.14 均有预编译轮。
      // 这与本机正常工作的生产环境(3.14 + [proxy] + 无 litellm)完全一致。
      '--python', '3.14',
      '--index-url', 'https://pypi.tuna.tsinghua.edu.cn/simple',
    ];
    // 约束文件作为「回退保险」：万一某机器 uv 落到 <3.14(headroom 又要 litellm)，则被压到 <1.92。
    if (hasConstraint) installArgs.push('--constraints', constraintFile);
    // [proxy] 的 huggingface_hub 目前是被 transformers 间接带入，显式补装以防依赖链变动后缺失（模型下载必需）。
    installArgs.push('--with', 'huggingface_hub');
    // macOS/Linux 加 UV_NO_BUILD=1：禁止源码现场编译，只用预编译轮，
    // 避免混入需编译的包时无限期卡编译（曾因 hnswlib 卡满 10 分钟超时）。
    // Windows 分支不加，保持原有已验证的安装行为不变。
    const noBuild = process.platform !== 'win32';
    try {
      const result = spawnSync(uvBin, installArgs, {
        timeout: 600_000,
        encoding: 'utf-8',
        env: {
          ...process.env,
          UV_PYTHON_PREFERENCE: 'only-managed',
          UV_INDEX_URL: 'https://pypi.tuna.tsinghua.edu.cn/simple',
          ...(noBuild ? { UV_NO_BUILD: '1' } : {}),
        },
      });
      if (result.signal === 'SIGTERM') {
        return { success: false, reason: '安装超时（10分钟）。网络可能较慢或被公司防火墙拦截，请检查网络后重试。' };
      } else if (result.status === 0 || (result.stderr || '').includes('already installed')) {
        logger.info('[Headroom] uv 安装成功');
        // uv tool install 把 bin 放到 ~/.local/bin（macOS/Linux）
        if (findHeadroomBin()) return { success: true };
        // 如果找不到，可能 uv 的 bin 目录不在搜索范围内，尝试获取
        const whichResult = spawnSync(uvBin, ['tool', 'dir', '--bin'], { timeout: 5000, encoding: 'utf-8' });
        if (whichResult.status === 0) {
          const uvBinDir = whichResult.stdout.trim();
          const headroomPath = path.join(uvBinDir, process.platform === 'win32' ? 'headroom.exe' : 'headroom');
          if (fs.existsSync(headroomPath)) {
            logger.info(`[Headroom] 找到 headroom: ${headroomPath}`);
            return { success: true };
          }
        }
        return { success: false, reason: '安装完成但未找到 headroom 可执行文件，请重启 DongCC 后重试。' };
      } else {
        const stderr = (result.stderr || '').trim();
        if (process.platform === 'win32' && (stderr.includes('1385') || stderr.includes('CreateProcessWithLogonW'))) {
          return { success: false, reason: '系统安全策略阻止了进程创建（错误码 1385）。请尝试以管理员身份运行 DongCC，或联系 IT 部门解除进程创建限制。' };
        }
        const lastLines = stderr.split('\n').slice(-5).join('\n');
        logger.info(`[Headroom] uv tool install 失败 (exit=${result.status}): ${lastLines}`);
        // 诊断具体失败原因，给用户可操作的提示
        let reason = `安装失败 (exit=${result.status})`;
        if (stderr.includes('ConnectError') || stderr.includes('ConnectionError') || stderr.includes('ETIMEDOUT') || stderr.includes('getaddrinfo')) {
          reason = '网络连接失败，无法访问 PyPI 镜像。请检查网络连接或代理设置后重试。';
        } else if (stderr.includes('No space left') || stderr.includes('ENOSPC') || stderr.includes('disk full')) {
          reason = '磁盘空间不足，请清理磁盘后重试。';
        } else if (stderr.includes('PermissionError') || stderr.includes('Access is denied') || stderr.includes('EPERM')) {
          reason = '权限不足，请尝试以管理员身份运行 DongCC。';
        } else if (stderr.includes('No solution found') || stderr.includes('ResolutionImpossible')) {
          reason = `依赖解析失败，可能是 Python 版本不兼容。详情: ${lastLines}`;
        } else if (lastLines) {
          reason = `安装失败: ${lastLines.substring(0, 300)}`;
        }
        return { success: false, reason };
      }
    } catch (err: any) {
      if (process.platform === 'win32' && (err.message?.includes('1385') || err.message?.includes('CreateProcessWithLogonW'))) {
        return { success: false, reason: '系统安全策略阻止了进程创建（错误码 1385）。请尝试以管理员身份运行 DongCC，或联系 IT 部门解除进程创建限制。' };
      }
      logger.info(`[Headroom] uv 安装异常: ${err.message}`);
      return { success: false, reason: `安装异常: ${err.message}` };
    }
  }

  // === 策略 2：使用 pip（需要 Python 环境） ===
  const pythonBin = findPythonBin();
  if (!pythonBin) {
    return {
      success: false,
      reason: `未检测到 Python 环境。请安装 Python 3.9+ 后重试，或手动运行: pip install "headroom-ai[proxy]"`,
    };
  }

  logger.info(`[Headroom] 使用 ${pythonBin} 安装 headroom-ai...`);

  // 检测 pip 版本，如果 < 22 则先升级 pip（旧版 pip 无法解析现代 PyPI 元数据）
  const pipVersion = getPipVersion(pythonBin);
  if (pipVersion !== null && pipVersion < 22) {
    logger.info(`[Headroom] pip 版本过旧 (${pipVersion})，尝试升级 pip...`);
    const upgradeStrategies = [
      ['-m', 'pip', 'install', '--upgrade', 'pip', '--user', '--quiet'],
      ['-m', 'pip', 'install', '--upgrade', 'pip', '--quiet', '--break-system-packages', '--user'],
      ['-m', 'pip', 'install', '--upgrade', 'pip', '--quiet', '--break-system-packages'],
    ];
    for (const args of upgradeStrategies) {
      const result = spawnSync(pythonBin, args, { timeout: 120_000, encoding: 'utf-8' });
      if (result.status === 0) {
        logger.info('[Headroom] pip 升级成功');
        break;
      }
    }
  }

  // pip install headroom-ai 多策略
  // 全平台统一 [proxy]：不含需编译的 hnswlib，proxy 依赖均有预编译轮，天然不触发编译。
  // litellm 双保险(约束文件 -c，不主动引入)：仅当系统 Python <3.14、headroom 真要 litellm 时，
  // 才把它压到 <1.92(1.91.4 有 py3-none-any 通用轮)，避免 1.92+ 只发 Linux 轮导致现场编译失败。
  const headroomPkg = 'headroom-ai[proxy]';
  const pipConstraintFile = path.join(os.tmpdir(), 'dongcc-headroom-constraints.txt');
  let pipHasConstraint = false;
  try {
    fs.writeFileSync(pipConstraintFile, 'litellm<1.92\n', 'utf-8');
    pipHasConstraint = true;
  } catch (e: any) {
    logger.warn(`[Headroom] 写 pip 约束文件失败(忽略，继续): ${e?.message}`);
  }
  const cArgs = pipHasConstraint ? ['-c', pipConstraintFile] : [];
  const strategies: { args: string[]; label: string }[] = [
    { args: ['-m', 'pip', 'install', headroomPkg, ...cArgs, '--quiet', '--user'], label: 'pip --user' },
    { args: ['-m', 'pip', 'install', headroomPkg, ...cArgs, '--quiet', '--break-system-packages', '--user'], label: 'pip --break-system-packages --user' },
    { args: ['-m', 'pip', 'install', headroomPkg, ...cArgs, '--quiet', '--break-system-packages'], label: 'pip --break-system-packages' },
  ];

  for (const strategy of strategies) {
    logger.info(`[Headroom] 尝试安装策略: ${strategy.label}`);
    try {
      const result = spawnSync(pythonBin, strategy.args, {
        timeout: 180_000,
        encoding: 'utf-8',
      });

      if (result.status === 0) {
        logger.info('[Headroom] 安装成功');
        if (findHeadroomBin()) {
          return { success: true };
        }
        return { success: false, reason: '安装完成但未检测到 headroom 命令，请重启 DongCC 后重试' };
      }

      const stderr = (result.stderr || '').toLowerCase();
      if (stderr.includes('externally-managed-environment') || stderr.includes('break-system-packages')) {
        logger.info(`[Headroom] 策略 ${strategy.label} 失败（PEP 668），尝试下一个...`);
        continue;
      }
      let reason = '安装失败';
      if (stderr.includes('permission') || stderr.includes('accessdenied') || stderr.includes('access is denied')) {
        reason = '权限不足，请尝试以管理员身份运行，或手动执行 pip install "headroom-ai[proxy]" --user';
      } else if (stderr.includes('no module named pip')) {
        reason = 'Python 环境缺少 pip，请先安装 pip 后重试';
      } else if (stderr.includes('no matching distribution') || stderr.includes('from versions: none')) {
        reason = `pip 版本过旧无法找到 headroom-ai 包。请手动执行: python3 -m pip install --upgrade pip && pip install "${headroomPkg}"`;
      } else if (stderr.includes('error:') || stderr.includes('failed')) {
        reason = `安装失败: ${stderr.substring(0, 200)}`;
      }
      return { success: false, reason };
    } catch (err: any) {
      if (process.platform === 'win32' && (err.message?.includes('1385') || err.message?.includes('CreateProcessWithLogonW'))) {
        return { success: false, reason: '系统安全策略阻止了进程创建（错误码 1385）。请尝试以管理员身份运行 DongCC，或联系 IT 部门解除进程创建限制。' };
      }
      return { success: false, reason: `安装异常: ${err.message}` };
    }
  }

  return {
    success: false,
    reason: `所有安装策略均失败。请手动运行: pip install "${headroomPkg}" --break-system-packages --user`,
  };
}

/**
 * 停止 Headroom 代理子进程
 */
export function stopHeadroomProxy(): void {
  if (headroomProcess && typeof headroomProcess.kill === 'function') {
    headroomProcess.kill();
    headroomProcess = null;
    logger.info('[Headroom] 代理已停止');
  } else {
    headroomProcess = null;
  }
}
