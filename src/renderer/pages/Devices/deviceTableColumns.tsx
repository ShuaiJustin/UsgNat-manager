import { Button, Popconfirm, Space, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ApiOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import type { TFunction } from 'i18next';

import type { Device } from '@/types';
import { formatDeviceLastConnected } from './deviceListHelpers';

interface CreateDeviceColumnsOptions {
  onDeleteDevice: (deviceId: string) => void;
  onEditDevice: (device: Device) => void;
  onTestDeviceConnection: (deviceId: string) => void;
  t: TFunction;
  testingDeviceId: string | null;
}

export const createDeviceColumns = ({
  onDeleteDevice,
  onEditDevice,
  onTestDeviceConnection,
  t,
  testingDeviceId,
}: CreateDeviceColumnsOptions): ColumnsType<Device> => [
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
    render: (date) => formatDeviceLastConnected(date),
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
          onClick={() => onTestDeviceConnection(record.id)}
          loading={testingDeviceId === record.id}
        >
          {t('devices.testConnection')}
        </Button>
        <Button size="small" icon={<EditOutlined />} onClick={() => onEditDevice(record)}>
          {t('common.edit')}
        </Button>
        <Popconfirm
          title={t('common.delete')}
          description={t('devices.deleteConfirm')}
          onConfirm={() => onDeleteDevice(record.id)}
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
