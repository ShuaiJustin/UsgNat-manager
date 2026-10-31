import React, { useEffect } from 'react';
import { CloudOutlined, ClockCircleOutlined, LaptopOutlined } from '@ant-design/icons';
import { Badge, Layout, Space, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { Device } from '@/types';
import { useMonitorStore } from '@/stores/monitor.store';

const { Header } = Layout;
const { Text } = Typography;

const StatusBar: React.FC = () => {
  const { t } = useTranslation();
  const { currentIP, isMonitoring, setCurrentIP, setMonitoring } = useMonitorStore();

  const { data: ip, isPending: ipPending } = useQuery({
    queryKey: ['currentIP'],
    queryFn: async () => {
      const api = window.electronAPI;
      if (!api?.monitor?.getCurrentIP) {
        throw new Error('monitor API 未就绪');
      }
      return api.monitor.getCurrentIP();
    },
    refetchInterval: 60000,
    enabled: typeof window.electronAPI?.monitor?.getCurrentIP === 'function',
    retry: false,
  });

  const { data: status, isError: statusError } = useQuery({
    queryKey: ['monitor', 'status'],
    queryFn: () => window.electronAPI.monitor.getStatus(),
    refetchInterval: 5000,
    retry: false,
  });

  const { data: devices } = useQuery<Device[]>({
    queryKey: ['devices'],
    queryFn: async () => {
      const api = window.electronAPI;
      if (!api?.device?.getAll) {
        throw new Error('device API 未就绪');
      }
      return api.device.getAll();
    },
    refetchInterval: 30000,
    enabled: typeof window.electronAPI?.device?.getAll === 'function',
    retry: 2,
  });

  useEffect(() => {
    setMonitoring(!statusError && Boolean(status?.isRunning));
    setCurrentIP(statusError ? '' : status?.isRunning ? status.currentIP || '' : ip || '');
  }, [ip, status, statusError, setCurrentIP, setMonitoring]);

  const onlineDevices = devices?.filter((device) => device.online).length || 0;
  const totalDevices = devices?.length || 0;

  return (
    <Header
      style={{
        background: '#fff',
        padding: '0 20px',
        borderBottom: '1px solid #e8e8e8',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        height: 44,
        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.04)',
      }}
    >
      <Space size="large">
        <Space>
          <CloudOutlined style={{ color: '#1890ff' }} />
          <Text strong>{t('statusBar.currentIP')}:</Text>
          <Text>{currentIP || t(ipPending ? 'statusBar.fetching' : 'statusBar.unavailable')}</Text>
        </Space>

        <Space>
          <LaptopOutlined style={{ color: '#52c41a' }} />
          <Text strong>{t('statusBar.deviceStatus')}:</Text>
          <Text>
            {onlineDevices}/{totalDevices} {t('statusBar.online')}
          </Text>
        </Space>

        <Space>
          <ClockCircleOutlined style={{ color: isMonitoring ? '#52c41a' : '#999' }} />
          <Text strong>{t('statusBar.monitoring')}:</Text>
          <Badge
            status={isMonitoring ? 'processing' : 'default'}
            text={isMonitoring ? t('statusBar.running') : t('statusBar.stopped')}
          />
        </Space>
      </Space>
    </Header>
  );
};

export default StatusBar;
