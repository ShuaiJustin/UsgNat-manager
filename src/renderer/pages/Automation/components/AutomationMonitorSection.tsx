import React from 'react';
import { Alert, Card, Form, InputNumber, Switch } from 'antd';
import type { TFunction } from 'i18next';

interface AutomationMonitorSectionProps {
  t: TFunction;
}

const AutomationMonitorSection: React.FC<AutomationMonitorSectionProps> = ({ t }) => {
  const ipMonitorEnabled = Form.useWatch<boolean>('ipMonitorEnabled');
  const monitorEnabled = ipMonitorEnabled !== false;

  return (
    <Card>
      <Form.Item
        label={t('automation.enableMonitoring')}
        name="ipMonitorEnabled"
        valuePropName="checked"
      >
        <Switch />
      </Form.Item>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Form.Item
          label={t('automation.checkInterval')}
          name="checkInterval"
          required={monitorEnabled}
          rules={monitorEnabled ? [{ required: true }] : []}
          extra={t('automation.checkIntervalHint')}
        >
          <InputNumber
            min={1}
            max={60}
            addonAfter="分钟"
            style={{ width: '100%' }}
            disabled={!monitorEnabled}
          />
        </Form.Item>

        <Form.Item
          label={t('automation.confirmCount')}
          name="confirmCount"
          required={monitorEnabled}
          rules={monitorEnabled ? [{ required: true }] : []}
          extra={t('automation.confirmCountHint')}
        >
          <InputNumber
            min={1}
            max={10}
            addonAfter="次"
            style={{ width: '100%' }}
            disabled={!monitorEnabled}
          />
        </Form.Item>
      </div>

      <Form.Item label={t('automation.checkSources')}>
        <Alert
          type="info"
          showIcon
          message={t('automation.firewallWANSource')}
          description={t('automation.firewallWANSourceHint')}
        />
      </Form.Item>
    </Card>
  );
};

export default AutomationMonitorSection;
