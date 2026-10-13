import assert from 'node:assert/strict';
import test from 'node:test';

import { isValidDeviceHost, parseDeviceInput } from './device-input.ts';

test('device input keeps only whitelisted fields', () => {
  assert.deepEqual(
    parseDeviceInput(
      {
        name: 'USG',
        host: '192.0.2.1',
        port: 22,
        connectionType: 'SSH',
        description: null,
        enabled: true,
        id: 'forged',
        online: true,
        lastConnected: new Date(),
      },
      false
    ),
    {
      name: 'USG',
      host: '192.0.2.1',
      port: 22,
      connectionType: 'SSH',
      description: null,
      enabled: true,
    }
  );
  assert.deepEqual(parseDeviceInput({ enabled: false, online: true }, true), { enabled: false });
});

test('device input rejects invalid values with Chinese errors', () => {
  const valid = { name: 'USG', host: 'fw.example.com', port: 22 };
  for (const invalid of [
    null,
    [],
    { ...valid, name: '  ' },
    { ...valid, name: 'x'.repeat(101) },
    { ...valid, host: '256.1.1.1' },
    { ...valid, host: 'bad host' },
    { ...valid, host: 'a..b' },
    { ...valid, port: 0 },
    { ...valid, port: 65536 },
    { ...valid, port: '22' },
    { ...valid, port: 22.5 },
    { ...valid, connectionType: 'HTTPS' },
    { ...valid, description: 'x'.repeat(501) },
    { ...valid, enabled: 'true' },
    { host: '192.0.2.1', port: 22 },
  ])
    assert.throws(() => parseDeviceInput(invalid, false), /[一-龥]/);
  assert.throws(() => parseDeviceInput({ host: '' }, true), /设备地址/);
});

test('device host accepts IPv4 and hostnames only', () => {
  for (const host of ['10.0.0.1', 'localhost', 'fw-01', 'fw.example.com']) {
    assert.equal(isValidDeviceHost(host), true, host);
  }
  for (const host of [
    '',
    '1.2.3',
    '999.1.1.1',
    '-fw',
    'fw_01',
    'fw.example.com/path',
    'a'.repeat(254),
  ]) {
    assert.equal(isValidDeviceHost(host), false, host);
  }
});
