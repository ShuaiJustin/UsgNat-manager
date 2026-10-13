import React from 'react';
import {
  Button,
  Card,
  Checkbox,
  Collapse,
  Empty,
  Form,
  InputNumber,
  Radio,
  Space,
  Switch,
  Table,
  Tag,
  TimePicker,
  Typography,
} from 'antd';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import type { TFunction } from 'i18next';
import { useNavigate } from 'react-router-dom';

import type { Device, NatRule } from '@/types';
import { toggleManagedDevice } from '../automationSelection';

const { Text } = Typography;

interface AutomationUpdateSectionProps {
  devices: Device[];
  rules: NatRule[];
  selectedDeviceIds: string[];
  managedRuleIds: string[];
  onSelectionChange: (selectedDevices: string[], managedRuleIds: string[]) => void;
  t: TFunction;
}

const ruleColumns = [
  { title: '规则名称', dataIndex: 'ruleName', key: 'ruleName' },
  {
    title: '协议',
    dataIndex: 'protocol',
    key: 'protocol',
    width: 80,
    render: (protocol: string) => <Tag>{protocol}</Tag>,
  },
  {
    title: '公网端口',
    key: 'global',
    width: 110,
    render: (_: unknown, rule: NatRule) => rule.globalPort,
  },
  {
    title: '内网地址',
    key: 'inside',
    render: (_: unknown, rule: NatRule) => `${rule.insideIp}:${rule.insidePort}`,
  },
];

const AutomationUpdateSection: React.FC<AutomationUpdateSectionProps> = ({
  devices,
  rules,
  selectedDeviceIds,
  managedRuleIds,
  onSelectionChange,
  t,
}) => {
  const navigate = useNavigate();
  const autoUpdateEnabled = Form.useWatch<boolean>('autoUpdateEnabled');
  const selectedCount = managedRuleIds.length;

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Form.Item name="autoUpdateEnabled" valuePropName="checked" noStyle>
          <Switch />
        </Form.Item>
        <div>
          <div style={{ fontWeight: 500 }}>{t('automation.enableAutoUpdate')}</div>
          <Text type="secondary">公网 IP 变化后，自动把下面勾选的规则改成新的公网 IP。</Text>
        </div>
      </div>

      <div
        style={{
          marginTop: 16,
          padding: '8px 12px',
          background: '#f6ffed',
          border: '1px solid #b7eb8f',
          borderRadius: 6,
          color: '#389e0d',
        }}
      >
        <SafetyCertificateOutlined /> 修改前会先在防火墙接口（如 Dialer0）上核对新 IP，
        不一致时不会改动任何规则。
      </div>

      {/* Registered so validation and save see the selection managed below. */}
      <Form.Item name="selectedDevices" hidden />
      <Form.Item name="managedRuleIds" hidden />

      <h4 style={{ margin: '24px 0 4px' }}>要自动更新的规则</h4>
      <Text type="secondary">
        勾选设备后默认选中它的全部启用规则，可以再取消不想自动修改的规则。
        {autoUpdateEnabled && selectedCount > 0 && `当前已选 ${selectedCount} 条。`}
      </Text>

      <Space direction="vertical" style={{ width: '100%', marginTop: 12 }} size={12}>
        {devices.length === 0 && (
          <Empty description="还没有启用的设备" image={Empty.PRESENTED_IMAGE_SIMPLE}>
            <Button onClick={() => navigate('/devices')}>去添加设备</Button>
          </Empty>
        )}
        {devices.map((device) => {
          const deviceRules = rules.filter((rule) => rule.deviceId === device.id);
          const checked = selectedDeviceIds.includes(device.id);
          const chosen = deviceRules.filter((rule) => managedRuleIds.includes(rule.id));
          return (
            <div
              key={device.id}
              style={{
                border: `1px solid ${checked ? '#ffccc7' : '#f0f0f0'}`,
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Checkbox
                  checked={checked}
                  onChange={(event) =>
                    onSelectionChange(
                      ...toggleManagedDevice(
                        { selectedDevices: selectedDeviceIds, managedRuleIds },
                        device.id,
                        event.target.checked,
                        deviceRules.map((rule) => rule.id)
                      )
                    )
                  }
                >
                  <span style={{ fontWeight: 500 }}>{device.name}</span>
                </Checkbox>
                <Text type="secondary">{device.host}</Text>
                <Tag color={device.online ? 'success' : 'default'}>
                  {device.online ? t('devices.online') : t('devices.offline')}
                </Tag>
                {checked && (
                  <Text type="secondary" style={{ marginLeft: 'auto' }}>
                    已选 {chosen.length}/{deviceRules.length} 条
                  </Text>
                )}
              </div>

              {checked &&
                (deviceRules.length ? (
                  <Table
                    style={{ marginTop: 12 }}
                    size="small"
                    rowKey="id"
                    pagination={false}
                    columns={ruleColumns}
                    dataSource={deviceRules}
                    scroll={deviceRules.length > 8 ? { y: 320 } : undefined}
                    rowSelection={{
                      selectedRowKeys: chosen.map((rule) => rule.id),
                      getCheckboxProps: (rule) => ({ title: rule.ruleName }),
                      onChange: (keys) =>
                        onSelectionChange(selectedDeviceIds, [
                          ...managedRuleIds.filter(
                            (id) => !deviceRules.some((rule) => rule.id === id)
                          ),
                          ...(keys as string[]),
                        ]),
                    }}
                  />
                ) : (
                  <div style={{ marginTop: 12 }}>
                    <Text type="secondary">这台设备还没有读取到启用的规则。</Text>
                    <Button type="link" onClick={() => navigate('/rules')}>
                      去规则管理读取
                    </Button>
                  </div>
                ))}
            </div>
          );
        })}
      </Space>

      <h4 style={{ margin: '24px 0 8px' }}>{t('automation.triggerType')}</h4>
      <Form.Item name="triggerType" style={{ marginBottom: 8 }}>
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
            >
              <InputNumber min={1} max={60} addonAfter="分钟" style={{ width: 200 }} />
            </Form.Item>
          ) : getFieldValue('triggerType') === 'scheduled' ? (
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

      <Collapse
        ghost
        style={{ marginTop: 8, marginLeft: -16 }}
        items={[
          {
            key: 'advanced',
            // Mounted while collapsed so saving always sees these options.
            forceRender: true,
            label: '高级选项（备份与安全）',
            children: (
              <>
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                  每次修改前都会自动备份设备配置，修改后都会回读核验，这两项始终开启。
                </Text>
                <Form.Item name="backupOptions" style={{ marginBottom: 8 }}>
                  <Checkbox.Group>
                    <Space direction="vertical">
                      <Checkbox value="autoRollback">修改失败时自动恢复原来的规则</Checkbox>
                      <Checkbox value="keepBackups">只保留最近若干份设备备份</Checkbox>
                    </Space>
                  </Checkbox.Group>
                </Form.Item>
                <Form.Item
                  noStyle
                  shouldUpdate={(prev, curr) => prev.backupOptions !== curr.backupOptions}
                >
                  {({ getFieldValue }) =>
                    getFieldValue('backupOptions')?.includes('keepBackups') ? (
                      <Form.Item label="保留份数" name="backupKeepCount">
                        <InputNumber min={1} max={50} addonAfter="份" style={{ width: 200 }} />
                      </Form.Item>
                    ) : null
                  }
                </Form.Item>
                <Form.Item name="securityOptions" style={{ marginBottom: 0 }}>
                  <Checkbox.Group>
                    <Space direction="vertical">
                      <Checkbox value="manualConfirm">每次修改前弹窗让我确认</Checkbox>
                      <Checkbox value="integrityCheck">修改前检查规则完整性</Checkbox>
                    </Space>
                  </Checkbox.Group>
                </Form.Item>
              </>
            ),
          },
        ]}
      />
    </Card>
  );
};

export default AutomationUpdateSection;
