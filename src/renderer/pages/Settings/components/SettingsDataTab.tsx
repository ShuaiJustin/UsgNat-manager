import React from 'react';
import { Button, Card, Divider, Space } from 'antd';

import type { SettingsDatabaseInfo, SettingsTranslation } from './types';

interface SettingsDataTabProps {
  databaseInfo: SettingsDatabaseInfo;
  t: SettingsTranslation;
  onBackupData: () => void;
  onRestoreData: () => void;
  onClearData: () => void;
  onExportConfig: () => void;
  onImportConfig: () => void;
}

const SettingsDataTab: React.FC<SettingsDataTabProps> = ({
  databaseInfo,
  t,
  onBackupData,
  onRestoreData,
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
      <Button onClick={onRestoreData}>恢复备份</Button>
      <Button danger onClick={onClearData}>
        {t('settings.clearData')}
      </Button>
    </Space>
    <p style={{ marginTop: 12 }}>
      备份包含设备、规则、配置、凭据和最近 1000
      条日志。恢复会替换这些数据，并先创建当前状态备份。系统加密凭据通常仅能在原系统账户使用；密钥未包含在备份内。
    </p>

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
