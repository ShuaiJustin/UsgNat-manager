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
    'ip.sb',
    'ipify',
  ]);
});

test('migrates a saved legacy ip138-only automation configuration to a domestic source', () => {
  assert.deepEqual(normalizeAutomationCheckSources(['ip138']), ['ipip', 'ddnspod', 'pconline']);
});

test('falls back to domestic defaults when the saved source list is empty or invalid', () => {
  assert.deepEqual(normalizeAutomationCheckSources([]), ['ipip', 'ddnspod', 'pconline']);
  assert.deepEqual(normalizeAutomationCheckSources(['not-supported']), [
    'ipip',
    'ddnspod',
    'pconline',
  ]);
  assert.deepEqual([...DEFAULT_AUTOMATION_CHECK_SOURCES], ['ipip', 'ddnspod', 'pconline']);
});

test('migrates the old cip.cc automation default pair to stable domestic defaults', () => {
  assert.deepEqual(normalizeAutomationCheckSources(['cip.cc', 'ipip']), [
    'ipip',
    'ddnspod',
    'pconline',
  ]);
});

test('still accepts explicit foreign automation sources when the user selects them', () => {
  assert.deepEqual(normalizeAutomationCheckSources(['ipify', 'ip.sb', 'icanhazip']), [
    'ipify',
    'ip.sb',
    'icanhazip',
  ]);
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
