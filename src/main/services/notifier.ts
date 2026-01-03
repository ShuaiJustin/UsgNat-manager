import { Notification } from 'electron';
import { logger } from './logger';
import { emailService } from './email-service';

/**
 * 通知类型
 */
export type NotificationType = 'info' | 'success' | 'warning' | 'error';

/**
 * 通知选项
 */
export interface NotificationOptions {
  title: string;
  body: string;
  type?: NotificationType;
  silent?: boolean;
  urgency?: 'normal' | 'critical' | 'low';
}

/**
 * 通知配置
 */
export interface NotifierConfig {
  windowsNotifyEnabled: boolean;
  emailNotifyEnabled: boolean;
  notifyTypes: string[]; // 'ipChange', 'updateSuccess', 'updateFailed', 'deviceOffline'
}

/**
 * 通知管理器
 * 负责发送各种类型的通知
 */
class Notifier {
  private config: NotifierConfig = {
    windowsNotifyEnabled: true,
    emailNotifyEnabled: false,
    notifyTypes: ['ipChange', 'updateSuccess', 'updateFailed', 'deviceOffline'],
  };

  /**
   * 更新配置
   */
  updateConfig(config: Partial<NotifierConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取配置
   */
  getConfig(): NotifierConfig {
    return { ...this.config };
  }

  /**
   * 发送Windows通知
   */
  async showNotification(options: NotificationOptions): Promise<void> {
    if (!this.config.windowsNotifyEnabled) {
      return;
    }

    try {
      const notification = new Notification({
        title: options.title,
        body: options.body,
        silent: options.silent || false,
        urgency: options.urgency || 'normal',
        icon: this.getIconForType(options.type),
      });

      notification.show();

      // 记录通知日志
      await logger.info('通知', `发送通知: ${options.title}`, {
        body: options.body,
        type: options.type,
      });
    } catch (error) {
      console.error('发送通知失败:', error);
      await logger.error('通知', '发送通知失败', { error });
    }
  }

  /**
   * IP变化通知
   */
  async notifyIPChange(oldIP: string, newIP: string): Promise<void> {
    if (!this.config.notifyTypes.includes('ipChange')) {
      return;
    }

    // 发送 Windows 通知
    await this.showNotification({
      title: '公网IP已变化',
      body: `IP地址从 ${oldIP} 变更为 ${newIP}`,
      type: 'info',
      urgency: 'normal',
    });

    // 发送邮件通知
    if (this.config.emailNotifyEnabled) {
      try {
        await emailService.notifyIPChange(oldIP, newIP);
      } catch (error: any) {
        await logger.error('通知', '发送IP变化邮件通知失败', { error: error.message });
      }
    }
  }

  /**
   * 更新成功通知
   */
  async notifyUpdateSuccess(deviceName: string, ruleCount: number, newIP?: string): Promise<void> {
    if (!this.config.notifyTypes.includes('updateSuccess')) {
      return;
    }

    // 发送 Windows 通知
    await this.showNotification({
      title: 'NAT规则更新成功',
      body: `设备 ${deviceName} 的 ${ruleCount} 条规则已成功更新`,
      type: 'success',
      urgency: 'low',
    });

    // 发送邮件通知
    if (this.config.emailNotifyEnabled && newIP) {
      try {
        await emailService.notifyUpdateSuccess(deviceName, ruleCount, newIP);
      } catch (error: any) {
        await logger.error('通知', '发送更新成功邮件通知失败', { error: error.message });
      }
    }
  }

  /**
   * 更新失败通知
   */
  async notifyUpdateFailed(deviceName: string, error: string): Promise<void> {
    if (!this.config.notifyTypes.includes('updateFailed')) {
      return;
    }

    // 发送 Windows 通知
    await this.showNotification({
      title: 'NAT规则更新失败',
      body: `设备 ${deviceName} 更新失败: ${error}`,
      type: 'error',
      urgency: 'critical',
    });

    // 发送邮件通知
    if (this.config.emailNotifyEnabled) {
      try {
        await emailService.notifyUpdateFailed(deviceName, error);
      } catch (error: any) {
        await logger.error('通知', '发送更新失败邮件通知失败', { error: error.message });
      }
    }
  }

  /**
   * 设备离线通知
   */
  async notifyDeviceOffline(deviceName: string): Promise<void> {
    if (!this.config.notifyTypes.includes('deviceOffline')) {
      return;
    }

    // 发送 Windows 通知
    await this.showNotification({
      title: '设备连接失败',
      body: `设备 ${deviceName} 无法连接，请检查网络或设备状态`,
      type: 'warning',
      urgency: 'normal',
    });

    // 发送邮件通知
    if (this.config.emailNotifyEnabled) {
      try {
        await emailService.notifyDeviceOffline(deviceName);
      } catch (error: any) {
        await logger.error('通知', '发送设备离线邮件通知失败', { error: error.message });
      }
    }
  }

  /**
   * 监控启动通知
   */
  async notifyMonitorStarted(): Promise<void> {
    await this.showNotification({
      title: 'IP监控已启动',
      body: '系统将自动监控公网IP变化并更新NAT规则',
      type: 'success',
      urgency: 'low',
    });
  }

  /**
   * 监控停止通知
   */
  async notifyMonitorStopped(): Promise<void> {
    await this.showNotification({
      title: 'IP监控已停止',
      body: '系统已停止监控公网IP变化',
      type: 'info',
      urgency: 'low',
    });
  }

  /**
   * 批量更新开始通知
   */
  async notifyBatchUpdateStarted(deviceCount: number, ruleCount: number): Promise<void> {
    await this.showNotification({
      title: '开始批量更新',
      body: `正在更新 ${deviceCount} 个设备的 ${ruleCount} 条规则...`,
      type: 'info',
      urgency: 'low',
    });
  }

  /**
   * 批量更新完成通知
   */
  async notifyBatchUpdateCompleted(successCount: number, failedCount: number): Promise<void> {
    const type: NotificationType = failedCount > 0 ? 'warning' : 'success';
    const body =
      failedCount > 0
        ? `成功: ${successCount}, 失败: ${failedCount}`
        : `所有 ${successCount} 个设备更新成功`;

    await this.showNotification({
      title: '批量更新完成',
      body,
      type,
      urgency: failedCount > 0 ? 'normal' : 'low',
    });
  }

  /**
   * 根据类型获取图标路径
   */
  private getIconForType(_type?: NotificationType): string | undefined {
    // 这里可以根据不同类型返回不同的图标
    // 暂时返回undefined使用默认图标
    return undefined;
  }

  /**
   * 测试通知
   */
  async testNotification(): Promise<void> {
    await this.showNotification({
      title: '测试通知',
      body: '这是一条测试通知，如果您看到这条消息，说明通知功能正常工作。',
      type: 'info',
    });
  }
}

// 导出单例
export const notifier = new Notifier();
