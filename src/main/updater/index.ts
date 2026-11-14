import { autoUpdater } from 'electron-updater';
// electron 原生 autoUpdater（Squirrel.Mac）。electron-updater 的 MacUpdater 内部就是复用它，
// 它是 electron 单例，这里 import 到的与 MacUpdater.nativeUpdater 是同一个实例。
// 只用于在 macOS 上监听"更新已真正暂存完成（通过签名校验）"的原生 update-downloaded 事件。
import { app, BrowserWindow, dialog, ipcMain, autoUpdater as nativeAutoUpdater } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../logger';

export interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes?: string;
}

/**
 * 远端版本是否"严格更新"于当前版本(semver 数字段比较)。
 * 只有它为 true 才应触发下载/安装 —— 避免"版本不同但不更高"(测试新包比 OSS 高、
 * 或 OSS 回滚)被误判为有更新,进而调 downloadUpdate 触发 electron-updater
 * "Please check update first"、甚至尝试降级安装。
 */
export function isNewerVersion(remote: string, current: string): boolean {
  const parse = (v: string) =>
    String(v || '')
      .trim()
      .replace(/^v/i, '')
      .split('-')[0] // 去掉预发布后缀,只比主版本段
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const r = parse(remote);
  const c = parse(current);
  for (let i = 0; i < Math.max(r.length, c.length); i++) {
    const a = r[i] || 0;
    const b = c[i] || 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false; // 相等或更旧 → 不算有更新
}

export class AppUpdater {
  private mainWindow: BrowserWindow | null = null;
  private updateAvailable: boolean = false;
  private updateDownloaded: boolean = false;
  // macOS 专用：Squirrel.Mac 是否已把更新"真正暂存好"（下载 + 通过代码签名校验）。
  // 只有为 true 时 quitAndInstall() 才会真的退出并安装；否则它只会挂监听器空等，
  // 表现为"点安装后不退出/不落地/无报错"。由原生 update-downloaded 事件置位。
  private macUpdateStaged: boolean = false;
  // 安装更新前调用:让主进程置 isQuitting(避免关窗被"最小化到托盘"拦截)+ quittingForUpdate
  // (让 before-quit 放行,不 app.exit 强杀,交给 quitAndInstall/Squirrel 完成安装+重启)。
  private quitForInstallHook: (() => void) | null = null;

  constructor() {
    this.setupAutoUpdater();
    this.setupIPC();
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /** 注册"安装更新前"钩子(由主进程实现,置 isQuitting / quittingForUpdate)。 */
  setQuitForInstallHook(cb: () => void): void {
    this.quitForInstallHook = cb;
  }

  /**
   * 下载前清理 electron-updater 的 pending 缓存目录。
   * Windows 上多次失败重试会在 %LOCALAPPDATA%\dongcc-updater\pending 残留同名/临时安装包，
   * 这些残留一旦被占用（杀软扫描 / 上次进程句柄未释放），会导致本次下载末尾
   * "temp-xxx.exe → xxx.exe" 重命名报 EPERM。开下前清空可消除这一类残留占用。
   */
  private clearPendingUpdateCache(): void {
    try {
      const base = process.env.LOCALAPPDATA;
      if (!base) return; // 仅 Windows 有该变量；其它平台无此问题
      const pendingDir = path.join(base, 'dongcc-updater', 'pending');
      if (fs.existsSync(pendingDir)) {
        fs.rmSync(pendingDir, { recursive: true, force: true });
        logger.info(`[Updater] 已清理 pending 缓存: ${pendingDir}`);
      }
    } catch (e: any) {
      logger.warn(`[Updater] 清理 pending 缓存失败（忽略继续）: ${e?.message}`);
    }
  }

  private setupAutoUpdater(): void {
    autoUpdater.logger = logger;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    if (process.platform === 'darwin') {
      (autoUpdater as any).forceCodeSigning = false;
      // electron-updater 自己的 'update-downloaded' 触发得早（仅代表 zip 落盘 + 本地代理就绪，
      // 见 MacUpdater.dispatchUpdateDownloaded），此时 Squirrel 往往还没拉包/校验完，直接安装会空等。
      // 原生 Squirrel.Mac 完成"拉包 + 签名校验"后才会发它自己的 'update-downloaded'，
      // 那一刻才是真正可安装（MacUpdater.squirrelDownloadedUpdate 同步置 true）。监听它拿到可靠信号。
      try {
        nativeAutoUpdater.on('update-downloaded', () => {
          this.macUpdateStaged = true;
          logger.info('[Updater] macOS: Squirrel 已完成暂存（含签名校验），更新可安装');
        });
      } catch (e: any) {
        logger.warn(`[Updater] macOS: 监听原生 update-downloaded 失败（忽略）: ${e?.message}`);
      }
    }

    autoUpdater.on('checking-for-update', () => {
      logger.info('[Updater] Checking for update...');
      this.sendToRenderer('update-checking');
    });

    autoUpdater.on('update-available', (info) => {
      logger.info('[Updater] Update available:', info.version);
      this.updateAvailable = true;
      this.sendToRenderer('update-available', {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes,
      } as UpdateInfo);
    });

    autoUpdater.on('update-not-available', (info) => {
      logger.info('[Updater] Update not available. Current version:', info.version);
      this.updateAvailable = false;
      this.sendToRenderer('update-not-available', { version: info.version });
    });

    autoUpdater.on('download-progress', (progressInfo) => {
      const percent = Math.round(progressInfo.percent);
      logger.info(`[Updater] Download progress: ${percent}%`);
      this.sendToRenderer('update-download-progress', {
        percent,
        transferred: progressInfo.transferred,
        total: progressInfo.total,
        bytesPerSecond: progressInfo.bytesPerSecond,
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      logger.info('[Updater] Update downloaded:', info.version);
      this.updateDownloaded = true;
      this.sendToRenderer('update-downloaded', {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes,
      } as UpdateInfo);
    });

    autoUpdater.on('error', (error) => {
      logger.error('[Updater] Error:', error);
      this.sendToRenderer('update-error', { message: error.message });
    });
  }

  private setupIPC(): void {
    ipcMain.handle('updater:check-for-updates', async () => {
      try {
        const result = await autoUpdater.checkForUpdates();
        if (!result) {
          return {
            available: false,
            version: autoUpdater.currentVersion.version,
            currentVersion: autoUpdater.currentVersion.version,
          };
        }
        return {
          available: isNewerVersion(result.updateInfo.version, autoUpdater.currentVersion.version),
          version: result.updateInfo.version,
          currentVersion: autoUpdater.currentVersion.version,
        };
      } catch (error: any) {
        logger.error('[Updater] Check for updates error:', error);
        throw error;
      }
    });

    ipcMain.handle('updater:download-update', async () => {
      try {
        this.clearPendingUpdateCache();
        await autoUpdater.downloadUpdate();
        return { success: true };
      } catch (error: any) {
        logger.error('[Updater] Download update error:', error);
        throw error;
      }
    });

    ipcMain.handle('updater:install-update', () => {
      logger.info('[Updater] Installing update and quitting...');
      this.safeQuitAndInstall();
    });

    ipcMain.handle('updater:get-current-version', () => {
      return autoUpdater.currentVersion.version;
    });
  }

  private sendToRenderer(channel: string, data?: any): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  async checkForUpdates(notifyUser: boolean = false): Promise<boolean> {
    try {
      const result = await autoUpdater.checkForUpdates();
      if (!result) {
        return false;
      }
      const hasUpdate = isNewerVersion(result.updateInfo.version, autoUpdater.currentVersion.version);
      
      if (hasUpdate && notifyUser) {
        const response = await dialog.showMessageBox(this.mainWindow!, {
          type: 'info',
          title: '发现新版本',
          message: `发现新版本 ${result.updateInfo.version}`,
          detail: '是否立即下载更新？',
          buttons: ['下载更新', '稍后提醒'],
          defaultId: 0,
          cancelId: 1,
        });

        if (response.response === 0) {
          await this.downloadUpdate();
        }
      }
      
      return hasUpdate;
    } catch (error) {
      logger.error('[Updater] Check for updates failed:', error);
      return false;
    }
  }

  async downloadUpdate(): Promise<void> {
    try {
      this.clearPendingUpdateCache();
      await autoUpdater.downloadUpdate();

      const response = await dialog.showMessageBox(this.mainWindow!, {
        type: 'info',
        title: '更新已下载',
        message: '新版本已下载完成',
        detail: '是否立即安装并重启应用？',
        buttons: ['立即安装', '稍后安装'],
        defaultId: 0,
        cancelId: 1,
      });

      if (response.response === 0) {
        this.safeQuitAndInstall();
      }
    } catch (error) {
      logger.error('[Updater] Download update failed:', error);
      throw error;
    }
  }

  isUpdateAvailable(): boolean {
    return this.updateAvailable;
  }

  isUpdateDownloaded(): boolean {
    return this.updateDownloaded;
  }

  getCurrentVersion(): string {
    return autoUpdater.currentVersion.version;
  }

  async checkAndAutoUpdate(): Promise<void> {
    try {
      logger.info('[Updater] Auto-update triggered by remote notice');
      const result = await autoUpdater.checkForUpdates();
      if (!result) return;
      const hasUpdate = isNewerVersion(result.updateInfo.version, autoUpdater.currentVersion.version);
      if (hasUpdate) {
        logger.info(`[Updater] Auto-downloading update: ${result.updateInfo.version}`);
        this.clearPendingUpdateCache();
        await autoUpdater.downloadUpdate();
        logger.info('[Updater] Auto-download complete, prompting user to install');
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          const response = await dialog.showMessageBox(this.mainWindow, {
            type: 'info',
            title: '更新已下载',
            message: `新版本 ${result.updateInfo.version} 已下载完成`,
            detail: '是否立即安装并重启应用？',
            buttons: ['立即安装', '稍后安装'],
            defaultId: 0,
            cancelId: 1,
          });
          if (response.response === 0) {
            this.safeQuitAndInstall();
          }
        }
      }
    } catch (error) {
      logger.error('[Updater] Auto-update failed:', error);
    }
  }

  private safeQuitAndInstall(): void {
    // hook 会 destroy tray/所有窗口——放到"真的要装"的时机才调,避免 macOS 上等 Squirrel 暂存的 60s 里
    // 用户以为 app 挂了。Windows 上关窗即触发 window-all-closed→quit,所以 hook 可以早调。
    if (process.platform === 'win32') {
      // Windows: 先通知主进程置 isQuitting/quittingForUpdate + 释放 UI ref,然后关窗等文件锁释放。
      try { this.quitForInstallHook?.(); } catch { /* ignore */ }
      logger.info('[Updater] Windows: closing windows before install...');
      BrowserWindow.getAllWindows().forEach(w => w.close());
      setTimeout(() => {
        // isSilent=true：静默安装（/S），跳过 electron-builder 内置的“应用仍在运行/无法停止”
        // 交互弹窗（自动更新时 DongCC.exe 尚未完全退出会误触发它，重试无效、需手动点取消）。
        // 进程终止由 installer.nsh 的 _KillDongCC 宏接管（静默模式下宏照常执行），实现无感更新。
        autoUpdater.quitAndInstall(true, true);
      }, 2000);
    } else {
      // macOS: 关键不在 isSilent（Squirrel.Mac 下 MacUpdater.quitAndInstall() 不接收任何参数，
      // 传 true/false 都被忽略），而在于"更新是否已被 Squirrel 真正暂存好"。若未暂存就调用，
      // quitAndInstall() 只会挂监听器空等 → 点安装后不退出/不落地/无报错。故这里等就绪再装。
      // hook 由 macQuitAndInstallWhenStaged 在 staged 分支里调,配合 fallback exit 兜底。
      this.macQuitAndInstallWhenStaged();
    }
  }

  /**
   * macOS：等 Squirrel.Mac 把更新真正暂存完成（macUpdateStaged / 内部 squirrelDownloadedUpdate）
   * 再执行 quitAndInstall。多数"点太早"的卡顿由此消除；若长时间仍未就绪（多半是签名校验没过），
   * 给出明确提示，引导用户改用"正常退出 DongCC(Cmd+Q)后重开"来完成安装，而不是无声卡死。
   */
  private macQuitAndInstallWhenStaged(attempt: number = 0): void {
    const INTERVAL_MS = 800;
    const MAX_ATTEMPTS = 75; // ~60s
    const staged = this.macUpdateStaged || (autoUpdater as any).squirrelDownloadedUpdate === true;

    if (staged) {
      logger.info('[Updater] macOS: 更新已暂存，开始退出并安装');
      // 释放 tray/所有窗口 + 置 quittingForUpdate:Tray 是 macOS 上隐式 activation ref,不 destroy
      // 的话 app.quit 收不了尾,ShipIt 见主进程仍在运行会 abort("App Still Running Error")。
      try { this.quitForInstallHook?.(); } catch { /* ignore */ }
      // 第二个参数 isForceRunAfter=true：装完自动重启 App（Mac 上此参数有效，走 autoRunAppAfterInstall）。
      setTimeout(() => autoUpdater.quitAndInstall(false, true), 500);
      // Fallback:若 3s 内 quit 仍未终结主进程(子进程/未释放的引用拖着),强制 app.exit(0) 让 ShipIt 接手。
      // ShipItState.plist 已就绪,ShipIt 服务检测到目标 app 消失后会自动完成替换 + 重启。
      setTimeout(() => {
        logger.warn('[Updater] macOS: quitAndInstall 3s 未终结主进程,强制 app.exit(0) 让 ShipIt 接手');
        app.exit(0);
      }, 3500);
      return;
    }

    if (attempt >= MAX_ATTEMPTS) {
      logger.warn('[Updater] macOS: 更新在 ~60s 内仍未暂存完成（可能签名校验未通过）');
      this.sendToRenderer('update-error', {
        message: '更新包仍在后台准备中（可能因签名校验较慢或未通过）。请退出 DongCC（Cmd+Q）后重新打开以完成安装，或手动下载 dmg 覆盖安装。',
      });
      return;
    }

    if (attempt === 0) {
      logger.info('[Updater] macOS: 更新尚未暂存完成，等待 Squirrel 就绪…');
      this.sendToRenderer('update-preparing');
    }
    setTimeout(() => this.macQuitAndInstallWhenStaged(attempt + 1), INTERVAL_MS);
  }

  async checkOnly(): Promise<void> {
    try {
      logger.info('[Updater] Check-only triggered by remote notice (no auto-download)');
      const result = await autoUpdater.checkForUpdates();
      if (!result) return;
      const hasUpdate = isNewerVersion(result.updateInfo.version, autoUpdater.currentVersion.version);
      if (hasUpdate) {
        logger.info(`[Updater] New version available: ${result.updateInfo.version} (not downloading)`);
        this.sendToRenderer('update-available', {
          version: result.updateInfo.version,
          releaseDate: result.updateInfo.releaseDate,
          releaseNotes: result.updateInfo.releaseNotes,
        } as UpdateInfo);
      }
    } catch (error) {
      logger.error('[Updater] Check-only failed:', error);
    }
  }
}

let _appUpdater: AppUpdater | null = null;

export const appUpdater = {
  get instance(): AppUpdater {
    if (!_appUpdater) {
      _appUpdater = new AppUpdater();
    }
    return _appUpdater;
  },
  setMainWindow(window: BrowserWindow) {
    this.instance.setMainWindow(window);
  },
  setQuitForInstallHook(cb: () => void) {
    this.instance.setQuitForInstallHook(cb);
  },
  checkForUpdates(silent?: boolean) {
    return this.instance.checkForUpdates(silent);
  },
  checkAndAutoUpdate() {
    return this.instance.checkAndAutoUpdate();
  },
  checkOnly() {
    return this.instance.checkOnly();
  },
};
