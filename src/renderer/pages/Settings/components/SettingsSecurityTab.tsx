import React from 'react';
import { Alert, Button, Card, Checkbox, Form, InputNumber, Space } from 'antd';

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
}) => (
  <Card title={t('settings.securitySettings')} style={{ marginBottom: 24 }}>
    <Alert
      type="info"
      showIcon
      message="敏感内容优先使用 Electron safeStorage 的系统账户加密；系统保护不可用时使用本地 AES 密钥。私钥和私钥密码均加密，旧数据兼容读取。备份不包含本地密钥。"
      style={{ marginBottom: 16 }}
    />
    <Form.Item label={t('settings.credentialManagement')}>
      <Space direction="vertical">
        <Form.Item name="useWindowsCredentials" valuePropName="checked" noStyle>
          <Checkbox disabled>Windows 凭据管理器（未实现）</Checkbox>
        </Form.Item>
        <Form.Item name="encryptSensitiveData" valuePropName="checked" noStyle>
          <Checkbox disabled>敏感数据加密（始终启用）</Checkbox>
        </Form.Item>
        <Form.Item name="requirePasswordOnStartup" valuePropName="checked" noStyle>
          <Checkbox disabled>启动主密码（未实现）</Checkbox>
        </Form.Item>
      </Space>
    </Form.Item>

    <Form.Item label={t('settings.auditLog')}>
      <Space direction="vertical">
        <Form.Item name="logAllOperations" valuePropName="checked" noStyle>
          <Checkbox disabled>操作审计日志（始终启用）</Checkbox>
        </Form.Item>
        <Form.Item name="writeToWindowsEventLog" valuePropName="checked" noStyle>
          <Checkbox disabled>Windows 事件日志（未实现）</Checkbox>
        </Form.Item>
      </Space>
    </Form.Item>

    <Form.Item label={t('settings.logRetentionDays')} name="logRetentionDays">
      <InputNumber min={7} max={365} style={{ width: 100 }} />
    </Form.Item>

    <Space>
      <Button disabled>主密码管理（未实现）</Button>
      <Button onClick={onExportAuditLog}>{t('settings.exportAuditLog')}</Button>
      <Button danger onClick={onClearCredentials}>
        {t('settings.clearCredentials')}
      </Button>
    </Space>
  </Card>
);

export default SettingsSecurityTab;
