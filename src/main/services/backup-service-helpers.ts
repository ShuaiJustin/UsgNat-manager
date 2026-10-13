import type { Config, CredentialRef, Device, Log, NatRule, PrismaClient } from '@prisma/client';

// 与 config-service-helpers 的 SSH_HOST_KEY_PREFIX 一致（helpers 间不做运行时 import）。
const SSH_HOST_KEY_PREFIX = 'ssh-host:';

export interface BackupData {
  devices: Device[];
  rules: NatRule[];
  logs: Log[];
  configs: Config[];
  credentials: CredentialRef[];
}

export async function replaceBackupData(client: PrismaClient, data: BackupData): Promise<void> {
  // SSH 主机指纹只能经首次信任流程写入：恢复时跳过备份中的指纹并保留本机已有指纹。
  const configs = data.configs.filter((config) => !config.key.startsWith(SSH_HOST_KEY_PREFIX));
  await client.$transaction(
    async (tx) => {
      await tx.natRule.deleteMany({});
      await tx.credentialRef.deleteMany({});
      await tx.device.deleteMany({});
      await tx.log.deleteMany({});
      await tx.config.deleteMany({
        where: { NOT: { key: { startsWith: SSH_HOST_KEY_PREFIX } } },
      });
      if (data.devices.length) await tx.device.createMany({ data: data.devices });
      if (data.rules.length) await tx.natRule.createMany({ data: data.rules });
      if (data.credentials.length) await tx.credentialRef.createMany({ data: data.credentials });
      if (data.logs.length) await tx.log.createMany({ data: data.logs });
      if (configs.length) await tx.config.createMany({ data: configs });
    },
    { timeout: 30000 }
  );
}

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
type FieldType =
  | 'string'
  | 'nullableString'
  | 'boolean'
  // Added after older backups were written; missing means false.
  | 'optionalBoolean'
  | 'port'
  | 'date'
  | 'nullableDate';
const dates = { createdAt: 'date', updatedAt: 'date' } as const;
const schemas: Record<keyof BackupData, Record<string, FieldType>> = {
  devices: {
    id: 'string',
    name: 'string',
    host: 'string',
    port: 'port',
    connectionType: 'string',
    description: 'nullableString',
    enabled: 'boolean',
    online: 'boolean',
    lastConnected: 'nullableDate',
    ...dates,
  },
  rules: {
    id: 'string',
    deviceId: 'string',
    ruleName: 'string',
    protocol: 'string',
    globalIp: 'string',
    globalPort: 'string',
    insideIp: 'string',
    insidePort: 'string',
    enabled: 'boolean',
    description: 'nullableString',
    noReverse: 'boolean',
    unrRoute: 'optionalBoolean',
    ...dates,
  },
  logs: {
    id: 'string',
    level: 'string',
    operation: 'string',
    message: 'string',
    details: 'nullableString',
    createdAt: 'date',
  },
  configs: { id: 'string', key: 'string', value: 'string', ...dates },
  credentials: {
    id: 'string',
    deviceId: 'string',
    authType: 'string',
    username: 'nullableString',
    secretRef: 'nullableString',
    privateKey: 'nullableString',
    certificate: 'nullableString',
    mfaType: 'nullableString',
    ...dates,
  },
};

/** O(n) validation using sets for identifiers and ownership references. No data is deleted here. */
export function validateBackupPayload(payload: unknown): {
  data: BackupData;
  keyFingerprint?: string;
} {
  if (
    !record(payload) ||
    !['1.0.2', '1.1.0'].includes(String(payload.version)) ||
    !record(payload.data)
  ) {
    throw new Error('无效的备份文件格式或版本');
  }
  const result: Partial<BackupData> = {};
  for (const [table, schema] of Object.entries(schemas)) {
    const rows = payload.data[table];
    if (!Array.isArray(rows)) throw new Error(`备份缺少完整数据表: ${table}`);
    const ids = new Set<string>();
    const output = rows.map((row: unknown) => {
      if (!record(row) || Object.keys(row).some((key) => !(key in schema)))
        throw new Error(`备份字段无效: ${table}`);
      const normalized: RecordValue = {};
      for (const [field, type] of Object.entries(schema)) {
        const value = row[field];
        if (type === 'optionalBoolean' && value === undefined) {
          normalized[field] = false;
          continue;
        }
        const nullable = type.startsWith('nullable');
        if (value === null && nullable) {
          normalized[field] = null;
          continue;
        }
        let valid = false;
        if (type === 'string' || type === 'nullableString') valid = typeof value === 'string';
        if (type === 'boolean' || type === 'optionalBoolean') valid = typeof value === 'boolean';
        if (type === 'port')
          valid =
            typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535;
        if (type === 'date' || type === 'nullableDate') {
          valid =
            (typeof value === 'string' || value instanceof Date) &&
            !Number.isNaN(new Date(value as string | Date).getTime());
        }
        if (!valid) throw new Error(`备份字段类型无效: ${table}.${field}`);
        normalized[field] =
          type === 'date' || type === 'nullableDate' ? new Date(value as string | Date) : value;
      }
      if (!normalized.id || ids.has(normalized.id as string))
        throw new Error(`备份重复或空标识: ${table}`);
      ids.add(normalized.id as string);
      return normalized;
    });
    (result as RecordValue)[table] = output;
  }
  const data = result as BackupData;
  const devices = new Set(data.devices.map((device) => device.id));
  const uniqueRules = new Set<string>();
  for (const rule of data.rules) {
    const unique = JSON.stringify([rule.deviceId, rule.ruleName]);
    if (
      !devices.has(rule.deviceId) ||
      uniqueRules.has(unique) ||
      !rule.ruleName ||
      !['TCP', 'UDP', 'ALL'].includes(rule.protocol)
    )
      throw new Error('备份规则关联、名称或协议无效');
    uniqueRules.add(unique);
  }
  const credentialDevices = new Set<string>();
  for (const credential of data.credentials) {
    if (
      !devices.has(credential.deviceId) ||
      credentialDevices.has(credential.deviceId) ||
      !['Password', 'PrivateKey', 'Certificate', 'MultiFactor'].includes(credential.authType)
    )
      throw new Error('备份凭据关联或认证类型无效');
    credentialDevices.add(credential.deviceId);
  }
  const configKeys = new Set<string>();
  for (const config of data.configs) {
    if (!config.key || configKeys.has(config.key)) throw new Error('备份配置键重复或无效');
    configKeys.add(config.key);
    try {
      JSON.parse(config.value);
    } catch {
      throw new Error(`备份配置JSON无效: ${config.key}`);
    }
  }
  if (data.logs.some((log) => !['INFO', 'SUCCESS', 'WARNING', 'ERROR'].includes(log.level)))
    throw new Error('备份日志级别无效');
  const protection = payload.protection;
  if (
    protection !== undefined &&
    (!record(protection) ||
      typeof protection.keyFingerprint !== 'string' ||
      !/^[a-f\d]{64}$/i.test(protection.keyFingerprint))
  )
    throw new Error('备份密钥指纹无效');
  return {
    data,
    keyFingerprint: record(protection) ? (protection.keyFingerprint as string) : undefined,
  };
}
