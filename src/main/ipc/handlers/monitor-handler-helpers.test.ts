import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCurrentMonitorIP } from './monitor-handler-helpers.ts';

test('returns the cached IP while the monitor is actively running', async () => {
  let fetchCalled = false;

  const currentIP = await resolveCurrentMonitorIP({
    isMonitoring: true,
    currentIP: '1.2.3.4',
    fetchCurrentIP: async () => {
      fetchCalled = true;
      return '5.6.7.8';
    },
  });

  assert.equal(currentIP, '1.2.3.4');
  assert.equal(fetchCalled, false);
});

test('fetches a fresh IP when the monitor is stopped to avoid stale cached values', async () => {
  let fetchCalled = false;

  const currentIP = await resolveCurrentMonitorIP({
    isMonitoring: false,
    currentIP: '1.2.3.4',
    fetchCurrentIP: async () => {
      fetchCalled = true;
      return '5.6.7.8';
    },
  });

  assert.equal(currentIP, '5.6.7.8');
  assert.equal(fetchCalled, true);
});

test('returns the fallback IP when fetching the current IP fails', async () => {
  const currentIP = await resolveCurrentMonitorIP({
    isMonitoring: false,
    currentIP: '',
    fetchCurrentIP: async () => {
      throw new Error('network down');
    },
  });

  assert.equal(currentIP, '0.0.0.0');
});
