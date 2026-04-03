import { ipcMain } from 'electron';

import { backupService } from '../../services/backup-service';
import { type ConfigType, configService } from '../../services/config-service';
import { customUpdater } from '../../services/custom-updater';
import { type SMTPConfig, emailService } from '../../services/email-service';
import { logger } from '../../services/logger';
import { notifier } from '../../services/notifier';
import { getErrorMessage } from './shared';

const DEFAULT_NOTIFY_TYPES = ['ipChange', 'updateSuccess', 'updateFailed', 'deviceOffline'];

type ConfigPayload = Record<string, unknown>;

export function registerConfigHandlers() {
  ipcMain.handle('email:configure', async (_event, config: SMTPConfig) => {
    try {
      emailService.configure(config);
      await configService.saveConfig('email', config);

      notifier.updateConfig({
        emailNotifyEnabled: config.enabled || false,
        notifyTypes: config.notifyTypes || DEFAULT_NOTIFY_TYPES,
      });

      await logger.info('邮件服务', '邮件配置已保存');
      return { success: true };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '邮件配置保存失败');
      await logger.error('邮件服务', '配置失败', { error: errorMessage });
      return { success: false, error: errorMessage };
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

  ipcMain.handle('config:save', async (_event, type: ConfigType, data: ConfigPayload) => {
    try {
      await configService.saveConfig(type, data);

      if (type === 'update') {
        await customUpdater.startPeriodicCheck();
      }

      return { success: true };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '保存配置失败');
      await logger.error('配置服务', '保存配置失败', { error: errorMessage, type });
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle('config:get', async (_event, type: ConfigType) => {
    try {
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

  ipcMain.handle('config:export', async (_event, filePath?: string) => {
    try {
      const exportedPath = await configService.exportConfig(filePath);
      return { success: true, path: exportedPath };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '导出配置失败');
      await logger.error('配置服务', '导出配置失败', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle('config:import', async (_event, filePath: string) => {
    try {
      await configService.importConfig(filePath);
      return { success: true };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '导入配置失败');
      await logger.error('配置服务', '导入配置失败', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle('config:reset', async () => {
    try {
      await configService.resetAllConfigs();
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
      await backupService.restoreBackup(filePath);
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
