import type { ParsedNatRule } from './usg-parser';

type AutomationRuleLike = {
  id?: string | null;
  ruleName?: string | null;
  enabled?: boolean | null;
  protocol?: string | null;
  globalIp?: string | null;
  globalPort?: string | null;
  insideIp?: string | null;
  insidePort?: string | null;
  noReverse?: boolean | null;
};

type AutomationRulePayloadInput = {
  ruleName: string;
  protocol: string;
  globalIp: string;
  globalPort: string;
  insideIp: string;
  insidePort: string;
  enabled: boolean;
  noReverse?: boolean | null;
  addSyntax?: ParsedNatRule['addSyntax'];
};

type AutomationRuleWithIdLike = AutomationRulePayloadInput & {
  id: string;
};

type BatchUpdateIPCommandBuilder = {
  parseNatServerList: (output: string) => ParsedNatRule[];
  generateDeleteNatServerCommand: (rule: ParsedNatRule) => string;
  generateNatServerCommand: (rule: ParsedNatRule) => string;
  generateBatchUpdateIPCommands: (
    rules: ParsedNatRule[],
    newGlobalIp: string,
    deviceRules?: ParsedNatRule[]
  ) => string[];
};

export type ManualConfirmationOutcome = 'confirmed' | 'rejected' | 'timeout' | 'cancelled';

export class ManualConfirmationRequestController {
  private cancelPending: (() => void) | null = null;

  /** Only an explicit "no" maps to 'rejected'; timeouts and cancellations stay distinguishable. */
  request(
    isCancelled: () => boolean,
    emitRequest: (respond: (confirmed: boolean, reason?: 'timeout' | 'cancelled') => void) => void
  ): Promise<ManualConfirmationOutcome> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (confirmed: boolean, reason?: 'timeout' | 'cancelled') => {
        if (settled) {
          return;
        }

        settled = true;
        if (this.cancelPending === cancel) {
          this.cancelPending = null;
        }
        resolve(confirmed ? 'confirmed' : (reason ?? 'rejected'));
      };
      const cancel = () => settle(false, 'cancelled');

      this.cancelPending = cancel;
      if (isCancelled()) {
        cancel();
        return;
      }

      emitRequest(settle);
    });
  }

  cancel(): void {
    this.cancelPending?.();
  }
}

// Notification-only and IP-detection settings never change what an in-flight batch writes.
const NON_WRITE_CONFIG_KEYS = new Set([
  'windowsNotifyEnabled',
  'notifyTypes',
  'checkInterval',
  'confirmCount',
  'checkSources',
]);

/** O(keys) comparison; values are small config scalars/arrays compared structurally. */
export const hasWriteRelevantConfigChange = (previous: object, next: object): boolean => {
  const before = new Map(Object.entries(previous));
  const after = new Map(Object.entries(next));
  return [...new Set([...before.keys(), ...after.keys()])].some(
    (key) =>
      !NON_WRITE_CONFIG_KEYS.has(key) &&
      JSON.stringify(before.get(key)) !== JSON.stringify(after.get(key))
  );
};

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const isValidIPv4 = (ip: string): boolean => {
  const match = ip.match(IPV4_PATTERN);
  if (!match) {
    return false;
  }

  for (let index = 1; index <= 4; index += 1) {
    const octet = parseInt(match[index], 10);
    if (octet < 0 || octet > 255) {
      return false;
    }
  }

  return true;
};

const normalizeNatProtocol = (protocol: string): ParsedNatRule['protocol'] => {
  const normalized = protocol.toUpperCase();

  if (normalized === 'TCP' || normalized === 'UDP' || normalized === 'ALL') {
    return normalized;
  }

  return normalized as ParsedNatRule['protocol'];
};

const hasSameRuleIdentity = (left: ParsedNatRule, right: ParsedNatRule): boolean =>
  left.ruleName === right.ruleName ||
  (left.addSyntax === 'endpoint' &&
    right.addSyntax === 'endpoint' &&
    left.protocol.toUpperCase() === right.protocol.toUpperCase() &&
    left.globalPort === right.globalPort &&
    left.insideIp === right.insideIp &&
    left.insidePort === right.insidePort);

export const parseScheduledTimeParts = (
  scheduledTime: string
): { hour: number; minute: number } | null => {
  const [hourStr, minuteStr] = scheduledTime.split(':');
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);

  if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return { hour, minute };
};

export const collectIntegrityCheckIssues = (
  rules: readonly AutomationRuleLike[],
  newIP: string
): string[] => {
  const issues: string[] = [];
  const ruleKeys = new Map<string, string[]>();

  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }

    const key = `${rule.protocol}:${newIP}:${rule.globalPort}`;
    if (!ruleKeys.has(key)) {
      ruleKeys.set(key, []);
    }
    ruleKeys.get(key)?.push(rule.ruleName || '未命名规则');
  }

  for (const [key, ruleNames] of ruleKeys.entries()) {
    if (ruleNames.length > 1) {
      issues.push(`规则冲突: ${ruleNames.join(', ')} 使用相同的 ${key}`);
    }
  }

  if (!isValidIPv4(newIP)) {
    issues.push(`IP地址格式无效: ${newIP}`);
  }

  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }

    const globalPort = parseInt(rule.globalPort || '', 10);
    if (isNaN(globalPort) || globalPort < 1 || globalPort > 65535) {
      issues.push(`规则 ${rule.ruleName} 端口无效: ${rule.globalPort}`);
    }

    const insidePort = parseInt(rule.insidePort || '', 10);
    if (isNaN(insidePort) || insidePort < 1 || insidePort > 65535) {
      issues.push(`规则 ${rule.ruleName} 内网端口无效: ${rule.insidePort}`);
    }
  }

  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }

    if (!isValidIPv4(rule.insideIp || '')) {
      issues.push(`规则 ${rule.ruleName} 内网IP格式无效: ${rule.insideIp}`);
    }
  }

  const ruleNameCounts = new Map<string, number>();
  for (const rule of rules) {
    if (!rule.ruleName) {
      continue;
    }
    ruleNameCounts.set(rule.ruleName, (ruleNameCounts.get(rule.ruleName) || 0) + 1);
  }

  for (const [ruleName, count] of ruleNameCounts.entries()) {
    if (count > 1) {
      issues.push(`规则名称重复: ${ruleName} (${count}次)`);
    }
  }

  return issues;
};

export const createRuleSnapshots = (
  rules: readonly AutomationRuleWithIdLike[]
): AutomationRuleWithIdLike[] =>
  rules.map((rule) => ({
    id: rule.id,
    ruleName: rule.ruleName,
    protocol: rule.protocol,
    globalIp: rule.globalIp,
    globalPort: rule.globalPort,
    insideIp: rule.insideIp,
    insidePort: rule.insidePort,
    enabled: rule.enabled,
    noReverse: rule.noReverse || false,
    ...(rule.addSyntax ? { addSyntax: rule.addSyntax } : {}),
  }));

export const createNatRulePayloads = (
  rules: readonly AutomationRulePayloadInput[]
): ParsedNatRule[] =>
  rules.map((rule) => ({
    ruleName: rule.ruleName,
    protocol: normalizeNatProtocol(rule.protocol),
    globalIp: rule.globalIp,
    globalPort: rule.globalPort,
    insideIp: rule.insideIp,
    insidePort: rule.insidePort,
    enabled: rule.enabled,
    noReverse: rule.noReverse || false,
    ...(rule.addSyntax ? { addSyntax: rule.addSyntax } : {}),
  }));

export const buildBatchUpdateIPCommands = (
  rules: readonly AutomationRulePayloadInput[],
  newIP: string,
  deviceNatConfigOutput: string | null | undefined,
  commandBuilder: BatchUpdateIPCommandBuilder
): string[] => {
  if (deviceNatConfigOutput == null) {
    throw new Error('未获取到设备当前NAT规则，已停止批量更新');
  }

  const deviceRules = deviceNatConfigOutput?.trim()
    ? commandBuilder.parseNatServerList(deviceNatConfigOutput)
    : [];

  return commandBuilder.generateBatchUpdateIPCommands(
    createNatRulePayloads(rules),
    newIP,
    deviceRules
  );
};

export const shouldScheduleDailyUpdate = (config: {
  autoUpdateEnabled?: boolean | null;
  triggerType?: string | null;
  scheduledTime?: string | null;
}): boolean =>
  config.autoUpdateEnabled === true &&
  config.triggerType === 'scheduled' &&
  Boolean(config.scheduledTime);

export const shouldClearPendingUpdateTasks = (
  previousConfig: {
    autoUpdateEnabled?: boolean | null;
    triggerType?: string | null;
    scheduledTime?: string | null;
  },
  nextConfig: {
    autoUpdateEnabled?: boolean | null;
    triggerType?: string | null;
    scheduledTime?: string | null;
  }
): boolean =>
  previousConfig.autoUpdateEnabled !== nextConfig.autoUpdateEnabled ||
  previousConfig.triggerType !== nextConfig.triggerType ||
  previousConfig.scheduledTime !== nextConfig.scheduledTime;

export const shouldClearPendingScheduledIP = (
  previousConfig: {
    autoUpdateEnabled?: boolean | null;
    triggerType?: string | null;
  },
  nextConfig: {
    autoUpdateEnabled?: boolean | null;
    triggerType?: string | null;
  }
): boolean =>
  previousConfig.autoUpdateEnabled === true &&
  previousConfig.triggerType === 'scheduled' &&
  (nextConfig.autoUpdateEnabled !== true || nextConfig.triggerType !== 'scheduled');

export const buildScopedRollbackCommands = (
  oldRules: readonly AutomationRuleWithIdLike[],
  currentDeviceNatConfigOutput: string | null | undefined,
  commandBuilder: BatchUpdateIPCommandBuilder
): string[] => {
  const parsedOldRules = createNatRulePayloads(oldRules);
  const currentDeviceRules = currentDeviceNatConfigOutput?.trim()
    ? commandBuilder.parseNatServerList(currentDeviceNatConfigOutput)
    : [];
  const commands: string[] = ['system-view'];

  for (const oldRule of parsedOldRules) {
    const currentRule = currentDeviceRules.find((rule) => hasSameRuleIdentity(rule, oldRule));
    if (currentRule) {
      commands.push(commandBuilder.generateDeleteNatServerCommand(currentRule));
    }

    if (oldRule.enabled) {
      commands.push(
        commandBuilder.generateNatServerCommand({
          ...oldRule,
          addSyntax: currentRule?.addSyntax || oldRule.addSyntax,
        })
      );
    }
  }

  commands.push('quit');
  commands.push('save');
  commands.push('y');

  return commands;
};

export const getUpdatedRuleVerificationIssues = (
  expectedRules: readonly AutomationRulePayloadInput[],
  newIP: string,
  deviceNatConfigOutput: string | null | undefined,
  commandBuilder: Pick<BatchUpdateIPCommandBuilder, 'parseNatServerList'>
): string[] => {
  const deviceRules = deviceNatConfigOutput?.trim()
    ? commandBuilder.parseNatServerList(deviceNatConfigOutput)
    : [];
  const issues: string[] = [];

  for (const expectedRule of createNatRulePayloads(expectedRules)) {
    const updatedRule = { ...expectedRule, globalIp: newIP };
    const matchedRule = deviceRules.find((rule) => hasSameRuleIdentity(rule, updatedRule));

    if (
      !matchedRule ||
      matchedRule.globalIp !== newIP ||
      matchedRule.protocol.toUpperCase() !== updatedRule.protocol.toUpperCase() ||
      matchedRule.globalPort !== updatedRule.globalPort ||
      matchedRule.insideIp !== updatedRule.insideIp ||
      matchedRule.insidePort !== updatedRule.insidePort ||
      Boolean(matchedRule.noReverse) !== Boolean(updatedRule.noReverse) ||
      !matchedRule.enabled
    ) {
      issues.push(`规则 ${expectedRule.ruleName} 未在设备上生效`);
    }
  }

  return issues;
};

export const assertRuleVerificationSucceeded = (verified: boolean): void => {
  if (!verified) {
    throw new Error('Rule verification failed after device update');
  }
};

export class AutomationRunController {
  private generation = 0;
  private activeTask: Promise<unknown> | null = null;

  begin(): number {
    return this.generation;
  }

  isCancelled(token: number): boolean {
    return token !== this.generation;
  }

  track<T>(task: Promise<T>): Promise<T> {
    const trackedTask = task.finally(() => {
      if (this.activeTask === trackedTask) {
        this.activeTask = null;
      }
    });
    this.activeTask = trackedTask;
    return trackedTask;
  }

  async cancelAndWait(cancelPending?: () => void): Promise<void> {
    this.generation += 1;
    cancelPending?.();
    const activeTask = this.activeTask;
    if (activeTask) {
      await activeTask;
    }
  }
}
