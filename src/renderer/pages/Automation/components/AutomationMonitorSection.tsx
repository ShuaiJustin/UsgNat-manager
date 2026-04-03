import React from 'react';
import { Card, Checkbox, Form, InputNumber, Switch } from 'antd';
import type { TFunction } from 'i18next';

import { AUTOMATION_CHECK_SOURCE_OPTIONS } from '@/utils/automationConfig';

interface AutomationMonitorSectionProps {
  t: TFunction;
}

const AutomationMonitorSection: React.FC<AutomationMonitorSectionProps> = ({ t }) => (
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
        rules={[{ required: true }]}
        extra="建议: 5-30分钟"
      >
        <InputNumber min={1} max={60} style={{ width: '100%' }} />
      </Form.Item>

      <Form.Item
        label={t('automation.confirmCount')}
        name="confirmCount"
        rules={[{ required: true }]}
        extra="连续检测到相同IP后确认变更"
      >
        <InputNumber min={1} max={10} style={{ width: '100%' }} />
      </Form.Item>
    </div>

    <Form.Item
      label={t('automation.checkSources')}
      name="checkSources"
      extra="选择用于检测公网IP的数据源，建议保持默认值"
    >
      <Checkbox.Group options={AUTOMATION_CHECK_SOURCE_OPTIONS} />
    </Form.Item>
  </Card>
);

export default AutomationMonitorSection;
