import { Notification } from 'electron';

import { emailService } from './email-service';
import { logger } from './logger';

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface NotificationOptions {
  title: string;
  body: string;
  type?: NotificationType;
  silent?: boolean;
  urgency?: 'normal' | 'critical' | 'low';
}

export interface NotifierConfig {
  windowsNotifyEnabled: boolean;
  emailNotifyEnabled: boolean;
  notifyTypes: string[];
}

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

class Notifier {
  private config: NotifierConfig = {
    windowsNotifyEnabled: true,
    emailNotifyEnabled: false,
    notifyTypes: ['ipChange', 'updateSuccess', 'updateFailed', 'deviceOffline'],
  };

  updateConfig(config: Partial<NotifierConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): NotifierConfig {
    return { ...this.config };
  }

  async showNotification(options: NotificationOptions): Promise<void> {
    if (!this.config.windowsNotifyEnabled) {
      return;
    }

    try {
      new Notification({
        title: options.title,
        body: options.body,
        silent: options.silent || false,
        urgency: options.urgency || 'normal',
        icon: this.getIconForType(options.type),
      }).show();

      await logger.info('通知', `发送通知: ${options.title}`, {
        body: options.body,
        type: options.type,
      });
    } catch (error) {
      console.error('发送通知失败:', error);
      await logger.error('通知', '发送通知失败', {
        error: getErrorMessage(error, '发送通知失败'),
      });
    }
  }

  async notifyIPChange(oldIP: string, newIP: string): Promise<void> {
    if (!this.config.notifyTypes.includes('ipChange')) {
      return;
    }

    await this.showNotification({
      title: '公网 IP 已变化',
      body: `IP 地址从 ${oldIP} 变更为 ${newIP}`,
      type: 'info',
      urgency: 'normal',
    });

    if (this.config.emailNotifyEnabled) {
      try {
        await emailService.notifyIPChange(oldIP, newIP);
      } catch (error) {
        await logger.error('通知', '发送 IP 变化邮件通知失败', {
          error: getErrorMessage(error, '发送 IP 变化邮件通知失败'),
        });
      }
    }
  }

  async notifyUpdateSuccess(deviceName: string, ruleCount: number, newIP?: string): Promise<void> {
    if (!this.config.notifyTypes.includes('updateSuccess')) {
      return;
    }

    await this.showNotification({
      title: 'NAT 规则更新成功',
      body: `设备 ${deviceName} 的 ${ruleCount} 条规则已成功更新`,
      type: 'success',
      urgency: 'low',
    });

    if (this.config.emailNotifyEnabled && newIP) {
      try {
        await emailService.notifyUpdateSuccess(deviceName, ruleCount, newIP);
      } catch (error) {
        await logger.error('通知', '发送更新成功邮件通知失败', {
          error: getErrorMessage(error, '发送更新成功邮件通知失败'),
        });
      }
    }
  }

  async notifyUpdateFailed(deviceName: string, error: string): Promise<void> {
    if (!this.config.notifyTypes.includes('updateFailed')) {
      return;
    }

    await this.showNotification({
      title: 'NAT 规则更新失败',
      body: `设备 ${deviceName} 更新失败: ${error}`,
      type: 'error',
      urgency: 'critical',
    });

    if (this.config.emailNotifyEnabled) {
      try {
        await emailService.notifyUpdateFailed(deviceName, error);
      } catch (notifyError) {
        await logger.error('通知', '发送更新失败邮件通知失败', {
          error: getErrorMessage(notifyError, '发送更新失败邮件通知失败'),
        });
      }
    }
  }

  async notifyDeviceOffline(deviceName: string): Promise<void> {
    if (!this.config.notifyTypes.includes('deviceOffline')) {
      return;
    }

    await this.showNotification({
      title: '设备连接失败',
      body: `设备 ${deviceName} 无法连接，请检查网络或设备状态`,
      type: 'warning',
      urgency: 'normal',
    });

    if (this.config.emailNotifyEnabled) {
      try {
        await emailService.notifyDeviceOffline(deviceName);
      } catch (error) {
        await logger.error('通知', '发送设备离线邮件通知失败', {
          error: getErrorMessage(error, '发送设备离线邮件通知失败'),
        });
      }
    }
  }

  async notifyMonitorStarted(): Promise<void> {
    await this.showNotification({
      title: 'IP 监控已启动',
      body: '系统将自动监控公网 IP 变化并更新 NAT 规则',
      type: 'success',
      urgency: 'low',
    });
  }

  async notifyMonitorStopped(): Promise<void> {
    await this.showNotification({
      title: 'IP 监控已停止',
      body: '系统已停止监控公网 IP 变化',
      type: 'info',
      urgency: 'low',
    });
  }

  async notifyBatchUpdateStarted(deviceCount: number, ruleCount: number): Promise<void> {
    await this.showNotification({
      title: '开始批量更新',
      body: `正在更新 ${deviceCount} 个设备的 ${ruleCount} 条规则...`,
      type: 'info',
      urgency: 'low',
    });
  }

  async notifyBatchUpdateCompleted(successCount: number, failedCount: number): Promise<void> {
    const type: NotificationType = failedCount > 0 ? 'warning' : 'success';
    const body =
      failedCount > 0
        ? `成功: ${successCount}, 失败: ${failedCount}`
        : `全部 ${successCount} 个设备更新成功`;

    await this.showNotification({
      title: '批量更新完成',
      body,
      type,
      urgency: failedCount > 0 ? 'normal' : 'low',
    });
  }

  private getIconForType(_type?: NotificationType): string | undefined {
    return undefined;
  }

  async testNotification(): Promise<void> {
    await this.showNotification({
      title: '测试通知',
      body: '这是一条测试通知，如果你看到了它，说明通知功能工作正常。',
      type: 'info',
    });
  }
}

export const notifier = new Notifier();
