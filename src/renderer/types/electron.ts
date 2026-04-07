import type { AutomationConfirmRequest } from './automation';
import type { ConnectionTestResult, Credential, Device } from './device';
import type { Log, MonitorStatus } from './log';
import type { NatRule } from './rule';

type UnknownRecord = Record<string, unknown>;

type IpcResult = {
  success: boolean;
  error?: string;
  message?: string;
};

type DeviceDraft = Partial<Device>;
type RuleDraft = Partial<NatRule>;
type CredentialDraft = Partial<Credential>;

type DirectConnectionConfig = {
  host: string;
  port: number;
  connectionType?: Device['connectionType'];
  authType?: Credential['authType'];
  username?: string;
  password?: string;
  privateKeyPath?: string;
  privateKey?: string;
  certificatePath?: string;
  certificate?: string;
  passphrase?: string;
  mfaType?: Credential['mfaType'];
};

type RuleBatchUpdatePayload = RuleDraft & UnknownRecord;

type LogQueryFilter = {
  level?: Log['level'];
  operation?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  orderBy?: 'asc' | 'desc';
};

type AutomationConfigPayload = {
  ipMonitorEnabled?: boolean;
  checkInterval?: number;
  confirmCount?: number;
  checkSources?: string[];
  autoUpdateEnabled?: boolean;
  triggerType?: string;
  delayMinutes?: number;
  scheduledTime?: string | null;
  selectedDevices?: string[];
  backupOptions?: string[];
  backupKeepCount?: number;
  securityOptions?: string[];
  windowsNotifyEnabled?: boolean;
  notifyTypes?: string[];
  emailNotifyEnabled?: boolean;
  smtpServer?: string;
  smtpPort?: string | number;
  smtpEncryption?: string;
  smtpUsername?: string;
  smtpPassword?: string;
  senderEmail?: string;
  senderName?: string;
  recipientEmails?: string;
  emailNotifyTypes?: string[];
  wechatNotifyEnabled?: boolean;
  wechatType?: string;
  corpId?: string;
  corpSecret?: string;
  agentId?: string;
  webhookUrl?: string;
  appId?: string;
  appSecret?: string;
  templateId?: string;
  [key: string]: unknown;
};

type AutomationStatus = {
  isMonitoring?: boolean;
  isRunning?: boolean;
  currentIP?: string;
  [key: string]: unknown;
};

type EmailConfigPayload = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  requireTLS?: boolean;
  ignoreTLS?: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: {
    name: string;
    address: string;
  };
  to: string[];
  notifyTypes?: string[];
};

type BackupEntry = {
  filename?: string;
  [key: string]: unknown;
};

type BackupStats = {
  totalBackups?: number;
  totalSize?: number;
  oldestBackup?: string | null;
  newestBackup?: string | null;
  [key: string]: unknown;
};

type FileDialogOptions = {
  title?: string;
  filters?: Array<{
    name: string;
    extensions: string[];
  }>;
  properties?: string[];
};

type UpdateCheckResult = IpcResult & {
  hasUpdate?: boolean;
  currentVersion?: string;
  latestVersion?: string;
};

type WindowControls = {
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
};

export interface ElectronAPI {
  device: {
    getAll: () => Promise<Device[]>;
    getById: (id: string) => Promise<Device>;
    create: (device: DeviceDraft) => Promise<Device>;
    update: (id: string, device: DeviceDraft) => Promise<Device>;
    delete: (id: string) => Promise<void>;
    testConnection: (id: string) => Promise<ConnectionTestResult>;
    testDirectConnection: (config: DirectConnectionConfig) => Promise<ConnectionTestResult>;
  };
  rule: {
    getAll: (deviceId: string) => Promise<NatRule[]>;
    getTotalCount: () => Promise<number>;
    syncFromDevice: (deviceId: string) => Promise<NatRule[]>;
    syncToDevice: (
      deviceId: string
    ) => Promise<IpcResult & { syncedCount?: number; updated?: number }>;
    batchUpdateIP: (
      deviceId: string,
      ruleIds: string[],
      newIP: string
    ) => Promise<IpcResult & { updated?: number }>;
    batchUpdate: (
      ruleIds: string[],
      updates: RuleBatchUpdatePayload
    ) => Promise<IpcResult & { updated?: number }>;
    create: (deviceId: string, rule: RuleDraft) => Promise<NatRule>;
    update: (id: string, rule: RuleDraft) => Promise<NatRule>;
    delete: (id: string) => Promise<void>;
  };
  monitor: {
    start: () => Promise<IpcResult>;
    stop: () => Promise<IpcResult>;
    getStatus: () => Promise<MonitorStatus>;
    getCurrentIP: () => Promise<string>;
  };
  credential: {
    save: (deviceId: string, credential: CredentialDraft) => Promise<void>;
    get: (deviceId: string) => Promise<Credential>;
    delete: (deviceId: string) => Promise<void>;
  };
  log: {
    query: (filter: LogQueryFilter) => Promise<Log[]>;
    export: (filter: LogQueryFilter) => Promise<string>;
    cleanup: (daysToKeep: number) => Promise<{ success: boolean; count: number }>;
  };
  automation: {
    start: (config: AutomationConfigPayload) => Promise<IpcResult>;
    stop: () => Promise<IpcResult>;
    getConfig: <T = AutomationConfigPayload>() => Promise<T>;
    getStatus: <T = AutomationStatus>() => Promise<T>;
    manualUpdate: (newIP?: string) => Promise<IpcResult>;
    updateConfig: (config: AutomationConfigPayload) => Promise<IpcResult>;
    confirmResponse: (requestId: string, confirmed: boolean) => Promise<IpcResult>;
    getPendingConfirm: () => Promise<AutomationConfirmRequest | null>;
    onConfirmRequest: (callback: (data: AutomationConfirmRequest) => void) => void;
    removeConfirmRequestListener: (callback: (data: AutomationConfirmRequest) => void) => void;
  };
  email: {
    configure: (config: EmailConfigPayload) => Promise<{ success: boolean }>;
    sendTest: () => Promise<{ success: boolean }>;
    sendTestWithConfig: (config: EmailConfigPayload) => Promise<IpcResult>;
    verifyConfig: (config: EmailConfigPayload) => Promise<IpcResult>;
  };
  config: {
    save: <T extends UnknownRecord>(type: string, data: T) => Promise<{ success: boolean }>;
    get: <T = UnknownRecord>(type: string) => Promise<T | null>;
    getAll: <T extends UnknownRecord = UnknownRecord>() => Promise<T>;
    export: (filePath?: string) => Promise<{ success: boolean; path: string; error?: string }>;
    import: (filePath: string) => Promise<IpcResult>;
    reset: () => Promise<{ success: boolean }>;
  };
  backup: {
    create: (description?: string) => Promise<BackupEntry>;
    restore: (filePath: string) => Promise<{ success: boolean }>;
    list: () => Promise<BackupEntry[]>;
    delete: (filename: string) => Promise<{ success: boolean }>;
    cleanup: (keepCount?: number) => Promise<{ success: boolean; deleted: number }>;
    stats: () => Promise<BackupStats>;
  };
  database: {
    clearAll: () => Promise<{ success: boolean }>;
  };
  system: {
    showNotification: (title: string, body: string) => Promise<void>;
    getTheme: () => Promise<string>;
    setTheme: (theme: string) => Promise<void>;
    setAutoStart: (enabled: boolean) => Promise<IpcResult>;
    getAutoStart: () => Promise<boolean>;
    getDatabaseInfo: () => Promise<{ path: string; size: string }>;
    selectFile: (options?: FileDialogOptions) => Promise<string | null>;
  };
  updater: {
    checkForUpdates: (showNoUpdateMessage?: boolean) => Promise<UpdateCheckResult>;
    downloadUpdate: () => Promise<IpcResult>;
    quitAndInstall: () => Promise<IpcResult>;
    getCurrentVersion: () => Promise<string>;
  };
  window: WindowControls;
  on: (channel: string, callback: (...args: unknown[]) => void) => void;
  off: (channel: string, callback: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
