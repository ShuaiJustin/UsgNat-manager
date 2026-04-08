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
  assert.deepEqual(normalizeIPCheckSources(['ip138']), ['cip.cc']);
});

test('falls back to domestic defaults when no usable source remains', () => {
  assert.deepEqual(normalizeIPCheckSources(['unknown-source']), ['cip.cc', 'ipip']);
  assert.deepEqual(normalizeIPCheckSources(undefined), ['cip.cc', 'ipip']);
  assert.deepEqual([...DEFAULT_IP_CHECK_SOURCES], ['cip.cc', 'ipip']);
});

test('keeps explicit foreign sources selectable without making them defaults', () => {
  assert.deepEqual(normalizeIPCheckSources(['ipify', 'icanhazip', 'ifconfig', 'ipinfo']), [
    'ipify',
    'icanhazip',
    'ifconfig',
    'ipinfo',
  ]);
});
