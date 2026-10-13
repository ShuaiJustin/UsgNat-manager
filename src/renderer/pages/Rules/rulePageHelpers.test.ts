import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRulesCsv,
  resolveActiveRuleDeviceId,
  resolveCurrentRuleDevice,
  shouldShowRuleBatchActions,
} from './rulePageHelpers.ts';

test('resolveCurrentRuleDevice falls back to the first device when no device is explicitly selected', () => {
  const devices = [
    { id: 'device-1', name: 'USG-1' },
    { id: 'device-2', name: 'USG-2' },
  ];
  const currentDevice = resolveCurrentRuleDevice(devices, '');

  assert.ok(currentDevice);
  assert.equal(currentDevice.id, 'device-1');
});

test('resolveCurrentRuleDevice prefers the actively selected device', () => {
  const devices = [
    { id: 'device-1', name: 'USG-1' },
    { id: 'device-2', name: 'USG-2' },
  ];
  const currentDevice = resolveCurrentRuleDevice(devices, 'device-2');

  assert.ok(currentDevice);
  assert.equal(currentDevice.id, 'device-2');
});

test('resolveActiveRuleDeviceId falls back to the first available device when the selection is stale', () => {
  const devices = [
    { id: 'device-1', name: 'USG-1' },
    { id: 'device-2', name: 'USG-2' },
  ];

  assert.equal(resolveActiveRuleDeviceId(devices, 'device-missing'), 'device-1');
});

test('resolveActiveRuleDeviceId preserves the selected device when it still exists', () => {
  const devices = [
    { id: 'device-1', name: 'USG-1' },
    { id: 'device-2', name: 'USG-2' },
  ];

  assert.equal(resolveActiveRuleDeviceId(devices, 'device-2'), 'device-2');
});

test('buildRulesCsv escapes quotes, commas, and spreadsheet formula prefixes', () => {
  const csv = buildRulesCsv(
    [
      'Rule Name',
      'Protocol',
      'Global IP',
      'Global Port',
      'Inside IP',
      'Inside Port',
      'Status',
      'Description',
    ],
    [
      {
        ruleName: '=SUM(1,1)',
        protocol: 'TCP',
        globalIp: '1.2.3.4',
        globalPort: '443',
        insideIp: '192.168.1.10',
        insidePort: '8443',
        enabled: true,
        description: 'He said "hello", team',
      },
    ],
    'Enabled',
    'Disabled'
  );

  assert.match(
    csv,
    /^"Rule Name","Protocol","Global IP","Global Port","Inside IP","Inside Port","Status","Description"$/m
  );
  assert.match(csv, /"'=SUM\(1,1\)"/);
  assert.match(csv, /"He said ""hello"", team"/);
});

test('shows rule batch actions only when at least one row is selected', () => {
  assert.equal(shouldShowRuleBatchActions(0), false);
  assert.equal(shouldShowRuleBatchActions(1), true);
});

test('pending changes count everything a push would change on the device', async () => {
  const { countPendingChanges, isPendingState } = await import('./rulePageHelpers.ts');
  assert.equal(
    countPendingChanges({
      states: {
        a: 'synced',
        b: 'pendingAdd',
        c: 'pendingChange',
        d: 'pendingRemove',
        e: 'localDisabled',
      },
      deviceOnly: [{}],
    }),
    4
  );
  assert.equal(isPendingState('localDisabled'), false);
  assert.equal(isPendingState('deviceOnly'), true);
});
