import { ipcMain } from 'electron';

import { type Credential, credentialManager } from '../../services/credential-manager';
import { ipMonitor } from '../../services/ip-monitor';
import { automationService } from '../../services/automation-service';
import { type LogQueryFilter, logger } from '../../services/logger';
import { customUpdater } from '../../services/custom-updater';
import { mandatoryUpdateBusinessGate } from '../../services/mandatory-update-business-gate';
import { resolveCurrentMonitorIP } from './monitor-handler-helpers';
import { getErrorMessage } from './shared';

export function registerMonitorHandlers() {
  ipcMain.handle('monitor:start', async () => {
    const releaseBusinessOperation = mandatoryUpdateBusinessGate.tryEnter();
    if (!releaseBusinessOperation) {
      customUpdater.replayCurrentState();
      return { success: false, error: '必须先完成强制更新' };
    }

    try {
      if (customUpdater.isMandatoryUpdateRequired()) {
        customUpdater.replayCurrentState();
        return { success: false, error: '必须先完成强制更新' };
      }

      if (ipMonitor.isMonitoring()) {
        await logger.warning('监控服务', 'IP 监控已在运行');
        return { success: true, message: '监控服务已在运行' };
      }

      await ipMonitor.start();

      if (mandatoryUpdateBusinessGate.isBlocked()) {
        ipMonitor.stop();
        customUpdater.replayCurrentState();
        return { success: false, error: '必须先完成强制更新' };
      }

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
    } finally {
      releaseBusinessOperation();
    }
  });

  ipcMain.handle('monitor:stop', async () => {
    try {
      await automationService.stop();
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
      lastCheck: ipMonitor.getLastSuccessfulCheck(),
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
      const releaseBusinessOperation = mandatoryUpdateBusinessGate.tryEnter();
      if (!releaseBusinessOperation) {
        customUpdater.replayCurrentState();
        throw new Error('业务操作已暂停，请等待维护或完成强制更新');
      }
      try {
        await credentialManager.saveCredential({ deviceId, ...credential });
        await logger.info('凭据管理', `保存设备凭据: ${deviceId}`);
      } catch (error) {
        const errorMessage = getErrorMessage(error, '保存凭据失败');
        await logger.error('凭据管理', '保存失败', { error: errorMessage });
        throw error;
      } finally {
        releaseBusinessOperation();
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
    const releaseBusinessOperation = mandatoryUpdateBusinessGate.tryEnter();
    if (!releaseBusinessOperation) {
      customUpdater.replayCurrentState();
      throw new Error('业务操作已暂停，请等待维护或完成强制更新');
    }
    try {
      await credentialManager.deleteCredential(deviceId);
      await logger.info('凭据管理', `删除设备凭据: ${deviceId}`);
    } catch (error) {
      const errorMessage = getErrorMessage(error, '删除凭据失败');
      await logger.error('凭据管理', '删除失败', { error: errorMessage });
      throw error;
    } finally {
      releaseBusinessOperation();
    }
  });

  ipcMain.handle('log:query', async (_event, filter: LogQueryFilter) => {
    return logger.query(filter);
  });

  ipcMain.handle('log:queryPage', async (_event, filter: LogQueryFilter) =>
    logger.queryPage(filter)
  );

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
    const releaseBusinessOperation = mandatoryUpdateBusinessGate.tryEnter();
    if (!releaseBusinessOperation) throw new Error('业务操作已暂停，请等待维护或完成强制更新');
    try {
      const count = await logger.cleanup(daysToKeep);
      await logger.info('日志清理', `清理完成，删除了 ${count} 条日志`, { daysToKeep });
      return { success: true, count };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '清理日志失败');
      await logger.error('日志清理', '清理失败', { error: errorMessage });
      throw error;
    } finally {
      releaseBusinessOperation();
    }
  });
}
