import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_IP_CHECK_SOURCES, normalizeIPCheckSources } from './ip-check-sources.ts';

test('maps legacy source ids to supported ids and removes duplicates', () => {
  assert.deepEqual(normalizeIPCheckSources(['cip', 'ipip', 'ip138', 'ip.sb', 'ipify', 'ip.sb']), [
    'cip.cc',
    'ipip',
    'ip.sb',
    'ipify',
  ]);
});

test('migrates a saved legacy ip138-only configuration to a domestic source', () => {
  assert.deepEqual(normalizeIPCheckSources(['ip138']), ['ipip', 'ddnspod', 'pconline']);
});

test('falls back to domestic defaults when no usable source remains', () => {
  assert.deepEqual(normalizeIPCheckSources(['unknown-source']), ['ipip', 'ddnspod', 'pconline']);
  assert.deepEqual(normalizeIPCheckSources(undefined), ['ipip', 'ddnspod', 'pconline']);
  assert.deepEqual([...DEFAULT_IP_CHECK_SOURCES], ['ipip', 'ddnspod', 'pconline']);
});

test('migrates the old cip.cc default pair to stable domestic defaults', () => {
  assert.deepEqual(normalizeIPCheckSources(['cip.cc', 'ipip']), ['ipip', 'ddnspod', 'pconline']);
});

test('keeps explicit foreign sources selectable without making them defaults', () => {
  assert.deepEqual(normalizeIPCheckSources(['ipify', 'icanhazip', 'ifconfig', 'ipinfo']), [
    'ipify',
    'icanhazip',
    'ifconfig',
    'ipinfo',
  ]);
});
