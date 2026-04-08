import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_AUTOMATION_CHECK_SOURCES } from './automationConfig.ts';
import {
  buildAutomationMonitorStartConfig,
  startMonitoringService,
  stopMonitoringService,
} from './monitorControl.ts';

type IpcResult = {
  success: boolean;
  error?: string;
};

type AutomationConfig = {
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

type MonitorControlApi = {
  config?: {
    get?: <T = AutomationConfig>(type: string) => Promise<T | null>;
  };
  automation?: {
    start?: (config: AutomationConfig) => Promise<IpcResult>;
    stop?: () => Promise<IpcResult>;
    getStatus?: <T = { isMonitoring?: boolean }>() => Promise<T>;
  };
  monitor?: {
    start?: () => Promise<IpcResult>;
    stop?: () => Promise<IpcResult>;
  };
};

const createConfigGetter =
  <T>(value: T | null) =>
  async <U = T>(_type: string): Promise<U | null> =>
    value as unknown as U | null;

const createStatusGetter =
  <T>(value: T) =>
  async <U = T>(): Promise<U> =>
    value as unknown as U;

test('buildAutomationMonitorStartConfig applies defaults and normalizes sources', () => {
  const config = buildAutomationMonitorStartConfig({
    ipMonitorEnabled: true,
    autoUpdateEnabled: true,
    checkSources: ['cip', 'ipify', 'cip'],
    selectedDevices: ['device-1'],
  });

  assert.equal(config.enabled, true);
  assert.equal(config.autoUpdateEnabled, true);
  assert.equal(config.triggerType, 'immediate');
  assert.equal(config.delayMinutes, 5);
  assert.deepEqual(config.selectedDevices, ['device-1']);
  assert.equal(config.checkInterval, 5);
  assert.equal(config.confirmCount, 3);
  assert.deepEqual(config.checkSources, ['cip.cc', 'ipify']);
  assert.deepEqual(config.backupOptions, []);
  assert.equal(config.backupKeepCount, 10);
  assert.deepEqual(config.securityOptions, []);
});

test('startMonitoringService prefers automation start when saved automation monitoring is enabled', async () => {
  let automationStartConfig: AutomationConfig | null = null;
  let monitorStartCalled = false;

  const api: MonitorControlApi = {
    config: {
      get: createConfigGetter({
        ipMonitorEnabled: true,
        autoUpdateEnabled: true,
        checkSources: ['cip'],
        selectedDevices: ['device-1'],
      }),
    },
    automation: {
      getStatus: createStatusGetter({ isMonitoring: false }),
      start: async (config) => {
        automationStartConfig = config;
        return { success: true };
      },
    },
    monitor: {
      start: async () => {
        monitorStartCalled = true;
        return { success: true };
      },
    },
  };

  const result = await startMonitoringService(api);

  assert.equal(result.success, true);
  assert.equal(monitorStartCalled, false);
  assert.deepEqual(automationStartConfig, {
    enabled: true,
    autoUpdateEnabled: true,
    triggerType: 'immediate',
    delayMinutes: 5,
    scheduledTime: null,
    selectedDevices: ['device-1'],
    checkInterval: 5,
    confirmCount: 3,
    checkSources: ['cip.cc'],
    backupOptions: [],
    backupKeepCount: 10,
    securityOptions: [],
  });
});

test('startMonitoringService falls back to raw monitor start when automation monitoring is disabled', async () => {
  let automationStartCalled = false;
  let monitorStartCalled = false;

  const api: MonitorControlApi = {
    config: {
      get: createConfigGetter({
        ipMonitorEnabled: false,
      }),
    },
    automation: {
      start: async () => {
        automationStartCalled = true;
        return { success: true };
      },
    },
    monitor: {
      start: async () => {
        monitorStartCalled = true;
        return { success: true };
      },
    },
  };

  const result = await startMonitoringService(api);

  assert.equal(result.success, true);
  assert.equal(automationStartCalled, false);
  assert.equal(monitorStartCalled, true);
});

test('stopMonitoringService prefers automation stop when automation status reports monitoring', async () => {
  let automationStopCalled = false;
  let monitorStopCalled = false;

  const api: MonitorControlApi = {
    automation: {
      getStatus: createStatusGetter({ isMonitoring: true }),
      stop: async () => {
        automationStopCalled = true;
        return { success: true };
      },
    },
    monitor: {
      stop: async () => {
        monitorStopCalled = true;
        return { success: true };
      },
    },
  };

  const result = await stopMonitoringService(api);

  assert.equal(result.success, true);
  assert.equal(automationStopCalled, true);
  assert.equal(monitorStopCalled, false);
});

test('stopMonitoringService falls back to raw monitor stop when automation is not running', async () => {
  let automationStopCalled = false;
  let monitorStopCalled = false;

  const api: MonitorControlApi = {
    automation: {
      getStatus: createStatusGetter({ isMonitoring: false }),
      stop: async () => {
        automationStopCalled = true;
        return { success: true };
      },
    },
    monitor: {
      stop: async () => {
        monitorStopCalled = true;
        return { success: true };
      },
    },
  };

  const result = await stopMonitoringService(api);

  assert.equal(result.success, true);
  assert.equal(automationStopCalled, false);
  assert.equal(monitorStopCalled, true);
});

test('stopMonitoringService still uses automation stop when saved automation monitoring is enabled', async () => {
  let automationStopCalled = false;
  let monitorStopCalled = false;

  const api: MonitorControlApi = {
    config: {
      get: createConfigGetter({
        ipMonitorEnabled: true,
      }),
    },
    automation: {
      getStatus: createStatusGetter({ isMonitoring: false }),
      stop: async () => {
        automationStopCalled = true;
        return { success: true };
      },
    },
    monitor: {
      stop: async () => {
        monitorStopCalled = true;
        return { success: true };
      },
    },
  };

  const result = await stopMonitoringService(api);

  assert.equal(result.success, true);
  assert.equal(automationStopCalled, true);
  assert.equal(monitorStopCalled, false);
});

test('buildAutomationMonitorStartConfig falls back to default sources when saved sources are invalid', () => {
  const config = buildAutomationMonitorStartConfig({
    ipMonitorEnabled: true,
    checkSources: ['not-supported'],
  });

  assert.deepEqual(config.checkSources, ['cip.cc', 'ipip']);
  assert.deepEqual([...DEFAULT_AUTOMATION_CHECK_SOURCES], ['cip.cc', 'ipip']);
});
