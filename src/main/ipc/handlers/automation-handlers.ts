import { BrowserWindow, ipcMain } from 'electron';

import {
  type ManualConfirmationRequest,
  ManualConfirmationManager,
} from '../../manual-confirmation';
import { type AutomationConfig, automationService } from '../../services/automation-service';
import { logger } from '../../services/logger';
import { getErrorMessage } from './shared';

type ManualConfirmEventPayload = {
  newIP: string;
  deviceCount: number;
  callback: (confirmed: boolean) => void;
};

const toRendererRequest = (request: ManualConfirmationRequest): ManualConfirmationRequest => ({
  requestId: request.requestId,
  newIP: request.newIP,
  deviceCount: request.deviceCount,
  expiresAt: request.expiresAt,
});

export function registerAutomationHandlers(manualConfirmationManager: ManualConfirmationManager) {
  ipcMain.handle('automation:start', async (_event, config: AutomationConfig) => {
    try {
      await automationService.start(config);
      await logger.info('自动化', '自动化服务已启动');
      return { success: true };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '启动自动化服务失败');
      await logger.error('自动化', '启动失败', { error: errorMessage });
      return { success: false, error: errorMessage };
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
    try {
      await automationService.manualUpdate(newIP);
      return { success: true };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '手动更新失败');
      await logger.error('自动化', '手动更新失败', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle('automation:updateConfig', async (_event, config: Partial<AutomationConfig>) => {
    try {
      automationService.updateConfig(config);
      await logger.info('自动化', '配置已更新');
      return { success: true };
    } catch (error) {
      const errorMessage = getErrorMessage(error, '更新自动化配置失败');
      await logger.error('自动化', '更新配置失败', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  });

  automationService.on('manual-confirm-request', (data: ManualConfirmEventPayload) => {
    const request = manualConfirmationManager.start(
      {
        newIP: data.newIP,
        deviceCount: data.deviceCount,
      },
      data.callback
    );

    const payload = toRendererRequest(request);
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('automation:confirm-request', payload);
    }
  });

  ipcMain.handle(
    'automation:confirm-response',
    async (_event, requestId: string, confirmed: boolean) => {
      const handled = manualConfirmationManager.respond(requestId, confirmed);
      if (!handled) {
        return { success: false, error: '确认请求已失效或不存在' };
      }

      return { success: true };
    }
  );

  ipcMain.handle('automation:getPendingConfirm', async () =>
    manualConfirmationManager.getPending()
  );
}
