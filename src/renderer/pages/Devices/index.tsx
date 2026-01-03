import React, { useState } from 'react';
import { Card, Table, Button, Space, Input, Tag, Popconfirm, App } from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  EditOutlined,
  DeleteOutlined,
  ApiOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import type { Device } from '@/types';
import DeviceModal from './DeviceModal';

const Devices: React.FC = () => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [searchText, setSearchText] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [testingDeviceId, setTestingDeviceId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // 获取设备列表
  const { data: devices, isLoading } = useQuery<Device[]>({
    queryKey: ['devices'],
    queryFn: async () => {
      const api = (window as any).electronAPI;
      if (!api?.device?.getAll) {
        throw new Error('electronAPI 未就绪，无法获取设备列表');
      }
      return await api.device.getAll();
    },
  });

  // 删除设备
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const api = (window as any).electronAPI;
      if (!api?.device?.delete) {
        throw new Error('electronAPI 未就绪，无法删除设备');
      }
      return await api.device.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      message.success(t('common.success'));
    },
    onError: () => {
      message.error(t('common.error'));
    },
  });

  // 测试连接
  const testConnectionMutation = useMutation({
    mutationFn: async (id: string) => {
      setTestingDeviceId(id);
      const api = (window as any).electronAPI;
      if (!api?.device?.testConnection) {
        throw new Error('electronAPI 未就绪，无法测试连接');
      }
      return await api.device.testConnection(id);
    },
    onSuccess: (result) => {
      setTestingDeviceId(null);
      if (result.success) {
        message.success(`${t('devices.connectionSuccess')} - ${result.latency}ms`);
      } else {
        message.error(`${t('devices.connectionFailed')}: ${result.message}`);
      }
      // 刷新设备列表以同步在线状态
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: () => {
      setTestingDeviceId(null);
      // 即使测试失败也刷新设备列表
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });

  const columns: ColumnsType<Device> = [
    {
      title: t('devices.deviceName'),
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => (
        <div>
          <div style={{ fontWeight: 500 }}>{text}</div>
          {record.description && (
            <div style={{ fontSize: 12, color: '#999' }}>{record.description}</div>
          )}
        </div>
      ),
    },
    {
      title: t('devices.host'),
      dataIndex: 'host',
      key: 'host',
    },
    {
      title: t('devices.port'),
      dataIndex: 'port',
      key: 'port',
    },
    {
      title: t('devices.connectionType'),
      dataIndex: 'connectionType',
      key: 'connectionType',
      render: (type) => <Tag color="blue">{type}</Tag>,
    },
    {
      title: t('devices.status'),
      dataIndex: 'online',
      key: 'online',
      render: (online) => (
        <Tag color={online ? 'success' : 'error'}>
          {online ? t('devices.online') : t('devices.offline')}
        </Tag>
      ),
    },
    {
      title: t('devices.lastConnected'),
      dataIndex: 'lastConnected',
      key: 'lastConnected',
      render: (date) => {
        if (!date) return '-';
        try {
          const d = new Date(date);
          if (isNaN(d.getTime())) return '-';
          return d.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          });
        } catch {
          return '-';
        }
      },
    },
    {
      title: t('devices.actions'),
      key: 'action',
      width: 280,
      render: (_, record) => (
        <Space size="small">
          <Button
            size="small"
            icon={<ApiOutlined />}
            onClick={() => testConnectionMutation.mutate(record.id)}
            loading={testingDeviceId === record.id}
          >
            {t('devices.testConnection')}
          </Button>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setEditingDevice(record);
              setIsModalOpen(true);
            }}
          >
            {t('common.edit')}
          </Button>
          <Popconfirm
            title={t('common.delete')}
            description={t('devices.deleteConfirm')}
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

  const filteredDevices = devices?.filter(
    (device: Device) =>
      device.name.toLowerCase().includes(searchText.toLowerCase()) ||
      device.host.includes(searchText)
  );

  return (
    <div>
      <Card>
        <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
          <Input
            placeholder={t('common.search')}
            prefix={<SearchOutlined />}
            style={{ width: 300 }}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            allowClear
          />
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => queryClient.invalidateQueries({ queryKey: ['devices'] })}
            >
              {t('common.refresh')}
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditingDevice(null);
                setIsModalOpen(true);
              }}
            >
              {t('devices.addDevice')}
            </Button>
          </Space>
        </Space>

        <Table
          columns={columns}
          dataSource={filteredDevices}
          loading={isLoading}
          rowKey="id"
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total) => `${t('common.info')}: ${total}`,
          }}
        />
      </Card>

      <DeviceModal
        open={isModalOpen}
        device={editingDevice}
        onClose={() => {
          setIsModalOpen(false);
          setEditingDevice(null);
        }}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['devices'] });
        }}
      />
    </div>
  );
};

export default Devices;
