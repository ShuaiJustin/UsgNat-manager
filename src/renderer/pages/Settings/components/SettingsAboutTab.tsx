import React from 'react';
import { Button, Card, Divider, Space } from 'antd';
import { version as appVersion } from '../../../../../package.json';

import type { SettingsTranslation } from './types';

interface SettingsAboutTabProps {
  t: SettingsTranslation;
  onCheckUpdate: () => void;
  onContactSupport: () => void;
  onViewLicense: () => void;
}

const SettingsAboutTab: React.FC<SettingsAboutTabProps> = ({
  t,
  onCheckUpdate,
  onContactSupport,
  onViewLicense,
}) => (
  <Card title={t('settings.about')}>
    <p>
      <strong>{t('settings.aboutTitle')}</strong>
    </p>
    <p>
      {t('settings.version')}: V{appVersion}
    </p>
    <p>{t('settings.electronVersion')}: 28.1.0</p>
    <p>{t('settings.reactVersion')}: 18.2.0</p>
    <Divider />
    <Space>
      <Button onClick={onViewLicense}>{t('settings.viewLicense')}</Button>
      <Button onClick={onCheckUpdate}>{t('settings.checkUpdate')}</Button>
      <Button onClick={onContactSupport}>{t('settings.contactSupport')}</Button>
    </Space>
  </Card>
);

export default SettingsAboutTab;
