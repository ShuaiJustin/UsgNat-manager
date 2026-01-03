import { contextBridge, ipcRenderer } from 'electron';

// 暴露安全的API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 设备管理
  device: {
    getAll: () => ipcRenderer.invoke('device:getAll'),
    getById: (id: string) => ipcRenderer.invoke('device:getById', id),
    create: (device: any) => ipcRenderer.invoke('device:create', device),
    update: (id: string, device: any) => ipcRenderer.invoke('device:update', id, device),
    delete: (id: string) => ipcRenderer.invoke('device:delete', id),
    testConnection: (id: string) => ipcRenderer.invoke('device:testConnection', id),
    testDirectConnection: (config: any) =>
      ipcRenderer.invoke('device:testDirectConnection', config),
  },

  // 规则管理
  rule: {
    getAll: (deviceId: string) => ipcRenderer.invoke('rule:getAll', deviceId),
    getTotalCount: () => ipcRenderer.invoke('rule:getTotalCount'),
    syncFromDevice: (deviceId: string) => ipcRenderer.invoke('rule:syncFromDevice', deviceId),
    syncToDevice: (deviceId: string) => ipcRenderer.invoke('rule:syncToDevice', deviceId),
    batchUpdateIP: (deviceId: string, ruleIds: string[], newIP: string) =>
      ipcRenderer.invoke('rule:batchUpdateIP', deviceId, ruleIds, newIP),
    batchUpdate: (ruleIds: string[], updates: any) =>
      ipcRenderer.invoke('rule:batchUpdate', ruleIds, updates),
    create: (deviceId: string, rule: any) => ipcRenderer.invoke('rule:create', deviceId, rule),
    update: (id: string, rule: any) => ipcRenderer.invoke('rule:update', id, rule),
    delete: (id: string) => ipcRenderer.invoke('rule:delete', id),
  },

  // 监控管理
  monitor: {
    start: () => ipcRenderer.invoke('monitor:start'),
    stop: () => ipcRenderer.invoke('monitor:stop'),
    getStatus: () => ipcRenderer.invoke('monitor:getStatus'),
    getCurrentIP: () => ipcRenderer.invoke('monitor:getCurrentIP'),
  },

  // 凭据管理
  credential: {
    save: (deviceId: string, credential: any) =>
      ipcRenderer.invoke('credential:save', deviceId, credential),
    get: (deviceId: string) => ipcRenderer.invoke('credential:get', deviceId),
    delete: (deviceId: string) => ipcRenderer.invoke('credential:delete', deviceId),
  },

  // 日志管理
  log: {
    query: (filter: any) => ipcRenderer.invoke('log:query', filter),
    export: (filter: any) => ipcRenderer.invoke('log:export', filter),
    cleanup: (daysToKeep: number) => ipcRenderer.invoke('log:cleanup', daysToKeep),
  },

  // 自动化服务
  automation: {
    start: (config: any) => ipcRenderer.invoke('automation:start', config),
    stop: () => ipcRenderer.invoke('automation:stop'),
    getStatus: () => ipcRenderer.invoke('automation:getStatus'),
    getConfig: () => ipcRenderer.invoke('automation:getConfig'),
    manualUpdate: (newIP?: string) => ipcRenderer.invoke('automation:manualUpdate', newIP),
    updateConfig: (config: any) => ipcRenderer.invoke('automation:updateConfig', config),
    confirmResponse: (confirmed: boolean) => ipcRenderer.invoke('automation:confirm-response', confirmed),
    onConfirmRequest: (callback: (data: { newIP: string; deviceCount: number }) => void) => {
      ipcRenderer.on('automation:confirm-request', (_event, data) => callback(data));
    },
    removeConfirmRequestListener: () => {
      ipcRenderer.removeAllListeners('automation:confirm-request');
    },
  },

  // 邮件服务
  email: {
    configure: (config: any) => ipcRenderer.invoke('email:configure', config),
    sendTest: () => ipcRenderer.invoke('email:sendTest'),
    sendTestWithConfig: (config: any) => ipcRenderer.invoke('email:sendTestWithConfig', config),
    verifyConfig: (config: any) => ipcRenderer.invoke('email:verifyConfig', config),
  },

  // 配置服务
  config: {
    save: (type: string, data: any) => ipcRenderer.invoke('config:save', type, data),
    get: (type: string) => ipcRenderer.invoke('config:get', type),
    getAll: () => ipcRenderer.invoke('config:getAll'),
    export: (filePath?: string) => ipcRenderer.invoke('config:export', filePath),
    import: (filePath: string) => ipcRenderer.invoke('config:import', filePath),
    reset: () => ipcRenderer.invoke('config:reset'),
  },

  // 备份服务
  backup: {
    create: (description?: string) => ipcRenderer.invoke('backup:create', description),
    restore: (filePath: string) => ipcRenderer.invoke('backup:restore', filePath),
    list: () => ipcRenderer.invoke('backup:list'),
    delete: (filename: string) => ipcRenderer.invoke('backup:delete', filename),
    cleanup: (keepCount?: number) => ipcRenderer.invoke('backup:cleanup', keepCount),
    stats: () => ipcRenderer.invoke('backup:stats'),
  },

  // 系统功能
  system: {
    showNotification: (title: string, body: string) =>
      ipcRenderer.invoke('system:showNotification', title, body),
    getTheme: () => ipcRenderer.invoke('system:getTheme'),
    setTheme: (theme: string) => ipcRenderer.invoke('system:setTheme', theme),
    setAutoStart: (enabled: boolean) => ipcRenderer.invoke('system:setAutoStart', enabled),
    getAutoStart: () => ipcRenderer.invoke('system:getAutoStart'),
    getDatabaseInfo: () => ipcRenderer.invoke('system:getDatabaseInfo'),
    selectFile: (options?: any) => ipcRenderer.invoke('system:selectFile', options),
  },

  // 更新功能
  updater: {
    checkForUpdates: (showNoUpdateMessage?: boolean) =>
      ipcRenderer.invoke('updater:checkForUpdates', showNoUpdateMessage),
    downloadUpdate: () => ipcRenderer.invoke('updater:downloadUpdate'),
    quitAndInstall: () => ipcRenderer.invoke('updater:quitAndInstall'),
    getCurrentVersion: () => ipcRenderer.invoke('updater:getCurrentVersion'),
  },

  // 窗口控制
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },

  // 事件监听
  on: (channel: string, callback: (...args: any[]) => void) => {
    const wrappedCallback = (_event: any, ...args: any[]) => callback(...args);
    ipcRenderer.on(channel, wrappedCallback);
    return wrappedCallback; // 返回包装后的回调，用于正确移除
  },

  // 移除监听
  off: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.removeAllListeners(channel); // 先移除所有，避免重复
  },
});
