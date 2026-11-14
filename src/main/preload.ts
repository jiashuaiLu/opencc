import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: (id: string) => ipcRenderer.invoke('config:get', id),
  saveConfig: (config: any) => ipcRenderer.invoke('config:save', config),
  getInstanceId: () => ipcRenderer.invoke('instance:get'),
  resetInstanceId: () => ipcRenderer.invoke('instance:reset'),
  listConfigs: () => ipcRenderer.invoke('config:list'),
  deleteConfig: (id: string) => ipcRenderer.invoke('config:delete', id),
  testConnection: (clientType: 'claude' | 'codex' | 'cursor' | 'opencode', port: number, clientCfg: any) =>
    ipcRenderer.invoke('config:testConnection', clientType, port, clientCfg),

  startService: (config: any) => ipcRenderer.invoke('service:start', config),
  stopService: () => ipcRenderer.invoke('service:stop'),
  getServiceStatus: () => ipcRenderer.invoke('service:status'),
  headroomInstall: (hfMirrorUrl?: string) => ipcRenderer.invoke('headroom:install', hfMirrorUrl),
  headroomCancelDownload: () => ipcRenderer.invoke('headroom:cancelDownload'),
  onHeadroomDownloadProgress: (callback: (progress: any) => void) => {
    const listener = (_e: any, progress: any) => callback(progress);
    ipcRenderer.on('headroom:download-progress', listener);
    return () => ipcRenderer.removeListener('headroom:download-progress', listener);
  },
  onHeadroomDownloadStatus: (callback: (status: any) => void) => {
    const listener = (_e: any, status: any) => callback(status);
    ipcRenderer.on('headroom:download-status', listener);
    return () => ipcRenderer.removeListener('headroom:download-status', listener);
  },
  removeHeadroomListeners: () => {
    ipcRenderer.removeAllListeners('headroom:download-progress');
    ipcRenderer.removeAllListeners('headroom:download-status');
  },

  getLogs: (filter: any) => ipcRenderer.invoke('logs:get', filter),
  clearLogs: () => ipcRenderer.invoke('logs:clear'),

  getStats: (period: string) => ipcRenderer.invoke('stats:get', period),

  getUsageSummary: (startDate?: number, endDate?: number) =>
    ipcRenderer.invoke('usage:summary', startDate, endDate),
  getUsageTrends: (startDate?: number, endDate?: number) =>
    ipcRenderer.invoke('usage:trends', startDate, endDate),
  getModelStats: () => ipcRenderer.invoke('usage:modelStats'),
  getRequestLogs: (filters?: any, page?: number, pageSize?: number) =>
    ipcRenderer.invoke('usage:logs', filters, page, pageSize),

  getConversations: (limit?: number) => ipcRenderer.invoke('conversations:get', limit),
  deleteConversation: (id: string) => ipcRenderer.invoke('conversations:delete', id),
  deleteAllConversations: () => ipcRenderer.invoke('conversations:deleteAll'),

  scanSessions: () => ipcRenderer.invoke('sessions:scan'),
  loadSessionMessages: (sessionPath: string) => ipcRenderer.invoke('sessions:messages', sessionPath),
  launchSessionResume: (sessionId: string, cwd: string) => ipcRenderer.invoke('sessions:launch', sessionId, cwd),

  getPrompts: () => ipcRenderer.invoke('prompt:list'),
  savePrompt: (prompt: any) => ipcRenderer.invoke('prompt:save', prompt),
  deletePrompt: (id: string) => ipcRenderer.invoke('prompt:delete', id),
  readPromptFile: (target: string) => ipcRenderer.invoke('prompt:read-file', target),
  writePromptFile: (target: string, content: string) => ipcRenderer.invoke('prompt:write-file', target, content),

  generateDeepLink: (payload: any) => ipcRenderer.invoke('deeplink:generate', payload),
  onDeepLinkImport: (callback: (url: string) => void) => {
    const listener = (_e: any, url: string) => callback(url);
    ipcRenderer.on('deep-link:import', listener);
    return () => ipcRenderer.removeListener('deep-link:import', listener);
  },
  removeDeepLinkListener: () => ipcRenderer.removeAllListeners('deep-link:import'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: any) => ipcRenderer.invoke('settings:save', settings),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  clearCache: () => ipcRenderer.invoke('cache:clear'),

  getMcpServers: () => ipcRenderer.invoke('mcp:list'),
  saveMcpServer: (server: any) => ipcRenderer.invoke('mcp:save', server),
  deleteMcpServer: (id: string) => ipcRenderer.invoke('mcp:delete', id),
  toggleMcpApp: (id: string, app: string, enabled: boolean) =>
    ipcRenderer.invoke('mcp:toggleApp', id, app, enabled),
  getMcpPresets: () => ipcRenderer.invoke('mcp:getPresets'),
  importMcpFromClaude: () => ipcRenderer.invoke('mcp:importFromClaude'),

  getSkills: () => ipcRenderer.invoke('skills:list'),
  saveSkill: (skill: any) => ipcRenderer.invoke('skills:save', skill),
  deleteSkill: (id: string) => ipcRenderer.invoke('skills:delete', id),
  toggleSkillApp: (id: string, app: string, enabled: boolean) =>
    ipcRenderer.invoke('skills:toggleApp', id, app, enabled),
  renameSkill: (id: string, name: string) => ipcRenderer.invoke('skills:rename', id, name),
  scanUnmanagedSkills: () => ipcRenderer.invoke('skills:scanUnmanaged'),
  importSkill: (directory: string) => ipcRenderer.invoke('skills:import', directory),
  importSkills: (directories: string[]) => ipcRenderer.invoke('skills:importMultiple', directories),
  importSkillFromPath: (sourcePath: string, sourceType: 'global' | 'project', sourceProject?: string) =>
    ipcRenderer.invoke('skills:importFromPath', sourcePath, sourceType, sourceProject),
  listProjectsWithSkills: () => ipcRenderer.invoke('skills:listProjects'),
  scanCustomProject: (projectPath: string) => ipcRenderer.invoke('skills:scanCustomProject', projectPath),
  getSkillDirectory: (id: string) => ipcRenderer.invoke('skills:getDirectory', id),
  getSkillRepos: () => ipcRenderer.invoke('skills:getRepos'),
  saveSkillRepo: (repo: any) => ipcRenderer.invoke('skills:saveRepo', repo),
  deleteSkillRepo: (owner: string, name: string) => ipcRenderer.invoke('skills:deleteRepo', owner, name),

  // New skills APIs
  openZipFileDialog: () => ipcRenderer.invoke('skills:openZipFileDialog'),
  installSkillsFromZip: (filePath: string, currentApp?: 'claude') =>
    ipcRenderer.invoke('skills:installFromZip', filePath, currentApp || 'claude'),
  installSkillsFromZipUrl: (url: string, currentApp?: 'claude') =>
    ipcRenderer.invoke('skills:installFromZipUrl', url, currentApp || 'claude'),
  discoverSkills: () => ipcRenderer.invoke('skills:discover'),
  installSkillFromRepo: (skill: any, currentApp?: 'claude') =>
    ipcRenderer.invoke('skills:installFromRepo', skill, currentApp || 'claude'),
  installSkillByScript: (taskId: string, steps: { cmd: string; args: string[] }[]) =>
    ipcRenderer.invoke('skills:installByScript', taskId, steps),
  getSkillInstallDir: () => ipcRenderer.invoke('skills:getInstallDir'),
  setSkillInstallDir: (dir: string) => ipcRenderer.invoke('skills:setInstallDir', dir),
  reinstallSkillFromZip: (id: string, filePath: string) =>
    ipcRenderer.invoke('skills:reinstallFromZip', id, filePath),
  updateSkillMeta: (id: string, meta: { name?: string; description?: string }) =>
    ipcRenderer.invoke('skills:updateMeta', id, meta),
  onInstallScriptLog: (handler: (data: { taskId: string; stream: 'stdout' | 'stderr' | 'meta'; line: string }) => void) => {
    const listener = (_e: any, data: any) => handler(data);
    ipcRenderer.on('skills:installScriptLog', listener);
    return () => ipcRenderer.removeListener('skills:installScriptLog', listener);
  },

  openExternal: (url: string) => ipcRenderer.invoke('openExternal', url),
  openInFinder: (filePath: string) => ipcRenderer.invoke('openInFinder', filePath),

  calculateCost: (modelId: string, inputTokens: number, outputTokens: number, cacheCreationTokens?: number, cacheReadTokens?: number) =>
    ipcRenderer.invoke('cost:calculate', modelId, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens),
  getPricing: (modelId?: string) => ipcRenderer.invoke('cost:getPricing', modelId),
  estimateMonthlyCost: (modelId: string, dailyInputTokens: number, dailyOutputTokens: number) =>
    ipcRenderer.invoke('cost:estimateMonthly', modelId, dailyInputTokens, dailyOutputTokens),

  exportToCSV: (data: any, filename: string) => ipcRenderer.invoke('export:csv', data, filename),
  exportToExcel: (data: any, filename: string) => ipcRenderer.invoke('export:excel', data, filename),
  exportToJson: (data: any, filename: string) => ipcRenderer.invoke('export:json', data, filename),

  checkForUpdates: () => ipcRenderer.invoke('updater:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download-update'),
  installUpdate: () => ipcRenderer.invoke('updater:install-update'),
  getCurrentVersion: () => ipcRenderer.invoke('updater:get-current-version'),

  onUpdateChecking: (callback: () => void) => ipcRenderer.on('update-checking', callback),
  onUpdateAvailable: (callback: (info: any) => void) => ipcRenderer.on('update-available', (_event, info) => callback(info)),
  onUpdateNotAvailable: (callback: (info: any) => void) => ipcRenderer.on('update-not-available', (_event, info) => callback(info)),
  onUpdateDownloadProgress: (callback: (progress: any) => void) => ipcRenderer.on('update-download-progress', (_event, progress) => callback(progress)),
  onUpdateDownloaded: (callback: (info: any) => void) => ipcRenderer.on('update-downloaded', (_event, info) => callback(info)),
  onUpdatePreparing: (callback: () => void) => ipcRenderer.on('update-preparing', callback),
  onUpdateError: (callback: (error: any) => void) => ipcRenderer.on('update-error', (_event, error) => callback(error)),

  removeUpdateListeners: () => {
    ipcRenderer.removeAllListeners('update-checking');
    ipcRenderer.removeAllListeners('update-available');
    ipcRenderer.removeAllListeners('update-not-available');
    ipcRenderer.removeAllListeners('update-download-progress');
    ipcRenderer.removeAllListeners('update-downloaded');
    ipcRenderer.removeAllListeners('update-preparing');
    ipcRenderer.removeAllListeners('update-error');
  },

  onServiceLog: (callback: (msg: string, level: string) => void) =>
    ipcRenderer.on('service:log', (_event, msg, level) => callback(msg, level)),
  removeServiceLogListener: () =>
    ipcRenderer.removeAllListeners('service:log'),

  onRemoteNotice: (callback: (notice: any) => void) =>
    ipcRenderer.on('remote-notice', (_event, notice) => callback(notice)),
  removeRemoteNoticeListener: () =>
    ipcRenderer.removeAllListeners('remote-notice'),
  getNotice: () => ipcRenderer.invoke('notice:get'),

  getErp: () => ipcRenderer.invoke('system:getErp'),
  fetchRanking: (url: string) => ipcRenderer.invoke('ranking:fetch', url),

  // Token 消耗悬浮窗
  openFloatingWindow: () => ipcRenderer.invoke('floating:open'),
  closeFloatingWindow: () => ipcRenderer.invoke('floating:close'),
  toggleFloatingWindow: () => ipcRenderer.invoke('floating:toggle'),
  isFloatingWindowOpen: () => ipcRenderer.invoke('floating:isOpen'),

  getUserInfo: () => ipcRenderer.invoke('user:getInfo'),
  getCachedUser: () => ipcRenderer.invoke('user:getCached'),
  loginSSO: () => ipcRenderer.invoke('user:login'),
  logout: () => ipcRenderer.invoke('user:logout'),
  onUserInfoUpdated: (callback: (info: any) => void) =>
    ipcRenderer.on('user:info-updated', (_event, info) => callback(info)),
  removeUserInfoListener: () =>
    ipcRenderer.removeAllListeners('user:info-updated'),

  getCommunitySkills: (query: any) => ipcRenderer.invoke('skills:community:list', query),
  publishCommunitySkill: (params: any) => ipcRenderer.invoke('skills:community:publish', params),
  uploadSkillZip: (fileData: number[], fileName: string) => ipcRenderer.invoke('skills:community:upload-zip', fileData, fileName),
  uploadSkillIcon: (fileData: number[], fileName: string) => ipcRenderer.invoke('skills:community:upload-icon', fileData, fileName),
  installCommunitySkill: (skill: any) => ipcRenderer.invoke('skills:community:install', skill),
  incrementCommunityDownload: (id: string) => ipcRenderer.invoke('skills:community:incrementDownload', id),
  starCommunitySkill: (id: string) => ipcRenderer.invoke('skills:community:star', id),
  unstarCommunitySkill: (id: string) => ipcRenderer.invoke('skills:community:unstar', id),
  updateCommunitySkill: (id: string, params: any) => ipcRenderer.invoke('skills:community:update', id, params),
  deleteCommunitySkill: (id: string) => ipcRenderer.invoke('skills:community:delete', id),
});
