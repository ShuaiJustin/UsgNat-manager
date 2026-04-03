type AutomationEmailValues = {
  smtpServer?: string;
  smtpPort?: string;
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

export const buildAutomationEmailConfig = (
  values: AutomationEmailValues,
  enabled: boolean
): AutomationEmailConfig => ({
  enabled,
  host: values.smtpServer || '',
  port: parseInt(values.smtpPort || '', 10) || 465,
  secure: values.smtpPort === '465',
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
    secure: smtpPort === '465',
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
