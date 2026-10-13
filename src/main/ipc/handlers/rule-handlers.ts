import type { Device, NatRule, Prisma } from '@prisma/client';
import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { automationService } from '../../services/automation-service';
import { credentialManager } from '../../services/credential-manager';
import { logger } from '../../services/logger';
import { notifier } from '../../services/notifier';
import { prisma } from '../../services/prisma-client';
import { sshManager } from '../../services/ssh-manager';
import { mandatoryUpdateBusinessGate } from '../../services/mandatory-update-business-gate';
import {
  assertNoNatEndpointConflicts,
  usgParser,
  type ParsedNatRule,
} from '../../services/usg-parser';
import {
  assertBatchUpdateIPInput,
  getRuleIdsOutsideDevice,
  replaceDeviceRuleSnapshot,
  getRuleSyncPreview,
  executeVerifiedRuleWrite,
  equalDeviceRules,
  getBatchIPTarget,
  splitSaveCommands,
} from './rule-handler-helpers';
import { assertSupportedDeviceAccess } from './shared';

type RuleWritePayload = {
  ruleName: string;
  protocol: ParsedNatRule['protocol'];
  globalIp: string;
  globalPort: string;
  insideIp: string;
  insidePort: string;
  enabled: boolean;
  description?: string | null;
  noReverse?: boolean | null;
};
type RuleUpdatePayload = Partial<RuleWritePayload>;
const assertRulePayload = (rule: RuleUpdatePayload) => {
  if (
    !rule ||
    typeof rule !== 'object' ||
    Object.keys(rule).some(
      (key) =>
        ![
          'ruleName',
          'protocol',
          'globalIp',
          'globalPort',
          'insideIp',
          'insidePort',
          'enabled',
          'description',
          'noReverse',
        ].includes(key)
    )
  )
    throw new Error('规则修改包含不支持的字段');
};
const toParsedRule = (rule: NatRule): ParsedNatRule => ({
  ...rule,
  protocol: rule.protocol as ParsedNatRule['protocol'],
  description: rule.description ?? undefined,
});
const deviceIdentity = (device: Device) => JSON.stringify([device.id, device.host, device.port]);
const guardedHandle = <Args extends unknown[], Result>(
  channel: string,
  action: (event: IpcMainInvokeEvent, ...args: Args) => Promise<Result>
) =>
  ipcMain.handle(channel, async (event, ...args: Args) => {
    const release = mandatoryUpdateBusinessGate.tryEnter();
    if (!release) throw new Error('业务操作暂时停止，请稍后重试');
    try {
      return await action(event, ...args);
    } finally {
      release();
    }
  });

const ensureConnected = async (device: Device) => {
  if (sshManager.isConnected(device.id)) return;
  const credential = await credentialManager.getCredential(device.id);
  if (!credential) throw new Error('未配置凭据');
  assertSupportedDeviceAccess(device, credential);
  const result = await sshManager.connect(device.id, {
    host: device.host,
    port: device.port,
    username: credential.username || 'admin',
    password: credential.password,
    privateKey: credential.privateKey,
    passphrase: credential.passphrase,
  });
  if (!result.success) throw new Error('连接失败: ' + result.message);
};
const readDeviceRules = async (device: Device): Promise<ParsedNatRule[]> => {
  await ensureConnected(device);
  const result = await sshManager.executeCommand(
    device.id,
    'display current-configuration | include nat server'
  );
  if (!result.success) throw new Error('设备配置读取失败: ' + (result.error || '未知错误'));
  return usgParser.parseNatServerSnapshot(result.output, result.complete === true);
};
const withDevice = async <T>(
  deviceId: string,
  action: (device: Device) => Promise<T>
): Promise<T> =>
  sshManager.withDeviceOperation(deviceId, async () => {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new Error('设备不存在');
    try {
      return await action(device);
    } finally {
      await sshManager.disconnect(deviceId);
    }
  });
const backupDevice = async (device: Device, before: ParsedNatRule[]): Promise<string> => {
  await ensureConnected(device);
  const result = await sshManager.executeCommand(device.id, 'display current-configuration');
  if (!result.success || !result.complete || !result.output.trim())
    throw new Error('变更前完整设备备份失败，已阻止下发');
  const backupRules = usgParser.parseNatServerSnapshot(
    result.output
      .split(/\r?\n/)
      .filter((line) => /^\s*nat\s+server\s/i.test(line))
      .join('\n'),
    true
  );
  if (!equalDeviceRules(before, backupRules)) throw new Error('备份时设备规则已变化，请重新预览');
  const id = 'manual-' + randomUUID();
  const dir = path.join(app.getPath('userData'), 'device-backups');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, id + '.json'),
    JSON.stringify(
      {
        deviceId: device.id,
        deviceName: device.name,
        createdAt: new Date().toISOString(),
        config: result.output,
        rules: before,
      },
      null,
      2
    ),
    { encoding: 'utf8', flag: 'wx', mode: 0o600 }
  );
  return id;
};
const writeDevice = async (
  device: Device,
  before: ParsedNatRule[],
  expected: ParsedNatRule[],
  commands: string[]
) => {
  const result = await executeVerifiedRuleWrite(before, expected, {
    backup: () => backupDevice(device, before),
    execute: async () => {
      await ensureConnected(device);
      return sshManager.executeBatchCommands(device.id, splitSaveCommands(commands));
    },
    read: () => readDeviceRules(device),
    save: async () => {
      await ensureConnected(device);
      return sshManager.executeBatchCommands(device.id, ['save', 'y']);
    },
    rollback: async (actual) => {
      const restore = splitSaveCommands(usgParser.generateSyncToDeviceCommands(actual, before));
      if (!restore.length) return { success: true };
      await ensureConnected(device);
      return sshManager.executeBatchCommands(device.id, restore);
    },
  });
  // Device rules changed outside automation; its next observation must re-read devices.
  automationService.invalidateAppliedState();
  if (result.status === 'verified')
    await logger.success('规则下发', result.message, {
      deviceId: device.id,
      backupId: result.backupId,
    });
  else if (result.status === 'unsaved')
    await logger.warning('规则下发', result.message, {
      deviceId: device.id,
      backupId: result.backupId,
    });
  else
    await logger.error('规则下发', result.message, {
      deviceId: device.id,
      status: result.status,
      backupId: result.backupId,
    });
  return result;
};

const batchPlan = async (device: Device, ruleIds: string[], newIP: string) => {
  assertBatchUpdateIPInput({ deviceId: device.id, ruleIds, newIP });
  const rules = await prisma.natRule.findMany({ where: { id: { in: ruleIds } } });
  if (rules.length !== new Set(ruleIds).size) throw new Error('部分所选规则不存在');
  if (getRuleIdsOutsideDevice(rules, device.id).length) throw new Error('所选规则不属于目标设备');
  const parsed = rules.map(toParsedRule);
  parsed.forEach((rule) => usgParser.assertWritableNatRule(rule));
  const enabled = parsed.filter((rule) => rule.enabled);
  const before = enabled.length ? await readDeviceRules(device) : [];
  const expected = getBatchIPTarget(before, parsed, newIP);
  assertNoNatEndpointConflicts(
    expected,
    expected.filter((rule) => !before.includes(rule))
  );
  const preview = getRuleSyncPreview(
    JSON.stringify([deviceIdentity(device), [...ruleIds].sort(), newIP, rules]),
    before,
    expected
  );
  return {
    rules,
    enabled,
    before,
    expected,
    preview: { ...preview, localOnlyCount: rules.length - enabled.length },
  };
};

export function registerRuleHandlers() {
  ipcMain.handle('rule:getAll', async (_event, deviceId: string) =>
    prisma.natRule.findMany({ where: { deviceId }, orderBy: { createdAt: 'desc' } })
  );
  ipcMain.handle('rule:getTotalCount', async () => prisma.natRule.count());

  guardedHandle('rule:syncFromDevice', async (_event, deviceId: string) =>
    withDevice(deviceId, async (device) => {
      const snapshot = await readDeviceRules(device);
      const saved = await replaceDeviceRuleSnapshot(prisma, deviceId, snapshot);
      await logger.success('获取规则', '完整设备快照已覆盖本地缓存：' + saved.length + ' 条规则', {
        deviceId,
      });
      return saved;
    })
  );
  guardedHandle('rule:previewSync', async (_event, deviceId: string) =>
    withDevice(deviceId, async (device) => {
      const deviceRules = await readDeviceRules(device);
      const localRules = (await prisma.natRule.findMany({ where: { deviceId } })).map(toParsedRule);
      localRules.forEach((rule) => usgParser.assertWritableNatRule(rule));
      // Builds the commands only to surface conflicts at preview time.
      usgParser.generateSyncToDeviceCommands(deviceRules, localRules);
      return getRuleSyncPreview(deviceIdentity(device), deviceRules, localRules);
    })
  );
  guardedHandle('rule:syncToDevice', async (_event, deviceId: string, token?: string) =>
    withDevice(deviceId, async (device) => {
      const localRules = (await prisma.natRule.findMany({ where: { deviceId } })).map(toParsedRule);
      localRules.forEach((rule) => usgParser.assertWritableNatRule(rule));
      const deviceRules = await readDeviceRules(device);
      const preview = getRuleSyncPreview(deviceIdentity(device), deviceRules, localRules);
      if (!token || token !== preview.token)
        throw new Error('规则或设备已变化，请重新预览并确认实际差异');
      const commands = usgParser.generateSyncToDeviceCommands(deviceRules, localRules);
      if (!commands.length)
        return {
          success: true,
          status: 'verified',
          syncedCount: 0,
          message: '回读确认规则已一致，无需下发',
          ...preview,
        };
      const result = await writeDevice(
        device,
        deviceRules,
        localRules.filter((rule) => rule.enabled),
        commands
      );
      return {
        ...result,
        ...preview,
        syncedCount: result.success ? localRules.filter((rule) => rule.enabled).length : 0,
      };
    })
  );

  guardedHandle(
    'rule:previewBatchUpdateIP',
    async (_event, deviceId: string, ruleIds: string[], newIP: string) =>
      withDevice(deviceId, async (device) => (await batchPlan(device, ruleIds, newIP)).preview)
  );

  guardedHandle(
    'rule:batchUpdateIP',
    async (_event, deviceId: string, ruleIds: string[], newIP: string, token?: string) =>
      withDevice(deviceId, async (device) => {
        const { rules, enabled, before, expected, preview } = await batchPlan(
          device,
          ruleIds,
          newIP
        );
        if (!token || token !== preview.token)
          throw new Error('规则或设备已变化，请重新预览并确认实际差异');
        if (!enabled.length) {
          await prisma.natRule.updateMany({
            where: { id: { in: ruleIds }, deviceId },
            data: { globalIp: newIP },
          });
          return {
            success: true,
            status: 'local-only',
            updated: rules.length,
            message: '已修改 ' + rules.length + ' 条禁用规则的本地待下发配置，未向设备发送命令',
          };
        }
        const commands = usgParser.generateBatchUpdateIPCommands(enabled, newIP, before);
        const result = await writeDevice(device, before, expected, commands);
        if (result.success) {
          try {
            await prisma.natRule.updateMany({
              where: { id: { in: ruleIds }, deviceId },
              data: { globalIp: newIP },
            });
          } catch (error) {
            const message =
              '设备配置已变更并核验，但本地缓存保存失败，请依据备份检查并重新获取设备规则。' +
              (error instanceof Error ? error.message : String(error));
            await logger.error('规则下发', message, { deviceId, backupId: result.backupId });
            return {
              ...result,
              success: false,
              status: 'partial',
              message,
              updated: 0,
              localOnlyCount: rules.length - enabled.length,
            };
          }
          try {
            if (result.status === 'verified')
              await notifier.notifyUpdateSuccess(device.name, enabled.length);
          } catch (error) {
            await logger.warning('规则通知', '配置已核验，但通知发送失败', {
              deviceId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        return {
          ...result,
          updated: result.success ? rules.length : 0,
          localOnlyCount: rules.length - enabled.length,
        };
      })
  );

  guardedHandle('rule:create', async (_event, deviceId: string, rule: RuleWritePayload) =>
    sshManager.withDeviceOperation(deviceId, async () => {
      assertRulePayload(rule);
      const candidate = {
        ...rule,
        noReverse: rule.noReverse ?? false,
        description: rule.description ?? undefined,
      };
      usgParser.assertWritableNatRule(candidate);
      const others = await prisma.natRule.findMany({ where: { deviceId } });
      assertNoNatEndpointConflicts([...others.map(toParsedRule), candidate], [candidate]);
      const saved = await prisma.natRule.create({
        data: { ...rule, noReverse: rule.noReverse ?? undefined, deviceId },
      });
      await logger.info('本地规则', '规则已保存为待下发配置', {
        deviceId,
        ruleName: saved.ruleName,
      });
      return saved;
    })
  );
  guardedHandle('rule:update', async (_event, id: string, rule: RuleUpdatePayload) => {
    assertRulePayload(rule);
    const { deviceId } = await prisma.natRule.findUniqueOrThrow({ where: { id } });
    return sshManager.withDeviceOperation(deviceId, async () => {
      const existing = await prisma.natRule.findUniqueOrThrow({ where: { id } });
      const candidate = toParsedRule({
        ...existing,
        ...rule,
        noReverse: rule.noReverse ?? existing.noReverse,
      });
      usgParser.assertWritableNatRule(candidate);
      const others = await prisma.natRule.findMany({ where: { deviceId, id: { not: id } } });
      assertNoNatEndpointConflicts([...others.map(toParsedRule), candidate], [candidate]);
      const saved = await prisma.natRule.update({
        where: { id },
        data: { ...rule, noReverse: rule.noReverse ?? undefined },
      });
      await logger.info('本地规则', '规则修改已保存为待下发配置', { ruleId: id });
      return saved;
    });
  });
  guardedHandle('rule:delete', async (_event, id: string) => {
    const existing = await prisma.natRule.findUniqueOrThrow({ where: { id } });
    return sshManager.withDeviceOperation(existing.deviceId, async () => {
      await prisma.natRule.delete({ where: { id } });
      await logger.info('本地规则', '已从本地待下发配置删除；设备需确认同步后删除', { ruleId: id });
    });
  });
  guardedHandle(
    'rule:batchUpdate',
    async (_event, ruleIds: string[], updates: Prisma.NatRuleUpdateManyMutationInput) => {
      if (Object.keys(updates).some((key) => !['enabled', 'description'].includes(key)))
        throw new Error('批量本地修改仅支持启停与描述');
      const rows = await prisma.natRule.findMany({ where: { id: { in: ruleIds } } });
      if (
        !rows.length ||
        rows.length !== new Set(ruleIds).size ||
        new Set(rows.map((rule) => rule.deviceId)).size !== 1
      )
        throw new Error('请选择同一设备的有效规则');
      return sshManager.withDeviceOperation(rows[0].deviceId, async () => {
        await prisma.natRule.updateMany({ where: { id: { in: ruleIds } }, data: updates });
        await logger.info('本地规则', '批量修改已保存为待下发配置', { count: rows.length });
        return { success: true, count: rows.length };
      });
    }
  );
}
