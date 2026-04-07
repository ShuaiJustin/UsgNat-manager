import type { SettingsAppConfig, SettingsFormValues } from './components/types';

export const DEFAULT_SETTINGS_FORM_VALUES: SettingsFormValues = {
  scale: '100',
  language: 'zh-CN',
  autoStart: true,
  logRetentionDays: 30,
  useWindowsCredentials: true,
  encryptSensitiveData: true,
  requirePasswordOnStartup: false,
  logAllOperations: true,
  writeToWindowsEventLog: true,
};

export const buildSettingsFormSnapshot = (
  appConfig?: SettingsAppConfig | null,
  autoStart: boolean = DEFAULT_SETTINGS_FORM_VALUES.autoStart
): SettingsFormValues => ({
  ...DEFAULT_SETTINGS_FORM_VALUES,
  ...appConfig,
  autoStart,
});
