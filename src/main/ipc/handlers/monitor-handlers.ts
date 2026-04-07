import { ipcMain } from 'electron';

import { type Credential, credentialManager } from '../../services/credential-manager';
import { ipMonitor } from '../../services/ip-monitor';
import { type LogQueryFilter, logger } from '../../services/logger';
import { resolveCurrentMonitorIP } from './monitor-handler-helpers';
import { getErrorMessage } from './shared';

export function registerMonitorHandlers() {
  ipcMain.handle('monitor:start', async () => {
    try {
      if (ipMonitor.isMonitoring()) {
        await logger.warning('监控服务', 'IP 监控已在运行');
        return { success: true, message: '监控服务已在运行' };
      }

      await ipMonitor.start();
      await logger.info('监控服务', 'IP 监控已启动');

      return { success: true, message: 'IP 监控已启动' };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '未知错误');
      await logger.error('监控服务', '启动失败', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
        details: '请检查网络连接或稍后重试',
      };
    }
  });

  ipcMain.handle('monitor:stop', async () => {
    try {
      ipMonitor.stop();
      await logger.info('监控服务', 'IP 监控已停止');
      return { success: true };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '停止监控失败');
      await logger.error('监控服务', '停止失败', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle('monitor:getStatus', async () => {
    return {
      isRunning: ipMonitor.isMonitoring(),
      currentIP: ipMonitor.getCurrentIPSync(),
      lastCheck: new Date(),
    };
  });

  ipcMain.handle('monitor:getCurrentIP', async () => {
    return resolveCurrentMonitorIP({
      isMonitoring: ipMonitor.isMonitoring(),
      currentIP: ipMonitor.getCurrentIPSync(),
      fetchCurrentIP: () => ipMonitor.fetchCurrentIP(),
    });
  });

  ipcMain.handle(
    'credential:save',
    async (_event, deviceId: string, credential: Omit<Credential, 'deviceId'>) => {
      try {
        await credentialManager.saveCredential({ deviceId, ...credential });
        await logger.info('凭据管理', `保存设备凭据: ${deviceId}`);
      } catch (error) {
        const errorMessage = getErrorMessage(error, '保存凭据失败');
        await logger.error('凭据管理', '保存失败', { error: errorMessage });
        throw error;
      }
    }
  );

  ipcMain.handle('credential:get', async (_event, deviceId: string) => {
    try {
      return await credentialManager.getCredential(deviceId);
    } catch (error) {
      await logger.error('凭据管理', '获取失败', {
        error: getErrorMessage(error, '获取凭据失败'),
      });
      return null;
    }
  });

  ipcMain.handle('credential:delete', async (_event, deviceId: string) => {
    try {
      await credentialManager.deleteCredential(deviceId);
      await logger.info('凭据管理', `删除设备凭据: ${deviceId}`);
    } catch (error) {
      const errorMessage = getErrorMessage(error, '删除凭据失败');
      await logger.error('凭据管理', '删除失败', { error: errorMessage });
      throw error;
    }
  });

  ipcMain.handle('log:query', async (_event, filter: LogQueryFilter) => {
    return logger.query(filter);
  });

  ipcMain.handle('log:export', async (_event, filter: LogQueryFilter) => {
    try {
      const csv = await logger.export(filter);
      await logger.info('日志导出', '导出日志成功');
      return csv;
    } catch (error) {
      const errorMessage = getErrorMessage(error, '导出日志失败');
      await logger.error('日志导出', '导出失败', { error: errorMessage });
      throw error;
    }
  });

  ipcMain.handle('log:cleanup', async (_event, daysToKeep: number) => {
    try {
      const count = await logger.cleanup(daysToKeep);
      await logger.info('日志清理', `清理完成，删除了 ${count} 条日志`, { daysToKeep });
      return { success: true, count };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '清理日志失败');
      await logger.error('日志清理', '清理失败', { error: errorMessage });
      throw error;
    }
  });
}
