import CryptoJS from 'crypto-js';

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

const MASKED_EXPORT_PASSWORD = '***masked***';
const EXPORT_WARNING = 'This export may contain sensitive configuration. Keep it secure.';

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null;

const hasAuthPassword = (value: unknown): value is AuthWithPasswordRecord =>
  isRecord(value) &&
  isRecord(value.auth) &&
  typeof value.auth.pass === 'string' &&
  value.auth.pass.length > 0;

export const encryptSensitiveConfig = <T>(type: string, data: T, encryptionKey: string): T => {
  if (type !== 'email' || !hasAuthPassword(data)) {
    return data;
  }

  return {
    ...data,
    auth: {
      ...data.auth,
      pass: CryptoJS.AES.encrypt(data.auth.pass, encryptionKey).toString(),
    },
  } as T;
};

export const decryptSensitiveConfig = <T>(
  type: string,
  data: T,
  encryptionKey: string,
  keyInitialized: boolean
): T => {
  if (type !== 'email' || !hasAuthPassword(data)) {
    return data;
  }

  if (!keyInitialized || !encryptionKey) {
    return data;
  }

  try {
    const bytes = CryptoJS.AES.decrypt(data.auth.pass, encryptionKey);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);

    if (!decrypted) {
      return data;
    }

    return {
      ...data,
      auth: {
        ...data.auth,
        pass: decrypted,
      },
    } as T;
  } catch {
    return data;
  }
};

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
  const safeConfigs: Record<string, unknown> = { ...configs };

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
