// 设备类型
export interface Device {
  id: string;
  name: string;
  host: string;
  port: number;
  connectionType: 'SSH' | 'HTTPS';
  description?: string;
  enabled: boolean;
  online: boolean;
  lastConnected?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// NAT规则类型
export interface NatRule {
  id: string;
  deviceId: string;
  ruleName: string;
  protocol: 'TCP' | 'UDP' | 'ALL';
  globalIp: string;
  globalPort: string;
  insideIp: string;
  insidePort: string;
  enabled: boolean;
  description?: string;
  noReverse: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// 日志类型
export interface Log {
  id: string;
  level: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  operation: string;
  message: string;
  details?: string;
  createdAt: Date;
}

// 凭据类型
export interface Credential {
  id: string;
  deviceId: string;
  authType: 'Password' | 'PrivateKey' | 'Certificate' | 'MultiFactor';
  username?: string;
  password?: string;
  secretRef?: string;
  privateKey?: string;
  certificate?: string;
  mfaType?: 'TOTP' | 'SMS' | 'Email' | 'Hardware';
  createdAt: Date;
  updatedAt: Date;
}

// 连接测试结果
export interface ConnectionTestResult {
  success: boolean;
  latency: number;
  message: string;
}

// 监控状态
export interface MonitorStatus {
  isRunning: boolean;
  currentIP: string;
  lastCheck: Date;
}

// ElectronAPI类型定义
export interface ElectronAPI {
  device: {
    getAll: () => Promise<Device[]>;
    getById: (id: string) => Promise<Device>;
    create: (device: Partial<Device>) => Promise<Device>;
    update: (id: string, device: Partial<Device>) => Promise<Device>;
    delete: (id: string) => Promise<void>;
    testConnection: (id: string) => Promise<ConnectionTestResult>;
    testDirectConnection: (config: any) => Promise<ConnectionTestResult>;
  };
  rule: {
    getAll: (deviceId: string) => Promise<NatRule[]>;
    getTotalCount: () => Promise<number>;
    syncFromDevice: (deviceId: string) => Promise<NatRule[]>;
    syncToDevice: (deviceId: string) => Promise<{ success: boolean; syncedCount: number }>;
    batchUpdateIP: (
      deviceId: string,
      ruleIds: string[],
      newIP: string
    ) => Promise<{ success: boolean; updated: number }>;
    batchUpdate: (ruleIds: string[], updates: any) => Promise<{ success: boolean; updated: number }>;
    create: (deviceId: string, rule: Partial<NatRule>) => Promise<NatRule>;
    update: (id: string, rule: Partial<NatRule>) => Promise<NatRule>;
    delete: (id: string) => Promise<void>;
  };
  monitor: {
    start: () => Promise<any>;
    stop: () => Promise<any>;
    getStatus: () => Promise<MonitorStatus>;
    getCurrentIP: () => Promise<string>;
  };
  credential: {
    save: (deviceId: string, credential: Partial<Credential>) => Promise<void>;
    get: (deviceId: string) => Promise<Credential>;
    delete: (deviceId: string) => Promise<void>;
  };
  log: {
    query: (filter: any) => Promise<Log[]>;
    export: (filter: any) => Promise<string>;
    cleanup: (daysToKeep: number) => Promise<{ success: boolean; count: number }>;
  };
  automation: {
    start: (config: any) => Promise<{ success: boolean; error?: string }>;
    stop: () => Promise<{ success: boolean; error?: string }>;
    getConfig: () => Promise<any>;
    getStatus: () => Promise<any>;
    manualUpdate: (newIP?: string) => Promise<{ success: boolean; error?: string }>;
    updateConfig: (config: any) => Promise<{ success: boolean; error?: string }>;
    confirmResponse: (confirmed: boolean) => Promise<{ success: boolean; error?: string }>;
    onConfirmRequest: (callback: (data: { newIP: string; deviceCount: number }) => void) => void;
    removeConfirmRequestListener: (
      callback: (data: { newIP: string; deviceCount: number }) => void
    ) => void;
  };
  email: {
    configure: (config: any) => Promise<{ success: boolean }>;
    sendTest: () => Promise<{ success: boolean }>;
    sendTestWithConfig: (config: any) => Promise<{ success: boolean }>;
    verifyConfig: (config: any) => Promise<{ success: boolean }>;
  };
  config: {
    save: (type: string, data: any) => Promise<{ success: boolean }>;
    get: (type: string) => Promise<any>;
    getAll: () => Promise<Record<string, any>>;
    export: (filePath?: string) => Promise<{ success: boolean; path: string }>;
    import: (filePath: string) => Promise<{ success: boolean }>;
    reset: () => Promise<{ success: boolean }>;
  };
  backup: {
    create: (description?: string) => Promise<any>;
    restore: (filePath: string) => Promise<{ success: boolean }>;
    list: () => Promise<any[]>;
    delete: (filename: string) => Promise<{ success: boolean }>;
    cleanup: (keepCount?: number) => Promise<{ success: boolean; deleted: number }>;
    stats: () => Promise<any>;
  };
  database: {
    clearAll: () => Promise<{ success: boolean }>;
  };
  system: {
    showNotification: (title: string, body: string) => Promise<void>;
    getTheme: () => Promise<string>;
    setTheme: (theme: string) => Promise<void>;
    setAutoStart: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
    getAutoStart: () => Promise<boolean>;
    getDatabaseInfo: () => Promise<{ path: string; size: string }>;
    selectFile: (options?: any) => Promise<string | null>;
  };
  updater: {
    checkForUpdates: (showNoUpdateMessage?: boolean) => Promise<any>;
    downloadUpdate: () => Promise<{ success: boolean; message?: string }>;
    quitAndInstall: () => Promise<{ success: boolean; message?: string }>;
    getCurrentVersion: () => Promise<string>;
  };
  on: (channel: string, callback: (...args: unknown[]) => void) => void;
  off: (channel: string, callback: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
