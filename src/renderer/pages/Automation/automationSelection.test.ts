import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAutomationFieldTab,
  getDevicesWithoutManagedRules,
  toggleManagedDevice,
} from './automationSelection.ts';

test('checking a device selects all its rules and unchecking removes only its rules', () => {
  const start = { selectedDevices: ['a'], managedRuleIds: ['a1'] };
  const [devices, rules] = toggleManagedDevice(start, 'b', true, ['b1', 'b2']);
  assert.deepEqual(devices, ['a', 'b']);
  assert.deepEqual(rules, ['a1', 'b1', 'b2']);
  assert.deepEqual(
    toggleManagedDevice({ selectedDevices: devices, managedRuleIds: rules }, 'b', false, [
      'b1',
      'b2',
    ]),
    [['a'], ['a1']]
  );
});

test('selected devices without any managed rule are reported', () => {
  assert.deepEqual(
    getDevicesWithoutManagedRules({ selectedDevices: ['a', 'b'], managedRuleIds: ['a1'] }, [
      { id: 'a1', deviceId: 'a' },
      { id: 'b1', deviceId: 'b' },
    ]),
    ['b']
  );
});

test('validation errors map to the tab that shows the field', () => {
  assert.equal(getAutomationFieldTab('checkSources'), 'monitor');
  assert.equal(getAutomationFieldTab('smtpServer'), 'notify');
  assert.equal(getAutomationFieldTab('delayMinutes'), 'update');
});
