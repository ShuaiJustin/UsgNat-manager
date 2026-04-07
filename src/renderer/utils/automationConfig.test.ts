import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_AUTOMATION_CHECK_SOURCES,
  hasSelectedAutomationCheckSources,
  hasSelectedAutomationDevices,
  normalizeAutomationCheckSources,
} from './automationConfig.ts';

test('normalizes legacy automation source ids into supported values', () => {
  assert.deepEqual(normalizeAutomationCheckSources(['cip', 'ipip', 'ip138', 'ip.sb', 'ipify']), [
    'cip.cc',
    'ipip',
    'ipify',
    'ip.sb',
  ]);
});

test('falls back to supported defaults when the saved source list is empty or invalid', () => {
  assert.deepEqual(normalizeAutomationCheckSources([]), ['cip.cc', 'ipip', 'ip.sb', 'icanhazip']);
  assert.deepEqual(normalizeAutomationCheckSources(['not-supported']), [
    'cip.cc',
    'ipip',
    'ip.sb',
    'icanhazip',
  ]);
  assert.deepEqual([...DEFAULT_AUTOMATION_CHECK_SOURCES], ['cip.cc', 'ipip', 'ip.sb', 'icanhazip']);
});

test('requires a selected device only when auto-update is enabled', () => {
  assert.equal(hasSelectedAutomationDevices(false, []), true);
  assert.equal(hasSelectedAutomationDevices(true, []), false);
  assert.equal(hasSelectedAutomationDevices(true, ['device-1']), true);
});

test('requires at least one supported check source only when IP monitoring is enabled', () => {
  assert.equal(hasSelectedAutomationCheckSources(false, []), true);
  assert.equal(hasSelectedAutomationCheckSources(true, []), false);
  assert.equal(hasSelectedAutomationCheckSources(true, ['not-supported']), false);
  assert.equal(hasSelectedAutomationCheckSources(true, ['ipify']), true);
  assert.equal(hasSelectedAutomationCheckSources(true, ['cip']), true);
});
