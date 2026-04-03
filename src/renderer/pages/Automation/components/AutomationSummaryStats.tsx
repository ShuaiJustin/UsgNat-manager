import React from 'react';
import {
  BellOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Card, Col, Row, Statistic } from 'antd';
import type { TFunction } from 'i18next';

type AutomationSummaryValues = {
  autoUpdateEnabled?: boolean;
  checkInterval?: number;
  ipMonitorEnabled?: boolean;
  windowsNotifyEnabled?: boolean;
};

interface AutomationSummaryStatsProps {
  emailNotifyEnabled: boolean;
  formValues: AutomationSummaryValues;
  t: TFunction;
}

const AutomationSummaryStats: React.FC<AutomationSummaryStatsProps> = ({
  emailNotifyEnabled,
  formValues,
  t,
}) => (
  <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
    <Col xs={24} sm={12} lg={6}>
      <Card>
        <Statistic
          title={t('automation.ipMonitoring')}
          value={
            formValues.ipMonitorEnabled !== false
              ? t('automation.running')
              : t('automation.stopped')
          }
          prefix={<CheckCircleOutlined />}
          valueStyle={{
            fontSize: 16,
            color: formValues.ipMonitorEnabled !== false ? '#52c41a' : '#999',
          }}
        />
      </Card>
    </Col>
    <Col xs={24} sm={12} lg={6}>
      <Card>
        <Statistic
          title={t('automation.checkInterval')}
          value={formValues.checkInterval || 5}
          suffix={t('automation.checkIntervalUnit')}
          prefix={<ClockCircleOutlined />}
          valueStyle={{ fontSize: 16 }}
        />
      </Card>
    </Col>
    <Col xs={24} sm={12} lg={6}>
      <Card>
        <Statistic
          title={t('automation.autoUpdate')}
          value={
            formValues.autoUpdateEnabled === true
              ? t('automation.running')
              : t('automation.stopped')
          }
          prefix={<ThunderboltOutlined />}
          valueStyle={{
            fontSize: 16,
            color: formValues.autoUpdateEnabled === true ? '#1890ff' : '#999',
          }}
        />
      </Card>
    </Col>
    <Col xs={24} sm={12} lg={6}>
      <Card>
        <Statistic
          title={t('automation.serviceStatus')}
          value={
            formValues.windowsNotifyEnabled || emailNotifyEnabled
              ? t('automation.running')
              : t('automation.stopped')
          }
          prefix={<BellOutlined />}
          valueStyle={{
            fontSize: 16,
            color: formValues.windowsNotifyEnabled || emailNotifyEnabled ? '#faad14' : '#999',
          }}
        />
      </Card>
    </Col>
  </Row>
);

export default AutomationSummaryStats;
