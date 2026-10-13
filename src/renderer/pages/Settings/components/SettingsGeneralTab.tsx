import React from 'react';
import { Badge, Button, Card, Form, Select, Space, Switch } from 'antd';

import type { SettingsTranslation } from './types';

interface SettingsGeneralTabProps {
  t: SettingsTranslation;
  monitorRunning?: boolean;
  onPauseService: () => void;
  onRestartService: () => void;
  onViewServiceLog: () => void;
}

const SettingsGeneralTab: React.FC<SettingsGeneralTabProps> = ({
  t,
  monitorRunning,
  onPauseService,
  onRestartService,
  onViewServiceLog,
}) => (
  <>
    <Card title="应用内监控" style={{ marginBottom: 24 }}>
      <p>应用运行期间检测公网 IP。暂停或重启会控制应用内监控和自动化任务。</p>
      <Form.Item label="监控状态">
        <Badge
          status={monitorRunning === true ? 'processing' : 'default'}
          text={
            monitorRunning === undefined
              ? '状态未知'
              : monitorRunning
                ? t('settings.running')
                : '已停止'
          }
        />
      </Form.Item>

      <Space style={{ marginBottom: 15 }}>
        <Button onClick={onPauseService}>暂停监控</Button>
        <Button onClick={onRestartService}>重启监控</Button>
      </Space>

      <Form.Item label={t('settings.autoStart')} name="autoStart" valuePropName="checked">
        <Switch />
      </Form.Item>

      <Space>
        <Button onClick={onViewServiceLog}>{t('settings.viewServiceLog')}</Button>
      </Space>
    </Card>

    <Card title={t('settings.appearance')}>
      <Form.Item label={t('settings.scale')} name="scale">
        <Select style={{ width: 200 }}>
          <Select.Option value="75">75%</Select.Option>
          <Select.Option value="90">90%</Select.Option>
          <Select.Option value="100">
            100% ({t('common.recommend', { defaultValue: '推荐' })})
          </Select.Option>
          <Select.Option value="125">125%</Select.Option>
          <Select.Option value="150">150%</Select.Option>
        </Select>
      </Form.Item>

      <Form.Item label={t('settings.language')} name="language">
        <Select style={{ width: 200 }}>
          <Select.Option value="zh-CN">简体中文</Select.Option>
          <Select.Option value="en-US">English</Select.Option>
        </Select>
      </Form.Item>
    </Card>
  </>
);

export default SettingsGeneralTab;
