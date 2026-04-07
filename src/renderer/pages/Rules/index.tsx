import React, { useState } from 'react';
import { App, Button, Card, Input, Popconfirm, Select, Space, Table, Tag } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';

import type { Device, NatRule } from '@/types';
import { createTablePagination } from '@/utils/tablePagination';
import RuleModal from './RuleModal';
import {
  buildRulesCsv,
  resolveActiveRuleDeviceId,
  resolveCurrentRuleDevice,
  shouldShowRuleBatchActions,
} from './rulePageHelpers';

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const Rules: React.FC = () => {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const [searchText, setSearchText] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [protocolFilter, setProtocolFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<NatRule | null>(null);
  const queryClient = useQueryClient();

  const { data: devices } = useQuery<Device[]>({
    queryKey: ['devices'],
    queryFn: async () => {
      const api = window.electronAPI;
      if (!api?.device?.getAll) {
        throw new Error('device API 未就绪');
      }
      return api.device.getAll();
    },
    enabled: typeof window.electronAPI?.device?.getAll === 'function',
    retry: 2,
  });

  const activeDeviceId = resolveActiveRuleDeviceId(devices, selectedDeviceId);

  const { data: rules, isLoading } = useQuery<NatRule[]>({
    queryKey: ['rules', activeDeviceId],
    queryFn: async () => {
      const api = window.electronAPI;
      if (!api?.rule?.getAll) {
        throw new Error('rule API 未就绪');
      }
      return api.rule.getAll(activeDeviceId);
    },
    enabled: !!activeDeviceId && typeof window.electronAPI?.rule?.getAll === 'function',
    retry: 2,
  });

  const syncFromDeviceMutation = useMutation({
    mutationFn: async (deviceId: string) => {
      const api = window.electronAPI;
      if (!api?.rule?.syncFromDevice) {
        throw new Error('rule API 未就绪');
      }
      return api.rule.syncFromDevice(deviceId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rules'] });
      message.success(t('rules.syncSuccess'));
    },
    onError: () => {
      message.error(t('rules.syncFailed'));
    },
  });

  const syncToDeviceMutation = useMutation({
    mutationFn: async (deviceId: string) => {
      const api = window.electronAPI;
      if (!api?.rule?.syncToDevice) {
        throw new Error('rule API 未就绪');
      }
      return api.rule.syncToDevice(deviceId);
    },
    onSuccess: (data) => {
      if (data.syncedCount === 0) {
        message.info(data.message || t('common.info'));
      } else {
        message.success(data.message || `${t('rules.syncSuccess')} ${data.syncedCount}`);
      }
    },
    onError: (error: unknown) => {
      message.error(getErrorMessage(error, t('rules.syncFailed')));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const api = window.electronAPI;
      if (!api?.rule?.delete) {
        throw new Error('rule API 未就绪');
      }
      return api.rule.delete(id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rules'] });
      message.success(t('common.success'));
    },
    onError: () => {
      message.error(t('common.error'));
    },
  });

  const columns: ColumnsType<NatRule> = [
    {
      title: t('rules.ruleName'),
      dataIndex: 'ruleName',
      key: 'ruleName',
    },
    {
      title: t('rules.protocol'),
      dataIndex: 'protocol',
      key: 'protocol',
      render: (protocol: NatRule['protocol']) => <Tag color="blue">{protocol}</Tag>,
    },
    {
      title: t('rules.globalIP'),
      dataIndex: 'globalIp',
      key: 'globalIp',
    },
    {
      title: t('rules.globalPort'),
      dataIndex: 'globalPort',
      key: 'globalPort',
    },
    {
      title: t('rules.insideIP'),
      dataIndex: 'insideIp',
      key: 'insideIp',
    },
    {
      title: t('rules.insidePort'),
      dataIndex: 'insidePort',
      key: 'insidePort',
    },
    {
      title: t('devices.status'),
      dataIndex: 'enabled',
      key: 'enabled',
      render: (enabled: boolean) => (
        <Tag color={enabled ? 'success' : 'default'}>
          {enabled ? t('rules.enabled') : t('rules.disabled')}
        </Tag>
      ),
    },
    {
      title: t('devices.actions'),
      key: 'action',
      width: 150,
      render: (_, record) => (
        <Space size="small">
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setEditingRule(record);
              setIsModalOpen(true);
            }}
          >
            {t('common.edit')}
          </Button>
          <Popconfirm
            title={t('common.delete')}
            description={t('rules.deleteConfirm')}
            onConfirm={() => deleteMutation.mutate(record.id)}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              {t('common.delete')}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const filteredRules = rules?.filter((rule) => {
    const matchesSearch =
      rule.ruleName.toLowerCase().includes(searchText.toLowerCase()) ||
      rule.globalIp.includes(searchText) ||
      rule.insideIp.includes(searchText);
    const matchesProtocol = protocolFilter === 'all' || rule.protocol === protocolFilter;
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'enabled' && rule.enabled) ||
      (statusFilter === 'disabled' && !rule.enabled);

    return matchesSearch && matchesProtocol && matchesStatus;
  });

  const handleBatchUpdateIP = () => {
    if (selectedRowKeys.length === 0) {
      message.warning(t('common.warning'));
      return;
    }

    modal.confirm({
      title: t('rules.batchUpdate'),
      content: (
        <div>
          <p>
            {t('rules.batchUpdate')} {selectedRowKeys.length}
          </p>
          <Input placeholder={t('devices.host')} id="newIpInput" style={{ marginTop: 8 }} />
        </div>
      ),
      onOk: async () => {
        const newIp = (document.getElementById('newIpInput') as HTMLInputElement)?.value;
        if (!newIp) {
          message.error('请输入新的 IP 地址');
          return Promise.reject();
        }

        const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (!ipPattern.test(newIp)) {
          message.error('请输入有效的 IP 地址');
          return Promise.reject();
        }

        const parts = newIp.split('.').map(Number);
        if (parts.some((part) => part < 0 || part > 255)) {
          message.error('IP 地址段必须在 0-255 之间');
          return Promise.reject();
        }

        try {
          await window.electronAPI.rule.batchUpdateIP(
            activeDeviceId,
            selectedRowKeys.map(String),
            newIp
          );
          await queryClient.invalidateQueries({ queryKey: ['rules'] });
          message.success(`${t('common.success')} ${selectedRowKeys.length}`);
          setSelectedRowKeys([]);
        } catch (error) {
          message.error(`更新失败: ${getErrorMessage(error, t('common.error'))}`);
          return Promise.reject();
        }
      },
    });
  };

  const handleBatchEnable = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning(t('common.warning'));
      return;
    }

    try {
      await window.electronAPI.rule.batchUpdate(selectedRowKeys.map(String), { enabled: true });
      await queryClient.invalidateQueries({ queryKey: ['rules'] });
      message.success(`${t('rules.enabled')} ${selectedRowKeys.length}`);
      setSelectedRowKeys([]);
    } catch (error) {
      message.error(`启用失败: ${getErrorMessage(error, t('common.error'))}`);
    }
  };

  const handleBatchDisable = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning(t('common.warning'));
      return;
    }

    try {
      await window.electronAPI.rule.batchUpdate(selectedRowKeys.map(String), { enabled: false });
      await queryClient.invalidateQueries({ queryKey: ['rules'] });
      message.success(`${t('rules.disabled')} ${selectedRowKeys.length}`);
      setSelectedRowKeys([]);
    } catch (error) {
      message.error(`禁用失败: ${getErrorMessage(error, t('common.error'))}`);
    }
  };

  const handleBatchExport = () => {
    if (selectedRowKeys.length === 0) {
      message.warning(t('common.warning'));
      return;
    }

    const selectedRules = rules?.filter((rule) => selectedRowKeys.includes(rule.id)) ?? [];
    const csv = buildRulesCsv(
      [
        t('rules.ruleName'),
        t('rules.protocol'),
        t('rules.globalIP'),
        t('rules.globalPort'),
        t('rules.insideIP'),
        t('rules.insidePort'),
        t('devices.status'),
        t('devices.description'),
      ],
      selectedRules,
      t('rules.enabled'),
      t('rules.disabled')
    );

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `nat_rules_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    message.success(`${t('common.success')} ${selectedRowKeys.length}`);
  };

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) {
      message.warning(t('common.warning'));
      return;
    }

    modal.confirm({
      title: t('common.delete'),
      content: `${t('rules.deleteConfirm')} ${selectedRowKeys.length}?`,
      okText: t('common.confirm'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          for (const id of selectedRowKeys) {
            await window.electronAPI.rule.delete(String(id));
          }
          await queryClient.invalidateQueries({ queryKey: ['rules'] });
          message.success(`${t('common.success')} ${selectedRowKeys.length}`);
          setSelectedRowKeys([]);
        } catch (error) {
          message.error(`删除失败: ${getErrorMessage(error, t('common.error'))}`);
        }
      },
    });
  };

  const currentDevice = resolveCurrentRuleDevice(devices, activeDeviceId);

  return (
    <div>
      <Card>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '16px',
            }}
          >
            <Space size="middle">
              <Select
                style={{ width: 180 }}
                placeholder={t('automation.selectDevices')}
                value={activeDeviceId || undefined}
                onChange={(nextDeviceId) => {
                  setSelectedDeviceId(nextDeviceId);
                  setSelectedRowKeys([]);
                }}
              >
                {devices?.map((device) => (
                  <Select.Option key={device.id} value={device.id}>
                    {device.name}
                  </Select.Option>
                ))}
              </Select>
              <Select style={{ width: 120 }} value={protocolFilter} onChange={setProtocolFilter}>
                <Select.Option value="all">{t('rules.protocol')}</Select.Option>
                <Select.Option value="TCP">TCP</Select.Option>
                <Select.Option value="UDP">UDP</Select.Option>
                <Select.Option value="ALL">ALL</Select.Option>
              </Select>
              <Select style={{ width: 120 }} value={statusFilter} onChange={setStatusFilter}>
                <Select.Option value="all">{t('devices.status')}</Select.Option>
                <Select.Option value="enabled">{t('rules.enabled')}</Select.Option>
                <Select.Option value="disabled">{t('rules.disabled')}</Select.Option>
              </Select>
              <Input
                placeholder={t('common.search')}
                prefix={<SearchOutlined />}
                style={{ width: 200 }}
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                allowClear
              />
            </Space>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditingRule(null);
                setIsModalOpen(true);
              }}
              disabled={!activeDeviceId}
            >
              {t('rules.addRule')}
            </Button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => void queryClient.invalidateQueries({ queryKey: ['rules'] })}
            >
              {t('common.refresh')}
            </Button>
            <Button
              size="small"
              icon={<SyncOutlined />}
              onClick={() => activeDeviceId && syncFromDeviceMutation.mutate(activeDeviceId)}
              loading={syncFromDeviceMutation.isPending}
              disabled={!activeDeviceId}
            >
              {t('rules.getFromDevice')}
            </Button>
            <Button
              size="small"
              icon={<SyncOutlined />}
              onClick={() => {
                if (!activeDeviceId) {
                  return;
                }
                modal.confirm({
                  title: t('rules.syncToDevice'),
                  content: t('rules.syncToDevice'),
                  okText: t('common.confirm'),
                  okType: 'primary',
                  cancelText: t('common.cancel'),
                  onOk: () => {
                    syncToDeviceMutation.mutate(activeDeviceId);
                  },
                });
              }}
              loading={syncToDeviceMutation.isPending}
              disabled={!activeDeviceId}
            >
              {t('rules.syncToDevice')}
            </Button>
            <Button
              size="small"
              icon={<ExportOutlined />}
              onClick={() => {
                if (!rules || rules.length === 0) {
                  message.warning(t('common.warning'));
                  return;
                }

                const csv = buildRulesCsv(
                  [
                    t('rules.ruleName'),
                    t('rules.protocol'),
                    t('rules.globalIP'),
                    t('rules.globalPort'),
                    t('rules.insideIP'),
                    t('rules.insidePort'),
                    t('devices.status'),
                    t('devices.description'),
                  ],
                  rules,
                  t('rules.enabled'),
                  t('rules.disabled')
                );

                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `nat_rules_${currentDevice?.name}_${new Date().toISOString().split('T')[0]}.csv`;
                link.click();
                URL.revokeObjectURL(url);
                message.success(t('common.success'));
              }}
            >
              {t('common.export')}
            </Button>
          </div>

          {currentDevice && (
            <div
              style={{
                padding: '12px 16px',
                background: 'linear-gradient(to right, #f0f2f5, #fafafa)',
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 16,
              }}
            >
              <Tag color={currentDevice.online ? 'success' : 'error'}>
                {currentDevice.online ? t('devices.online') : t('devices.offline')}
              </Tag>
              <strong>{currentDevice.name}</strong>
              <span style={{ color: '#999' }}>{currentDevice.host}</span>
              <span style={{ marginLeft: 'auto', color: '#999' }}>
                {t('common.info')}: {filteredRules?.length || 0}
              </span>
            </div>
          )}

          {shouldShowRuleBatchActions(selectedRowKeys.length) && (
            <div
              style={{
                padding: '12px 16px',
                background: '#fff7e6',
                borderRadius: 6,
                border: '1px solid #ffd591',
              }}
            >
              <Space style={{ width: '100%', justifyContent: 'space-between' }} align="center" wrap>
                <span style={{ color: '#8c5a13', fontWeight: 500 }}>
                  {t('common.info')}: {selectedRowKeys.length}
                </span>
                <Space wrap>
                  <Button type="primary" onClick={handleBatchUpdateIP}>
                    {t('rules.batchUpdate')}
                  </Button>
                  <Button onClick={() => void handleBatchEnable()}>{t('rules.enabled')}</Button>
                  <Button onClick={() => void handleBatchDisable()}>{t('rules.disabled')}</Button>
                  <Button onClick={handleBatchExport}>{t('common.export')}</Button>
                  <Button danger onClick={handleBatchDelete}>
                    {t('common.delete')}
                  </Button>
                </Space>
              </Space>
            </div>
          )}

          <Table
            rowSelection={{
              selectedRowKeys,
              onChange: (nextKeys) => setSelectedRowKeys(nextKeys),
            }}
            columns={columns}
            dataSource={filteredRules}
            loading={isLoading}
            rowKey="id"
            pagination={createTablePagination(10, t('common.info'))}
          />
        </Space>
      </Card>

      <RuleModal
        open={isModalOpen}
        rule={editingRule}
        deviceId={activeDeviceId}
        onClose={() => {
          setIsModalOpen(false);
          setEditingRule(null);
        }}
        onSuccess={() => {
          void queryClient.invalidateQueries({ queryKey: ['rules'] });
        }}
      />
    </div>
  );
};

export default Rules;
