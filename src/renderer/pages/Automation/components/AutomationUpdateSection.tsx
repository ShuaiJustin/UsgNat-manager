import React from 'react';
import { Card, Checkbox, Form, InputNumber, Radio, Space, TimePicker, Switch } from 'antd';
import type { TFunction } from 'i18next';

import type { Device } from '@/types';

interface AutomationUpdateSectionProps {
  devices: Device[];
  t: TFunction;
}

const AutomationUpdateSection: React.FC<AutomationUpdateSectionProps> = ({ devices, t }) => (
  <Card title={t('automation.autoUpdate')}>
    <Form.Item
      label={t('automation.enableAutoUpdate')}
      name="autoUpdateEnabled"
      valuePropName="checked"
    >
      <Switch />
    </Form.Item>

    <Form.Item
      label={t('automation.selectDevices')}
      name="selectedDevices"
      extra="勾选需要自动更新NAT规则的设备"
    >
      <Checkbox.Group style={{ width: '100%' }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          {devices.length === 0 ? (
            <div style={{ color: '#999' }}>{t('common.loading')}</div>
          ) : (
            devices.map((device) => (
              <Checkbox key={device.id} value={device.id}>
                <span style={{ fontWeight: 500 }}>{device.name}</span>
                <span style={{ marginLeft: 8, color: '#666' }}>({device.host})</span>
                {device.online && (
                  <span style={{ marginLeft: 8, color: '#52c41a' }}>● {t('devices.online')}</span>
                )}
              </Checkbox>
            ))
          )}
        </Space>
      </Checkbox.Group>
    </Form.Item>

    <Form.Item label={t('automation.triggerType')} name="triggerType">
      <Radio.Group>
        <Space direction="vertical">
          <Radio value="immediate">{t('automation.immediate')}</Radio>
          <Radio value="delayed">{t('automation.delayed')}</Radio>
          <Radio value="scheduled">{t('automation.scheduled')}</Radio>
        </Space>
      </Radio.Group>
    </Form.Item>

    <Form.Item noStyle shouldUpdate={(prev, curr) => prev.triggerType !== curr.triggerType}>
      {({ getFieldValue }) =>
        getFieldValue('triggerType') === 'delayed' ? (
          <Form.Item
            label={t('automation.delayTime')}
            name="delayMinutes"
            rules={[{ required: true, message: '请输入延迟时间' }]}
            extra="建议: 1-60分钟"
          >
            <InputNumber min={1} max={60} placeholder="5" style={{ width: 200 }} />
          </Form.Item>
        ) : null
      }
    </Form.Item>

    <Form.Item noStyle shouldUpdate={(prev, curr) => prev.triggerType !== curr.triggerType}>
      {({ getFieldValue }) =>
        getFieldValue('triggerType') === 'scheduled' ? (
          <Form.Item
            label={t('automation.scheduledTime')}
            name="scheduledTime"
            rules={[{ required: true, message: '请选择更新时间' }]}
          >
            <TimePicker format="HH:mm" style={{ width: 200 }} />
          </Form.Item>
        ) : null
      }
    </Form.Item>

    <Form.Item label="备份策略" name="backupOptions">
      <Checkbox.Group>
        <Space direction="vertical">
          <Checkbox value="autoBackup">更新前自动备份配置</Checkbox>
          <Checkbox value="keepBackups">保留最近N个备份</Checkbox>
          <Checkbox value="autoRollback">更新失败时自动回滚</Checkbox>
        </Space>
      </Checkbox.Group>
    </Form.Item>

    <Form.Item noStyle shouldUpdate={(prev, curr) => prev.backupOptions !== curr.backupOptions}>
      {({ getFieldValue }) =>
        getFieldValue('backupOptions')?.includes('keepBackups') ? (
          <Form.Item
            label="保留备份数量"
            name="backupKeepCount"
            extra="保留最近N个设备配置备份"
            initialValue={10}
          >
            <InputNumber min={1} max={50} style={{ width: 200 }} />
          </Form.Item>
        ) : null
      }
    </Form.Item>

    <Form.Item label="安全选项" name="securityOptions">
      <Checkbox.Group>
        <Space direction="vertical">
          <Checkbox value="verifyRules">更新后验证规则生效</Checkbox>
          <Checkbox value="integrityCheck">执行完整性检查</Checkbox>
          <Checkbox value="manualConfirm">更新前需要手动确认</Checkbox>
        </Space>
      </Checkbox.Group>
    </Form.Item>
  </Card>
);

export default AutomationUpdateSection;
