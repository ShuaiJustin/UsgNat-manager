import React from 'react';
import { Card, Col, Row, Statistic } from 'antd';
import {
  CheckCircleOutlined,
  DatabaseOutlined,
  SafetyOutlined,
  SettingOutlined,
} from '@ant-design/icons';

import type { SettingsDatabaseInfo, SettingsSummaryValues, SettingsTranslation } from './types';

interface SettingsOverviewStatsProps {
  databaseInfo: SettingsDatabaseInfo;
  formValues: SettingsSummaryValues;
  t: SettingsTranslation;
}

const SettingsOverviewStats: React.FC<SettingsOverviewStatsProps> = ({
  databaseInfo,
  formValues,
  t,
}) => (
  <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
    <Col xs={24} sm={12} lg={6}>
      <Card>
        <Statistic
          title={t('settings.serviceStatus')}
          value={t('settings.running')}
          prefix={<CheckCircleOutlined />}
          valueStyle={{ fontSize: 16, color: '#52c41a' }}
        />
      </Card>
    </Col>
    <Col xs={24} sm={12} lg={6}>
      <Card>
        <Statistic
          title={t('settings.interfaceScale')}
          value={formValues.scale || '100'}
          suffix="%"
          prefix={<SettingOutlined />}
          valueStyle={{ fontSize: 16 }}
        />
      </Card>
    </Col>
    <Col xs={24} sm={12} lg={6}>
      <Card>
        <Statistic
          title={t('settings.databaseSize')}
          value={databaseInfo.size}
          prefix={<DatabaseOutlined />}
          valueStyle={{ fontSize: 16 }}
        />
      </Card>
    </Col>
    <Col xs={24} sm={12} lg={6}>
      <Card>
        <Statistic
          title={t('settings.logRetention')}
          value={formValues.logRetentionDays || 30}
          suffix={t('settings.days')}
          prefix={<SafetyOutlined />}
          valueStyle={{ fontSize: 16 }}
        />
      </Card>
    </Col>
  </Row>
);

export default SettingsOverviewStats;
