type ConfigEntryLike = {
  key: string;
  value: string;
};

type ConfigStatLike = {
  key: string;
  updatedAt: Date | null;
};

type UnknownRecord = Record<string, unknown>;
type AuthWithPasswordRecord = UnknownRecord & {
  auth: UnknownRecord & {
    pass: string;
  };
};

export const CONFIG_TYPES = [
  'automation',
  'notification',
  'email',
  'wechat',
  'system',
  'appearance',
  'app',
  'update',
] as const;

export type ConfigType = (typeof CONFIG_TYPES)[number];

export const isConfigType = (value: unknown): value is ConfigType =>
  typeof value === 'string' && (CONFIG_TYPES as readonly string[]).includes(value);

export const assertConfigType: (value: unknown) => asserts value is ConfigType = (value) => {
  if (!isConfigType(value)) throw new Error(`未知配置类型: ${String(value)}`);
};

/** SSH 主机指纹只能由 SSH 首次信任流程写入，导入/恢复/重置都不得触碰。 */
export const SSH_HOST_KEY_PREFIX = 'ssh-host:';
export const isSshHostKeyConfig = (key: string): boolean => key.startsWith(SSH_HOST_KEY_PREFIX);

const MASKED_EXPORT_PASSWORD = '***masked***';
const EXPORT_WARNING = 'This export may contain sensitive configuration. Keep it secure.';

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null;

const hasAuthPassword = (value: unknown): value is AuthWithPasswordRecord =>
  isRecord(value) &&
  isRecord(value.auth) &&
  typeof value.auth.pass === 'string' &&
  value.auth.pass.length > 0;

export const parseStoredConfigs = (
  configs: readonly ConfigEntryLike[]
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  for (const config of configs) {
    try {
      result[config.key] = JSON.parse(config.value);
    } catch {
      result[config.key] = config.value;
    }
  }

  return result;
};

export const createConfigExportPayload = (
  configs: Record<string, unknown>,
  exportTime = new Date().toISOString()
) => {
  // Host-key trust and stale keys are machine-local state, never part of a portable export.
  const safeConfigs: Record<string, unknown> = Object.fromEntries(
    Object.entries(configs).filter(([key]) => isConfigType(key))
  );

  if (hasAuthPassword(safeConfigs.email)) {
    safeConfigs.email = {
      ...safeConfigs.email,
      auth: {
        ...safeConfigs.email.auth,
        pass: MASKED_EXPORT_PASSWORD,
      },
    };
  }

  return {
    version: '1.0.2',
    exportTime,
    configs: safeConfigs,
    warning: EXPORT_WARNING,
  };
};

export const summarizeConfigStats = (configs: readonly ConfigStatLike[]) => ({
  total: configs.length,
  types: configs.map((config) => config.key),
  lastUpdated: configs[0]?.updatedAt || null,
});

export const mergeImportedConfig = (
  type: string,
  incoming: unknown,
  existing: unknown
): unknown => {
  if (!isRecord(incoming) || Array.isArray(incoming)) throw new Error(`无效配置: ${type}`);
  if (type === 'automation') {
    // An imported scope may name devices or rules that differ here, so auto-update starts off.
    return { ...incoming, autoUpdateEnabled: false, clientEgressConfirmed: false };
  }
  if (
    type !== 'email' ||
    !hasAuthPassword(incoming) ||
    incoming.auth.pass !== MASKED_EXPORT_PASSWORD
  )
    return incoming;
  if (!hasAuthPassword(existing) || existing.auth.pass === MASKED_EXPORT_PASSWORD) {
    throw new Error('导入文件不含邮件密码，请先重新录入邮件密码');
  }
  return { ...incoming, auth: { ...incoming.auth, pass: existing.auth.pass } };
};

export const removeMisplacedSecrets = (type: string, data: unknown): unknown => {
  if (type !== 'automation' || !isRecord(data)) return data;
  const clean = { ...data };
  for (const key of ['smtpPassword', 'corpSecret', 'appSecret', 'webhookUrl']) delete clean[key];
  return clean;
};

/** Validate the fields consumed by running services; absent legacy fields keep their defaults. */
export const assertStoredConfiguration = (type: string, data: unknown): void => {
  if (
    ![
      'app',
      'automation',
      'email',
      'update',
      'notification',
      'system',
      'appearance',
      'wechat',
    ].includes(type)
  )
    return;
  if (!isRecord(data) || Array.isArray(data)) throw new Error(`无效配置: ${type}`);
  const bool = (key: string) => {
    if (data[key] !== undefined && typeof data[key] !== 'boolean')
      throw new Error(`配置布尔字段无效: ${type}.${key}`);
  };
  const number = (key: string, min: number, max: number, integer = false) => {
    const value = data[key];
    if (
      value !== undefined &&
      (typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < min ||
        value > max ||
        (integer && !Number.isInteger(value)))
    )
      throw new Error(`配置数值无效: ${type}.${key}`);
  };
  const strings = (key: string, allowed?: readonly string[]) => {
    const value = data[key];
    if (
      value !== undefined &&
      (!Array.isArray(value) ||
        value.some(
          (item) => typeof item !== 'string' || !item.trim() || (allowed && !allowed.includes(item))
        ))
    )
      throw new Error(`配置列表无效: ${type}.${key}`);
  };
  if (type === 'app') {
    if (
      data.logRetentionDays !== undefined &&
      (typeof data.logRetentionDays !== 'number' ||
        !Number.isInteger(data.logRetentionDays) ||
        data.logRetentionDays < 7 ||
        data.logRetentionDays > 365)
    )
      throw new Error('日志保留天数必须为 7 到 365 的整数');
    for (const key of [
      'autoStart',
      'encryptSensitiveData',
      'logAllOperations',
      'useWindowsCredentials',
      'requirePasswordOnStartup',
      'writeToWindowsEventLog',
    ])
      bool(key);
  }
  if (type === 'automation') {
    for (const key of [
      'enabled',
      'ipMonitorEnabled',
      'autoUpdateEnabled',
      'clientEgressConfirmed',
      'windowsNotifyEnabled',
    ])
      bool(key);
    number('checkInterval', 1, 60);
    number('confirmCount', 1, 10, true);
    number('delayMinutes', 1, 60);
    number('backupKeepCount', 1, 50, true);
    if (
      data.triggerType !== undefined &&
      !['immediate', 'delayed', 'scheduled'].includes(String(data.triggerType))
    )
      throw new Error('自动化触发方式无效');
    if (
      data.scheduledTime !== undefined &&
      (typeof data.scheduledTime !== 'string' ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(data.scheduledTime))
    )
      throw new Error('自动化定时时间必须为 HH:mm');
    if (
      data.autoUpdateEnabled === true &&
      data.triggerType === 'scheduled' &&
      data.scheduledTime === undefined
    )
      throw new Error('自动化定时时间不能为空');
    strings('selectedDevices');
    strings('managedRuleIds');
    strings('checkSources', [
      'ipip',
      'ddnspod',
      'pconline',
      'cip.cc',
      'cip',
      'ip138',
      'ip.sb',
      'ipify',
      'icanhazip',
      'ipinfo',
      'ifconfig',
    ]);
    strings('backupOptions', ['autoBackup', 'keepBackups', 'autoRollback']);
    strings('securityOptions', ['verifyRules', 'integrityCheck', 'manualConfirm']);
    strings('notifyTypes', [
      'ipChange',
      'updateSuccess',
      'updateFailed',
      'deviceOffline',
      'dailyReport',
    ]);
  }
  if (type === 'email') {
    for (const key of ['enabled', 'secure', 'requireTLS', 'ignoreTLS']) bool(key);
    number('port', 1, 65535, true);
    if (data.host !== undefined && typeof data.host !== 'string')
      throw new Error('SMTP 服务器地址无效');
    for (const key of ['auth', 'from'])
      if (data[key] !== undefined && (!isRecord(data[key]) || Array.isArray(data[key])))
        throw new Error(`SMTP ${key} 配置无效`);
    const auth = isRecord(data.auth) ? data.auth : {};
    const from = isRecord(data.from) ? data.from : {};
    for (const value of [auth.user, auth.pass, from.address, from.name])
      if (value !== undefined && typeof value !== 'string') throw new Error('SMTP 字段类型无效');
    strings('to');
    strings('notifyTypes', [
      'ipChange',
      'updateSuccess',
      'updateFailed',
      'deviceOffline',
      'dailyReport',
    ]);
    if (
      data.enabled === true &&
      (typeof data.host !== 'string' ||
        !data.host.trim() ||
        typeof data.port !== 'number' ||
        typeof data.secure !== 'boolean' ||
        typeof auth.user !== 'string' ||
        !auth.user.trim() ||
        typeof auth.pass !== 'string' ||
        !auth.pass ||
        typeof from.address !== 'string' ||
        !from.address.trim() ||
        !Array.isArray(data.to) ||
        !data.to.length)
    )
      throw new Error('启用邮件通知需要完整 SMTP 服务器、端口、认证、发件人与收件人');
  }
};
