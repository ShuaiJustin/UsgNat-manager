import { BrowserWindow, ipcMain } from 'electron';

import {
  type ManualConfirmationRequest,
  ManualConfirmationManager,
} from '../../manual-confirmation';
import { registerManualConfirmationLifecycle } from '../../manual-confirmation-lifecycle';
import { type AutomationConfig, automationService } from '../../services/automation-service';
import { customUpdater } from '../../services/custom-updater';
import { logger } from '../../services/logger';
import { mandatoryUpdateBusinessGate } from '../../services/mandatory-update-business-gate';
import { getErrorMessage } from './shared';

const toRendererRequest = (request: ManualConfirmationRequest): ManualConfirmationRequest => ({
  requestId: request.requestId,
  newIP: request.newIP,
  deviceCount: request.deviceCount,
  expiresAt: request.expiresAt,
});

export function registerAutomationHandlers(manualConfirmationManager: ManualConfirmationManager) {
  ipcMain.handle('automation:start', async (_event, config: AutomationConfig) => {
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

      await automationService.start(config);
      await logger.info('自动化', '自动化服务已启动');
      return { success: true };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '启动自动化服务失败');
      await logger.error('自动化', '启动失败', { error: errorMessage });
      return { success: false, error: errorMessage };
    } finally {
      releaseBusinessOperation();
    }
  });

  ipcMain.handle('automation:stop', async () => {
    try {
      await automationService.stop();
      await logger.info('自动化', '自动化服务已停止');
      return { success: true };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '停止自动化服务失败');
      await logger.error('自动化', '停止失败', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle('automation:getStatus', async () => automationService.getStatus());
  ipcMain.handle('automation:getConfig', async () => automationService.getConfig());

  ipcMain.handle('automation:manualUpdate', async (_event, newIP?: string) => {
    const releaseBusinessOperation = mandatoryUpdateBusinessGate.tryEnter();
    if (!releaseBusinessOperation) {
      customUpdater.replayCurrentState();
      return { success: false, error: '必须先完成强制更新' };
    }

    try {
      const result = await automationService.manualUpdate(newIP);
      if (mandatoryUpdateBusinessGate.isBlocked()) {
        customUpdater.replayCurrentState();
        return { success: false, error: '必须先完成强制更新' };
      }
      return result;
    } catch (error) {
      const errorMessage = getErrorMessage(error, '手动更新失败');
      await logger.error('自动化', '手动更新失败', { error: errorMessage });
      return { success: false, error: errorMessage };
    } finally {
      releaseBusinessOperation();
    }
  });

  ipcMain.handle('automation:updateConfig', async (_event, config: Partial<AutomationConfig>) => {
    const releaseBusinessOperation = mandatoryUpdateBusinessGate.tryEnter();
    if (!releaseBusinessOperation)
      return { success: false, error: '业务操作已暂停，请等待维护或完成强制更新' };
    try {
      automationService.updateConfig(config);
      await logger.info('自动化', '配置已更新');
      return { success: true };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '更新自动化配置失败');
      await logger.error('自动化', '更新配置失败', { error: errorMessage });
      return { success: false, error: errorMessage };
    } finally {
      releaseBusinessOperation();
    }
  });

  registerManualConfirmationLifecycle({
    automationEvents: automationService,
    gate: mandatoryUpdateBusinessGate,
    manager: manualConfirmationManager,
    notifyRequest: (request) => {
      const payload = toRendererRequest(request);
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('automation:confirm-request', payload);
      }
    },
    notifyCancelled: () => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('automation:confirm-cancelled');
      }
    },
  });

  ipcMain.handle(
    'automation:confirm-response',
    async (_event, requestId: string, confirmed: boolean) => {
      const releaseBusinessOperation = mandatoryUpdateBusinessGate.tryEnter();
      if (!releaseBusinessOperation) {
        customUpdater.replayCurrentState();
        return { success: false, error: '必须先完成强制更新' };
      }

      try {
        const handled = manualConfirmationManager.respond(requestId, confirmed);
        if (!handled) {
          return { success: false, error: '确认请求已失效或不存在' };
        }

        return { success: true };
      } finally {
        releaseBusinessOperation();
      }
    }
  );

  ipcMain.handle('automation:getPendingConfirm', async () =>
    manualConfirmationManager.getPending()
  );
}
