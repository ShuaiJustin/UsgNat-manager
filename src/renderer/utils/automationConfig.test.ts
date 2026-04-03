import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_AUTOMATION_CHECK_SOURCES,
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
  assert.deepEqual(normalizeAutomationCheckSources([]), [...DEFAULT_AUTOMATION_CHECK_SOURCES]);
  assert.deepEqual(normalizeAutomationCheckSources(['not-supported']), [
    ...DEFAULT_AUTOMATION_CHECK_SOURCES,
  ]);
});

test('requires a selected device only when auto-update is enabled', () => {
  assert.equal(hasSelectedAutomationDevices(false, []), true);
  assert.equal(hasSelectedAutomationDevices(true, []), false);
  assert.equal(hasSelectedAutomationDevices(true, ['device-1']), true);
});
