import type { NatRule } from '@prisma/client';
import { EventEmitter } from 'events';
import * as schedule from 'node-schedule';
import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { ipMonitor, IPChangeEvent, type IPMonitorConfig } from './ip-monitor';
import { sshManager, type SSHConfig } from './ssh-manager';
import { usgParser, type ParsedNatRule } from './usg-parser';
import { deviceRuleSnapshots } from './device-rule-snapshots';
import { logger } from './logger';
import { notifier } from './notifier';
import { credentialManager } from './credential-manager';
import { prisma } from './prisma-client';
import {
  AutomationRunController,
  ManualConfirmationRequestController,
  type ManualConfirmationOutcome,
  assertRuleVerificationSucceeded,
  buildBatchUpdateIPCommands,
  buildScopedRollbackCommands,
  collectIntegrityCheckIssues,
  getUpdatedRuleVerificationIssues,
  hasWriteRelevantConfigChange,
  parseScheduledTimeParts,
  shouldClearPendingScheduledIP,
  shouldClearPendingUpdateTasks,
  shouldScheduleDailyUpdate,
} from './automation-service-helpers';
import { mandatoryUpdateBusinessGate } from './mandatory-update-business-gate';
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
    | 'unrRoute'
  >,
  'noReverse' | 'unrRoute'
> & {
  noReverse?: boolean | null;
  unrRoute?: boolean | null;
  addSyntax?: ParsedNatRule['addSyntax'];
};

type DeviceUpdateResult = {
  success: boolean;
  cancelled?: boolean;
  updated?: number;
  message?: string;
  backupPath?: string | null;
  error?: string;
};

type DeviceUpdateSummary = DeviceUpdateResult & {
  deviceId: string;
  deviceName: string;
};

export interface AutomationUpdateResult {
  success: boolean;
  cancelled?: boolean;
  successCount: number;
  failedCount: number;
  results: DeviceUpdateSummary[];
  error?: string;
}

const failedUpdate = (error: string, cancelled = false): AutomationUpdateResult => ({
  success: false,
  cancelled,
  successCount: 0,
  failedCount: 0,
  results: [],
  error,
});

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// After this many consecutive failed reconciliations of one target, stop auto-retrying until the
// IP changes or the user triggers a manual update.
// Unanswered confirmations back off (5, 10, 20 … up to 60 minutes) instead of prompting every cycle.
const CONFIRM_TIMEOUT_BACKOFF_BASE_MS = 5 * 60 * 1000;
const CONFIRM_TIMEOUT_BACKOFF_MAX_MS = 60 * 60 * 1000;
// Even with an unchanged IP, devices are re-read periodically so manual drift gets repaired.
const APPLIED_STATE_MAX_AGE_MS = 60 * 60 * 1000;
export const INTERFACE_ADDRESS_COMMAND = 'display ip interface brief | include /';
const MAX_CONSECUTIVE_FAILURES = 5;

export interface AutomationConfig {
  enabled: boolean;
  autoUpdateEnabled: boolean;
  triggerType: 'immediate' | 'delayed' | 'scheduled';
  delayMinutes?: number;
  scheduledTime?: string;
  selectedDevices: string[]; // 要自动更新的设备ID列表
  // ponytail: retired. The firewall's interface addresses are now checked before every
  // detected-IP write, so this manual declaration no longer gates anything; kept for old configs.
  clientEgressConfirmed?: boolean;
  managedRuleIds?: string[];
  windowsNotifyEnabled?: boolean;
  notifyTypes?: string[];
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
  private isRunning = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempts = 0;
  private retryNotBefore = 0;
  private rejectedIP: string | null = null;
  // IP that every selected device was last verified to carry; unchanged observations skip SSH.
  private lastAppliedIP: string | null = null;
  private lastAppliedAt = 0;
  private confirmationTimeouts = 0;
  // Bumped by outside rule writes so a run that started earlier cannot re-mark devices as applied.
  private appliedGeneration = 0;
  private needsAttention = false;
  // Shown in the UI while needsAttention is set, so the user sees why updates stopped.
  private attentionReason: string | null = null;
  private readonly updateRuns = new AutomationRunController();
  private readonly manualConfirmationRequests = new ManualConfirmationRequestController();
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
      this.notifyInBackground('IP变化通知', () =>
        notifier.notifyIPChange(event.oldIP, event.newIP)
      );

      if (this.isRunning && this.config.autoUpdateEnabled) {
        await this.handleIPChange(event);
      }
    });

    // IP检测事件
    ipMonitor.on('checked', (data: unknown) => {
      this.emit('ip-checked', data);
      void this.reconcileObservedIP().catch((error) => this.logReconcileError(error));
    });

    ipMonitor.on('initialized', () => {
      void this.reconcileObservedIP().catch((error) => this.logReconcileError(error));
    });

    // 错误事件
    ipMonitor.on('error', async (error: Error) => {
      await logger.error('IP监控', 'IP检测失败', { error: getErrorMessage(error) });
    });
  }

  /**
   * 处理IP变化
   */
  private logReconcileError(error: unknown) {
    return logger.error('自动更新', '对账失败', { error: getErrorMessage(error) });
  }

  /** Notifications must never hold device locks, update runs or shutdown. */
  private notifyInBackground(label: string, send: () => Promise<void>): void {
    void Promise.resolve()
      .then(send)
      .catch((error) =>
        logger.error('通知', `${label}发送失败`, { error: getErrorMessage(error) }).catch(() => {})
      );
  }

  private async reconcileObservedIP() {
    const ip = ipMonitor.getCurrentIPSync();
    if (ip) await this.handleIPChange({ newIP: ip } as IPChangeEvent);
  }

  private async handleIPChange(event: IPChangeEvent) {
    if (
      !this.isRunning ||
      !this.config.enabled ||
      !this.config.autoUpdateEnabled ||
      event.newIP !== ipMonitor.getCurrentIPSync() ||
      mandatoryUpdateBusinessGate.isBlocked()
    ) {
      return;
    }
    if (
      event.newIP === this.lastAppliedIP &&
      Date.now() - this.lastAppliedAt < APPLIED_STATE_MAX_AGE_MS
    ) {
      // Steady state: devices were verified for this IP and no run has started since.
      this.pendingIP = null;
      return;
    }
    if (this.pendingIP !== event.newIP) {
      this.retryAttempts = 0;
      this.retryNotBefore = 0;
      this.needsAttention = false;
      this.confirmationTimeouts = 0;
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
    }
    const changedTarget = this.pendingIP !== event.newIP;
    this.pendingIP = event.newIP;
    if (this.rejectedIP === event.newIP || this.needsAttention || Date.now() < this.retryNotBefore)
      return;
    this.rejectedIP = null;
    if (this.isUpdating) {
      return;
    }
    if (this.retryTimer && !changedTarget) return;

    switch (this.config.triggerType) {
      case 'immediate':
        await this.executeUpdate(event.newIP);
        break;

      case 'delayed': {
        if (this.delayTimer && !changedTarget) return;
        if (this.delayTimer) {
          clearTimeout(this.delayTimer);
        }
        const delayMinutes = this.config.delayMinutes || 5;
        const delayMs = delayMinutes * 60 * 1000;
        const scheduledIP = event.newIP;
        const timer = setTimeout(async () => {
          try {
            if (
              this.delayTimer !== timer ||
              !this.isRunning ||
              mandatoryUpdateBusinessGate.isBlocked()
            )
              return;
            // Keep the timer reserved while fresh observations emit checked/changed events.
            const latestIP = await ipMonitor.refreshConfirmedIP();
            if (
              this.delayTimer !== timer ||
              !this.isRunning ||
              !this.config.enabled ||
              !this.config.autoUpdateEnabled ||
              this.config.triggerType !== 'delayed' ||
              mandatoryUpdateBusinessGate.isBlocked()
            )
              return;
            this.delayTimer = null;
            if (latestIP !== scheduledIP) {
              await this.handleIPChange({ newIP: latestIP } as IPChangeEvent);
              return;
            }
            this.pendingIP = latestIP;
            await this.executeUpdate(latestIP);
          } catch (error: unknown) {
            await logger.error('自动更新', '延迟更新执行失败', { error: getErrorMessage(error) });
          } finally {
            if (this.delayTimer === timer) this.delayTimer = null;
          }
        }, delayMs);
        // Reserve synchronously; async logging must not allow duplicate timers to escape cancellation.
        this.delayTimer = timer;
        await logger.info('自动更新', `延迟 ${delayMinutes} 分钟后更新`, {
          newIP: scheduledIP,
          scheduledFor: new Date(Date.now() + delayMs).toISOString(),
        });
        break;
      }

      case 'scheduled': {
        // 保存待更新的IP
        if (changedTarget)
          await logger.info('自动更新', `待对账IP: ${event.newIP}，等待定时任务执行`);

        // 如果没有配置定时时间，记录警告
        if (!this.config.scheduledTime) {
          await logger.warning('自动更新', '未配置定时更新时间，请在设置中配置');
          return;
        }

        if (!this.scheduledJob) this.rescheduleTask(this.config.scheduledTime);
        break;
      }
    }
  }

  /**
   * 请求手动确认
   */
  private async requestManualConfirm(
    newIP: string,
    deviceCount: number,
    token: number
  ): Promise<ManualConfirmationOutcome> {
    return this.manualConfirmationRequests.request(
      () => this.updateRuns.isCancelled(token),
      (callback) => {
        this.emit('manual-confirm-request', {
          newIP,
          deviceCount,
          callback,
        });
        this.notifyInBackground('确认提醒', () => notifier.notifyManualConfirmationRequired(newIP));
      }
    );
  }

  private async stopCancelledUpdate(token: number): Promise<boolean> {
    if (!this.updateRuns.isCancelled(token)) {
      return false;
    }

    await logger.warning('自动更新', '自动化服务已停止，更新任务已在安全边界取消');
    this.emit('update-cancelled', { reason: '自动化服务已停止' });
    return true;
  }

  /**
   * 执行更新
   */
  private async rejectUpdate(message: string): Promise<AutomationUpdateResult> {
    await logger.warning('自动更新', `更新未执行：${message}`);
    return failedUpdate(message);
  }

  private async executeUpdate(newIP: string, detectedIP = true): Promise<AutomationUpdateResult> {
    if (mandatoryUpdateBusinessGate.isBlocked())
      return this.rejectUpdate('业务操作已暂停，请等待维护或完成强制更新');
    if (this.isUpdating) {
      if (detectedIP) this.pendingIP = newIP;
      return this.rejectUpdate('已有更新任务在执行，最新观测已保留待对账');
    }
    if (!this.config.selectedDevices.length || !this.config.managedRuleIds?.length) {
      return this.rejectUpdate('请明确选择设备及受管规则，已阻止写入');
    }
    if (
      !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(newIP) ||
      newIP.split('.').some((part) => Number(part) > 255)
    ) {
      return this.rejectUpdate('IP地址格式无效');
    }

    const token = this.updateRuns.begin();
    const generation = this.appliedGeneration;
    const result = await this.updateRuns.track(this.performUpdate(newIP, token, detectedIP));
    const retryable = !result.success && !result.cancelled && detectedIP && this.isRunning;
    if (result.success) {
      this.confirmationTimeouts = 0;
      if (generation === this.appliedGeneration) {
        this.lastAppliedIP = newIP;
        this.lastAppliedAt = Date.now();
      }
      if (this.pendingIP === newIP) {
        this.pendingIP = null;
        this.retryAttempts = 0;
        this.retryNotBefore = 0;
        this.needsAttention = false;
      }
    } else if (retryable) {
      this.pendingIP ||= newIP;
      this.retryAttempts += 1;
    }
    if (retryable && this.retryAttempts >= MAX_CONSECUTIVE_FAILURES) {
      this.needsAttention = true;
      this.retryNotBefore = 0;
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = null;
      const cause = result.results?.find((item) => !item.success && item.error)?.error;
      this.attentionReason = cause || result.error || null;
      const message = `连续 ${this.retryAttempts} 次对账失败，已停止自动重试；请检查设备后手动更新，公网IP变化时将重新尝试${cause ? `。最近原因：${cause}` : ''}`;
      await logger.error('自动更新', message, { targetIP: newIP, error: result.error });
      this.notifyInBackground('自动更新告警', () =>
        notifier.notifyUpdateFailed('自动更新', message)
      );
    } else if (retryable) {
      // Retry only after another fresh observation and device read, never replay a command batch.
      const delay = this.retryAttempts <= 3 ? 30000 * 2 ** (this.retryAttempts - 1) : 5 * 60000;
      this.retryNotBefore = Date.now() + delay;
      if (this.retryTimer) clearTimeout(this.retryTimer);
      const retryTimer = setTimeout(async () => {
        if (
          this.retryTimer !== retryTimer ||
          !this.isRunning ||
          !this.config.enabled ||
          !this.config.autoUpdateEnabled ||
          mandatoryUpdateBusinessGate.isBlocked()
        )
          return;
        try {
          const latestIP = await ipMonitor.refreshConfirmedIP();
          if (
            this.retryTimer !== retryTimer ||
            !this.isRunning ||
            !this.config.enabled ||
            !this.config.autoUpdateEnabled ||
            mandatoryUpdateBusinessGate.isBlocked()
          )
            return;
          this.retryTimer = null;
          if (latestIP !== newIP) {
            await this.handleIPChange({ newIP: latestIP } as IPChangeEvent);
            return;
          }
          this.pendingIP = latestIP;
          await this.executeUpdate(latestIP);
        } catch (error) {
          await this.logReconcileError(error);
        } finally {
          if (this.retryTimer === retryTimer) this.retryTimer = null;
        }
      }, delay);
      this.retryTimer = retryTimer;
    }
    if (
      this.isRunning &&
      this.config.autoUpdateEnabled &&
      this.pendingIP &&
      this.pendingIP !== newIP
    ) {
      void this.reconcileObservedIP().catch((error) => this.logReconcileError(error));
    }
    return result;
  }

  private async performUpdate(
    newIP: string,
    token: number,
    detectedIP: boolean
  ): Promise<AutomationUpdateResult> {
    this.isUpdating = true;
    // Any run may change device state; only its own verified success re-establishes the steady state.
    this.lastAppliedIP = null;
    this.emit('update-started', { newIP });
    const runConfig = this.getConfig();
    const results: DeviceUpdateSummary[] = [];
    const summary = (cancelled = false): AutomationUpdateResult => {
      const successCount = results.filter((result) => result.success).length;
      const failedCount = results.length - successCount;
      return {
        success: !cancelled && failedCount === 0 && successCount > 0,
        cancelled,
        successCount,
        failedCount,
        results,
        ...(cancelled
          ? { error: '更新已取消，剩余设备未写入' }
          : failedCount
            ? { error: `有 ${failedCount} 台设备更新失败或结果未知` }
            : {}),
      };
    };
    try {
      const selectedIds = [...new Set(runConfig.selectedDevices)];
      const managedIds = [...new Set(runConfig.managedRuleIds || [])];
      const devices = await prisma.device.findMany({
        where: { id: { in: selectedIds }, enabled: true },
      });
      const foundDevices = new Set(devices.map((device) => device.id));
      const invalidDevices = selectedIds.filter((id) => !foundDevices.has(id));
      if (invalidDevices.length)
        throw new Error(`所选设备已删除或禁用，整批停止写入：${invalidDevices.join(', ')}`);
      const scopedRules = await prisma.natRule.findMany({
        where: {
          id: { in: managedIds },
          deviceId: { in: selectedIds },
          enabled: true,
        },
      });
      const foundRules = new Set(scopedRules.map((rule) => rule.id));
      const invalidRules = managedIds.filter((id) => !foundRules.has(id));
      if (invalidRules.length)
        throw new Error(
          `受管规则已删除、禁用或不属于所选设备，整批停止写入：${invalidRules.join(', ')}`
        );
      const ruleIdsByDevice = new Map<string, string[]>();
      for (const rule of scopedRules) {
        const ids = ruleIdsByDevice.get(rule.deviceId) || [];
        ids.push(rule.id);
        ruleIdsByDevice.set(rule.deviceId, ids);
      }
      const unscopedDevices = selectedIds.filter((id) => !ruleIdsByDevice.has(id));
      if (unscopedDevices.length)
        throw new Error(`所选设备没有启用的受管规则，整批停止写入：${unscopedDevices.join(', ')}`);
      if (await this.stopCancelledUpdate(token)) return summary(true);

      for (const device of devices) {
        if (await this.stopCancelledUpdate(token)) return summary(true);
        try {
          const result = await this.updateDeviceRules(
            device.id,
            newIP,
            token,
            runConfig,
            detectedIP,
            ruleIdsByDevice.get(device.id) || []
          );
          results.push({ deviceId: device.id, deviceName: device.name, ...result });
          if (result.cancelled) return summary(true);
        } catch (error) {
          const message = getErrorMessage(error);
          await logger.error('自动更新', `设备 ${device.name} 更新失败：${message}`, {
            deviceId: device.id,
          });
          results.push({
            deviceId: device.id,
            deviceName: device.name,
            success: false,
            error: message,
          });
        }
        if (await this.stopCancelledUpdate(token)) return summary(true);
      }
      const result = summary();
      const log = result.success ? logger.success.bind(logger) : logger.warning.bind(logger);
      await log('自动更新', `对账完成: 成功 ${result.successCount}, 失败 ${result.failedCount}`, {
        results,
      });
      const changedRuleCount = results.reduce((total, item) => total + (item.updated || 0), 0);
      if (result.failedCount > 0 || changedRuleCount > 0)
        this.notifyInBackground('批量更新通知', () =>
          notifier.notifyBatchUpdateCompleted(result.successCount, result.failedCount)
        );
      this.emit('update-completed', result);
      return result;
    } catch (error) {
      const message = getErrorMessage(error);
      await logger.error('自动更新', '批量更新失败', { error: message });
      const result = { ...summary(), success: false, error: message };
      this.emit('update-failed', result);
      return result;
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

      if (!result.success || !result.output || result.complete !== true) {
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

      // Read the current state and restore only the observed managed rules.
      const currentRulesResult = await sshManager.executeCommand(
        deviceId,
        'display current-configuration | include nat server'
      );

      if (!currentRulesResult.success) throw new Error('回滚前无法读取设备现状');
      usgParser.parseNatServerSnapshot(
        currentRulesResult.output || '',
        currentRulesResult.complete === true
      );

      const commands = buildScopedRollbackCommands(
        oldRules,
        currentRulesResult.success ? currentRulesResult.output : undefined,
        usgParser
      );

      deviceRuleSnapshots.invalidate(deviceId);
      const rollbackResult = await sshManager.executeBatchCommands(deviceId, commands);
      if (!rollbackResult.success) {
        throw new Error(`回滚命令执行失败: ${rollbackResult.error || '未知错误'}`);
      }

      const restored = await sshManager.executeCommand(
        deviceId,
        'display current-configuration | include nat server'
      );
      if (!restored.success) throw new Error('回滚后无法回读验证');
      const restoredRules = usgParser.parseNatServerSnapshot(
        restored.output || '',
        restored.complete === true
      );
      for (const oldRule of oldRules) {
        const restoredRule = restoredRules.find((rule) => rule.ruleName === oldRule.ruleName);
        if (
          !restoredRule ||
          restoredRule.globalIp !== oldRule.globalIp ||
          restoredRule.insideIp !== oldRule.insideIp ||
          restoredRule.globalPort !== oldRule.globalPort ||
          restoredRule.insidePort !== oldRule.insidePort ||
          restoredRule.protocol !== oldRule.protocol ||
          Boolean(restoredRule.noReverse) !== Boolean(oldRule.noReverse) ||
          Boolean(restoredRule.unrRoute) !== Boolean(oldRule.unrRoute)
        ) {
          throw new Error(`规则 ${oldRule.ruleName} 回滚未通过验证`);
        }
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
    rules: RuleSnapshot[]
  ): Promise<boolean> {
    try {
      const verifyCommand = 'display current-configuration | include nat server';
      const result = await sshManager.executeCommand(deviceId, verifyCommand);

      if (!result.success) {
        await logger.warning(
          '规则验证',
          `设备 ${deviceName} 验证失败: 无法获取规则；${result.error || 'SSH命令执行失败（未返回原因）'}`
        );
        return false;
      }

      usgParser.parseNatServerSnapshot(result.output || '', result.complete === true);

      const issues = getUpdatedRuleVerificationIssues(rules, newIP, result.output, usgParser);
      if (issues.length > 0) {
        await logger.warning('规则验证', `设备 ${deviceName} 验证失败`, {
          expected: rules.length,
          issues,
        });
        return false;
      }

      await logger.success('规则验证', `设备 ${deviceName} 规则验证通过`, {
        ruleCount: rules.length,
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
   * 对账并更新明确选择的设备规则
   */
  private async updateDeviceRules(
    deviceId: string,
    newIP: string,
    token: number,
    runConfig: AutomationConfig,
    detectedIP: boolean,
    expectedRuleIds: string[]
  ): Promise<DeviceUpdateResult> {
    return sshManager.withDeviceOperation(deviceId, () =>
      this.updateDeviceRulesLocked(deviceId, newIP, token, runConfig, detectedIP, expectedRuleIds)
    );
  }

  private async updateDeviceRulesLocked(
    deviceId: string,
    newIP: string,
    token: number,
    runConfig: AutomationConfig,
    detectedIP: boolean,
    expectedRuleIds: string[]
  ): Promise<DeviceUpdateResult> {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) {
      throw new Error('设备不存在');
    }
    if (!device.enabled) throw new Error(`设备 ${deviceId} 已禁用，已停止写入`);

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
      where: { deviceId, id: { in: expectedRuleIds }, enabled: true },
    });
    const initialIds = new Set(rules.map((rule) => rule.id));
    const missingInitialIds = expectedRuleIds.filter((id) => !initialIds.has(id));
    if (!expectedRuleIds.length || missingInitialIds.length)
      throw new Error(`受管规则范围已变化，已停止写入：${missingInitialIds.join(', ')}`);

    // 连接设备
    const connected = await sshManager.connect(deviceId, {
      host: device.host,
      port: device.port,
      username: credential.username || 'admin',
      password: credential.password,
      privateKey: credential.privateKey,
      passphrase: credential.passphrase,
    });
    if (!connected.success) throw new Error(`连接失败: ${connected.message}`);

    let backupPath: string | null = null;
    let oldRules: RuleSnapshot[] = [];
    let writeAttempted = false;

    try {
      // 1. 完整性检查（如果启用）
      const securityOptions = runConfig.securityOptions || [];
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

      // Read before every attempt. Device observations, not the local cache, define rollback.
      const currentRulesResult = await sshManager.executeCommand(
        deviceId,
        'display current-configuration | include nat server'
      );
      if (!currentRulesResult.success)
        throw new Error(
          `无法读取设备当前NAT规则，已阻止写入：${currentRulesResult.error || 'SSH命令执行失败（未返回原因）'}`
        );
      const observed = usgParser.parseNatServerSnapshot(
        currentRulesResult.output || '',
        currentRulesResult.complete === true
      );
      const byName = new Map(observed.map((rule) => [rule.ruleName, rule]));
      const byEndpoint = new Map(
        observed.map((rule) => [
          `${rule.protocol}:${rule.globalPort}:${rule.insideIp}:${rule.insidePort}`,
          rule,
        ])
      );
      // O(local rules + observed rules); explicit managed scope never creates missing device rules.
      oldRules = rules.map((rule) => {
        const actual =
          byName.get(rule.ruleName) ||
          (rule.ruleName.startsWith('NAT_')
            ? byEndpoint.get(
                `${rule.protocol}:${rule.globalPort}:${rule.insideIp}:${rule.insidePort}`
              )
            : undefined);
        if (
          !actual ||
          actual.protocol !== rule.protocol ||
          actual.globalPort !== rule.globalPort ||
          actual.insideIp !== rule.insideIp ||
          actual.insidePort !== rule.insidePort
        ) {
          throw new Error(`受管规则 ${rule.ruleName} 已被删除或配置存在冲突，请先拉取并确认`);
        }
        return { ...actual, id: rule.id };
      });
      const changedRules = oldRules.filter((rule) => rule.globalIp !== newIP);
      if (!changedRules.length) {
        await prisma.natRule.updateMany({
          where: { deviceId, id: { in: rules.map((rule) => rule.id) }, enabled: true },
          data: { globalIp: newIP },
        });
        return { success: true, updated: 0, message: '设备配置已一致（回读确认）' };
      }
      if (detectedIP) {
        // The detected IP is this client's egress. It is only the firewall's public IP when the
        // firewall itself holds it (dialer/WAN interface); a VPN, proxy or another network on the
        // client must never be written into NAT rules.
        // Only lines carrying "address/mask" matter; executeCommand turns paging off first.
        const interfaces = await sshManager.executeCommand(deviceId, INTERFACE_ADDRESS_COMMAND);
        if (!interfaces.success || !interfaces.complete)
          throw new Error(
            `无法读取设备接口地址，已阻止写入：${interfaces.error || 'SSH命令执行失败（未返回原因）'}`
          );
        if (!usgParser.parseInterfaceAddresses(interfaces.output || '').includes(newIP))
          throw new Error(
            `检测到的公网IP ${newIP} 不在设备 ${device.name} 的任何接口上（本机网络或代理可能已变化），已阻止写入`
          );
      }
      if (runConfig.securityOptions?.includes('manualConfirm')) {
        // Ask only for a device with observed differences, avoiding a prompt on every matching check.
        const outcome = await this.requestManualConfirm(newIP, 1, token);
        if (this.updateRuns.isCancelled(token))
          return { success: false, cancelled: true, error: '更新已取消' };
        if (outcome === 'confirmed') this.confirmationTimeouts = 0;
        if (outcome !== 'confirmed') {
          // Only an explicit rejection suppresses this IP; a timeout stays pending and is asked
          // again on the next detection cycle.
          if (outcome === 'rejected') this.rejectedIP = newIP;
          if (outcome === 'timeout') {
            this.confirmationTimeouts += 1;
            this.retryNotBefore =
              Date.now() +
              Math.min(
                CONFIRM_TIMEOUT_BACKOFF_MAX_MS,
                CONFIRM_TIMEOUT_BACKOFF_BASE_MS * 2 ** (this.confirmationTimeouts - 1)
              );
          } else {
            this.confirmationTimeouts = 0;
          }
          const reason =
            outcome === 'rejected'
              ? '用户拒绝更新'
              : outcome === 'timeout'
                ? '确认超时，将在下一个检测周期重新请求'
                : '确认已取消';
          await logger.warning('自动更新', `设备 ${device.name} 未写入：${reason}`, { newIP });
          this.emit('update-cancelled', { reason });
          return { success: false, cancelled: true, error: reason };
        }
        if (detectedIP) {
          const latest = await ipMonitor.refreshConfirmedIP();
          if (latest !== newIP) {
            this.pendingIP = latest;
            this.emit('update-cancelled', { reason: '确认期间公网IP已变化，需要重新确认' });
            return { success: false, cancelled: true, error: '确认期间公网IP已变化，需要重新确认' };
          }
        }
      }
      // A readable, persisted backup is mandatory before the first mutating command.
      backupPath = await this.backupDeviceConfig(deviceId, device.name);
      if (!backupPath) throw new Error('设备配置备份失败，已阻止写入');
      const freshRead = await sshManager.executeCommand(
        deviceId,
        'display current-configuration | include nat server'
      );
      if (!freshRead.success)
        throw new Error(
          `写入前无法核对设备当前规则，已阻止写入：${freshRead.error || 'SSH命令执行失败（未返回原因）'}`
        );
      const freshRules = usgParser.parseNatServerSnapshot(
        freshRead.output || '',
        freshRead.complete === true
      );
      const freshByName = new Map(freshRules.map((rule) => [rule.ruleName, rule]));
      for (const rule of oldRules) {
        const actual = freshByName.get(rule.ruleName);
        if (
          !actual ||
          actual.globalIp !== rule.globalIp ||
          actual.globalPort !== rule.globalPort ||
          actual.insideIp !== rule.insideIp ||
          actual.insidePort !== rule.insidePort ||
          actual.protocol !== rule.protocol ||
          Boolean(actual.noReverse) !== Boolean(rule.noReverse) ||
          Boolean(actual.unrRoute) !== Boolean(rule.unrRoute)
        ) {
          throw new Error('确认或备份期间设备受管规则已变化，请重新对账确认');
        }
      }
      const commands = buildBatchUpdateIPCommands(
        changedRules,
        newIP,
        freshRead.output || '',
        usgParser
      );

      // 验证命令序列（确保至少包含system-view和save）
      if (commands.length < 3) {
        throw new Error('生成的命令序列无效');
      }

      await this.ensureDeviceConnected(deviceId, device, credential);
      const deviceBeforeWrite = await prisma.device.findUnique({ where: { id: deviceId } });
      if (
        !deviceBeforeWrite?.enabled ||
        deviceBeforeWrite.host !== device.host ||
        deviceBeforeWrite.port !== device.port
      )
        throw new Error(`设备 ${deviceId} 已禁用、删除或连接目标改变，已停止写入`);
      const rulesBeforeWrite = await prisma.natRule.findMany({
        where: { deviceId, id: { in: expectedRuleIds }, enabled: true },
      });
      const idsBeforeWrite = new Set(rulesBeforeWrite.map((rule) => rule.id));
      const missingIdsBeforeWrite = expectedRuleIds.filter((id) => !idsBeforeWrite.has(id));
      if (missingIdsBeforeWrite.length)
        throw new Error(`受管规则范围已变化，已停止写入：${missingIdsBeforeWrite.join(', ')}`);
      if (this.updateRuns.isCancelled(token) || mandatoryUpdateBusinessGate.isBlocked())
        throw new Error('更新已取消，未开始设备写入');

      // SSH batches can partially apply; failed results remain unknown until another read.
      writeAttempted = true;
      // The rules page must re-read this device; its cached snapshot is about to be wrong.
      deviceRuleSnapshots.invalidate(deviceId);
      const executeResult = await sshManager.executeBatchCommands(deviceId, commands);

      if (!executeResult.success) {
        await logger.error('规则更新', '命令执行失败', {
          deviceName: device.name,
          error: executeResult.error,
          commandCount: commands.length,
          output: executeResult.output?.substring(0, 1000),
        });
        throw new Error(`命令执行失败: ${executeResult.error || '未知错误'}`);
      }

      // Mandatory device verification precedes marking local state successful.
      assertRuleVerificationSucceeded(
        await this.verifyRules(deviceId, device.name, newIP, oldRules)
      );
      await prisma.natRule.updateMany({
        where: { deviceId, id: { in: rules.map((rule) => rule.id) }, enabled: true },
        data: { globalIp: newIP },
      });

      await logger.success(
        '规则更新',
        `设备 ${device.name} 更新并验证了 ${changedRules.length} 条受管规则`
      );
      this.notifyInBackground('更新成功通知', () =>
        notifier.notifyUpdateSuccess(device.name, changedRules.length, newIP)
      );

      return { success: true, updated: changedRules.length, backupPath };
    } catch (error: unknown) {
      await logger.error('规则更新', `设备 ${device.name} 更新失败`, {
        error: getErrorMessage(error),
      });

      // 6. 自动回滚（如果启用）
      const backupOptions = runConfig.backupOptions || [];
      if (writeAttempted && backupOptions.includes('autoRollback')) {
        await logger.info('规则回滚', `设备 ${device.name} 更新失败，开始自动回滚`);
        const rollbackSuccess = await this.rollbackDeviceRules(deviceId, device.name, oldRules);
        if (rollbackSuccess) {
          await logger.success('规则回滚', `设备 ${device.name} 已成功回滚到更新前状态`);
        } else {
          await logger.error('规则回滚', `设备 ${device.name} 回滚失败，请手动检查设备配置`);
        }
      }

      const failureMessage = getErrorMessage(error);
      this.notifyInBackground('更新失败通知', () =>
        notifier.notifyUpdateFailed(device.name, failureMessage)
      );
      throw error;
    } finally {
      await sshManager.disconnect(deviceId);
    }
  }

  /**
   * 启动自动化服务
   */
  private async ensureDeviceConnected(
    deviceId: string,
    device: { host: string; port: number },
    credential: {
      username?: string | null;
      password?: string;
      privateKey?: SSHConfig['privateKey'];
      passphrase?: string;
    }
  ): Promise<void> {
    if (sshManager.isConnected(deviceId)) {
      return;
    }

    const reconnectResult = await sshManager.connect(deviceId, {
      host: device.host,
      port: device.port,
      username: credential.username || 'admin',
      password: credential.password,
      privateKey: credential.privateKey,
      passphrase: credential.passphrase,
    });

    if (!reconnectResult.success) {
      throw new Error(`重新连接失败: ${reconnectResult.message}`);
    }
  }

  async start(config: AutomationConfig, options?: { duringMaintenance?: boolean }) {
    const startBlocked = () =>
      mandatoryUpdateBusinessGate.isBlocked() &&
      !(
        options?.duringMaintenance === true &&
        mandatoryUpdateBusinessGate.isBlocked('maintenance') &&
        !mandatoryUpdateBusinessGate.isBlocked('mandatory')
      );
    if (startBlocked()) {
      throw new Error('必须先完成强制更新');
    }

    this.updateConfig(config);

    if (!this.config.enabled) {
      await this.stop();
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

    // Register the running state before the initial observation so startup is reconciled.
    this.lastAppliedIP = null;
    this.isRunning = true;
    if (!ipMonitor.isMonitoring()) await ipMonitor.start();

    if (startBlocked()) {
      this.isRunning = false;
      ipMonitor.stop();
      throw new Error('必须先完成强制更新');
    }

    try {
      await ipMonitor.refreshConfirmedIP();
    } catch (error) {
      await this.logReconcileError(error);
    }

    if (shouldScheduleDailyUpdate(this.config)) {
      this.rescheduleTask(this.config.scheduledTime || '');
    }

    this.emit('started');
  }

  /**
   * 停止自动化服务
   */
  async stop() {
    this.isRunning = false;
    ipMonitor.stop();
    const stoppedRun = this.updateRuns.cancelAndWait(() =>
      this.manualConfirmationRequests.cancel()
    );

    // 清理延迟定时器
    if (this.delayTimer) {
      clearTimeout(this.delayTimer);
      this.delayTimer = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    // 取消定时任务
    if (this.scheduledJob) {
      this.scheduledJob.cancel();
      this.scheduledJob = null;
      await logger.info('自动更新', '定时任务已取消');
    }

    await stoppedRun;

    await logger.info('自动化服务', '自动化服务已停止');
    this.emit('stopped');
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<AutomationConfig>) {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...config };
    if (config.windowsNotifyEnabled !== undefined || config.notifyTypes !== undefined) {
      notifier.updateConfig({
        windowsNotifyEnabled: this.config.windowsNotifyEnabled !== false,
        notifyTypes: this.config.notifyTypes ?? ['ipChange', 'updateSuccess', 'updateFailed'],
      });
    }
    if (hasWriteRelevantConfigChange(oldConfig, this.config)) {
      // A new write scope must be reconciled against devices on the next observation, and a
      // stalled retry loop gets a fresh chance with it.
      this.lastAppliedIP = null;
      this.needsAttention = false;
      this.retryAttempts = 0;
      this.retryNotBefore = 0;
      this.confirmationTimeouts = 0;
      if (this.isUpdating) {
        void this.updateRuns
          .cancelAndWait(() => this.manualConfirmationRequests.cancel())
          .catch((error) => this.logReconcileError(error));
      }
    }

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

    const shouldResetUpdateTasks = shouldClearPendingUpdateTasks(oldConfig, this.config);

    if (shouldClearPendingScheduledIP(oldConfig, this.config)) {
      this.pendingIP = null;
    }

    if (shouldResetUpdateTasks) {
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      if (this.delayTimer) {
        clearTimeout(this.delayTimer);
        this.delayTimer = null;
      }

      if (this.scheduledJob) {
        this.scheduledJob.cancel();
        this.scheduledJob = null;
        logger.info('自动更新', '触发类型已改变，取消旧定时任务').catch((err) => {
          console.error('记录日志失败:', err);
        });
      }
    }

    if (this.isRunning && shouldResetUpdateTasks && shouldScheduleDailyUpdate(this.config)) {
      this.rescheduleTask(this.config.scheduledTime || '');
    }

    this.emit('config-updated', this.config);
  }

  /**
   * 重新安排定时任务
   */
  private rescheduleTask(scheduledTime: string) {
    try {
      if (this.scheduledJob) {
        this.scheduledJob.cancel();
        this.scheduledJob = null;
      }

      if (!this.isRunning || mandatoryUpdateBusinessGate.isBlocked()) {
        return;
      }

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
          if (!this.isRunning || mandatoryUpdateBusinessGate.isBlocked()) {
            return;
          }
          const updateIP = await ipMonitor.refreshConfirmedIP();
          this.pendingIP = updateIP;

          if (updateIP) {
            await logger.info('自动更新', `定时任务触发，使用IP: ${updateIP}`);
            await this.executeUpdate(updateIP);
          } else {
            await logger.warning('自动更新', '定时任务触发，但没有可用IP');
          }
        } catch (error: unknown) {
          await logger.error('自动更新', '定时任务执行失败', { error: getErrorMessage(error) });
        }
      });

      logger
        .success('自动更新', `定时任务已更新，每天 ${scheduledTime} 执行`, {
          pendingIP: this.pendingIP,
        })
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
      isRunning: this.isRunning,
      isMonitoring: ipMonitor.isMonitoring(),
      isUpdating: this.isUpdating,
      currentIP: ipMonitor.getCurrentIPSync(),
      lastCheck: ipMonitor.getLastSuccessfulCheck(),
      retryNotBefore: this.retryNotBefore ? new Date(this.retryNotBefore) : null,
      consecutiveFailures: this.retryAttempts,
      needsAttention: this.needsAttention, // 连续失败已停止自动重试，需人工处理
      attentionReason: this.needsAttention ? this.attentionReason : null,
      lastAppliedIP: this.lastAppliedIP,
      pendingIP: this.pendingIP, // 待更新的IP
      hasScheduledJob: this.scheduledJob !== null, // 是否已安排定时更新
      config: this.config,
    };
  }

  /**
   * 手动触发更新
   */
  async manualUpdate(newIP?: string): Promise<AutomationUpdateResult> {
    try {
      const ip = newIP || (await ipMonitor.refreshConfirmedIP());
      if (!ip) return failedUpdate('无法获取当前已确认IP');
      this.rejectedIP = null;
      // A manual update is the user's acknowledgement: restart the failure budget.
      this.retryAttempts = 0;
      this.retryNotBefore = 0;
      this.needsAttention = false;
      this.confirmationTimeouts = 0;
      return await this.executeUpdate(ip, !newIP);
    } catch (error) {
      return failedUpdate(getErrorMessage(error));
    }
  }

  // Called after rule writes outside automation so the next observation re-reads devices.
  invalidateAppliedState(): void {
    this.appliedGeneration += 1;
    this.lastAppliedIP = null;
  }

  async resume(): Promise<void> {
    if (!this.isRunning || mandatoryUpdateBusinessGate.isBlocked()) return;
    // Device state may have changed while suspended; force one device read. A stopped retry budget
    // (needsAttention) stays stopped until the IP changes or the user updates manually.
    this.lastAppliedIP = null;
    if (!this.needsAttention) {
      this.retryNotBefore = 0;
      this.retryAttempts = 0;
    }
    await ipMonitor.refreshConfirmedIP();
    await this.reconcileObservedIP();
  }
}

// 导出单例
export const automationService = new AutomationService();
