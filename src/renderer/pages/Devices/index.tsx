import React, { useState } from 'react';
import { App, Card, Table } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { Device } from '@/types';
import { createTablePagination } from '@/utils/tablePagination';
import DeviceListToolbar from './components/DeviceListToolbar';
import DeviceModal from './DeviceModal';
import { filterDevices } from './deviceListHelpers';
import { createDeviceColumns } from './deviceTableColumns';

const Devices: React.FC = () => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [searchText, setSearchText] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [testingDeviceId, setTestingDeviceId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: devices, isLoading } = useQuery<Device[]>({
    queryKey: ['devices'],
    queryFn: async () => {
      const api = window.electronAPI;
      if (!api?.device?.getAll) {
        throw new Error('electronAPI 未就绪，无法获取设备列表');
      }
      return api.device.getAll();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const api = window.electronAPI;
      if (!api?.device?.delete) {
        throw new Error('electronAPI 未就绪，无法删除设备');
      }
      return api.device.delete(id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
      message.success(t('common.success'));
    },
    onError: () => {
      message.error(t('common.error'));
    },
  });

  const testConnectionMutation = useMutation({
    mutationFn: async (id: string) => {
      setTestingDeviceId(id);
      const api = window.electronAPI;
      if (!api?.device?.testConnection) {
        throw new Error('electronAPI 未就绪，无法测试连接');
      }
      return api.device.testConnection(id);
    },
    onSuccess: (result) => {
      setTestingDeviceId(null);
      if (result.success) {
        message.success(`${t('devices.connectionSuccess')} - ${result.latency}ms`);
      } else {
        message.error(`${t('devices.connectionFailed')}: ${result.message}`);
      }
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: () => {
      setTestingDeviceId(null);
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });

  const columns = createDeviceColumns({
    onDeleteDevice: (deviceId) => deleteMutation.mutate(deviceId),
    onEditDevice: (device) => {
      setEditingDevice(device);
      setIsModalOpen(true);
    },
    onTestDeviceConnection: (deviceId) => testConnectionMutation.mutate(deviceId),
    t,
    testingDeviceId,
  });

  const filteredDevices = filterDevices(devices, searchText);

  return (
    <div>
      <Card>
        <DeviceListToolbar
          onAddDevice={() => {
            setEditingDevice(null);
            setIsModalOpen(true);
          }}
          onRefresh={() => void queryClient.invalidateQueries({ queryKey: ['devices'] })}
          onSearchTextChange={setSearchText}
          searchText={searchText}
          t={t}
        />

        <Table
          columns={columns}
          dataSource={filteredDevices}
          loading={isLoading}
          rowKey="id"
          pagination={createTablePagination(10, t('common.info'))}
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
          void queryClient.invalidateQueries({ queryKey: ['devices'] });
        }}
      />
    </div>
  );
};

export default Devices;
