import { contextBridge, ipcRenderer } from 'electron';

type RendererListener = (...args: unknown[]) => void;
type WrappedRendererListener = (_event: unknown, ...args: unknown[]) => void;
type ConfirmRequest = {
  requestId: string;
  newIP: string;
  deviceCount: number;
  expiresAt: number;
};
type DevicePayload = Record<string, unknown>;
type RulePayload = Record<string, unknown>;
type RuleBatchUpdatePayload = Record<string, unknown>;
type CredentialPayload = Record<string, unknown>;
type LogFilter = Record<string, unknown>;
type AutomationConfig = Record<string, unknown>;
type EmailConfig = Record<string, unknown>;
type ConfigPayload = Record<string, unknown>;
type FileDialogOptions = Record<string, unknown>;

const listenerMap = new Map<string, WeakMap<object, WrappedRendererListener>>();

const addMappedListener = (channel: string, callback: RendererListener) => {
  let channelListeners = listenerMap.get(channel);
  if (!channelListeners) {
    channelListeners = new WeakMap();
    listenerMap.set(channel, channelListeners);
  }

  const wrappedCallback: WrappedRendererListener = (_event, ...args) => callback(...args);
  channelListeners.set(callback as object, wrappedCallback);
  ipcRenderer.on(channel, wrappedCallback);
};

const removeMappedListener = (channel: string, callback: RendererListener) => {
  const wrappedCallback = listenerMap.get(channel)?.get(callback as object);
  if (wrappedCallback) {
    ipcRenderer.removeListener(channel, wrappedCallback);
  }
};

// 暴露安全的API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 设备管理
  device: {
    getAll: () => ipcRenderer.invoke('device:getAll'),
    getById: (id: string) => ipcRenderer.invoke('device:getById', id),
    create: (device: DevicePayload) => ipcRenderer.invoke('device:create', device),
    update: (id: string, device: DevicePayload) => ipcRenderer.invoke('device:update', id, device),
    delete: (id: string) => ipcRenderer.invoke('device:delete', id),
    testConnection: (id: string) => ipcRenderer.invoke('device:testConnection', id),
    testDirectConnection: (config: DevicePayload) =>
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
    batchUpdate: (ruleIds: string[], updates: RuleBatchUpdatePayload) =>
      ipcRenderer.invoke('rule:batchUpdate', ruleIds, updates),
    create: (deviceId: string, rule: RulePayload) =>
      ipcRenderer.invoke('rule:create', deviceId, rule),
    update: (id: string, rule: RulePayload) => ipcRenderer.invoke('rule:update', id, rule),
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
    save: (deviceId: string, credential: CredentialPayload) =>
      ipcRenderer.invoke('credential:save', deviceId, credential),
    get: (deviceId: string) => ipcRenderer.invoke('credential:get', deviceId),
    delete: (deviceId: string) => ipcRenderer.invoke('credential:delete', deviceId),
  },

  // 日志管理
  log: {
    query: (filter: LogFilter) => ipcRenderer.invoke('log:query', filter),
    export: (filter: LogFilter) => ipcRenderer.invoke('log:export', filter),
    cleanup: (daysToKeep: number) => ipcRenderer.invoke('log:cleanup', daysToKeep),
  },

  // 自动化服务
  automation: {
    start: (config: AutomationConfig) => ipcRenderer.invoke('automation:start', config),
    stop: () => ipcRenderer.invoke('automation:stop'),
    getStatus: () => ipcRenderer.invoke('automation:getStatus'),
    getConfig: () => ipcRenderer.invoke('automation:getConfig'),
    manualUpdate: (newIP?: string) => ipcRenderer.invoke('automation:manualUpdate', newIP),
    updateConfig: (config: AutomationConfig) =>
      ipcRenderer.invoke('automation:updateConfig', config),
    confirmResponse: (requestId: string, confirmed: boolean) =>
      ipcRenderer.invoke('automation:confirm-response', requestId, confirmed),
    getPendingConfirm: () => ipcRenderer.invoke('automation:getPendingConfirm'),
    onConfirmRequest: (callback: (data: ConfirmRequest) => void) => {
      addMappedListener('automation:confirm-request', (data) => callback(data as ConfirmRequest));
    },
    removeConfirmRequestListener: (callback: (data: ConfirmRequest) => void) => {
      removeMappedListener('automation:confirm-request', callback as RendererListener);
    },
  },

  // 邮件服务
  email: {
    configure: (config: EmailConfig) => ipcRenderer.invoke('email:configure', config),
    sendTest: () => ipcRenderer.invoke('email:sendTest'),
    sendTestWithConfig: (config: EmailConfig) =>
      ipcRenderer.invoke('email:sendTestWithConfig', config),
    verifyConfig: (config: EmailConfig) => ipcRenderer.invoke('email:verifyConfig', config),
  },

  // 配置服务
  config: {
    save: (type: string, data: ConfigPayload) => ipcRenderer.invoke('config:save', type, data),
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

  // 数据库工具
  database: {
    clearAll: () => ipcRenderer.invoke('database:clearAll'),
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
    selectFile: (options?: FileDialogOptions) => ipcRenderer.invoke('system:selectFile', options),
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
  on: (channel: string, callback: RendererListener) => {
    addMappedListener(channel, callback);
  },

  // 移除监听
  off: (channel: string, callback: RendererListener) => {
    removeMappedListener(channel, callback);
  },
});
