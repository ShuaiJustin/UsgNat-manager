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

const normalizeRecipients = (recipientEmails?: string): string[] =>
  recipientEmails
    ?.split(',')
    .map((email) => email.trim())
    .filter(Boolean) ?? [];

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
  port: parseInt(values.smtpPort || '', 10) || 465,
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
    port: parseInt(smtpPort, 10) || 465,
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
