import type { Dayjs } from 'dayjs';

import { normalizeAutomationCheckSources } from '../../utils/automationConfig.ts';
import { DEFAULT_AUTOMATION_FORM_VALUES } from './automationDefaults.ts';
import { parseScheduledTime } from './automationTime.ts';

export type AutomationFormValues = {
  ipMonitorEnabled?: boolean;
  checkInterval?: number;
  confirmCount?: number;
  checkSources?: string[];
  autoUpdateEnabled?: boolean;
  triggerType?: string;
  delayMinutes?: number;
  scheduledTime?: Dayjs | string | null;
  selectedDevices?: string[];
  backupOptions?: string[];
  backupKeepCount?: number;
  securityOptions?: string[];
  windowsNotifyEnabled?: boolean;
  notifyTypes?: string[];
  smtpServer?: string;
  smtpPort?: string;
  smtpEncryption?: string;
  smtpUsername?: string;
  smtpPassword?: string;
  senderEmail?: string;
  senderName?: string;
  recipientEmails?: string;
  emailNotifyTypes?: string[];
  wechatNotifyEnabled?: boolean;
  wechatType?: string;
  corpId?: string;
  corpSecret?: string;
  agentId?: string;
  webhookUrl?: string;
  appId?: string;
  appSecret?: string;
  templateId?: string;
};

export type StoredAutomationConfig = AutomationFormValues & {
  emailNotifyEnabled?: boolean;
  wechatNotifyEnabled?: boolean;
};

export type StoredEmailConfig = {
  enabled?: boolean;
  host?: string;
  port?: number;
  secure?: boolean;
  requireTLS?: boolean;
  ignoreTLS?: boolean;
  auth?: { user?: string; pass?: string };
  from?: { address?: string; name?: string };
  to?: string[];
  notifyTypes?: string[];
};

export type AutomationFormSnapshot = {
  formValues: AutomationFormValues;
  emailNotifyEnabled: boolean;
  wechatNotifyEnabled: boolean;
  wechatType: string;
};

const DEFAULT_NOTIFY_TYPES = ['ipChange', 'updateSuccess', 'updateFailed'];

const getStoredSmtpEncryption = (emailConfig?: StoredEmailConfig | null): string => {
  if (emailConfig?.secure) {
    return 'ssl';
  }

  if (emailConfig?.ignoreTLS) {
    return 'none';
  }

  if (emailConfig?.requireTLS) {
    return 'starttls';
  }

  return emailConfig?.port === 465 ? 'ssl' : 'starttls';
};

export const buildAutomationFormSnapshot = ({
  automationConfig,
  emailConfig,
}: {
  automationConfig?: StoredAutomationConfig | null;
  emailConfig?: StoredEmailConfig | null;
}): AutomationFormSnapshot => {
  const formValues: AutomationFormValues = {
    ...DEFAULT_AUTOMATION_FORM_VALUES,
  };

  let emailNotifyEnabled = false;
  let wechatNotifyEnabled = false;
  let wechatType = 'work';

  if (automationConfig) {
    emailNotifyEnabled = automationConfig.emailNotifyEnabled ?? false;
    wechatNotifyEnabled = automationConfig.wechatNotifyEnabled ?? false;
    wechatType = automationConfig.wechatType || 'work';

    Object.assign(formValues, {
      ipMonitorEnabled: automationConfig.ipMonitorEnabled,
      checkInterval: automationConfig.checkInterval,
      confirmCount: automationConfig.confirmCount,
      checkSources: normalizeAutomationCheckSources(automationConfig.checkSources),
      autoUpdateEnabled: automationConfig.autoUpdateEnabled ?? false,
      triggerType: automationConfig.triggerType,
      delayMinutes: automationConfig.delayMinutes,
      scheduledTime: parseScheduledTime(automationConfig.scheduledTime),
      selectedDevices: automationConfig.selectedDevices,
      backupOptions: automationConfig.backupOptions,
      backupKeepCount: automationConfig.backupKeepCount,
      securityOptions: automationConfig.securityOptions,
      windowsNotifyEnabled: automationConfig.windowsNotifyEnabled,
      notifyTypes: automationConfig.notifyTypes || [...DEFAULT_NOTIFY_TYPES],
      smtpServer: automationConfig.smtpServer,
      smtpPort: automationConfig.smtpPort,
      smtpEncryption: automationConfig.smtpEncryption,
      smtpUsername: automationConfig.smtpUsername,
      smtpPassword: automationConfig.smtpPassword,
      senderEmail: automationConfig.senderEmail,
      senderName: automationConfig.senderName,
      recipientEmails: automationConfig.recipientEmails,
      emailNotifyTypes: automationConfig.emailNotifyTypes,
      wechatType: automationConfig.wechatType,
      corpId: automationConfig.corpId,
      corpSecret: automationConfig.corpSecret,
      agentId: automationConfig.agentId,
      webhookUrl: automationConfig.webhookUrl,
      appId: automationConfig.appId,
      appSecret: automationConfig.appSecret,
      templateId: automationConfig.templateId,
    });
  }

  if (emailConfig) {
    emailNotifyEnabled = emailConfig.enabled || false;

    if (emailConfig.host) {
      Object.assign(formValues, {
        smtpServer: emailConfig.host,
        smtpPort: String(emailConfig.port || 465),
        smtpEncryption: getStoredSmtpEncryption(emailConfig),
        smtpUsername: emailConfig.auth?.user || '',
        smtpPassword: emailConfig.auth?.pass || '',
        senderEmail: emailConfig.from?.address || '',
        senderName: emailConfig.from?.name || '',
        recipientEmails: emailConfig.to?.join(', ') || '',
        emailNotifyTypes: emailConfig.notifyTypes || [],
      });
    }
  }

  return {
    formValues,
    emailNotifyEnabled,
    wechatNotifyEnabled,
    wechatType,
  };
};

export const createAutomationFormSnapshot = (
  formValues: AutomationFormValues,
  options: Omit<AutomationFormSnapshot, 'formValues'>
): AutomationFormSnapshot => ({
  formValues: {
    ...DEFAULT_AUTOMATION_FORM_VALUES,
    ...formValues,
    checkSources: normalizeAutomationCheckSources(formValues.checkSources),
    selectedDevices: formValues.selectedDevices ?? [],
    backupOptions: formValues.backupOptions ?? [],
    securityOptions: formValues.securityOptions ?? [],
    notifyTypes: formValues.notifyTypes ?? [...DEFAULT_NOTIFY_TYPES],
  },
  ...options,
});
