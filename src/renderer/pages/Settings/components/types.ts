import type { TFunction } from 'i18next';
import type { LanguageType } from '@/stores/app.store';

export type SettingsTranslation = TFunction;

export type SettingsDatabaseInfo = {
  path: string;
  size: string;
};

export type SettingsFormValues = {
  scale: string;
  language: LanguageType;
  autoStart: boolean;
  logRetentionDays: number;
  useWindowsCredentials: boolean;
  encryptSensitiveData: boolean;
  requirePasswordOnStartup: boolean;
  logAllOperations: boolean;
  writeToWindowsEventLog: boolean;
};

export type SettingsAppConfig = Omit<SettingsFormValues, 'autoStart'> & {
  theme?: string;
};

export type SettingsSummaryValues = Pick<SettingsFormValues, 'scale' | 'logRetentionDays'>;
