import type { Device } from '@/types';

export const formatDeviceLastConnected = (date: string | null | undefined): string => {
  if (!date) {
    return '-';
  }

  try {
    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return '-';
    }

    return parsedDate.toLocaleString('zh-CN', {
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
};

type DeviceSearchable = Pick<Device, 'name' | 'host'>;

export const filterDevices = <T extends DeviceSearchable>(
  devices: T[] | undefined,
  searchText: string
): T[] | undefined => {
  if (!devices || !searchText.trim()) {
    return devices;
  }

  const normalizedSearchText = searchText.toLowerCase();

  return devices.filter(
    (device) =>
      device.name.toLowerCase().includes(normalizedSearchText) || device.host.includes(searchText)
  );
};
