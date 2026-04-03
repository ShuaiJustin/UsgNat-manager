import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_IP_CHECK_SOURCES, normalizeIPCheckSources } from './ip-check-sources.ts';

test('maps legacy source ids to supported ids and removes duplicates', () => {
  assert.deepEqual(normalizeIPCheckSources(['cip', 'ipip', 'ip138', 'ip.sb', 'ipify', 'ip.sb']), [
    'cip.cc',
    'ipip',
    'ipify',
    'ip.sb',
  ]);
});

test('falls back to the supported defaults when no usable source remains', () => {
  assert.deepEqual(normalizeIPCheckSources(['unknown-source']), [...DEFAULT_IP_CHECK_SOURCES]);
  assert.deepEqual(normalizeIPCheckSources(undefined), [...DEFAULT_IP_CHECK_SOURCES]);
});
