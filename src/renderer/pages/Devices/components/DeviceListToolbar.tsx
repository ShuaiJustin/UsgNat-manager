import React from 'react';
import { Button, Input, Space } from 'antd';
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { TFunction } from 'i18next';

interface DeviceListToolbarProps {
  onAddDevice: () => void;
  onRefresh: () => void;
  onSearchTextChange: (value: string) => void;
  searchText: string;
  t: TFunction;
}

const DeviceListToolbar: React.FC<DeviceListToolbarProps> = ({
  onAddDevice,
  onRefresh,
  onSearchTextChange,
  searchText,
  t,
}) => (
  <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
    <Input
      placeholder={t('common.search')}
      prefix={<SearchOutlined />}
      style={{ width: 300 }}
      value={searchText}
      onChange={(event) => onSearchTextChange(event.target.value)}
      allowClear
    />
    <Space>
      <Button icon={<ReloadOutlined />} onClick={onRefresh}>
        {t('common.refresh')}
      </Button>
      <Button type="primary" icon={<PlusOutlined />} onClick={onAddDevice}>
        {t('devices.addDevice')}
      </Button>
    </Space>
  </Space>
);

export default DeviceListToolbar;
