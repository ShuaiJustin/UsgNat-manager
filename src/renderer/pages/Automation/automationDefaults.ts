import { normalizeAutomationCheckSources } from '../../utils/automationConfig.ts';

export const DEFAULT_AUTOMATION_FORM_VALUES = {
  ipMonitorEnabled: true,
  checkInterval: 5,
  confirmCount: 3,
  checkSources: normalizeAutomationCheckSources(undefined),
  autoUpdateEnabled: false,
  triggerType: 'immediate',
  selectedDevices: [],
  clientEgressConfirmed: false,
  managedRuleIds: [],
  backupOptions: ['autoBackup'],
  backupKeepCount: 10,
  securityOptions: ['verifyRules'],
  windowsNotifyEnabled: true,
  notifyTypes: ['ipChange', 'updateSuccess', 'updateFailed'],
  smtpEncryption: 'ssl',
  smtpPort: '465',
  emailNotifyTypes: ['ipChange', 'updateSuccess', 'updateFailed'],
};
