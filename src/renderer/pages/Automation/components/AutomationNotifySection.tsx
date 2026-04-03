import React from 'react';
import { Button, Card, Checkbox, Divider, Form, Input, Radio, Select, Switch } from 'antd';
import type { FormInstance } from 'antd';
import type { TFunction } from 'i18next';

interface AutomationNotifySectionProps {
  emailNotifyEnabled: boolean;
  form: FormInstance;
  onEmailNotifyEnabledChange: (enabled: boolean) => void;
  onSendTestEmail: () => Promise<void>;
  onSendTestWechat: () => void;
  onSmtpPasswordVisibleChange: (visible: boolean) => void;
  onWechatNotifyEnabledChange: (enabled: boolean) => void;
  onWechatTypeChange: (type: string) => void;
  smtpPasswordVisible: boolean;
  t: TFunction;
  wechatNotifyEnabled: boolean;
  wechatType: string;
}

const AutomationNotifySection: React.FC<AutomationNotifySectionProps> = ({
  emailNotifyEnabled,
  form,
  onEmailNotifyEnabledChange,
  onSendTestEmail,
  onSendTestWechat,
  onSmtpPasswordVisibleChange,
  onWechatNotifyEnabledChange,
  onWechatTypeChange,
  smtpPasswordVisible,
  t,
  wechatNotifyEnabled,
  wechatType,
}) => (
  <Card title={t('automation.notificationManagement')}>
    <Form.Item label="Windows通知" name="windowsNotifyEnabled" valuePropName="checked">
      <Switch />
    </Form.Item>

    <Form.Item label="通知类型" name="notifyTypes">
      <Checkbox.Group
        options={[
          { label: 'IP变化通知', value: 'ipChange' },
          { label: '更新成功通知', value: 'updateSuccess' },
          { label: '更新失败通知', value: 'updateFailed' },
          { label: '设备离线通知', value: 'deviceOffline' },
        ]}
      />
    </Form.Item>

    <Divider />

    <Form.Item label="邮件通知">
      <Switch checked={emailNotifyEnabled} onChange={onEmailNotifyEnabledChange} />
    </Form.Item>

    {emailNotifyEnabled && (
      <div style={{ marginTop: 15, padding: 15, background: '#f5f5f5', borderRadius: 6 }}>
        <h4 style={{ marginBottom: 15, fontSize: 14 }}>SMTP服务器配置</h4>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Form.Item
            label="SMTP服务器"
            name="smtpServer"
            rules={[{ required: emailNotifyEnabled }]}
          >
            <Input placeholder="smtp.example.com" />
          </Form.Item>
          <Form.Item label="端口" name="smtpPort" rules={[{ required: emailNotifyEnabled }]}>
            <Select>
              <Select.Option value="25">25 (SMTP)</Select.Option>
              <Select.Option value="465">465 (SSL)</Select.Option>
              <Select.Option value="587">587 (TLS)</Select.Option>
            </Select>
          </Form.Item>
        </div>

        <Form.Item label="加密方式" name="smtpEncryption">
          <Radio.Group>
            <Radio value="none">无加密</Radio>
            <Radio value="ssl">SSL/TLS</Radio>
            <Radio value="starttls">STARTTLS</Radio>
          </Radio.Group>
        </Form.Item>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Form.Item
            label="发件人邮箱"
            name="senderEmail"
            rules={[{ required: emailNotifyEnabled, type: 'email' }]}
          >
            <Input placeholder="sender@example.com" />
          </Form.Item>
          <Form.Item label="发件人名称" name="senderName">
            <Input placeholder="USG NAT管理系统" />
          </Form.Item>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Form.Item
            label="SMTP用户名"
            name="smtpUsername"
            rules={[{ required: emailNotifyEnabled }]}
          >
            <Input placeholder="username@example.com" />
          </Form.Item>
          <Form.Item
            label="SMTP密码"
            name="smtpPassword"
            rules={[{ required: emailNotifyEnabled }]}
          >
            <div style={{ position: 'relative' }}>
              <Input
                type={smtpPasswordVisible ? 'text' : 'password'}
                placeholder="请输入SMTP密码"
                autoComplete="off"
                onFocus={() => onSmtpPasswordVisibleChange(true)}
                onChange={() => {
                  if (!smtpPasswordVisible) {
                    onSmtpPasswordVisibleChange(true);
                  }
                }}
              />
              {!smtpPasswordVisible && form.getFieldValue('smtpPassword') && (
                <div
                  onClick={() => onSmtpPasswordVisibleChange(true)}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    display: 'flex',
                    alignItems: 'center',
                    paddingLeft: 11,
                    backgroundColor: 'white',
                    cursor: 'pointer',
                    color: '#999',
                    border: '1px solid #d9d9d9',
                    borderRadius: 6,
                    fontSize: 14,
                  }}
                >
                  ••••••••
                </div>
              )}
            </div>
          </Form.Item>
        </div>

        <Form.Item
          label="收件人邮箱"
          name="recipientEmails"
          rules={[{ required: emailNotifyEnabled }]}
          extra="支持多个收件人，用逗号分隔"
        >
          <Input placeholder="admin@example.com (多个邮箱用逗号分隔)" />
        </Form.Item>

        <Form.Item label="通知类型" name="emailNotifyTypes">
          <Checkbox.Group
            options={[
              { label: 'IP变化通知', value: 'ipChange' },
              { label: '更新成功通知', value: 'updateSuccess' },
              { label: '更新失败通知', value: 'updateFailed' },
              { label: '设备离线通知', value: 'deviceOffline' },
              { label: '每日报告', value: 'dailyReport' },
            ]}
          />
        </Form.Item>

        <Button onClick={onSendTestEmail}>发送测试邮件</Button>
      </div>
    )}

    <Divider />

    <Form.Item label="微信通知" extra="需要配置企业微信或微信公众号">
      <Switch checked={wechatNotifyEnabled} onChange={onWechatNotifyEnabledChange} />
    </Form.Item>

    {wechatNotifyEnabled && (
      <div style={{ marginTop: 15, padding: 15, background: '#f5f5f5', borderRadius: 6 }}>
        <h4 style={{ marginBottom: 15, fontSize: 14 }}>微信通知配置</h4>

        <Form.Item label="通知方式" name="wechatType">
          <Select value={wechatType} onChange={onWechatTypeChange}>
            <Select.Option value="work">企业微信</Select.Option>
            <Select.Option value="webhook">企业微信机器人(Webhook)</Select.Option>
            <Select.Option value="official">微信公众号</Select.Option>
          </Select>
        </Form.Item>

        {wechatType === 'work' && (
          <>
            <Form.Item label="企业ID" name="corpId" rules={[{ required: wechatNotifyEnabled }]}>
              <Input placeholder="ww1234567890abcdef" />
            </Form.Item>
            <Form.Item
              label="应用Secret"
              name="corpSecret"
              rules={[{ required: wechatNotifyEnabled }]}
            >
              <Input.Password placeholder="••••••••" />
            </Form.Item>
            <Form.Item
              label="应用AgentId"
              name="agentId"
              rules={[{ required: wechatNotifyEnabled }]}
            >
              <Input placeholder="1000002" />
            </Form.Item>
          </>
        )}

        {wechatType === 'webhook' && (
          <Form.Item
            label="Webhook URL"
            name="webhookUrl"
            rules={[{ required: wechatNotifyEnabled, type: 'url' }]}
            extra="在企业微信群聊中添加机器人获取"
          >
            <Input placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." />
          </Form.Item>
        )}

        {wechatType === 'official' && (
          <>
            <Form.Item label="AppID" name="appId" rules={[{ required: wechatNotifyEnabled }]}>
              <Input placeholder="wx1234567890abcdef" />
            </Form.Item>
            <Form.Item
              label="AppSecret"
              name="appSecret"
              rules={[{ required: wechatNotifyEnabled }]}
            >
              <Input.Password placeholder="••••••••" />
            </Form.Item>
            <Form.Item label="模板ID" name="templateId" rules={[{ required: wechatNotifyEnabled }]}>
              <Input placeholder="template_id_xxxxx" />
            </Form.Item>
          </>
        )}

        <Button onClick={onSendTestWechat}>发送测试消息</Button>
      </div>
    )}
  </Card>
);

export default AutomationNotifySection;
