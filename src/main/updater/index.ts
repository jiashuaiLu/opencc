import { autoUpdater } from 'electron-updater';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { logger } from '../logger';

export interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes?: string;
}

export class AppUpdater {
  private mainWindow: BrowserWindow | null = null;
  private updateAvailable: boolean = false;
  private updateDownloaded: boolean = false;

  constructor() {
    this.setupAutoUpdater();
    this.setupIPC();
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  private setupAutoUpdater(): void {
    autoUpdater.logger = logger;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

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
          available: result.updateInfo.version !== autoUpdater.currentVersion.version,
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
        await autoUpdater.downloadUpdate();
        return { success: true };
      } catch (error: any) {
        logger.error('[Updater] Download update error:', error);
        throw error;
      }
    });

    ipcMain.handle('updater:install-update', () => {
      logger.info('[Updater] Installing update and quitting...');
      autoUpdater.quitAndInstall(false, true);
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
      const hasUpdate = result.updateInfo.version !== autoUpdater.currentVersion.version;
      
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
        autoUpdater.quitAndInstall(false, true);
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
}

export const appUpdater = new AppUpdater();
