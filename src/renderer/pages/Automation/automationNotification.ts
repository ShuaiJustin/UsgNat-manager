type AutomationEmailValues = {
  smtpServer?: string;
  smtpPort?: string;
  smtpEncryption?: string;
  smtpUsername?: string;
  smtpPassword?: string;
  senderEmail?: string;
  senderName?: string;
  recipientEmails?: string;
  emailNotifyTypes?: string[];
};

type AutomationEmailBaseConfig = {
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
};

export type AutomationEmailConfig = AutomationEmailBaseConfig & {
  notifyTypes: string[];
};

export type AutomationTestEmailConfig = AutomationEmailBaseConfig;

const DEFAULT_SENDER_NAME = 'USG NAT管理系统';

// Commas, Chinese commas, semicolons and whitespace all separate recipients.
export const normalizeRecipients = (recipientEmails?: string): string[] =>
  recipientEmails
    ?.split(/[,，;；\s]+/)
    .map((email) => email.trim())
    .filter(Boolean) ?? [];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const findInvalidRecipients = (recipientEmails?: string): string[] =>
  normalizeRecipients(recipientEmails).filter((email) => !EMAIL_PATTERN.test(email));

// Well-known ports imply their encryption; picking 587 while SSL/TLS stays selected is the
// most common reason a test e-mail hangs until "Greeting never received".
export const getEncryptionForPort = (port?: string): 'ssl' | 'starttls' | undefined =>
  port === '465' ? 'ssl' : port === '587' || port === '25' ? 'starttls' : undefined;

export const DEFAULT_EMAIL_NOTIFY_TYPES = ['ipChange', 'updateSuccess', 'updateFailed'];

// example.com/.org/.net are reserved documentation domains; they can never deliver mail.
export const isPlaceholderSmtpHost = (host?: string): boolean =>
  /(^|\.)example\.(com|org|net)$/i.test(host?.trim() ?? '');

export const isValidSmtpPort = (port?: string): boolean =>
  /^\d{1,5}$/.test(port ?? '') && Number(port) >= 1 && Number(port) <= 65535;

// A hint, not a block: some providers run SSL on non-standard ports.
export const getPortEncryptionMismatch = (port?: string, encryption?: string): string | null => {
  const expected = getEncryptionForPort(port);
  if (!expected || !encryption || encryption === 'none' || encryption === expected) return null;
  return expected === 'ssl'
    ? '465 端口通常使用 SSL/TLS，当前选择可能导致连接失败'
    : `${port} 端口通常使用 STARTTLS，当前选择可能导致连接失败`;
};

const resolveTransportSecurity = (
  smtpPort?: string,
  smtpEncryption?: string
): Pick<AutomationEmailBaseConfig, 'secure' | 'requireTLS' | 'ignoreTLS'> => {
  const normalizedMode = smtpEncryption || (smtpPort === '465' ? 'ssl' : 'starttls');

  if (normalizedMode === 'ssl') {
    return {
      secure: true,
    };
  }

  if (normalizedMode === 'none') {
    return {
      secure: false,
      ignoreTLS: true,
    };
  }

  return {
    secure: false,
    requireTLS: true,
  };
};

export const buildAutomationEmailConfig = (
  values: AutomationEmailValues,
  enabled: boolean
): AutomationEmailConfig => ({
  enabled,
  host: values.smtpServer || '',
  port: Number(values.smtpPort) || 465,
  ...resolveTransportSecurity(values.smtpPort, values.smtpEncryption),
  auth: {
    user: values.smtpUsername || '',
    pass: values.smtpPassword || '',
  },
  from: {
    name: values.senderName || DEFAULT_SENDER_NAME,
    address: values.senderEmail || '',
  },
  to: normalizeRecipients(values.recipientEmails),
  notifyTypes: values.emailNotifyTypes || [],
});

export const buildAutomationTestEmailConfig = (
  values: AutomationEmailValues
): AutomationTestEmailConfig | null => {
  const smtpServer = values.smtpServer?.trim();
  const smtpUsername = values.smtpUsername?.trim();
  const smtpPassword = values.smtpPassword;
  const senderEmail = values.senderEmail?.trim();
  const senderName = values.senderName?.trim() || DEFAULT_SENDER_NAME;
  const recipients = normalizeRecipients(values.recipientEmails).filter((email) =>
    email.includes('@')
  );

  if (!smtpServer || !smtpUsername || !smtpPassword || !senderEmail || recipients.length === 0) {
    return null;
  }

  const smtpPort = values.smtpPort || '465';

  return {
    enabled: true,
    host: smtpServer,
    port: Number(smtpPort) || 465,
    ...resolveTransportSecurity(smtpPort, values.smtpEncryption),
    auth: {
      user: smtpUsername,
      pass: smtpPassword,
    },
    from: {
      name: senderName,
      address: senderEmail,
    },
    to: recipients,
  };
};
