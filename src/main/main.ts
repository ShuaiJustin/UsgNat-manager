import { app, BrowserWindow, dialog, powerMonitor } from 'electron';
import path from 'path';

import { DEFAULT_IP_CHECK_SOURCES } from './ip-check-sources';
import { registerIpcHandlers } from './ipc';
import { createTray, refreshTrayMenu } from './tray';
import { createWindow } from './window';
import { isDevMode } from './runtime-mode';
import { revealMainWindow } from './window-visibility';
import { type AutomationConfig, automationService } from './services/automation-service';
import { configService } from './services/config-service';
import { databaseService } from './services/database-service';
import type { SMTPConfig } from './services/email-service';
import { emailService } from './services/email-service';
import { ipMonitor, type IPMonitorConfig } from './services/ip-monitor';
import { logger } from './services/logger';
import { notifier } from './services/notifier';
import { disconnectPrisma } from './services/prisma-client';
import { customUpdater } from './services/custom-updater';
import { restoreAutomationUnlessMandatory } from './services/custom-updater-helpers';
import { mandatoryUpdateBusinessGate } from './services/mandatory-update-business-gate';
import { ConfigurationLifecycle } from './services/configuration-lifecycle';

type StoredEmailConfig = SMTPConfig & {
  enabled?: boolean;
  notifyTypes?: string[];
};

type StoredAutomationConfig = AutomationConfig & {
  ipMonitorEnabled?: boolean;
  checkInterval?: number;
  confirmCount?: number;
  checkSources?: string[];
};

type RuntimeState = {
  monitoring: boolean;
  automationRunning: boolean;
  automationConfig: AutomationConfig;
  monitorConfig: IPMonitorConfig;
};
let runtimeBeforeMaintenance: RuntimeState | null = null;

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const userDataPath = app.getPath('userData');
const dbPath = path.join(userDataPath, 'usg-nat.db');
process.env.DATABASE_URL = `file:${dbPath}`;

let mainWindow: BrowserWindow | null = null;

const cleanupStoredLogs = async () => {
  const settings = await configService.getConfig<{ logRetentionDays?: number }>('app');
  const days = settings?.logRetentionDays ?? 30;
  if (!Number.isInteger(days) || days < 7 || days > 365) {
    throw new Error('日志保留天数必须为 7 到 365 的整数');
  }
  await logger.cleanup(days);
};

let updaterConfigurationTask: Promise<void> = Promise.resolve();
const queueUpdaterConfiguration = () => {
  // A server check may block the mandatory gate and wait for admitted config saves to release it.
  // Complete local runtime application first, then run serialized checks in the background.
  updaterConfigurationTask = updaterConfigurationTask
    .then(() => customUpdater.startPeriodicCheck())
    .catch((error) => {
      void logger
        .error('自动更新', '更新检查配置应用失败', {
          error: getErrorMessage(error, '配置恢复失败'),
        })
        .catch(console.error);
    });
};

const applyStoredConfigurationNow = async (
  type?: string,
  duringMaintenance = false,
  runtimeOverride?: RuntimeState
) => {
  if (!type || type === 'all' || type === 'email') {
    const emailConfig = await configService.getConfig<StoredEmailConfig>('email');
    if (emailConfig) emailService.configure(emailConfig);
    else emailService.clearConfiguration();
    notifier.updateConfig({ emailNotifyEnabled: emailConfig?.enabled === true });
  }
  if (!type || type === 'all' || type === 'app') await cleanupStoredLogs();
  if (!type || type === 'all' || type === 'automation') {
    await automationService.stop();
    ipMonitor.stop();
    const automationConfig: StoredAutomationConfig | null =
      runtimeOverride?.automationConfig ??
      (await configService.getConfig<StoredAutomationConfig>('automation'));
    notifier.updateConfig({
      windowsNotifyEnabled: automationConfig?.windowsNotifyEnabled !== false,
      notifyTypes: automationConfig?.notifyTypes ?? ['ipChange', 'updateSuccess', 'updateFailed'],
    });
    const shouldMonitor = runtimeOverride
      ? runtimeOverride.monitoring
      : automationConfig?.ipMonitorEnabled;
    if (
      shouldMonitor &&
      runtimeOverride &&
      (!runtimeOverride.automationRunning || !runtimeOverride.automationConfig.enabled)
    ) {
      if (
        !customUpdater.isMandatoryUpdateRequired() &&
        !mandatoryUpdateBusinessGate.isBlocked('mandatory')
      ) {
        ipMonitor.updateConfig(runtimeOverride.monitorConfig);
        await ipMonitor.start();
      }
    } else if (shouldMonitor && automationConfig) {
      await restoreAutomationUnlessMandatory(
        () => customUpdater.isMandatoryUpdateRequired(),
        () =>
          automationService.start(
            {
              ...automationConfig,
              enabled: true,
              autoUpdateEnabled: automationConfig.autoUpdateEnabled === true,
              clientEgressConfirmed: automationConfig.clientEgressConfirmed === true,
              managedRuleIds: automationConfig.managedRuleIds ?? [],
              triggerType: automationConfig.triggerType ?? 'immediate',
              selectedDevices: automationConfig.selectedDevices ?? [],
              checkSources: automationConfig.checkSources ?? [...DEFAULT_IP_CHECK_SOURCES],
            },
            { duringMaintenance }
          ),
        () => automationService.stop()
      );
    }
  }
  if (!type || type === 'all' || type === 'update') queueUpdaterConfiguration();
};

const configurationLifecycle = new ConfigurationLifecycle({
  gate: mandatoryUpdateBusinessGate,
  stop: async () => {
    await automationService.stop();
    ipMonitor.stop();
  },
  apply: applyStoredConfigurationNow,
  beforeStop: () => {
    runtimeBeforeMaintenance = {
      monitoring: ipMonitor.isMonitoring(),
      automationRunning: automationService.getStatus().isRunning,
      automationConfig: automationService.getConfig(),
      monitorConfig: ipMonitor.getConfig(),
    };
  },
  restoreAfterFailure: async () => {
    if (!runtimeBeforeMaintenance) throw new Error('缺少维护前运行状态，已保持停止');
    await applyStoredConfigurationNow('all', true, runtimeBeforeMaintenance);
  },
  reportRestoreError: (error) =>
    logger.error('数据维护', '数据操作后恢复服务失败', {
      error: getErrorMessage(error, '恢复失败'),
    }),
});

const applyStoredConfiguration = (type?: string) => configurationLifecycle.apply(type);

const runDataChange = async <T>(
  _reason: 'import' | 'reset' | 'restore',
  action: () => Promise<T>
): Promise<T> => {
  try {
    return await configurationLifecycle.runDataChange(action);
  } finally {
    refreshTrayMenu();
    if (!mandatoryUpdateBusinessGate.isBlocked() && automationService.getStatus().isRunning)
      void automationService.resume().catch((error) =>
        logger.error('自动化服务', '维护恢复后对账失败', {
          error: getErrorMessage(error, '恢复失败'),
        })
      );
  }
};

const gotTheLock = app.requestSingleInstanceLock();
app.disableHardwareAcceleration();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      revealMainWindow(mainWindow);
    }
  });

  app.whenReady().then(async () => {
    try {
      await databaseService.initialize();
    } catch (error) {
      // Keep the app bootable, but say why rules and settings will not work.
      dialog.showErrorBox(
        '数据库初始化失败',
        `${error instanceof Error ? error.message : String(error)}

规则和设置功能可能无法使用，请关闭其他占用数据库的程序后重启软件。`
      );
    }

    app.setName('华为USG防火墙NAT管理软件');
    app.setAppUserModelId('com.crystal.usg-nat-manager');

    mainWindow = createWindow();
    createTray(mainWindow, customUpdater);
    registerIpcHandlers({
      aroundDataChange: runDataChange,
      afterConfigChange: applyStoredConfiguration,
    });
    customUpdater.setMandatoryUpdateStateHandler(async (required) => {
      if (!required) {
        mandatoryUpdateBusinessGate.unblock();
        refreshTrayMenu();
        return;
      }

      mandatoryUpdateBusinessGate.block();
      refreshTrayMenu();
      try {
        await automationService.stop();
        await mandatoryUpdateBusinessGate.waitForIdle();
      } finally {
        ipMonitor.stop();
      }
    });
    customUpdater.setMainWindow(mainWindow);

    setTimeout(() => {
      void applyStoredConfiguration().catch((error) =>
        logger.error('启动恢复', '配置恢复失败', {
          error: getErrorMessage(error, '配置恢复失败'),
        })
      );
    }, 1500);
    const retentionTimer = setInterval(
      () => {
        if (configurationLifecycle.isMaintaining()) return;
        const release = mandatoryUpdateBusinessGate.tryEnter();
        if (!release) return;
        void cleanupStoredLogs()
          .catch((error) =>
            logger.error('日志清理', '自动清理失败', {
              error: getErrorMessage(error, '日志清理失败'),
            })
          )
          .finally(release);
      },
      24 * 60 * 60 * 1000
    );
    retentionTimer.unref();
    powerMonitor.on('resume', () => {
      if (!configurationLifecycle.isMaintaining())
        void automationService.resume().catch((error) =>
          logger.error('自动化服务', '恢复后对账失败', {
            error: getErrorMessage(error, '恢复失败'),
          })
        );
    });
    if (isDevMode()) {
      mainWindow.webContents.openDevTools();
    }
  });

  app.on('window-all-closed', async () => {
    if (process.platform !== 'darwin') {
      await disconnectPrisma();
      app.quit();
    }
  });

  app.on('before-quit', async (event) => {
    event.preventDefault();

    try {
      try {
        await automationService.stop();
        ipMonitor.stop();
        await logger.info('应用退出', '自动化服务已停止');
      } catch (error) {
        console.error('停止自动化服务失败:', error);
      }

      await disconnectPrisma();
    } catch (error) {
      console.error('清理资源失败:', error);
    } finally {
      app.exit(0);
    }
  });

  app.on('activate', () => {
    if (mainWindow) {
      revealMainWindow(mainWindow);
      return;
    }

    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      customUpdater.setMainWindow(mainWindow);
    }
  });
}

export { mainWindow };
