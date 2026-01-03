import React, { useState } from 'react';
import RuleModal from './RuleModal';
import { Card, Table, Button, Space, Input, Select, Tag, App, Popconfirm } from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  SyncOutlined,
  EditOutlined,
  DeleteOutlined,
  ExportOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import type { NatRule, Device } from '@/types';

const Rules: React.FC = () => {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const [searchText, setSearchText] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [protocolFilter, setProtocolFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showBatchMenu, setShowBatchMenu] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<NatRule | null>(null);
  const queryClient = useQueryClient();

  // 获取设备列表
  const { data: devices } = useQuery({
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

  // 获取规则列表
  const { data: rules, isLoading } = useQuery({
    queryKey: ['rules', selectedDeviceId],
    queryFn: async () => {
      const api = (window as any).electronAPI;
      if (!api?.rule?.getAll) {
        throw new Error('rule API 未就绪');
      }
      return await api.rule.getAll(selectedDeviceId);
    },
    enabled: !!selectedDeviceId && typeof (window as any).electronAPI?.rule?.getAll === 'function',
    retry: 2,
  });

  // 从设备获取规则
  const syncFromDeviceMutation = useMutation({
    mutationFn: async (deviceId: string) => {
      const api = (window as any).electronAPI;
      if (!api?.rule?.syncFromDevice) {
        throw new Error('rule API 未就绪');
      }
      return await api.rule.syncFromDevice(deviceId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      message.success(t('rules.syncSuccess'));
    },
    onError: () => {
      message.error(t('rules.syncFailed'));
    },
  });

  // 同步到设备
  const syncToDeviceMutation = useMutation({
    mutationFn: async (deviceId: string) => {
      const api = (window as any).electronAPI;
      if (!api?.rule?.syncToDevice) {
        throw new Error('rule API 未就绪');
      }
      return await api.rule.syncToDevice(deviceId);
    },
    onSuccess: (data) => {
      if (data.syncedCount === 0) {
        message.info(data.message || t('common.info'));
      } else {
        message.success(data.message || `${t('rules.syncSuccess')} ${data.syncedCount}`);
      }
    },
    onError: (error: any) => {
      message.error(error.message || t('rules.syncFailed'));
    },
  });

  // 删除规则
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const api = (window as any).electronAPI;
      if (!api?.rule?.delete) {
        throw new Error('rule API 未就绪');
      }
      return await api.rule.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      message.success(t('common.success'));
    },
    onError: () => {
      message.error(t('common.error'));
    },
  });

  // 设置默认选中第一个设备
  React.useEffect(() => {
    if (devices && devices.length > 0 && !selectedDeviceId) {
      setSelectedDeviceId(devices[0].id);
    }
  }, [devices, selectedDeviceId]);

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
      render: (protocol) => <Tag color="blue">{protocol}</Tag>,
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
      render: (enabled) => (
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

  const filteredRules = rules?.filter((rule: NatRule) => {
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

  const rowSelection = {
    selectedRowKeys,
    onChange: (newSelectedRowKeys: React.Key[]) => {
      setSelectedRowKeys(newSelectedRowKeys);
    },
  };

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
          message.error('请输入新的IP地址');
          return Promise.reject();
        }

        // 验证IP地址格式
        const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (!ipPattern.test(newIp)) {
          message.error('请输入有效的IP地址');
          return Promise.reject();
        }

        // 验证IP段范围
        const parts = newIp.split('.').map(Number);
        if (parts.some((part) => part < 0 || part > 255)) {
          message.error('IP地址段必须在0-255之间');
          return Promise.reject();
        }

        try {
          const api = (window as any).electronAPI;
          await api.rule.batchUpdateIP(selectedDeviceId, selectedRowKeys, newIp);
          queryClient.invalidateQueries({ queryKey: ['rules'] });
          message.success(`${t('common.success')} ${selectedRowKeys.length}`);
          setSelectedRowKeys([]);
        } catch (error: any) {
          message.error(`更新失败: ${error.message || t('common.error')}`);
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
      const api = (window as any).electronAPI;
      // 使用批量更新API，效率更高
      await api.rule.batchUpdate(selectedRowKeys, { enabled: true });
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      message.success(`${t('rules.enabled')} ${selectedRowKeys.length}`);
      setSelectedRowKeys([]);
    } catch (error: any) {
      message.error(`启用失败: ${error.message || t('common.error')}`);
    }
  };

  const handleBatchDisable = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning(t('common.warning'));
      return;
    }

    try {
      const api = (window as any).electronAPI;
      // 使用批量更新API，效率更高
      await api.rule.batchUpdate(selectedRowKeys, { enabled: false });
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      message.success(`${t('rules.disabled')} ${selectedRowKeys.length}`);
      setSelectedRowKeys([]);
    } catch (error: any) {
      message.error(`禁用失败: ${error.message || t('common.error')}`);
    }
  };

  const handleBatchExport = () => {
    if (selectedRowKeys.length === 0) {
      message.warning(t('common.warning'));
      return;
    }

    const selectedRules = rules?.filter((r: NatRule) => selectedRowKeys.includes(r.id));
    const csv = [
      [
        t('rules.ruleName'),
        t('rules.protocol'),
        t('rules.globalIP'),
        t('rules.globalPort'),
        t('rules.insideIP'),
        t('rules.insidePort'),
        t('devices.status'),
        t('devices.description'),
      ].join(','),
      ...selectedRules!.map((r: NatRule) =>
        [
          r.ruleName,
          r.protocol,
          r.globalIp,
          r.globalPort,
          r.insideIp,
          r.insidePort,
          r.enabled ? t('rules.enabled') : t('rules.disabled'),
          r.description || '',
        ].join(',')
      ),
    ].join('\n');

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
          const api = (window as any).electronAPI;
          // 逐个删除规则
          for (const id of selectedRowKeys) {
            await api.rule.delete(id as string);
          }
          queryClient.invalidateQueries({ queryKey: ['rules'] });
          message.success(`${t('common.success')} ${selectedRowKeys.length}`);
          setSelectedRowKeys([]);
        } catch (error: any) {
          message.error(`删除失败: ${error.message || t('common.error')}`);
        }
      },
    });
  };

  const currentDevice = devices?.find((d: Device) => d.id === selectedDeviceId);

  return (
    <div>
      <Card>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {/* 筛选和搜索栏 */}
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
                value={selectedDeviceId}
                onChange={setSelectedDeviceId}
              >
                {devices?.map((device: Device) => (
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
                onChange={(e) => setSearchText(e.target.value)}
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
              disabled={!selectedDeviceId}
            >
              {t('rules.addRule')}
            </Button>
          </div>

          {/* 操作按钮栏 */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => queryClient.invalidateQueries({ queryKey: ['rules'] })}
            >
              {t('common.refresh')}
            </Button>
            <Button
              size="small"
              icon={<SyncOutlined />}
              onClick={() => selectedDeviceId && syncFromDeviceMutation.mutate(selectedDeviceId)}
              loading={syncFromDeviceMutation.isPending}
              disabled={!selectedDeviceId}
            >
              {t('rules.getFromDevice')}
            </Button>
            <Button
              size="small"
              icon={<SyncOutlined />}
              onClick={() => {
                if (!selectedDeviceId) return;
                modal.confirm({
                  title: t('rules.syncToDevice'),
                  content: t('rules.syncToDevice'),
                  okText: t('common.confirm'),
                  okType: 'primary',
                  cancelText: t('common.cancel'),
                  onOk: () => {
                    syncToDeviceMutation.mutate(selectedDeviceId);
                  },
                });
              }}
              loading={syncToDeviceMutation.isPending}
              disabled={!selectedDeviceId}
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
                const csv = [
                  [
                    t('rules.ruleName'),
                    t('rules.protocol'),
                    t('rules.globalIP'),
                    t('rules.globalPort'),
                    t('rules.insideIP'),
                    t('rules.insidePort'),
                    t('devices.status'),
                    t('devices.description'),
                  ].join(','),
                  ...rules.map((r: NatRule) =>
                    [
                      r.ruleName,
                      r.protocol,
                      r.globalIp,
                      r.globalPort,
                      r.insideIp,
                      r.insidePort,
                      r.enabled ? t('rules.enabled') : t('rules.disabled'),
                      r.description || '',
                    ].join(',')
                  ),
                ].join('\n');

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

          {/* 当前设备信息 */}
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

          {/* 规则表格 */}
          <Table
            rowSelection={rowSelection}
            columns={columns}
            dataSource={filteredRules}
            loading={isLoading}
            rowKey="id"
            pagination={{
              pageSize: 10,
              showSizeChanger: true,
              showTotal: (total) => `${t('common.info')}: ${total}`,
            }}
            footer={() => (
              <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                <Space>
                  <span>
                    {t('common.info')}: {selectedRowKeys.length}
                  </span>
                  <Button size="small" onClick={() => setShowBatchMenu(!showBatchMenu)}>
                    {t('rules.batchUpdate')} {showBatchMenu ? '▲' : '▼'}
                  </Button>
                </Space>
              </Space>
            )}
          />

          {/* 批量操作菜单 */}
          {showBatchMenu && (
            <div
              style={{
                padding: '12px',
                background: '#f5f5f5',
                borderRadius: 6,
                border: '1px solid #e0e0e0',
              }}
            >
              <Space wrap>
                <Button
                  type="primary"
                  onClick={handleBatchUpdateIP}
                  disabled={selectedRowKeys.length === 0}
                >
                  {t('rules.batchUpdate')}
                </Button>
                <Button onClick={handleBatchEnable} disabled={selectedRowKeys.length === 0}>
                  {t('rules.enabled')}
                </Button>
                <Button onClick={handleBatchDisable} disabled={selectedRowKeys.length === 0}>
                  {t('rules.disabled')}
                </Button>
                <Button onClick={handleBatchExport} disabled={selectedRowKeys.length === 0}>
                  {t('common.export')}
                </Button>
                <Button danger onClick={handleBatchDelete} disabled={selectedRowKeys.length === 0}>
                  {t('common.delete')}
                </Button>
              </Space>
            </div>
          )}
        </Space>
      </Card>

      <RuleModal
        open={isModalOpen}
        rule={editingRule}
        deviceId={selectedDeviceId}
        onClose={() => {
          setIsModalOpen(false);
          setEditingRule(null);
        }}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['rules'] });
        }}
      />
    </div>
  );
};

export default Rules;
