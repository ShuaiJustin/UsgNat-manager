import assert from 'node:assert/strict';
import test from 'node:test';

import { DEVICE_SNAPSHOT_TTL_MS, deviceRuleSnapshots } from './device-rule-snapshots.ts';

test('device snapshots expire, follow the device address and can be invalidated', () => {
  deviceRuleSnapshots.set('d', 'host-a', [], 1000);
  assert.ok(deviceRuleSnapshots.getFresh('d', 'host-a', 1000 + DEVICE_SNAPSHOT_TTL_MS - 1));
  assert.equal(
    deviceRuleSnapshots.getFresh('d', 'host-a', 1000 + DEVICE_SNAPSHOT_TTL_MS),
    undefined
  );
  assert.equal(deviceRuleSnapshots.getFresh('d', 'host-b', 1000), undefined);
  deviceRuleSnapshots.invalidate('d');
  assert.equal(deviceRuleSnapshots.getFresh('d', 'host-a', 1000), undefined);
});
