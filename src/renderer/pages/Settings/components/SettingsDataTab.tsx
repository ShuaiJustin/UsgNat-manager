import React from 'react';
import { Button, Card, Divider, Space } from 'antd';

import type { SettingsDatabaseInfo, SettingsTranslation } from './types';

interface SettingsDataTabProps {
  databaseInfo: SettingsDatabaseInfo;
  t: SettingsTranslation;
  onBackupData: () => void;
  onClearData: () => void;
  onExportConfig: () => void;
  onImportConfig: () => void;
}

const SettingsDataTab: React.FC<SettingsDataTabProps> = ({
  databaseInfo,
  t,
  onBackupData,
  onClearData,
  onExportConfig,
  onImportConfig,
}) => (
  <Card title={t('settings.dataManagement')}>
    <p>
      <strong>{t('settings.databasePath')}:</strong> {databaseInfo.path}
    </p>
    <p>
      <strong>{t('settings.databaseSize')}:</strong> {databaseInfo.size}
    </p>

    <Space style={{ marginTop: 15 }}>
      <Button onClick={onBackupData}>{t('settings.backupData')}</Button>
      <Button danger onClick={onClearData}>
        {t('settings.clearData')}
      </Button>
    </Space>

    <Divider />

    <div>
      <div style={{ marginBottom: 8, fontWeight: 500 }}>{t('settings.configImportExport')}</div>
      <Space>
        <Button onClick={onExportConfig}>{t('settings.exportConfig')}</Button>
        <Button onClick={onImportConfig}>{t('settings.importConfig')}</Button>
      </Space>
    </div>
  </Card>
);

export default SettingsDataTab;
