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
const SMTP_HOST_PLACEHOLDER =
  'SMTP 服务器是示例地址，请在“自动化管理 → 通知管理”中填写真实服务器，例如 smtp.qq.com';

// example.com/.org/.net are reserved documentation domains and never deliver mail.
export const isPlaceholderHost = (host: string): boolean =>
  /(^|\.)example\.(com|org|net)$/i.test(host.trim());

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

  if (isPlaceholderHost(config.host)) {
    return SMTP_HOST_PLACEHOLDER;
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

// nodemailer reports the failure class in `code` (EAUTH, ETIMEDOUT, …); the message alone is
// often just the server's reply ("535 Login fail"), so both are checked.
const FRIENDLY_BY_CODE: Record<string, string> = {
  EAUTH: '认证失败：请检查登录账号和密码。QQ、163 等邮箱需要使用“授权码”，不是登录密码。',
  EDNS: '找不到 SMTP 服务器：请检查服务器地址，例如 smtp.qq.com、smtp.163.com。',
  ETLS: '服务器不支持 STARTTLS 加密：请改用 465 端口配 SSL/TLS，或选择“不强制加密”。',
  ETIMEDOUT: '连接超时：请检查服务器地址、端口，以及本机网络或防火墙是否放行。',
  ECONNECTION: '连接失败：请检查服务器地址、端口，以及本机网络或防火墙是否放行。',
  ESOCKET:
    '连接失败：请检查服务器地址、端口和加密方式是否匹配（465 用 SSL/TLS，587 用 STARTTLS）。',
  EENVELOPE: '邮件被服务器拒收：请检查发件人和收件人地址。',
};

// The nodemailer error code decides first; the message is only consulted when no code is set,
// since server replies can mention "TLS" or contain numbers unrelated to the cause.
export const getFriendlyEmailError = ({ message, code }: EmailErrorInfo): string => {
  if (code && FRIENDLY_BY_CODE[code])
    return code === 'EENVELOPE'
      ? `${FRIENDLY_BY_CODE[code]}（${message}）`
      : FRIENDLY_BY_CODE[code];
  if (/\b535\b|authentication|invalid login/i.test(message)) return FRIENDLY_BY_CODE.EAUTH;
  if (/ENOTFOUND|EAI_AGAIN/.test(message)) return FRIENDLY_BY_CODE.EDNS;
  if (/greeting never received/i.test(message))
    return '服务器没有响应：通常是端口与加密方式不匹配（465 用 SSL/TLS，587 用 STARTTLS）。';
  if (/wrong version number|certificate|\bSSL\b|\bTLS\b/i.test(message))
    return 'SSL/TLS 握手失败：465 端口请选 SSL/TLS，587 端口请选 STARTTLS。';
  if (/ETIMEDOUT|ECONNREFUSED|ECONNRESET|socket/i.test(message))
    return FRIENDLY_BY_CODE.ECONNECTION;
  return message;
};
