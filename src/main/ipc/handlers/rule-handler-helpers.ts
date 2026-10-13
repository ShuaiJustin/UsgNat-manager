import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { ParsedNatRule } from '../../services/usg-parser';

const isEndpointRule = (rule: ParsedNatRule) =>
  rule.addSyntax === 'endpoint' ||
  (!rule.addSyntax && /^NAT_(?:\d{1,3}\.){3}\d{1,3}_\S+$/.test(rule.ruleName));
const endpointKey = (rule: {
  protocol: string;
  globalIp: string;
  globalPort: string;
  insideIp: string;
  insidePort: string;
}) =>
  JSON.stringify([
    rule.protocol.toUpperCase(),
    rule.globalIp,
    rule.globalPort,
    rule.insideIp,
    rule.insidePort,
  ]);
const syncRuleKey = (rule: ParsedNatRule) =>
  isEndpointRule(rule)
    ? `NAT_${rule.globalIp}_${rule.globalPort}_${rule.protocol.toUpperCase()}`
    : rule.ruleName;

export const replaceDeviceRuleSnapshot = async (
  database: Pick<PrismaClient, '$transaction'>,
  deviceId: string,
  rules: ParsedNatRule[]
) =>
  database.$transaction(async (tx) => {
    const existing = await tx.natRule.findMany({ where: { deviceId } });
    const names = new Map(existing.map((rule) => [rule.ruleName, rule]));
    const endpoints = new Map(
      existing
        .filter((rule) => /^NAT_(?:\d{1,3}\.){3}\d{1,3}_\S+$/.test(rule.ruleName))
        .map((rule) => [endpointKey(rule), rule])
    );
    const matches = rules.map(
      (rule) =>
        names.get(rule.ruleName) ||
        (rule.addSyntax === 'endpoint' ? endpoints.get(endpointKey(rule)) : undefined)
    );
    // Disabled rules exist only locally (the device has no disabled state), so a device read
    // must not erase them.
    await tx.natRule.deleteMany({
      where: {
        deviceId,
        enabled: true,
        id: { notIn: matches.flatMap((rule) => (rule ? [rule.id] : [])) },
      },
    });
    const saved = [];
    for (const [index, rule] of rules.entries()) {
      const { addSyntax: _addSyntax, ...values } = rule;
      const data = {
        ...values,
        noReverse: values.noReverse ?? false,
        unrRoute: values.unrRoute ?? false,
      };
      saved.push(
        await tx.natRule.upsert({
          where: matches[index]
            ? { id: matches[index]!.id }
            : { deviceId_ruleName: { deviceId, ruleName: rule.ruleName } },
          update: data,
          create: { ...data, deviceId },
        })
      );
    }
    return saved;
  });

const canonicalRule = (rule: ParsedNatRule) => [
  isEndpointRule(rule) ? '' : rule.ruleName,
  rule.protocol.toUpperCase(),
  rule.globalIp,
  rule.globalPort,
  rule.insideIp,
  rule.insidePort,
  Boolean(rule.noReverse),
  Boolean(rule.unrRoute),
];
const canonicalRules = (rules: ParsedNatRule[]) =>
  rules
    .filter((rule) => rule.enabled)
    .map(canonicalRule)
    .map((rule) => JSON.stringify(rule))
    .sort();
export const equalDeviceRules = (left: ParsedNatRule[], right: ParsedNatRule[]) =>
  JSON.stringify(canonicalRules(left)) === JSON.stringify(canonicalRules(right));
const describeRule = (rule: ParsedNatRule) =>
  `${rule.ruleName}: ${rule.protocol} ${rule.globalIp}:${rule.globalPort} → ${rule.insideIp}:${rule.insidePort}${rule.noReverse ? ' no-reverse' : ''}${rule.unrRoute ? ' unr-route' : ''}`;

export const getBatchIPTarget = (
  before: ParsedNatRule[],
  selected: ParsedNatRule[],
  newIP: string
): ParsedNatRule[] => {
  const result = [...before];
  for (const rule of selected.filter((item) => item.enabled)) {
    const endpointIndex = result.findIndex(
      (candidate) =>
        candidate.protocol.toUpperCase() === rule.protocol.toUpperCase() &&
        candidate.globalIp === rule.globalIp &&
        candidate.globalPort === rule.globalPort &&
        candidate.insideIp === rule.insideIp &&
        candidate.insidePort === rule.insidePort
    );
    const index =
      endpointIndex >= 0
        ? endpointIndex
        : result.findIndex((candidate) => candidate.ruleName === rule.ruleName);
    const onDevice = index >= 0 ? result[index] : undefined;
    if (index >= 0) result.splice(index, 1);
    // Mirrors generateBatchUpdateIPCommands: options are kept as the device has them.
    result.push({
      ...rule,
      globalIp: newIP,
      ...(onDevice
        ? { noReverse: Boolean(onDevice.noReverse), unrRoute: Boolean(onDevice.unrRoute) }
        : {}),
    });
  }
  return result;
};

export const getRuleSyncPreview = (
  deviceIdentity: string,
  deviceRules: ParsedNatRule[],
  localRules: ParsedNatRule[]
) => {
  const device = new Map(deviceRules.map((rule) => [syncRuleKey(rule), rule]));
  const local = new Map(
    localRules.filter((rule) => rule.enabled).map((rule) => [syncRuleKey(rule), rule])
  );
  const added = [...local]
    .filter(([name]) => !device.has(name))
    .map(([, rule]) => describeRule(rule));
  const deleted = [...device]
    .filter(([name]) => !local.has(name))
    .map(([, rule]) => describeRule(rule));
  const updated = [...local]
    .filter(([name, rule]) => device.has(name) && !equalDeviceRules([rule], [device.get(name)!]))
    .map(([name, rule]) => `${describeRule(device.get(name)!)} → ${describeRule(rule)}`);
  const token = createHash('sha256')
    .update(
      JSON.stringify([
        deviceIdentity,
        [...deviceRules].sort((a, b) => a.ruleName.localeCompare(b.ruleName)),
        [...localRules].sort((a, b) => a.ruleName.localeCompare(b.ruleName)),
      ])
    )
    .digest('hex');
  return { added, deleted, updated, token };
};

// Generated batches end with `quit, save, y`; the save is split off so it only runs after verification.
export const splitSaveCommands = (commands: string[]): string[] =>
  commands.length >= 2 && commands.at(-2) === 'save' && commands.at(-1) === 'y'
    ? commands.slice(0, -2)
    : commands;

export type RuleWriteResult = {
  success: boolean;
  // unsaved: running config verified but `save` failed, so a device reboot would revert it.
  status: 'verified' | 'unsaved' | 'failed' | 'partial' | 'unknown';
  message: string;
  backupId: string;
};
export const executeVerifiedRuleWrite = async (
  before: ParsedNatRule[],
  expected: ParsedNatRule[],
  effects: {
    backup: () => Promise<string>;
    execute: () => Promise<{ success: boolean; error?: string }>;
    read: () => Promise<ParsedNatRule[]>;
    // Persists running config; only called after read-back matches the target.
    save?: () => Promise<{ success: boolean; error?: string }>;
    // Restores the running config to `before`; nothing was saved, so startup config is untouched.
    rollback?: (actual: ParsedNatRule[]) => Promise<{ success: boolean; error?: string }>;
  }
): Promise<RuleWriteResult> => {
  const backupId = await effects.backup();
  const attempt = async (run: () => Promise<{ success: boolean; error?: string }>) => {
    try {
      return await run();
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
  const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const execution = await attempt(effects.execute);
  let actual: ParsedNatRule[];
  try {
    actual = await effects.read();
  } catch (error) {
    return {
      success: false,
      status: 'unknown',
      message: `设备结果未知，禁止按成功处理。${errorText(error)}`,
      backupId,
    };
  }
  // Read-back is the source of truth: a channel error after every command applied is still a success.
  if (equalDeviceRules(actual, expected)) {
    const saved = effects.save ? await attempt(effects.save) : { success: true };
    const channelNote = execution.success ? '' : `（执行通道曾报错：${execution.error || '未知'}）`;
    return saved.success
      ? {
          success: true,
          status: 'verified',
          message: `设备配置已回读核验并保存${channelNote}；公网业务可达性需另外验证`,
          backupId,
        }
      : {
          success: true,
          status: 'unsaved',
          message: `设备运行配置已回读核验，但保存失败，设备重启后变更会丢失，请在设备上手动执行 save。${saved.error || ''}`,
          backupId,
        };
  }
  const reason = execution.error || '回读配置与目标不一致';
  if (equalDeviceRules(actual, before))
    return { success: false, status: 'failed', message: `变更未生效。${reason}`, backupId };
  if (!effects.rollback)
    return {
      success: false,
      status: 'partial',
      message: `设备配置部分变更，请依据备份检查设备。${reason}`,
      backupId,
    };
  const rollback = await attempt(() => effects.rollback!(actual));
  const rollbackNote = rollback.error ? `；回滚：${rollback.error}` : '';
  try {
    if (equalDeviceRules(await effects.read(), before))
      return {
        success: false,
        status: 'failed',
        message: `变更失败，已自动回滚到变更前的规则。${reason}`,
        backupId,
      };
  } catch (error) {
    return {
      success: false,
      status: 'unknown',
      message: `设备配置部分变更，已执行自动回滚但回读失败，请依据备份检查设备。${reason}${rollbackNote}；回读：${errorText(error)}`,
      backupId,
    };
  }
  return {
    success: false,
    status: 'partial',
    message: `设备配置部分变更且自动回滚未完成，请依据备份检查设备。${reason}${rollbackNote}`,
    backupId,
  };
};

type RuleDeviceLike = {
  id: string;
  deviceId: string;
};

const IPV4_PATTERN = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;

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

export const assertBatchUpdateIPInput = ({
  deviceId,
  ruleIds,
  newIP,
}: {
  deviceId: string;
  ruleIds: readonly string[];
  newIP: string;
}): void => {
  if (!deviceId) {
    throw new Error('deviceId is required');
  }

  if (ruleIds.length === 0) {
    throw new Error('At least one rule must be selected');
  }

  if (!isValidIPv4(newIP)) {
    throw new Error(`Invalid IP address: ${newIP}`);
  }
};

export const getRuleIdsOutsideDevice = (
  rules: readonly RuleDeviceLike[],
  deviceId: string
): string[] => rules.filter((rule) => rule.deviceId !== deviceId).map((rule) => rule.id);

export type RuleSyncState =
  | 'synced'
  | 'pendingAdd'
  | 'pendingChange'
  | 'pendingRemove'
  | 'localDisabled';

// Classifies each saved rule against a fresh device read, using the same keys and equality as
// the sync preview so the page and "push to device" always agree. O(local + device).
export const compareLocalWithDevice = <T extends ParsedNatRule & { id: string }>(
  deviceRules: ParsedNatRule[],
  localRules: T[]
): { states: Record<string, RuleSyncState>; deviceOnly: ParsedNatRule[] } => {
  const device = new Map(deviceRules.map((rule) => [syncRuleKey(rule), rule]));
  const matched = new Set<string>();
  const states: Record<string, RuleSyncState> = {};
  // A disabled rule only asks for removal when no enabled local rule keeps the same key, as the
  // push itself only considers enabled rules.
  const enabledKeys = new Set(localRules.filter((rule) => rule.enabled).map(syncRuleKey));
  for (const rule of localRules) {
    const key = syncRuleKey(rule);
    const onDevice = device.get(key);
    if (onDevice) matched.add(key);
    states[rule.id] = !rule.enabled
      ? onDevice && !enabledKeys.has(key)
        ? 'pendingRemove'
        : 'localDisabled'
      : !onDevice
        ? 'pendingAdd'
        : equalDeviceRules([rule], [onDevice])
          ? 'synced'
          : 'pendingChange';
  }
  return {
    states,
    // On the device but not saved here: removed locally, or added directly on the firewall.
    deviceOnly: [...device].filter(([key]) => !matched.has(key)).map(([, rule]) => rule),
  };
};
