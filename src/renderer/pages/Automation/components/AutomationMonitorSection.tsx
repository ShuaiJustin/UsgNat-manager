import React from 'react';
import { Card, Checkbox, Form, InputNumber, Switch } from 'antd';
import type { TFunction } from 'i18next';

import { AUTOMATION_CHECK_SOURCE_OPTIONS } from '@/utils/automationConfig';

interface AutomationMonitorSectionProps {
  t: TFunction;
}

const AutomationMonitorSection: React.FC<AutomationMonitorSectionProps> = ({ t }) => {
  const ipMonitorEnabled = Form.useWatch<boolean>('ipMonitorEnabled');
  const monitorEnabled = ipMonitorEnabled !== false;

  return (
    <Card title={t('automation.ipMonitoring')} style={{ marginBottom: 24 }}>
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
          <InputNumber min={1} max={60} style={{ width: '100%' }} disabled={!monitorEnabled} />
        </Form.Item>

        <Form.Item
          label={t('automation.confirmCount')}
          name="confirmCount"
          required={monitorEnabled}
          rules={monitorEnabled ? [{ required: true }] : []}
          extra={t('automation.confirmCountHint')}
        >
          <InputNumber min={1} max={10} style={{ width: '100%' }} disabled={!monitorEnabled} />
        </Form.Item>
      </div>

      <Form.Item
        label={t('automation.checkSources')}
        name="checkSources"
        required={monitorEnabled}
        rules={
          monitorEnabled
            ? [
                {
                  validator: async (_rule, value: string[] | undefined) => {
                    if (Array.isArray(value) && value.length > 0) {
                      return;
                    }

                    throw new Error(t('automation.selectCheckSources'));
                  },
                },
              ]
            : []
        }
        extra={t('automation.checkSourcesHint')}
      >
        <Checkbox.Group options={AUTOMATION_CHECK_SOURCE_OPTIONS} disabled={!monitorEnabled} />
      </Form.Item>
    </Card>
  );
};

export default AutomationMonitorSection;
