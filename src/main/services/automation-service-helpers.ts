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
  (left.protocol.toUpperCase() === right.protocol.toUpperCase() &&
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

export const resolveScheduledUpdateIP = (
  pendingIP: string | null | undefined,
  currentIP: string | null | undefined
): string | null => pendingIP || currentIP || null;

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

    if (!matchedRule || matchedRule.globalIp !== newIP) {
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
