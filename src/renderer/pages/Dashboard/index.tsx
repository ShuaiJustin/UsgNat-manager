import React from 'react';
import { Row, Col, Card, Statistic, Button, Space, Timeline, Tag, Modal, Select, App } from 'antd';
import {
  CloudOutlined,
  LaptopOutlined,
  FileTextOutlined,
  ClockCircleOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  SyncOutlined,
  FileSearchOutlined,
  SwapOutlined,
  SaveOutlined,
  ExportOutlined,
} from '@ant-design/icons';
import { useMonitorStore } from '@/stores/monitor.store';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Device } from '@/types';

const Dashboard: React.FC = () => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { currentIP, isMonitoring, startMonitor, stopMonitor, setMonitoring, setCurrentIP } =
    useMonitorStore();
  const navigate = useNavigate();
  const [syncModalVisible, setSyncModalVisible] = React.useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = React.useState<string>();

  // 初始化监控状态和当前IP
  React.useEffect(() => {
    const initializeMonitorStatus = async () => {
      try {
        const api = (window as any).electronAPI;
        if (api?.monitor?.getStatus) {
          const status = await api.monitor.getStatus();
          setMonitoring(status.isRunning || false);
          setCurrentIP(status.currentIP || '');
        }
      } catch (error) {
        console.error('获取监控状态失败:', error);
      }
    };

    initializeMonitorStatus();
  }, [setMonitoring, setCurrentIP]);

  // 获取设备统计
  const { data: devices } = useQuery<Device[]>({
    queryKey: ['devices'],
    queryFn: async () => {
      const api = (window as any).electronAPI;
      if (!api?.device?.getAll) {
        throw new Error('device API 未就绪');
      }
      return await api.device.getAll();
    },
    enabled: typeof (window as any).electronAPI?.device?.getAll === 'function',
    retry: 2,
  });

  const onlineDevices = devices?.filter((d) => d.online).length || 0;
  const totalDevices = devices?.length || 0;

  // 获取自动化配置
  const { data: automationConfig } = useQuery({
    queryKey: ['automation', 'config'],
    queryFn: async () => {
      const api = (window as any).electronAPI;
      if (!api?.automation?.getConfig) {
        throw new Error('automation API 未就绪');
      }
      return await api.automation.getConfig();
    },
    retry: 2,
  });

  // 获取规则总数（优化：直接从后端获取统计数据）
  const { data: totalRules } = useQuery({
    queryKey: ['rules', 'totalCount'],
    queryFn: async () => {
      const api = (window as any).electronAPI;
      if (!api?.rule?.getTotalCount) {
        throw new Error('rule API 未就绪');
      }
      return await api.rule.getTotalCount();
    },
    enabled: typeof (window as any).electronAPI?.rule?.getTotalCount === 'function',
    retry: 2,
  });

  // 获取最近事件（从日志）
  const { data: recentEvents } = useQuery({
    queryKey: ['logs', 'recent'],
    queryFn: async () => {
      const api = (window as any).electronAPI;
      if (!api?.log?.query) {
        return [];
      }
      const logs = await api.log.query({
        limit: 10,
        orderBy: 'desc',
      });
      return logs || [];
    },
    refetchInterval: 30000, // 每30秒刷新一次
    retry: 2,
  });

  // 启动监控
  const startMonitorMutation = useMutation({
    mutationFn: async () => {
      const api = (window as any).electronAPI;
      if (!api?.monitor?.start) {
        throw new Error('monitor API 未就绪');
      }
      return await api.monitor.start();
    },
    onSuccess: (result) => {
      startMonitor();
      message.success(result.message || t('dashboard.startMonitoring'));
    },
    onError: (error: any) => {
      const errorMsg = error?.error || error?.message || t('common.error');
      const details = error?.details;
      message.error(details ? `${errorMsg}: ${details}` : errorMsg, 5);
    },
  });

  // 停止监控
  const stopMonitorMutation = useMutation({
    mutationFn: async () => {
      const api = (window as any).electronAPI;
      if (!api?.monitor?.stop) {
        throw new Error('monitor API 未就绪');
      }
      return await api.monitor.stop();
    },
    onSuccess: () => {
      stopMonitor();
      message.success(t('dashboard.stopMonitoring'));
    },
    onError: () => {
      message.error(t('common.error'));
    },
  });

  // 手动更新IP
  const manualUpdateMutation = useMutation({
    mutationFn: async () => {
      const api = (window as any).electronAPI;
      if (!api?.automation?.manualUpdate) {
        throw new Error('automation API 未就绪');
      }
      return await api.automation.manualUpdate();
    },
    onSuccess: () => {
      message.success(t('common.success'));
    },
    onError: () => {
      message.error(t('common.error'));
    },
  });

  // 同步规则
  const syncRuleMutation = useMutation({
    mutationFn: async (deviceId: string) => {
      const api = (window as any).electronAPI;
      if (!api?.rule?.syncFromDevice) {
        throw new Error('rule API 未就绪');
      }
      return await api.rule.syncFromDevice(deviceId);
    },
    onSuccess: (data) => {
      message.success(`${t('common.success')}, ${data.length} ${t('rules.title')}`);
      setSyncModalVisible(false);
    },
    onError: () => {
      message.error(t('rules.syncFailed'));
    },
  });

  // 备份配置
  const backupMutation = useMutation({
    mutationFn: async () => {
      const api = (window as any).electronAPI;
      if (!api?.backup?.create) {
        throw new Error('backup API 未就绪');
      }
      return await api.backup.create('手动备份');
    },
    onSuccess: (data) => {
      message.success(`${t('common.success')}: ${data.filename}`);
    },
    onError: () => {
      message.error(t('common.error'));
    },
  });

  // 导出日志
  const exportLogMutation = useMutation({
    mutationFn: async () => {
      const api = (window as any).electronAPI;
      if (!api?.log?.export) {
        throw new Error('log API 未就绪');
      }
      return await api.log.export({});
    },
    onSuccess: (csv) => {
      // 创建下载链接
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `logs_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      message.success(t('common.success'));
    },
    onError: () => {
      message.error(t('common.error'));
    },
  });

  return (
    <div>
      {/* 状态卡片 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title={t('dashboard.currentIP')}
              value={currentIP || t('common.loading')}
              prefix={<CloudOutlined />}
              valueStyle={{ fontSize: 20, color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title={t('dashboard.onlineDevices')}
              value={onlineDevices}
              suffix={`/ ${totalDevices}`}
              prefix={<LaptopOutlined />}
              valueStyle={{ fontSize: 20, color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title={t('dashboard.totalRules')}
              value={totalRules || 0}
              prefix={<FileTextOutlined />}
              valueStyle={{ fontSize: 20 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title={t('automation.checkInterval')}
              value={automationConfig?.checkInterval || 5}
              suffix={t('automation.checkIntervalUnit')}
              prefix={<ClockCircleOutlined />}
              valueStyle={{ fontSize: 20 }}
            />
          </Card>
        </Col>
      </Row>

      {/* 快速操作 */}
      <Card title={t('dashboard.quickActions')} style={{ marginBottom: 24 }}>
        <Space size="middle" wrap>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={() => startMonitorMutation.mutate()}
            disabled={isMonitoring}
            loading={startMonitorMutation.isPending}
          >
            {t('dashboard.startMonitoring')}
          </Button>
          <Button
            danger
            icon={<PauseCircleOutlined />}
            onClick={() => stopMonitorMutation.mutate()}
            disabled={!isMonitoring}
            loading={stopMonitorMutation.isPending}
          >
            {t('dashboard.stopMonitoring')}
          </Button>
          <Button
            icon={<SyncOutlined />}
            onClick={() => manualUpdateMutation.mutate()}
            loading={manualUpdateMutation.isPending}
          >
            手动更新规则
          </Button>
          <Button icon={<FileSearchOutlined />} onClick={() => navigate('/logs')}>
            {t('dashboard.viewLogs')}
          </Button>
          <Button
            icon={<SwapOutlined />}
            onClick={() => setSyncModalVisible(true)}
            disabled={!devices || devices.length === 0}
          >
            {t('dashboard.syncRules')}
          </Button>
          <Button
            icon={<SaveOutlined />}
            onClick={() => backupMutation.mutate()}
            loading={backupMutation.isPending}
          >
            {t('dashboard.backupData')}
          </Button>
          <Button
            icon={<ExportOutlined />}
            onClick={() => exportLogMutation.mutate()}
            loading={exportLogMutation.isPending}
          >
            {t('logs.exportLogs')}
          </Button>
        </Space>
      </Card>

      {/* 最近事件 */}
      <Card title={t('dashboard.recentEvents')}>
        <Timeline
          items={
            recentEvents && recentEvents.length > 0
              ? recentEvents.map((event: any) => {
                  // 根据日志级别确定颜色和标签
                  let color = 'blue';
                  let tagColor = 'default';
                  let tagText = t('common.info');

                  if (event.level === 'INFO') {
                    color = 'blue';
                    tagColor = 'default';
                    tagText = '信息';
                  } else if (event.level === 'SUCCESS') {
                    color = 'green';
                    tagColor = 'success';
                    tagText = '成功';
                  } else if (event.level === 'WARNING') {
                    color = 'orange';
                    tagColor = 'warning';
                    tagText = '警告';
                  } else if (event.level === 'ERROR') {
                    color = 'red';
                    tagColor = 'error';
                    tagText = '错误';
                  }

                  return {
                    color,
                    children: (
                      <div>
                        <div style={{ color: '#999', fontSize: 12, marginBottom: 4 }}>
                          {(() => {
                            if (!event.createdAt) return '-';
                            try {
                              const d = new Date(event.createdAt);
                              if (isNaN(d.getTime())) return '-';
                              return d.toLocaleTimeString('zh-CN', {
                                hour: '2-digit',
                                minute: '2-digit',
                              });
                            } catch {
                              return '-';
                            }
                          })()}
                        </div>
                        <div>
                          <Tag color={tagColor}>{tagText}</Tag>
                          {event.operation && (
                            <span style={{ marginRight: 8 }}>{event.operation}</span>
                          )}
                          {event.message}
                        </div>
                      </div>
                    ),
                  };
                })
              : [
                  // 默认占位数据（当没有日志时显示）
                  {
                    color: 'gray',
                    children: <div style={{ color: '#999' }}>{t('dashboard.recentEvents')}</div>,
                  },
                ]
          }
        />
      </Card>

      {/* 同步规则对话框 */}
      <Modal
        title={t('dashboard.syncRules')}
        open={syncModalVisible}
        onCancel={() => setSyncModalVisible(false)}
        onOk={() => {
          if (selectedDeviceId) {
            syncRuleMutation.mutate(selectedDeviceId);
          } else {
            message.warning(t('devices.deviceName'));
          }
        }}
        confirmLoading={syncRuleMutation.isPending}
      >
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8 }}>{t('automation.selectDevices')}:</div>
          <Select
            style={{ width: '100%' }}
            placeholder={t('devices.deviceName')}
            value={selectedDeviceId}
            onChange={setSelectedDeviceId}
            options={devices?.map((d) => ({
              label: `${d.name} (${d.host})`,
              value: d.id,
              disabled: !d.online,
            }))}
          />
        </div>
        <div style={{ color: '#999', fontSize: 12 }}>{t('rules.getFromDevice')}</div>
      </Modal>
    </div>
  );
};

export default Dashboard;
