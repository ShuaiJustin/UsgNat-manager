import {
  type OpenDialogOptions,
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
} from 'electron';
import fs from 'fs';
import path from 'path';

import { configService } from '../../services/config-service';
import { customUpdater } from '../../services/custom-updater';
import { logger } from '../../services/logger';
import { prisma } from '../../services/prisma-client';
import { backupService } from '../../services/backup-service';
import { mandatoryUpdateBusinessGate } from '../../services/mandatory-update-business-gate';
import { getErrorMessage } from './shared';

type AppSystemConfig = Record<string, unknown> & {
  theme?: string;
  autoStart?: boolean;
};

type FileSelectOptions = Pick<OpenDialogOptions, 'title' | 'filters' | 'properties'>;

const formatFileSize = (sizeInBytes: number): string => {
  if (sizeInBytes < 1024) {
    return `${sizeInBytes} B`;
  }

  if (sizeInBytes < 1024 * 1024) {
    return `${(sizeInBytes / 1024).toFixed(2)} KB`;
  }

  return `${(sizeInBytes / 1024 / 1024).toFixed(2)} MB`;
};

export function registerSystemHandlers(
  options: {
    aroundDataChange?: <T>(
      reason: 'import' | 'reset' | 'restore',
      action: () => Promise<T>
    ) => Promise<T>;
  } = {}
) {
  ipcMain.handle('system:showNotification', async (_event, title: string, body: string) => {
    new Notification({ title, body }).show();
  });

  ipcMain.handle('system:getTheme', async () => {
    try {
      const config = await configService.getConfig<AppSystemConfig>('app');
      return config?.theme || 'auto';
    } catch {
      return 'auto';
    }
  });

  ipcMain.handle('system:setTheme', async (_event, theme: string) => {
    const release = mandatoryUpdateBusinessGate.tryEnter();
    if (!release) return { success: false, error: '业务操作暂时停止，请稍后重试' };
    try {
      const config = (await configService.getConfig<AppSystemConfig>('app')) ?? {};
      await configService.saveConfig('app', { ...config, theme });
      await logger.info('系统设置', `主题已切换为: ${theme}`);
      return { success: true };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '设置主题失败');
      await logger.error('系统设置', '设置主题失败', { error: errorMessage });
      return { success: false, error: errorMessage };
    } finally {
      release();
    }
  });

  ipcMain.handle('system:setAutoStart', async (_event, enabled: boolean) => {
    const release = mandatoryUpdateBusinessGate.tryEnter();
    if (!release) return { success: false, error: '业务操作暂时停止，请稍后重试' };
    try {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: false,
        path: app.getPath('exe'),
        args: [],
      });

      const config = (await configService.getConfig<AppSystemConfig>('app')) ?? {};
      await configService.saveConfig('app', { ...config, autoStart: enabled });
      await logger.info('系统设置', `开机自启动已${enabled ? '启用' : '禁用'}`);

      return { success: true };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '设置开机自启动失败');
      await logger.error('系统设置', '设置开机自启动失败', { error: errorMessage });
      return { success: false, error: errorMessage };
    } finally {
      release();
    }
  });

  ipcMain.handle('system:getAutoStart', async () => {
    try {
      return app.getLoginItemSettings().openAtLogin;
    } catch {
      return false;
    }
  });

  ipcMain.handle('system:getDatabaseInfo', async () => {
    try {
      const dbPath = path.join(app.getPath('userData'), 'usg-nat.db');

      if (!fs.existsSync(dbPath)) {
        return { path: dbPath, size: '未知' };
      }

      const stats = fs.statSync(dbPath);
      return {
        path: dbPath,
        size: formatFileSize(stats.size),
      };
    } catch {
      return {
        path: '获取失败',
        size: '未知',
      };
    }
  });

  ipcMain.handle('database:clearAll', async () => {
    try {
      const clear = async () => {
        await backupService.createBackup('清空业务数据前自动备份');
        const automation =
          (await configService.getConfig<Record<string, unknown>>('automation')) ?? {};
        await prisma.$transaction([
          prisma.natRule.deleteMany({}),
          prisma.device.deleteMany({}),
          prisma.credentialRef.deleteMany({}),
          prisma.log.deleteMany({}),
          prisma.config.upsert({
            where: { key: 'automation' },
            create: {
              key: 'automation',
              value: JSON.stringify({
                ...automation,
                autoUpdateEnabled: false,
                selectedDevices: [],
                managedRuleIds: [],
                clientEgressConfirmed: false,
              }),
            },
            update: {
              value: JSON.stringify({
                ...automation,
                autoUpdateEnabled: false,
                selectedDevices: [],
                managedRuleIds: [],
                clientEgressConfirmed: false,
              }),
            },
          }),
        ]);
        await logger.warning(
          '数据库管理',
          '已清空所有数据（设备、规则、凭据、日志），并停用自动写入'
        );
      };
      if (options.aroundDataChange) await options.aroundDataChange('reset', clear);
      else await clear();
      return { success: true };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '清空数据失败');
      await logger.error('数据库管理', '清空数据失败', { error: errorMessage });
      throw error;
    }
  });

  ipcMain.handle('updater:checkForUpdates', async (_event, showNoUpdateMessage = true) => {
    try {
      return await customUpdater.checkForUpdates(showNoUpdateMessage);
    } catch (error) {
      const errorMessage = getErrorMessage(error, '检查更新失败');
      await logger.error('自动更新', '检查更新失败', { error: errorMessage });
      return {
        success: false,
        message: errorMessage,
      };
    }
  });

  ipcMain.handle(
    'updater:downloadUpdate',
    async (_event, version: string, policySignature: string) => {
      try {
        await customUpdater.downloadUpdate(version, policySignature);
        return { success: true };
      } catch (error) {
        const errorMessage = getErrorMessage(error, '下载更新失败');
        await logger.error('自动更新', '下载更新失败', { error: errorMessage });
        return {
          success: false,
          message: errorMessage,
        };
      }
    }
  );

  ipcMain.handle(
    'updater:quitAndInstall',
    async (_event, version: string, policySignature: string) => {
      try {
        await customUpdater.quitAndInstall(version, policySignature);
        return { success: true };
      } catch (error) {
        const errorMessage = getErrorMessage(error, '退出并安装失败');
        await logger.error('自动更新', '退出并安装失败', { error: errorMessage });
        return {
          success: false,
          message: errorMessage,
        };
      }
    }
  );

  ipcMain.handle('updater:getCurrentVersion', async () => customUpdater.getCurrentVersion());
  ipcMain.handle('updater:getState', async () => customUpdater.getCurrentState());
  ipcMain.handle('updater:quitApp', async () => customUpdater.quitApp());

  ipcMain.handle('window:minimize', async (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle('window:maximize', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return;
    }

    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  });

  ipcMain.handle('window:close', async (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle('window:isMaximized', async (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });

  ipcMain.handle('system:selectFile', async (event, options?: FileSelectOptions) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return null;
    }

    const result = await dialog.showOpenDialog(window, {
      title: options?.title || '选择文件',
      filters: options?.filters || [],
      properties: options?.properties || ['openFile'],
    });

    return result.canceled ? null : result.filePaths[0];
  });
}
