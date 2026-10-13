import React, { useRef, useState } from 'react';
import { Alert, App, Button, Card, Input, Popconfirm, Select, Space, Table, Tag } from 'antd';
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
import type { RuleComparison } from '@/types/electron';
import { createTablePagination } from '@/utils/tablePagination';
import RuleModal from './RuleModal';
import {
  buildRulesCsv,
  countPendingChanges,
  isPendingState,
  resolveActiveRuleDeviceId,
  resolveCurrentRuleDevice,
  shouldShowRuleBatchActions,
  SYNC_STATE_META,
  type RuleRowSyncState,
} from './rulePageHelpers';

// A row is either a saved rule or a rule that only exists on the device.
type RuleRow = NatRule & { syncState?: RuleRowSyncState; deviceOnly?: boolean };

const formatReadTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const renderDiff = (preview: {
  added: string[];
  deleted: string[];
  updated: string[];
  localOnlyCount?: number;
}) => (
  <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
    <p>以下为完整设备快照与目标配置的实际差异。下发前保存设备备份，完成后回读核验。</p>
    {(
      [
        ['新增', preview.added],
        ['删除', preview.deleted],
        ['修改', preview.updated],
      ] as const
    ).map(([label, values]) => (
      <div key={label}>
        <strong>
          {label}：{values.length}
        </strong>
        {values.map((value) => (
          <p key={value} style={{ wordBreak: 'break-all' }}>
            {value}
          </p>
        ))}
      </div>
    ))}
    {!!preview.localOnlyCount && (
      <p>另有 {preview.localOnlyCount} 条禁用规则仅更新本地配置，不向设备添加。</p>
    )}
  </div>
);

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

  const forceDeviceRead = useRef(false);
  // The device is the reference: saved rules are compared with a recent device read. Reusing
  // the read for two minutes keeps local edits from logging in to the firewall every time.
  const {
    data: comparison,
    error: compareError,
    isFetching: comparing,
    refetch: refetchComparison,
  } = useQuery<RuleComparison>({
    queryKey: ['rules', 'compare', activeDeviceId],
    queryFn: () => {
      // "Re-read device" asks for one forced read; every other refetch may reuse the snapshot.
      const refresh = forceDeviceRead.current;
      forceDeviceRead.current = false;
      return window.electronAPI.rule.compareWithDevice(activeDeviceId, refresh);
    },
    enabled: !!activeDeviceId && typeof window.electronAPI?.rule?.compareWithDevice === 'function',
    retry: false,
  });

  const rereadDevice = async () => {
    forceDeviceRead.current = true;
    await refetchComparison();
  };

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
    onError: (error: unknown) => {
      message.error(getErrorMessage(error, t('rules.syncFailed')));
    },
  });

  const syncToDeviceMutation = useMutation({
    mutationFn: async ({ deviceId, token }: { deviceId: string; token: string }) => {
      const api = window.electronAPI;
      if (!api?.rule?.syncToDevice) {
        throw new Error('rule API 未就绪');
      }
      const result = await api.rule.syncToDevice(deviceId, token);
      if (!result.success)
        throw new Error(
          `${result.status}: ${result.message}${result.backupId ? '；备份 ' + result.backupId : ''}`
        );
      return result;
    },
    onSuccess: (data) => {
      if (data.status === 'unsaved') {
        message.warning(data.message);
      } else if (data.syncedCount === 0) {
        message.info(data.message || t('common.info'));
      } else {
        message.success(data.message || `${t('rules.syncSuccess')} ${data.syncedCount}`);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['rules'] });
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
      message.success('已删除本地待下发配置；设备需确认同步后删除');
    },
    onError: () => {
      message.error(t('common.error'));
    },
  });

  const columns: ColumnsType<RuleRow> = [
    {
      title: t('rules.ruleName'),
      dataIndex: 'ruleName',
      key: 'ruleName',
      render: (name: string, record) => (
        <Space size={4} wrap>
          <span>{name}</span>
          {record.noReverse && <Tag style={{ marginInlineEnd: 0 }}>no-reverse</Tag>}
          {record.unrRoute && <Tag style={{ marginInlineEnd: 0 }}>unr-route</Tag>}
        </Space>
      ),
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
      title: '状态',
      key: 'syncState',
      width: 190,
      render: (_, record) =>
        record.syncState ? (
          <Tag color={SYNC_STATE_META[record.syncState].color}>
            {SYNC_STATE_META[record.syncState].label}
          </Tag>
        ) : (
          <Tag>{record.enabled ? t('rules.enabled') : t('rules.disabled')}</Tag>
        ),
    },
    {
      title: t('devices.actions'),
      key: 'action',
      width: 150,
      render: (_, record) =>
        record.deviceOnly ? (
          <span style={{ color: '#999' }}>—</span>
        ) : (
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

  // After a failed re-read the last comparison is stale; show no states rather than old ones.
  const liveComparison = compareError ? undefined : comparison;
  const deviceOnlyRows: RuleRow[] = (liveComparison?.deviceOnly ?? []).map((rule) => ({
    ...rule,
    id: `device-only:${rule.ruleName}:${rule.protocol}:${rule.globalIp}:${rule.globalPort}`,
    deviceId: activeDeviceId,
    enabled: true,
    noReverse: false,
    unrRoute: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    syncState: 'deviceOnly',
    deviceOnly: true,
  }));
  const rows: RuleRow[] = [
    ...(rules ?? []).map((rule) => ({ ...rule, syncState: liveComparison?.states[rule.id] })),
    ...deviceOnlyRows,
  ];
  const pendingCount = liveComparison ? countPendingChanges(liveComparison) : 0;
  const deviceOnlyCount = liveComparison?.deviceOnly.length ?? 0;

  const filteredRules = rows.filter((rule) => {
    const matchesSearch =
      rule.ruleName.toLowerCase().includes(searchText.toLowerCase()) ||
      rule.globalIp.includes(searchText) ||
      rule.insideIp.includes(searchText);
    const matchesProtocol = protocolFilter === 'all' || rule.protocol === protocolFilter;
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'pending' && isPendingState(rule.syncState)) ||
      (statusFilter === 'enabled' && rule.enabled && !rule.deviceOnly) ||
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
          const deviceId = activeDeviceId;
          const ruleIds = selectedRowKeys.map(String);
          const preview = await window.electronAPI.rule.previewBatchUpdateIP(
            deviceId,
            ruleIds,
            newIp
          );
          modal.confirm({
            title: '确认批量改 IP 的实际差异',
            content: renderDiff(preview),
            okText: '确认下发',
            cancelText: '取消',
            onOk: async () => {
              const result = await window.electronAPI.rule.batchUpdateIP(
                deviceId,
                ruleIds,
                newIp,
                preview.token
              );
              if (!result.success) {
                // The device may have partly changed; show a fresh comparison.
                void queryClient.invalidateQueries({ queryKey: ['rules'] });
                const detail = `${result.status}: ${result.message}${result.backupId ? '；备份 ' + result.backupId : ''}`;
                message.error(detail);
                throw new Error(detail);
              }
              await queryClient.invalidateQueries({ queryKey: ['rules'] });
              if (result.status === 'unsaved') message.warning(result.message);
              else message.success(result.message || '设备配置已回读核验');
              setSelectedRowKeys([]);
            },
          });
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
      message.success(`本地待下发配置已设为启用：${selectedRowKeys.length} 条；设备需确认同步`);
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
      message.success(`本地待下发配置已设为禁用：${selectedRowKeys.length} 条；设备需确认同步`);
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

  const previewAndPush = async () => {
    if (!activeDeviceId) return;
    try {
      const preview = await window.electronAPI.rule.previewSync(activeDeviceId);
      modal.confirm({
        title: t('rules.syncToDevice'),
        content: renderDiff(preview),
        okText: t('common.confirm'),
        okType: 'primary',
        cancelText: t('common.cancel'),
        onOk: () =>
          syncToDeviceMutation.mutateAsync({ deviceId: activeDeviceId, token: preview.token }),
      });
    } catch (error) {
      message.error(getErrorMessage(error, '读取同步差异失败'));
    }
  };

  const confirmDiscardChanges = () =>
    activeDeviceId &&
    modal.confirm({
      title: '放弃未下发的改动？',
      content:
        '软件中的规则会恢复成设备上的样子，尚未下发的新增、修改和删除都会丢失；只存在于软件中的已禁用规则会保留，设备上仍有的规则会恢复为启用。',
      okText: '放弃改动',
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: () => syncFromDeviceMutation.mutateAsync(activeDeviceId),
    });

  const currentDevice = resolveCurrentRuleDevice(devices, activeDeviceId);

  return (
    <div>
      <Card>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {activeDeviceId &&
            (comparing && !comparison ? (
              <Alert type="info" showIcon message="正在读取设备上的规则…" />
            ) : compareError ? (
              <Alert
                type="warning"
                showIcon
                message="无法读取设备，下面是软件中保存的规则，可能与设备不一致"
                description={getErrorMessage(compareError, '读取失败')}
                action={
                  <Button size="small" onClick={() => void rereadDevice()} loading={comparing}>
                    重试
                  </Button>
                }
              />
            ) : comparison && pendingCount > 0 ? (
              <Alert
                type="warning"
                showIcon
                message={`有 ${pendingCount} 项改动尚未下发到设备（设备规则读取于 ${formatReadTime(comparison.readAt)}）`}
                description={
                  <>
                    带“待新增 / 待修改 / 待从设备删除”标签的规则只在软件中改过，防火墙上还是原样。
                    {deviceOnlyCount > 0 &&
                      ` 另有 ${deviceOnlyCount} 条规则只在设备上有（可能是有人直接在防火墙上添加的），下发会把它们从设备删除；想保留请点“放弃改动”把它们读入软件。`}
                  </>
                }
                action={
                  <Space direction="vertical" size={4}>
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => void previewAndPush()}
                      loading={syncToDeviceMutation.isPending}
                    >
                      下发到设备
                    </Button>
                    <Button size="small" onClick={confirmDiscardChanges}>
                      放弃改动
                    </Button>
                  </Space>
                }
              />
            ) : comparison ? (
              <Alert
                type="success"
                showIcon
                message={`与设备一致（设备规则读取于 ${formatReadTime(comparison.readAt)}）`}
                action={
                  <Button size="small" onClick={() => void rereadDevice()} loading={comparing}>
                    重新读取
                  </Button>
                }
              />
            ) : null)}
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
                <Select.Option value="pending">待下发</Select.Option>
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
              onClick={() => void rereadDevice()}
              loading={comparing}
              disabled={!activeDeviceId}
            >
              重新读取设备
            </Button>
            <Button
              size="small"
              icon={<SyncOutlined />}
              onClick={() =>
                activeDeviceId &&
                modal.confirm({
                  title: '从设备读取规则？',
                  content:
                    '本地列表会更新为设备上的规则，尚未下发的修改会被覆盖；本地已禁用的规则会保留。',
                  okText: '读取',
                  onOk: () => syncFromDeviceMutation.mutateAsync(activeDeviceId),
                })
              }
              loading={syncFromDeviceMutation.isPending}
              disabled={!activeDeviceId}
            >
              {t('rules.getFromDevice')}
            </Button>
            <Button
              size="small"
              icon={<SyncOutlined />}
              onClick={() => void previewAndPush()}
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
                共 {filteredRules.length} 条
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
                  已选 {selectedRowKeys.length} 条
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
              getCheckboxProps: (record) => ({ disabled: !!record.deviceOnly }),
            }}
            columns={columns}
            dataSource={filteredRules}
            loading={isLoading}
            rowKey="id"
            rowClassName={(record) => (isPendingState(record.syncState) ? 'rule-row-pending' : '')}
            pagination={createTablePagination(10, '条')}
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
