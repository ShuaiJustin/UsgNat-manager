import React from 'react';
import { Card, Col, Row, Statistic } from 'antd';
import {
  CheckCircleOutlined,
  PauseCircleOutlined,
  QuestionCircleOutlined,
  DatabaseOutlined,
  SafetyOutlined,
  SettingOutlined,
} from '@ant-design/icons';

import type { SettingsDatabaseInfo, SettingsSummaryValues, SettingsTranslation } from './types';

interface SettingsOverviewStatsProps {
  databaseInfo: SettingsDatabaseInfo;
  formValues: SettingsSummaryValues;
  t: SettingsTranslation;
  monitorRunning?: boolean;
}

const SettingsOverviewStats: React.FC<SettingsOverviewStatsProps> = ({
  databaseInfo,
  formValues,
  t,
  monitorRunning,
}) => (
  <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
    <Col xs={24} sm={12} lg={6}>
      <Card>
        <Statistic
          title="应用内监控状态"
          value={
            monitorRunning === undefined
              ? '状态未知'
              : monitorRunning
                ? t('settings.running')
                : '已停止'
          }
          prefix={
            monitorRunning === undefined ? (
              <QuestionCircleOutlined />
            ) : monitorRunning ? (
              <CheckCircleOutlined />
            ) : (
              <PauseCircleOutlined />
            )
          }
          valueStyle={{ fontSize: 16, color: monitorRunning === true ? '#52c41a' : '#8c8c8c' }}
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
