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
  clientEgressConfirmed?: boolean;
  managedRuleIds?: string[];
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

export const buildStoredAutomationSettings = (
  values: AutomationFormValues
): StoredAutomationConfig => ({
  ipMonitorEnabled: values.ipMonitorEnabled !== false,
  checkInterval: values.checkInterval ?? 5,
  confirmCount: values.confirmCount ?? 3,
  checkSources: normalizeAutomationCheckSources(values.checkSources),
  autoUpdateEnabled: values.autoUpdateEnabled === true,
  triggerType: values.triggerType ?? 'immediate',
  delayMinutes: values.delayMinutes ?? 5,
  scheduledTime: values.scheduledTime,
  selectedDevices: values.selectedDevices ?? [],
  clientEgressConfirmed: values.clientEgressConfirmed === true,
  managedRuleIds: values.managedRuleIds ?? [],
  backupOptions: Array.from(new Set(['autoBackup', ...(values.backupOptions ?? [])])),
  backupKeepCount: values.backupKeepCount ?? 10,
  securityOptions: Array.from(new Set(['verifyRules', ...(values.securityOptions ?? [])])),
  windowsNotifyEnabled: values.windowsNotifyEnabled !== false,
  notifyTypes: values.notifyTypes ?? [...DEFAULT_NOTIFY_TYPES],
  wechatNotifyEnabled: false,
});

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

    const storedValues: AutomationFormValues = {
      ipMonitorEnabled: automationConfig.ipMonitorEnabled,
      checkInterval: automationConfig.checkInterval,
      confirmCount: automationConfig.confirmCount,
      checkSources: normalizeAutomationCheckSources(automationConfig.checkSources),
      autoUpdateEnabled: automationConfig.autoUpdateEnabled ?? false,
      triggerType: automationConfig.triggerType,
      delayMinutes: automationConfig.delayMinutes,
      scheduledTime: parseScheduledTime(automationConfig.scheduledTime),
      selectedDevices: automationConfig.selectedDevices,
      clientEgressConfirmed: automationConfig.clientEgressConfirmed === true,
      managedRuleIds: automationConfig.managedRuleIds ?? [],
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
    };
    Object.assign(
      formValues,
      Object.fromEntries(Object.entries(storedValues).filter(([, value]) => value !== undefined))
    );
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

  formValues.backupOptions = Array.from(
    new Set(['autoBackup', ...(formValues.backupOptions ?? [])])
  );
  formValues.securityOptions = Array.from(
    new Set(['verifyRules', ...(formValues.securityOptions ?? [])])
  );

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
    clientEgressConfirmed: formValues.clientEgressConfirmed === true,
    managedRuleIds: formValues.managedRuleIds ?? [],
    backupOptions: Array.from(new Set(['autoBackup', ...(formValues.backupOptions ?? [])])),
    securityOptions: Array.from(new Set(['verifyRules', ...(formValues.securityOptions ?? [])])),
    notifyTypes: formValues.notifyTypes ?? [...DEFAULT_NOTIFY_TYPES],
  },
  ...options,
});
