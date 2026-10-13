import { ipcMain } from 'electron';

import { backupService } from '../../services/backup-service';
import { configService } from '../../services/config-service';
import { assertConfigType, type ConfigType } from '../../services/config-service-helpers';
import { customUpdater } from '../../services/custom-updater';
import { type SMTPConfig, emailService } from '../../services/email-service';
import { logger } from '../../services/logger';
import { notifier } from '../../services/notifier';
import { mandatoryUpdateBusinessGate } from '../../services/mandatory-update-business-gate';
import { getErrorMessage } from './shared';

type ConfigPayload = Record<string, unknown>;

export interface ConfigHandlerLifecycle {
  aroundDataChange?: <T>(
    reason: 'import' | 'reset' | 'restore',
    action: () => Promise<T>
  ) => Promise<T>;
  afterConfigChange?: (type: ConfigType | 'all') => Promise<void>;
}

export function registerConfigHandlers(lifecycle: ConfigHandlerLifecycle = {}) {
  const aroundDataChange =
    lifecycle.aroundDataChange ??
    (async <T>(_reason: string, action: () => Promise<T>) => action());
  ipcMain.handle('email:configure', async (_event, config: SMTPConfig) => {
    const release = mandatoryUpdateBusinessGate.tryEnter();
    if (!release) return { success: false, error: '业务操作暂时停止，请稍后重试' };
    try {
      await configService.saveConfig('email', config);
      if (lifecycle.afterConfigChange) {
        await lifecycle.afterConfigChange('email');
      } else {
        emailService.configure(config);
        notifier.updateConfig({
          emailNotifyEnabled: config.enabled || false,
        });
      }

      await logger.info('邮件服务', '邮件配置已保存');
      return { success: true };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '邮件配置保存失败');
      await logger.error('邮件服务', '配置失败', { error: errorMessage });
      return { success: false, error: errorMessage };
    } finally {
      release();
    }
  });

  ipcMain.handle('email:sendTest', async () => {
    try {
      const result = await emailService.sendTestEmail();
      return { success: result };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '测试邮件发送失败');
      await logger.error('邮件服务', '发送测试邮件失败', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle('email:sendTestWithConfig', async (_event, config: SMTPConfig) => {
    try {
      const result = await emailService.sendTestEmailWithConfig(config);
      return { success: result };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '临时配置测试邮件发送失败');
      await logger.error('邮件服务', '使用临时配置发送测试邮件失败', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle('email:verifyConfig', async (_event, config: SMTPConfig) => {
    try {
      const result = await emailService.verifyConfig(config);
      return { success: result };
    } catch (error) {
      return {
        success: false,
        error: getErrorMessage(error, '邮件配置校验失败'),
      };
    }
  });

  ipcMain.handle('config:save', async (_event, type: unknown, data: ConfigPayload) => {
    const release = mandatoryUpdateBusinessGate.tryEnter();
    if (!release) return { success: false, error: '业务操作暂时停止，请稍后重试' };
    try {
      assertConfigType(type);
      await configService.saveConfig(type, data);
      if (lifecycle.afterConfigChange) {
        await lifecycle.afterConfigChange(type);
      } else if (type === 'update') {
        await customUpdater.startPeriodicCheck();
      }

      return { success: true };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '保存配置失败');
      await logger.error('配置服务', '保存配置失败', { error: errorMessage, type });
      return { success: false, error: errorMessage };
    } finally {
      release();
    }
  });

  ipcMain.handle('config:get', async (_event, type: unknown) => {
    try {
      assertConfigType(type);
      return await configService.getConfig(type);
    } catch (error) {
      await logger.error('配置服务', '获取配置失败', {
        error: getErrorMessage(error, '获取配置失败'),
        type,
      });
      return null;
    }
  });

  ipcMain.handle('config:getAll', async () => {
    try {
      return await configService.getAllConfigs();
    } catch (error) {
      await logger.error('配置服务', '获取所有配置失败', {
        error: getErrorMessage(error, '获取所有配置失败'),
      });
      return {};
    }
  });

  ipcMain.handle('config:export', async () => {
    try {
      const exportedPath = await configService.exportConfig();
      return { success: true, path: exportedPath };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '导出配置失败');
      await logger.error('配置服务', '导出配置失败', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle('config:import', async (_event, filePath: string) => {
    try {
      await aroundDataChange('import', async () => {
        await configService.importConfig(filePath);
        await lifecycle.afterConfigChange?.('all');
      });
      return { success: true };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '导入配置失败');
      await logger.error('配置服务', '导入配置失败', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle('config:reset', async () => {
    try {
      await aroundDataChange('reset', async () => {
        // A reset can erase the configuration required to interpret existing rules.
        await backupService.createBackup('重置配置前自动备份');
        await configService.resetAllConfigs();
        await lifecycle.afterConfigChange?.('all');
      });
      return { success: true };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '重置配置失败');
      await logger.error('配置服务', '重置配置失败', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle('backup:create', async (_event, description?: string) => {
    try {
      return await backupService.createBackup(description);
    } catch (error) {
      const errorMessage = getErrorMessage(error, '创建备份失败');
      await logger.error('备份服务', '创建备份失败', { error: errorMessage });
      throw error;
    }
  });

  ipcMain.handle('backup:restore', async (_event, filePath: string) => {
    try {
      await aroundDataChange('restore', async () => {
        await backupService.createBackup('恢复前自动备份');
        await backupService.restoreBackup(filePath);
        await lifecycle.afterConfigChange?.('all');
      });
      return { success: true };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '恢复备份失败');
      await logger.error('备份服务', '恢复备份失败', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle('backup:list', async () => {
    try {
      return await backupService.listBackups();
    } catch (error) {
      await logger.error('备份服务', '获取备份列表失败', {
        error: getErrorMessage(error, '获取备份列表失败'),
      });
      return [];
    }
  });

  ipcMain.handle('backup:delete', async (_event, filename: string) => {
    try {
      await backupService.deleteBackup(filename);
      return { success: true };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '删除备份失败');
      await logger.error('备份服务', '删除备份失败', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle('backup:cleanup', async (_event, keepCount?: number) => {
    try {
      const deleted = await backupService.cleanupOldBackups(keepCount);
      return { success: true, deleted };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '清理备份失败');
      await logger.error('备份服务', '清理备份失败', { error: errorMessage });
      return { success: false, deleted: 0, error: errorMessage };
    }
  });

  ipcMain.handle('backup:stats', async () => {
    try {
      return await backupService.getBackupStats();
    } catch (error) {
      await logger.error('备份服务', '获取备份统计失败', {
        error: getErrorMessage(error, '获取备份统计失败'),
      });
      return {
        totalBackups: 0,
        totalSize: 0,
        oldestBackup: null,
        newestBackup: null,
      };
    }
  });
}
