import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // 配置相关
  getConfig: (id: string) => ipcRenderer.invoke('config:get', id),
  saveConfig: (config: any) => ipcRenderer.invoke('config:save', config),
  listConfigs: () => ipcRenderer.invoke('config:list'),
  deleteConfig: (id: string) => ipcRenderer.invoke('config:delete', id),
  
  // 服务控制
  startService: (config: any) => ipcRenderer.invoke('service:start', config),
  stopService: () => ipcRenderer.invoke('service:stop'),
  getServiceStatus: () => ipcRenderer.invoke('service:status'),
  
  // 日志相关
  getLogs: (filter: any) => ipcRenderer.invoke('logs:get', filter),
  clearLogs: () => ipcRenderer.invoke('logs:clear'),
  
  // 统计相关
  getStats: (period: string) => ipcRenderer.invoke('stats:get', period),
  
  // 对话历史相关
  getConversations: (limit?: number) => ipcRenderer.invoke('conversations:get', limit),
  deleteConversation: (id: string) => ipcRenderer.invoke('conversations:delete', id),
  
  // 设置相关
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: any) => ipcRenderer.invoke('settings:save', settings),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  clearCache: () => ipcRenderer.invoke('cache:clear'),
});
