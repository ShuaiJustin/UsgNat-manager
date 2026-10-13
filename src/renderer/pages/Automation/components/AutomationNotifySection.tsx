import React from 'react';
import {
  AutoComplete,
  Button,
  Card,
  Checkbox,
  Divider,
  Form,
  Input,
  Radio,
  Switch,
  Typography,
} from 'antd';

import {
  findInvalidRecipients,
  getEncryptionForPort,
  getPortEncryptionMismatch,
  isPlaceholderSmtpHost,
  isValidSmtpPort,
} from '../automationNotification';

interface AutomationNotifySectionProps {
  emailNotifyEnabled: boolean;
  onEmailNotifyEnabledChange: (enabled: boolean) => void;
  onSendTestEmail: () => Promise<void>;
}

const NOTIFY_TYPE_OPTIONS = [
  { label: '公网 IP 变化', value: 'ipChange' },
  { label: '规则更新成功', value: 'updateSuccess' },
  { label: '规则更新失败', value: 'updateFailed' },
];

const twoColumns = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 } as const;

const AutomationNotifySection: React.FC<AutomationNotifySectionProps> = ({
  emailNotifyEnabled,
  onEmailNotifyEnabledChange,
  onSendTestEmail,
}) => {
  const form = Form.useFormInstance();
  return (
    <Card>
      <h4 style={{ marginTop: 0 }}>系统通知</h4>
      <Form.Item
        label="在 Windows 右下角弹出通知"
        name="windowsNotifyEnabled"
        valuePropName="checked"
      >
        <Switch />
      </Form.Item>
      <Form.Item label="以下情况时通知我" name="notifyTypes">
        <Checkbox.Group options={NOTIFY_TYPE_OPTIONS} />
      </Form.Item>

      <Divider />

      <h4>邮件通知</h4>
      <Form.Item label="同时发送邮件">
        <Switch checked={emailNotifyEnabled} onChange={onEmailNotifyEnabledChange} />
      </Form.Item>

      {emailNotifyEnabled && (
        <div style={{ padding: 16, background: '#fafafa', borderRadius: 8 }}>
          <div style={twoColumns}>
            <Form.Item
              label="SMTP 服务器"
              name="smtpServer"
              rules={[
                { required: true, message: '请输入 SMTP 服务器' },
                {
                  validator: async (_rule, value?: string) => {
                    if (isPlaceholderSmtpHost(value))
                      throw new Error(
                        '这是示例地址，请填写邮箱服务商的真实服务器，例如 smtp.qq.com'
                      );
                  },
                },
              ]}
            >
              <Input placeholder="例如 smtp.qq.com、smtp.163.com" />
            </Form.Item>
            <Form.Item
              label="端口"
              name="smtpPort"
              rules={[
                { required: true, message: '请输入端口' },
                {
                  validator: async (_rule, value?: string) => {
                    if (value && !isValidSmtpPort(value))
                      throw new Error('端口应为 1-65535 的数字');
                  },
                },
              ]}
              extra="选择常用端口会自动匹配加密方式"
            >
              <AutoComplete
                options={[
                  { value: '465', label: '465（SSL/TLS，推荐）' },
                  { value: '587', label: '587（STARTTLS）' },
                  { value: '25', label: '25' },
                ]}
                onChange={(port: string) => {
                  const encryption = getEncryptionForPort(port);
                  if (encryption) form.setFieldValue('smtpEncryption', encryption);
                }}
              />
            </Form.Item>
          </div>

          <Form.Item
            label="加密方式"
            name="smtpEncryption"
            dependencies={['smtpPort']}
            rules={[
              ({ getFieldValue }) => ({
                warningOnly: true,
                validator: async (_rule, value?: string) => {
                  const mismatch = getPortEncryptionMismatch(getFieldValue('smtpPort'), value);
                  if (mismatch) throw new Error(mismatch);
                },
              }),
            ]}
          >
            <Radio.Group>
              <Radio value="ssl">SSL/TLS</Radio>
              <Radio value="starttls">STARTTLS</Radio>
              <Radio value="none">不强制加密</Radio>
            </Radio.Group>
          </Form.Item>

          <div style={twoColumns}>
            <Form.Item
              label="登录账号"
              name="smtpUsername"
              rules={[{ required: true, message: '请输入登录账号' }]}
            >
              <Input placeholder="username@example.com" autoComplete="off" />
            </Form.Item>
            <Form.Item
              label="登录密码 / 授权码"
              name="smtpPassword"
              rules={[{ required: true, message: '请输入密码或授权码' }]}
            >
              <Input.Password
                placeholder="QQ、163 等邮箱请填写授权码"
                autoComplete="new-password"
              />
            </Form.Item>
          </div>

          <div style={twoColumns}>
            <Form.Item
              label="发件人邮箱"
              name="senderEmail"
              rules={[{ required: true, type: 'email', message: '请输入有效的邮箱' }]}
            >
              <Input placeholder="sender@example.com" />
            </Form.Item>
            <Form.Item label="发件人名称" name="senderName">
              <Input placeholder="USG NAT 管理" />
            </Form.Item>
          </div>

          <Form.Item
            label="收件人"
            name="recipientEmails"
            rules={[
              { required: true, message: '请输入至少一个收件人' },
              {
                validator: async (_rule, value?: string) => {
                  const invalid = findInvalidRecipients(value);
                  if (invalid.length) throw new Error(`邮箱格式不正确：${invalid.join('、')}`);
                },
              },
            ]}
            extra="多个收件人用逗号或分号分隔"
          >
            <Input placeholder="admin@example.com, ops@example.com" />
          </Form.Item>

          <Form.Item
            label="以下情况时发邮件"
            name="emailNotifyTypes"
            rules={[{ required: true, type: 'array', min: 1, message: '请至少选择一种情况' }]}
          >
            <Checkbox.Group options={NOTIFY_TYPE_OPTIONS} />
          </Form.Item>

          <Button onClick={() => void onSendTestEmail()}>发送测试邮件</Button>
          <Typography.Text type="secondary" style={{ marginLeft: 12 }}>
            使用当前填写的配置发送，无需先保存
          </Typography.Text>
        </div>
      )}
    </Card>
  );
};

export default AutomationNotifySection;
