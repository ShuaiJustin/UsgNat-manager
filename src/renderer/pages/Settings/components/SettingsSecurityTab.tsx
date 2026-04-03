import React from 'react';
import { Button, Card, Checkbox, Form, InputNumber, Space } from 'antd';

import type { SettingsTranslation } from './types';

interface SettingsSecurityTabProps {
  t: SettingsTranslation;
  onClearCredentials: () => void;
  onExportAuditLog: () => void;
  onManagePassword: () => void;
}

const SettingsSecurityTab: React.FC<SettingsSecurityTabProps> = ({
  t,
  onClearCredentials,
  onExportAuditLog,
  onManagePassword,
}) => (
  <Card title={t('settings.securitySettings')} style={{ marginBottom: 24 }}>
    <Form.Item label={t('settings.credentialManagement')}>
      <Space direction="vertical">
        <Form.Item name="useWindowsCredentials" valuePropName="checked" noStyle>
          <Checkbox>{t('settings.useWindowsCredentials')}</Checkbox>
        </Form.Item>
        <Form.Item name="encryptSensitiveData" valuePropName="checked" noStyle>
          <Checkbox>{t('settings.encryptSensitiveData')}</Checkbox>
        </Form.Item>
        <Form.Item name="requirePasswordOnStartup" valuePropName="checked" noStyle>
          <Checkbox>{t('settings.requirePasswordOnStartup')}</Checkbox>
        </Form.Item>
      </Space>
    </Form.Item>

    <Form.Item label={t('settings.auditLog')}>
      <Space direction="vertical">
        <Form.Item name="logAllOperations" valuePropName="checked" noStyle>
          <Checkbox>{t('settings.logAllOperations')}</Checkbox>
        </Form.Item>
        <Form.Item name="writeToWindowsEventLog" valuePropName="checked" noStyle>
          <Checkbox>{t('settings.writeToWindowsEventLog')}</Checkbox>
        </Form.Item>
      </Space>
    </Form.Item>

    <Form.Item label={t('settings.logRetentionDays')} name="logRetentionDays">
      <InputNumber min={7} max={365} style={{ width: 100 }} />
    </Form.Item>

    <Space>
      <Button onClick={onManagePassword}>{t('settings.managePassword')}</Button>
      <Button onClick={onExportAuditLog}>{t('settings.exportAuditLog')}</Button>
      <Button danger onClick={onClearCredentials}>
        {t('settings.clearCredentials')}
      </Button>
    </Space>
  </Card>
);

export default SettingsSecurityTab;
