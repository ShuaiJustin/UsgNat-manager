import { app, BrowserWindow } from 'electron';
import path from 'path';

import { DEFAULT_IP_CHECK_SOURCES } from './ip-check-sources';
import { registerIpcHandlers } from './ipc';
import { createTray } from './tray';
import { createWindow } from './window';
import { revealMainWindow } from './window-visibility';
import { type AutomationConfig, automationService } from './services/automation-service';
import { configService } from './services/config-service';
import { databaseService } from './services/database-service';
import type { SMTPConfig } from './services/email-service';
import { emailService } from './services/email-service';
import { ipMonitor } from './services/ip-monitor';
import { logger } from './services/logger';
import { notifier } from './services/notifier';
import { disconnectPrisma } from './services/prisma-client';
import { customUpdater } from './services/custom-updater';

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

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const userDataPath = app.getPath('userData');
const dbPath = path.join(userDataPath, 'usg-nat.db');
process.env.DATABASE_URL = `file:${dbPath}`;

let mainWindow: BrowserWindow | null = null;

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
    } catch {
      // Keep app bootable even if the database initialization fails.
    }

    app.setName('华为USG防火墙NAT管理软件');
    app.setAppUserModelId('com.crystal.usg-nat-manager');

    mainWindow = createWindow();
    createTray(mainWindow);
    registerIpcHandlers();
    customUpdater.setMainWindow(mainWindow);

    setTimeout(() => {
      customUpdater.cleanupOldInstallers().catch(console.error);
    }, 1000);

    setTimeout(async () => {
      try {
        const emailConfig = await configService.getConfig<StoredEmailConfig>('email');
        if (!emailConfig) {
          return;
        }

        emailService.configure(emailConfig);
        notifier.updateConfig({
          emailNotifyEnabled: emailConfig.enabled || false,
          notifyTypes: emailConfig.notifyTypes || [
            'ipChange',
            'updateSuccess',
            'updateFailed',
            'deviceOffline',
          ],
        });
      } catch (error) {
        await logger.error('邮件服务', '恢复邮件配置失败', {
          error: getErrorMessage(error, '恢复邮件配置失败'),
        });
        console.error('恢复邮件配置失败:', error);
      }
    }, 1500);

    setTimeout(async () => {
      try {
        const automationConfig =
          await configService.getConfig<StoredAutomationConfig>('automation');
        if (!automationConfig?.ipMonitorEnabled) {
          return;
        }

        ipMonitor.updateConfig({
          checkInterval: automationConfig.checkInterval || 5,
          confirmCount: automationConfig.confirmCount || 3,
          sources: automationConfig.checkSources || [...DEFAULT_IP_CHECK_SOURCES],
        });

        await automationService.start({
          enabled: true,
          autoUpdateEnabled: automationConfig.autoUpdateEnabled || false,
          triggerType: automationConfig.triggerType || 'immediate',
          delayMinutes: automationConfig.delayMinutes || 5,
          scheduledTime: automationConfig.scheduledTime,
          selectedDevices: automationConfig.selectedDevices || [],
          checkInterval: automationConfig.checkInterval || 5,
          confirmCount: automationConfig.confirmCount || 3,
          checkSources: automationConfig.checkSources || [...DEFAULT_IP_CHECK_SOURCES],
          backupOptions: automationConfig.backupOptions || [],
          backupKeepCount: automationConfig.backupKeepCount || 10,
          securityOptions: automationConfig.securityOptions || [],
        });

        await logger.info('自动化服务', '自动化配置已恢复并启动');
      } catch (error) {
        await logger.error('自动化服务', '恢复自动化配置失败', {
          error: getErrorMessage(error, '恢复自动化配置失败'),
        });
        console.error('恢复自动化配置失败:', error);
      }
    }, 2000);

    if (process.env.NODE_ENV !== 'development') {
      setTimeout(() => {
        customUpdater.checkForUpdates(false).catch(console.error);
      }, 3000);
    }

    if (process.env.NODE_ENV === 'development') {
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
