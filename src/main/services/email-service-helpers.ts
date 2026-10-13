type SMTPConfigLike = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  requireTLS?: boolean;
  ignoreTLS?: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: {
    name: string;
    address: string;
  };
  to: string[];
  notifyTypes?: string[];
};

type BaseTransportConfig = {
  host: string;
  port: number;
  secure: boolean;
  requireTLS?: boolean;
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
  auth: {
    user: string;
    pass: string;
  };
};

type TestTransportConfig = BaseTransportConfig & {
  logger: false;
  debug: false;
};

type EmailErrorInfo = {
  message: string;
  code?: string;
  command?: string;
};

const EMAIL_NOTIFICATION_DISABLED = '\u90ae\u4ef6\u901a\u77e5\u672a\u542f\u7528';
const SMTP_HOST_REQUIRED = 'SMTP \u670d\u52a1\u5668\u5730\u5740\u4e0d\u80fd\u4e3a\u7a7a';
const SMTP_USER_REQUIRED = 'SMTP \u7528\u6237\u540d\u4e0d\u80fd\u4e3a\u7a7a';
const SMTP_PASSWORD_REQUIRED = 'SMTP \u5bc6\u7801\u4e0d\u80fd\u4e3a\u7a7a';
const SMTP_FROM_REQUIRED = '\u53d1\u4ef6\u4eba\u90ae\u7bb1\u4e0d\u80fd\u4e3a\u7a7a';
const SMTP_TO_REQUIRED = '\u6536\u4ef6\u4eba\u90ae\u7bb1\u4e0d\u80fd\u4e3a\u7a7a';
const UNKNOWN_EMAIL_ERROR = '\u672a\u77e5\u9519\u8bef';

export const DEFAULT_NOTIFY_TYPES = [
  'ipChange',
  'updateSuccess',
  'updateFailed',
  'deviceOffline',
  'dailyReport',
] as const;

export const normalizeNotifyTypes = (notifyTypes?: string[]): string[] =>
  notifyTypes && notifyTypes.length > 0 ? [...notifyTypes] : [...DEFAULT_NOTIFY_TYPES];

export const getSMTPConfigValidationError = (config: SMTPConfigLike): string | null => {
  if (!config.enabled) {
    return EMAIL_NOTIFICATION_DISABLED;
  }

  if (!config.host) {
    return SMTP_HOST_REQUIRED;
  }

  if (!config.auth?.user) {
    return SMTP_USER_REQUIRED;
  }

  if (!config.auth?.pass) {
    return SMTP_PASSWORD_REQUIRED;
  }

  if (!config.from?.address) {
    return SMTP_FROM_REQUIRED;
  }

  if (!config.to || config.to.length === 0) {
    return SMTP_TO_REQUIRED;
  }

  return null;
};

export const createBaseTransportConfig = (config: SMTPConfigLike): BaseTransportConfig => ({
  host: config.host,
  port: config.port,
  secure: config.secure,
  // Without implicit TLS, STARTTLS is mandatory unless the user explicitly chose the unencrypted
  // mode (stored as ignoreTLS). That mode only drops the requirement: nodemailer's ignoreTLS is
  // never forwarded, so a server offering STARTTLS is still upgraded opportunistically.
  ...(!config.secure && !config.ignoreTLS ? { requireTLS: true } : {}),
  // Bounded waits keep a stalled SMTP server from hanging notification delivery indefinitely.
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 30000,
  auth: {
    user: config.auth.user,
    pass: config.auth.pass,
  },
});

export const createTestTransportConfig = (config: SMTPConfigLike): TestTransportConfig => ({
  ...createBaseTransportConfig(config),
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
  logger: false,
  debug: false,
});

export const getEmailErrorInfo = (error: unknown): EmailErrorInfo => {
  if (typeof error === 'string') {
    return {
      message: error,
      code: undefined,
      command: undefined,
    };
  }

  if (isRecord(error)) {
    return {
      message: typeof error.message === 'string' ? error.message : UNKNOWN_EMAIL_ERROR,
      code: typeof error.code === 'string' ? error.code : undefined,
      command: typeof error.command === 'string' ? error.command : undefined,
    };
  }

  return {
    message: UNKNOWN_EMAIL_ERROR,
    code: undefined,
    command: undefined,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
