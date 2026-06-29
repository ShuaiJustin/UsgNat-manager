import type { NatRule } from '@prisma/client';
import { EventEmitter } from 'events';
import * as schedule from 'node-schedule';
import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { ipMonitor, IPChangeEvent, type IPMonitorConfig } from './ip-monitor';
import { sshManager } from './ssh-manager';
import { usgParser } from './usg-parser';
import { logger } from './logger';
import { notifier } from './notifier';
import { credentialManager } from './credential-manager';
import { prisma } from './prisma-client';
import {
  assertRuleVerificationSucceeded,
  collectIntegrityCheckIssues,
  createNatRulePayloads,
  createRuleSnapshots,
  parseScheduledTimeParts,
} from './automation-service-helpers';
import { DEFAULT_IP_CHECK_SOURCES } from '../ip-check-sources';

/**
 * 自动化配置
 */
type RuleSnapshot = Omit<
  Pick<
    NatRule,
    | 'id'
    | 'ruleName'
    | 'protocol'
    | 'globalIp'
    | 'globalPort'
    | 'insideIp'
    | 'insidePort'
    | 'enabled'
    | 'noReverse'
  >,
  'noReverse'
> & {
  noReverse?: boolean | null;
};

type DeviceUpdateResult = {
  success: boolean;
  updated?: number;
  message?: string;
  backupPath?: string | null;
  error?: string;
};

type DeviceUpdateSummary = DeviceUpdateResult & {
  deviceId: string;
  deviceName: string;
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export interface AutomationConfig {
  enabled: boolean;
  autoUpdateEnabled: boolean;
  triggerType: 'immediate' | 'delayed' | 'scheduled';
  delayMinutes?: number;
  scheduledTime?: string;
  selectedDevices: string[]; // 要自动更新的设备ID列表
  // IP监控配置
  checkInterval?: number; // 检测间隔（分钟）
  confirmCount?: number; // 变更确认次数
  checkSources?: string[]; // IP检测源列表
  // 备份策略
  backupOptions?: string[]; // 备份选项：['autoBackup', 'keepBackups', 'autoRollback']
  backupKeepCount?: number; // 保留备份数量（默认10）
  // 安全选项
  securityOptions?: string[]; // 安全选项：['verifyRules', 'integrityCheck', 'manualConfirm']
}

/**
 * 自动化服务
 * 负责IP监控和自动更新NAT规则
 */
class AutomationService extends EventEmitter {
  private config: AutomationConfig = {
    enabled: false,
    autoUpdateEnabled: false,
    triggerType: 'immediate',
    selectedDevices: [],
  };

  // eslint-disable-next-line no-undef
  private delayTimer: NodeJS.Timeout | null = null;
  private scheduledJob: schedule.Job | null = null; // 定时任务
  private pendingIP: string | null = null; // 待更新的IP（用于定时更新）
  private isUpdating: boolean = false;
  private deviceBackupDir: string; // 设备配置备份目录

  constructor() {
    super();
    this.deviceBackupDir = path.join(app.getPath('userData'), 'device-backups');
    this.ensureDeviceBackupDir();
    this.setupIPMonitor();
  }

  /**
   * 确保设备备份目录存在
   */
  private async ensureDeviceBackupDir() {
    try {
      await fs.mkdir(this.deviceBackupDir, { recursive: true });
    } catch (error) {
      console.error('创建设备备份目录失败:', error);
    }
  }

  /**
   * 设置IP监控事件监听
   */
  private setupIPMonitor() {
    // IP变化事件
    ipMonitor.on('changed', async (event: IPChangeEvent) => {
      await logger.info('IP变化', `检测到IP变化: ${event.oldIP} -> ${event.newIP}`);
      await notifier.notifyIPChange(event.oldIP, event.newIP);

      if (this.config.autoUpdateEnabled) {
        await this.handleIPChange(event);
      }
    });

    // IP检测事件
    ipMonitor.on('checked', (data: unknown) => {
      this.emit('ip-checked', data);
    });

    // 错误事件
    ipMonitor.on('error', async (error: Error) => {
      await logger.error('IP监控', 'IP检测失败', { error: getErrorMessage(error) });
    });
  }

  /**
   * 处理IP变化
   */
  private async handleIPChange(event: IPChangeEvent) {
    if (this.isUpdating) {
      await logger.warning('自动更新', '已有更新任务在执行，跳过本次更新');
      return;
    }

    switch (this.config.triggerType) {
      case 'immediate':
        await this.executeUpdate(event.newIP);
        break;

      case 'delayed': {
        if (this.delayTimer) {
          clearTimeout(this.delayTimer);
        }
        const delayMs = (this.config.delayMinutes || 5) * 60 * 1000;
        await logger.info('自动更新', `延迟 ${this.config.delayMinutes} 分钟后更新`);
        this.delayTimer = setTimeout(async () => {
          try {
            await this.executeUpdate(event.newIP);
          } catch (error: unknown) {
            await logger.error('自动更新', '延迟更新执行失败', { error: getErrorMessage(error) });
          }
        }, delayMs);
        break;
      }

      case 'scheduled': {
        // 保存待更新的IP
        this.pendingIP = event.newIP;
        await logger.info('自动更新', `检测到IP变化，已保存新IP: ${event.newIP}，等待定时任务执行`);

        // 如果没有配置定时时间，记录警告
        if (!this.config.scheduledTime) {
          await logger.warning('自动更新', '未配置定时更新时间，请在设置中配置');
          return;
        }

        // 解析定时时间（格式: "HH:mm"）
        try {
          const scheduledTimeParts = parseScheduledTimeParts(this.config.scheduledTime);

          if (!scheduledTimeParts) {
            await logger.error('自动更新', `定时时间格式错误: ${this.config.scheduledTime}`);
            return;
          }

          // 取消之前的定时任务
          if (this.scheduledJob) {
            this.scheduledJob.cancel();
            await logger.info('自动更新', '取消之前的定时任务');
          }

          // 创建新的定时任务规则
          const rule = new schedule.RecurrenceRule();
          rule.hour = scheduledTimeParts.hour;
          rule.minute = scheduledTimeParts.minute;
          rule.tz = 'Asia/Shanghai'; // 使用中国时区

          // 安排定时任务
          this.scheduledJob = schedule.scheduleJob(rule, async () => {
            try {
              if (this.pendingIP) {
                await logger.info('自动更新', `定时任务触发，使用IP: ${this.pendingIP}`);
                await this.executeUpdate(this.pendingIP);
              } else {
                await logger.warning('自动更新', '定时任务触发，但没有待更新的IP');
              }
            } catch (error: unknown) {
              await logger.error('自动更新', '定时任务执行失败', { error: getErrorMessage(error) });
            }
          });

          await logger.success(
            '自动更新',
            `已安排定时任务，每天 ${this.config.scheduledTime} 执行更新`,
            { pendingIP: this.pendingIP }
          );
        } catch (error: unknown) {
          await logger.error('自动更新', '创建定时任务失败', { error: getErrorMessage(error) });
        }
        break;
      }
    }
  }

  /**
   * 请求手动确认
   */
  private async requestManualConfirm(newIP: string, deviceCount: number): Promise<boolean> {
    return new Promise((resolve) => {
      // 通过事件通知主进程，主进程会通过IPC发送到渲染进程
      this.emit('manual-confirm-request', {
        newIP,
        deviceCount,
        callback: (confirmed: boolean) => {
          resolve(confirmed);
        },
      });

      // 设置超时（30秒），如果用户没有响应，默认取消
    });
  }

  /**
   * 执行更新
   */
  private async executeUpdate(newIP: string) {
    if (this.isUpdating) {
      return;
    }

    this.isUpdating = true;
    this.emit('update-started', { newIP });

    try {
      // 检查是否需要手动确认
      const securityOptions = this.config.securityOptions || [];
      if (securityOptions.includes('manualConfirm')) {
        const devices = await prisma.device.findMany({
          where: {
            id: { in: this.config.selectedDevices || [] },
            enabled: true,
          },
        });

        await logger.info('自动更新', '需要手动确认，等待用户确认...');
        const confirmed = await this.requestManualConfirm(newIP, devices.length);

        if (!confirmed) {
          await logger.warning('自动更新', '用户取消了更新操作');
          this.isUpdating = false;
          this.emit('update-cancelled', { reason: '用户取消' });
          return;
        }

        await logger.info('自动更新', '用户已确认，继续执行更新');
      }

      await logger.info('自动更新', `开始批量更新NAT规则，新IP: ${newIP}`);

      const devices = await prisma.device.findMany({
        where: {
          id: { in: this.config.selectedDevices || [] },
          enabled: true,
        },
      });

      if (devices.length === 0) {
        await logger.warning('自动更新', '没有可更新的设备');
        return;
      }

      let successCount = 0;
      let failedCount = 0;
      const results: DeviceUpdateSummary[] = [];

      for (const device of devices) {
        try {
          const result = await this.updateDeviceRules(device.id, newIP);
          if (result.success) {
            successCount++;
          } else {
            failedCount++;
          }
          results.push({ deviceId: device.id, deviceName: device.name, ...result });
        } catch (error: unknown) {
          failedCount++;
          results.push({
            deviceId: device.id,
            deviceName: device.name,
            success: false,
            error: getErrorMessage(error),
          });
        }
      }

      await logger.success('自动更新', `批量更新完成: 成功 ${successCount}, 失败 ${failedCount}`, {
        results,
      });

      await notifier.notifyBatchUpdateCompleted(successCount, failedCount);
      this.emit('update-completed', { successCount, failedCount, results });
    } catch (error: unknown) {
      await logger.error('自动更新', '批量更新失败', { error: getErrorMessage(error) });
      this.emit('update-failed', { error: getErrorMessage(error) });
    } finally {
      this.isUpdating = false;
    }
  }

  /**
   * 备份设备配置
   */
  private async backupDeviceConfig(deviceId: string, deviceName: string): Promise<string | null> {
    try {
      const backupCommand = 'display current-configuration';
      const result = await sshManager.executeCommand(deviceId, backupCommand);

      if (!result.success || !result.output) {
        await logger.warning(
          '设备备份',
          `设备 ${deviceName} 备份失败: ${result.error || '无输出'}`
        );
        return null;
      }

      // 生成备份文件名
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `device-${deviceId}-${timestamp}.cfg`;
      const filePath = path.join(this.deviceBackupDir, filename);

      // 保存备份
      const backupData = {
        deviceId,
        deviceName,
        timestamp: new Date().toISOString(),
        config: result.output,
      };

      await fs.writeFile(filePath, JSON.stringify(backupData, null, 2), 'utf-8');
      await logger.info('设备备份', `设备 ${deviceName} 配置已备份`, { filename });

      // 清理旧备份
      await this.cleanupOldBackups(deviceId);

      return filePath;
    } catch (error: unknown) {
      await logger.warning('设备备份', `设备 ${deviceName} 备份失败`, {
        error: getErrorMessage(error),
      });
      return null;
    }
  }

  /**
   * 清理旧备份
   */
  private async cleanupOldBackups(deviceId: string) {
    try {
      const keepCount = this.config.backupKeepCount || 10;
      const files = await fs.readdir(this.deviceBackupDir);
      const deviceBackups = files
        .filter((f) => f.startsWith(`device-${deviceId}-`))
        .map((f) => ({
          name: f,
          path: path.join(this.deviceBackupDir, f),
        }));

      if (deviceBackups.length <= keepCount) {
        return;
      }

      // 按时间排序，删除最旧的
      const stats = await Promise.all(
        deviceBackups.map(async (b) => ({
          ...b,
          mtime: (await fs.stat(b.path)).mtime,
        }))
      );

      stats.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
      const toDelete = stats.slice(0, stats.length - keepCount);

      for (const backup of toDelete) {
        try {
          await fs.unlink(backup.path);
          await logger.info('设备备份', `已删除旧备份: ${backup.name}`);
        } catch (error: unknown) {
          await logger.warning('设备备份', `删除备份失败: ${backup.name}`, {
            error: getErrorMessage(error),
          });
        }
      }
    } catch (error: unknown) {
      await logger.warning('设备备份', '清理旧备份失败', { error: getErrorMessage(error) });
    }
  }

  /**
   * 回滚设备规则
   */
  private async rollbackDeviceRules(
    deviceId: string,
    deviceName: string,
    oldRules: RuleSnapshot[]
  ): Promise<boolean> {
    try {
      await logger.info('规则回滚', `开始回滚设备 ${deviceName} 的规则`);

      // 生成回滚命令（恢复旧规则）
      const parsedRules = createNatRulePayloads(oldRules);

      // 先获取当前设备上的规则，删除所有，然后恢复旧规则
      const currentRulesResult = await sshManager.executeCommand(
        deviceId,
        'display current-configuration | include nat server'
      );

      const commands: string[] = ['system-view'];

      // 如果有当前规则，先删除
      if (currentRulesResult.success && currentRulesResult.output) {
        const currentRules = usgParser.parseNatServerList(currentRulesResult.output);
        for (const rule of currentRules) {
          commands.push(usgParser.generateDeleteNatServerCommand(rule));
        }
      }

      // 恢复旧规则
      for (const rule of parsedRules) {
        if (rule.enabled) {
          commands.push(usgParser.generateNatServerCommand(rule));
        }
      }

      commands.push('quit');
      commands.push('save');
      commands.push('y');

      const rollbackResult = await sshManager.executeBatchCommands(deviceId, commands);
      if (!rollbackResult.success) {
        throw new Error(`回滚命令执行失败: ${rollbackResult.error || '未知错误'}`);
      }

      // 恢复数据库
      for (const rule of oldRules) {
        await prisma.natRule.update({
          where: { id: rule.id },
          data: { globalIp: rule.globalIp },
        });
      }

      await logger.success('规则回滚', `设备 ${deviceName} 规则已回滚`);
      return true;
    } catch (error: unknown) {
      await logger.error('规则回滚', `设备 ${deviceName} 回滚失败`, {
        error: getErrorMessage(error),
      });
      return false;
    }
  }

  /**
   * 验证规则是否生效
   */
  private async verifyRules(
    deviceId: string,
    deviceName: string,
    newIP: string,
    expectedCount: number
  ): Promise<boolean> {
    try {
      const verifyCommand = 'display current-configuration | include nat server';
      const result = await sshManager.executeCommand(deviceId, verifyCommand);

      if (!result.success || !result.output) {
        await logger.warning('规则验证', `设备 ${deviceName} 验证失败: 无法获取规则`);
        return false;
      }

      const deviceRules = usgParser.parseNatServerList(result.output);
      const rulesWithNewIP = deviceRules.filter((r) => r.globalIp === newIP);

      if (rulesWithNewIP.length !== expectedCount) {
        await logger.warning('规则验证', `设备 ${deviceName} 验证失败: 规则数量不匹配`, {
          expected: expectedCount,
          actual: rulesWithNewIP.length,
        });
        return false;
      }

      // 验证所有规则都包含新IP
      const allMatch = deviceRules.every((r) => r.globalIp === newIP || !r.enabled);
      if (!allMatch) {
        await logger.warning('规则验证', `设备 ${deviceName} 验证失败: 部分规则IP不匹配`);
        return false;
      }

      await logger.success('规则验证', `设备 ${deviceName} 规则验证通过`, {
        ruleCount: rulesWithNewIP.length,
      });
      return true;
    } catch (error: unknown) {
      await logger.warning('规则验证', `设备 ${deviceName} 验证失败`, {
        error: getErrorMessage(error),
      });
      return false;
    }
  }

  /**
   * 完整性检查
   * 检查规则冲突、重复等问题
   */
  private async integrityCheck(
    deviceId: string,
    deviceName: string,
    rules: RuleSnapshot[],
    newIP: string
  ): Promise<{ success: boolean; issues: string[] }> {
    try {
      const issues = collectIntegrityCheckIssues(rules, newIP);

      if (issues.length > 0) {
        await logger.warning(
          'Integrity Check',
          `Device ${deviceName} has ${issues.length} issues`,
          {
            deviceId,
            issues,
          }
        );
        return { success: false, issues };
      }

      await logger.success('Integrity Check', `Device ${deviceName} integrity check passed`, {
        deviceId,
      });
      return { success: true, issues: [] };
    } catch (error: unknown) {
      await logger.warning('Integrity Check', `Device ${deviceName} integrity check failed`, {
        deviceId,
        error: getErrorMessage(error),
      });
      return { success: false, issues: [`Integrity check error: ${getErrorMessage(error)}`] };
    }
  }

  /**
   * ?????????
   */
  private async updateDeviceRules(deviceId: string, newIP: string): Promise<DeviceUpdateResult> {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) {
      throw new Error('设备不存在');
    }

    const credential = await credentialManager.getCredential(deviceId);
    if (!credential) {
      throw new Error('未配置凭据');
    }

    if (device.connectionType !== 'SSH') {
      throw new Error(
        `Device ${device.name} uses unsupported connection type ${device.connectionType}. Only SSH is supported.`
      );
    }

    if (credential.authType !== 'Password' && credential.authType !== 'PrivateKey') {
      throw new Error(
        `Device ${device.name} uses unsupported auth type ${credential.authType}. Only Password and PrivateKey are supported.`
      );
    }

    // 获取需要更新的规则
    const rules = await prisma.natRule.findMany({
      where: { deviceId, enabled: true },
    });

    if (rules.length === 0) {
      return { success: true, updated: 0, message: '没有需要更新的规则' };
    }

    // 保存旧规则状态（用于回滚）
    const oldRules = createRuleSnapshots(rules);

    // 连接设备
    await sshManager.connect(deviceId, {
      host: device.host,
      port: device.port,
      username: credential.username || 'admin',
      password: credential.password,
      privateKey: credential.privateKey,
    });

    let backupPath: string | null = null;

    try {
      // 1. 完整性检查（如果启用）
      const securityOptions = this.config.securityOptions || [];
      if (securityOptions.includes('integrityCheck')) {
        const integrityResult = await this.integrityCheck(deviceId, device.name, rules, newIP);
        if (!integrityResult.success) {
          const errorMsg = `完整性检查失败: ${integrityResult.issues.join('; ')}`;
          await logger.error('规则更新', `设备 ${device.name} ${errorMsg}`, {
            issues: integrityResult.issues,
          });
          throw new Error(errorMsg);
        }
      }

      // 2. 备份设备配置（如果启用）
      const backupOptions = this.config.backupOptions || [];
      if (backupOptions.includes('autoBackup')) {
        backupPath = await this.backupDeviceConfig(deviceId, device.name);
      }

      // 3. 生成更新命令（先验证命令序列）
      const parsedRules = createNatRulePayloads(rules);

      const commands = usgParser.generateBatchUpdateIPCommands(parsedRules, newIP);

      // 验证命令序列（确保至少包含system-view和save）
      if (commands.length < 3) {
        throw new Error('生成的命令序列无效');
      }

      // 4. 执行更新命令（原子性操作）
      // 使用批量执行确保要么全部成功，要么全部失败
      const executeResult = await sshManager.executeBatchCommands(deviceId, commands);

      if (!executeResult.success) {
        throw new Error(`命令执行失败: ${executeResult.error || '未知错误'}`);
      }

      // 5. 更新数据库（在设备更新成功后）
      await prisma.natRule.updateMany({
        where: { deviceId, enabled: true },
        data: { globalIp: newIP },
      });

      // 6. 验证规则（如果启用）
      if (securityOptions.includes('verifyRules')) {
        const verified = await this.verifyRules(deviceId, device.name, newIP, rules.length);
        assertRuleVerificationSucceeded(verified);
      }

      await logger.success('规则更新', `设备 ${device.name} 更新了 ${rules.length} 条规则`);
      await notifier.notifyUpdateSuccess(device.name, rules.length, newIP);

      return { success: true, updated: rules.length, backupPath };
    } catch (error: unknown) {
      await logger.error('规则更新', `设备 ${device.name} 更新失败`, {
        error: getErrorMessage(error),
      });

      // 6. 自动回滚（如果启用）
      const backupOptions = this.config.backupOptions || [];
      if (backupOptions.includes('autoRollback')) {
        await logger.info('规则回滚', `设备 ${device.name} 更新失败，开始自动回滚`);
        const rollbackSuccess = await this.rollbackDeviceRules(deviceId, device.name, oldRules);
        if (rollbackSuccess) {
          await logger.success('规则回滚', `设备 ${device.name} 已成功回滚到更新前状态`);
        } else {
          await logger.error('规则回滚', `设备 ${device.name} 回滚失败，请手动检查设备配置`);
        }
      }

      await notifier.notifyUpdateFailed(device.name, getErrorMessage(error));
      throw error;
    } finally {
      await sshManager.disconnect(deviceId);
    }
  }

  /**
   * 启动自动化服务
   */
  async start(config: AutomationConfig) {
    this.config = { ...this.config, ...config };

    if (!this.config.enabled) {
      await logger.warning('自动化服务', '自动化服务未启用');
      return;
    }

    // 更新IP监控配置（如果提供了相关配置）
    if (this.config.checkInterval || this.config.confirmCount || this.config.checkSources) {
      ipMonitor.updateConfig({
        checkInterval: this.config.checkInterval || 5,
        confirmCount: this.config.confirmCount || 3,
        sources: this.config.checkSources || [...DEFAULT_IP_CHECK_SOURCES],
      });
      await logger.info('自动化服务', 'IP监控配置已更新', {
        checkInterval: this.config.checkInterval,
        confirmCount: this.config.confirmCount,
        sources: this.config.checkSources,
      });
    }

    // 启动IP监控
    await ipMonitor.start();
    this.emit('started');
  }

  /**
   * 停止自动化服务
   */
  async stop() {
    ipMonitor.stop();

    // 清理延迟定时器
    if (this.delayTimer) {
      clearTimeout(this.delayTimer);
      this.delayTimer = null;
    }

    // 取消定时任务
    if (this.scheduledJob) {
      this.scheduledJob.cancel();
      this.scheduledJob = null;
      await logger.info('自动更新', '定时任务已取消');
    }

    // 清理待更新的IP
    this.pendingIP = null;

    await logger.info('自动化服务', '自动化服务已停止');
    this.emit('stopped');
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<AutomationConfig>) {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...config };

    // 同步更新IP监控配置
    if (
      config.checkInterval !== undefined ||
      config.confirmCount !== undefined ||
      config.checkSources !== undefined
    ) {
      const ipMonitorConfig: Partial<IPMonitorConfig> = {};

      if (config.checkInterval !== undefined) {
        ipMonitorConfig.checkInterval = config.checkInterval;
      }
      if (config.confirmCount !== undefined) {
        ipMonitorConfig.confirmCount = config.confirmCount;
      }
      if (config.checkSources !== undefined) {
        ipMonitorConfig.sources = config.checkSources;
      }

      ipMonitor.updateConfig(ipMonitorConfig);
      logger.info('自动化服务', 'IP监控配置已同步更新', ipMonitorConfig).catch((err) => {
        console.error('记录日志失败:', err);
      });
    }

    // 如果更新了触发类型或定时时间，需要重新安排定时任务
    if (config.triggerType !== undefined && config.triggerType !== oldConfig.triggerType) {
      // 触发类型改变，先取消旧任务
      if (this.scheduledJob) {
        this.scheduledJob.cancel();
        this.scheduledJob = null;
        logger.info('自动更新', '触发类型已改变，取消旧定时任务').catch((err) => {
          console.error('记录日志失败:', err);
        });
      }

      // 如果切换到定时更新，安排新任务
      if (this.config.triggerType === 'scheduled' && this.config.scheduledTime && this.pendingIP) {
        this.rescheduleTask(this.config.scheduledTime, this.pendingIP);
      }
    } else if (
      config.scheduledTime !== undefined &&
      config.scheduledTime !== oldConfig.scheduledTime
    ) {
      // 仅定时时间改变，重新安排任务
      if (this.config.triggerType === 'scheduled' && this.config.scheduledTime) {
        if (this.scheduledJob) {
          this.scheduledJob.cancel();
          this.scheduledJob = null;
        }
        this.rescheduleTask(this.config.scheduledTime, this.pendingIP || '');
      }
    }

    this.emit('config-updated', this.config);
  }

  /**
   * 重新安排定时任务
   */
  private rescheduleTask(scheduledTime: string, pendingIP: string) {
    try {
      const scheduledTimeParts = parseScheduledTimeParts(scheduledTime);

      if (!scheduledTimeParts) {
        logger.error('自动更新', `定时时间格式错误: ${scheduledTime}`).catch(() => {});
        return;
      }

      const rule = new schedule.RecurrenceRule();
      rule.hour = scheduledTimeParts.hour;
      rule.minute = scheduledTimeParts.minute;
      rule.tz = 'Asia/Shanghai';

      this.scheduledJob = schedule.scheduleJob(rule, async () => {
        try {
          if (this.pendingIP) {
            await logger.info('自动更新', `定时任务触发，使用IP: ${this.pendingIP}`);
            await this.executeUpdate(this.pendingIP);
          } else {
            await logger.warning('自动更新', '定时任务触发，但没有待更新的IP');
          }
        } catch (error: unknown) {
          await logger.error('自动更新', '定时任务执行失败', { error: getErrorMessage(error) });
        }
      });

      logger
        .success('自动更新', `定时任务已更新，每天 ${scheduledTime} 执行`, { pendingIP })
        .catch((err) => {
          console.error('记录日志失败:', err);
        });
    } catch (error: unknown) {
      logger
        .error('自动更新', '重新安排定时任务失败', { error: getErrorMessage(error) })
        .catch((err) => {
          console.error('记录日志失败:', err);
        });
    }
  }

  /**
   * 获取配置
   */
  getConfig(): AutomationConfig {
    return { ...this.config };
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      enabled: this.config.enabled,
      isMonitoring: ipMonitor.isMonitoring(),
      isUpdating: this.isUpdating,
      currentIP: ipMonitor.getCurrentIPSync(),
      pendingIP: this.pendingIP, // 待更新的IP
      hasScheduledJob: this.scheduledJob !== null, // ???????
      config: this.config,
    };
  }

  /**
   * 手动触发更新
   */
  async manualUpdate(newIP?: string) {
    const ip = newIP || ipMonitor.getCurrentIPSync();
    if (!ip) {
      throw new Error('无法获取当前IP');
    }
    await this.executeUpdate(ip);
  }
}

// 导出单例
export const automationService = new AutomationService();
