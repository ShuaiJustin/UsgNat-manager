import assert from 'node:assert/strict';
import test from 'node:test';

import type { Device } from '@/types';
import { filterDevices, formatDeviceLastConnected } from './deviceListHelpers.ts';

type DeviceListTestItem = Pick<Device, 'id' | 'name' | 'host'>;

test('filters devices by case-insensitive name and host matches', () => {
  const devices: DeviceListTestItem[] = [
    { id: '1', name: 'Core Firewall', host: '10.0.0.1' },
    { id: '2', name: 'Branch Gateway', host: '192.168.1.1' },
  ];

  assert.deepEqual(filterDevices(devices, 'fire'), [
    { id: '1', name: 'Core Firewall', host: '10.0.0.1' },
  ]);

  assert.deepEqual(filterDevices(devices, '192.168'), [
    { id: '2', name: 'Branch Gateway', host: '192.168.1.1' },
  ]);
});

test('returns original device list when search text is empty', () => {
  const devices: DeviceListTestItem[] = [{ id: '1', name: 'Device A', host: '1.1.1.1' }];

  assert.equal(filterDevices(devices, ''), devices);
});

test('formats last connected timestamps and falls back for invalid values', () => {
  const expected = new Date('2026-04-03T01:02:03.000Z').toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  assert.equal(formatDeviceLastConnected('2026-04-03T01:02:03.000Z'), expected);
  assert.equal(formatDeviceLastConnected(null), '-');
  assert.equal(formatDeviceLastConnected('not-a-date'), '-');
});
