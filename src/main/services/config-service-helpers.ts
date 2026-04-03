import CryptoJS from 'crypto-js';

type ConfigEntryLike = {
  key: string;
  value: string;
};

type ConfigStatLike = {
  key: string;
  updatedAt: Date | null;
};

const MASKED_EXPORT_PASSWORD = '***masked***';
const EXPORT_WARNING = 'This export may contain sensitive configuration. Keep it secure.';

export const encryptSensitiveConfig = <T>(type: string, data: T, encryptionKey: string): T => {
  if (type !== 'email' || !(data as any)?.auth?.pass) {
    return data;
  }

  return {
    ...(data as any),
    auth: {
      ...(data as any).auth,
      pass: CryptoJS.AES.encrypt((data as any).auth.pass, encryptionKey).toString(),
    },
  };
};

export const decryptSensitiveConfig = <T>(
  type: string,
  data: T,
  encryptionKey: string,
  keyInitialized: boolean
): T => {
  if (type !== 'email' || !(data as any)?.auth?.pass) {
    return data;
  }

  if (!keyInitialized || !encryptionKey) {
    return data;
  }

  try {
    const bytes = CryptoJS.AES.decrypt((data as any).auth.pass, encryptionKey);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);

    if (!decrypted) {
      return data;
    }

    return {
      ...(data as any),
      auth: {
        ...(data as any).auth,
        pass: decrypted,
      },
    };
  } catch {
    return data;
  }
};

export const parseStoredConfigs = (configs: readonly ConfigEntryLike[]): Record<string, any> => {
  const result: Record<string, any> = {};

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
  configs: Record<string, any>,
  exportTime = new Date().toISOString()
) => {
  const safeConfigs = { ...configs };

  if (safeConfigs.email?.auth?.pass) {
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
