import { normalizeAutomationCheckSources } from './automationConfig.ts';

type IpcResult = {
  success: boolean;
  error?: string;
  message?: string;
};

type SavedAutomationConfig = {
  ipMonitorEnabled?: boolean;
  autoUpdateEnabled?: boolean;
  triggerType?: string;
  delayMinutes?: number;
  scheduledTime?: string | null;
  selectedDevices?: string[];
  checkInterval?: number;
  confirmCount?: number;
  checkSources?: string[];
  backupOptions?: string[];
  backupKeepCount?: number;
  securityOptions?: string[];
};

type AutomationStatus = {
  isMonitoring?: boolean;
};

type MonitorControlApi = {
  config?: {
    get?: <T = SavedAutomationConfig>(type: string) => Promise<T | null>;
  };
  automation?: {
    start?: (config: SavedAutomationConfig & { enabled: boolean }) => Promise<IpcResult>;
    stop?: () => Promise<IpcResult>;
    getStatus?: <T = AutomationStatus>() => Promise<T>;
  };
  monitor?: {
    start?: () => Promise<IpcResult>;
    stop?: () => Promise<IpcResult>;
  };
};

const shouldUseAutomationMonitor = (savedConfig?: SavedAutomationConfig | null): boolean =>
  !!savedConfig && savedConfig.ipMonitorEnabled !== false;

export const buildAutomationMonitorStartConfig = (savedConfig?: SavedAutomationConfig | null) => ({
  enabled: true,
  autoUpdateEnabled: savedConfig?.autoUpdateEnabled ?? false,
  triggerType: savedConfig?.triggerType ?? 'immediate',
  delayMinutes: savedConfig?.delayMinutes ?? 5,
  scheduledTime: savedConfig?.scheduledTime ?? null,
  selectedDevices: savedConfig?.selectedDevices ?? [],
  checkInterval: savedConfig?.checkInterval ?? 5,
  confirmCount: savedConfig?.confirmCount ?? 3,
  checkSources: normalizeAutomationCheckSources(savedConfig?.checkSources),
  backupOptions: savedConfig?.backupOptions ?? [],
  backupKeepCount: savedConfig?.backupKeepCount ?? 10,
  securityOptions: savedConfig?.securityOptions ?? [],
});

const ensureMonitorStart = async (api: MonitorControlApi): Promise<IpcResult> => {
  if (!api.monitor?.start) {
    throw new Error('monitor API unavailable');
  }

  return api.monitor.start();
};

const ensureMonitorStop = async (api: MonitorControlApi): Promise<IpcResult> => {
  if (!api.monitor?.stop) {
    throw new Error('monitor API unavailable');
  }

  return api.monitor.stop();
};

export const startMonitoringService = async (api: MonitorControlApi): Promise<IpcResult> => {
  const savedConfig = (await api.config?.get?.<SavedAutomationConfig>('automation')) ?? null;

  if (!shouldUseAutomationMonitor(savedConfig) || !api.automation?.start) {
    return ensureMonitorStart(api);
  }

  const status = api.automation.getStatus
    ? await api.automation.getStatus<AutomationStatus>()
    : null;

  if (status?.isMonitoring) {
    return { success: true };
  }

  return api.automation.start(buildAutomationMonitorStartConfig(savedConfig));
};

export const stopMonitoringService = async (api: MonitorControlApi): Promise<IpcResult> => {
  const savedConfig = (await api.config?.get?.<SavedAutomationConfig>('automation')) ?? null;
  const status = api.automation?.getStatus
    ? await api.automation.getStatus<AutomationStatus>()
    : null;

  if ((status?.isMonitoring || shouldUseAutomationMonitor(savedConfig)) && api.automation?.stop) {
    return api.automation.stop();
  }

  return ensureMonitorStop(api);
};
