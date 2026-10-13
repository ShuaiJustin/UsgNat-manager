import assert from 'node:assert/strict';
import test from 'node:test';

import { ManualConfirmationManager } from './manual-confirmation.ts';

test('returns pending confirmation info and resolves matching responses', () => {
  const manager = new ManualConfirmationManager();
  const confirmations: boolean[] = [];

  const request = manager.start(
    { newIP: '1.2.3.4', deviceCount: 2, timeoutMs: 5000 },
    (confirmed) => confirmations.push(confirmed)
  );

  assert.deepEqual(manager.getPending(), request);
  assert.equal(manager.respond(request.requestId, true), true);
  assert.deepEqual(confirmations, [true]);
  assert.equal(manager.getPending(), null);
});

test('ignores stale response ids and keeps the active confirmation pending', () => {
  const manager = new ManualConfirmationManager();
  const confirmations: boolean[] = [];

  const request = manager.start(
    { newIP: '5.6.7.8', deviceCount: 1, timeoutMs: 5000 },
    (confirmed) => confirmations.push(confirmed)
  );

  assert.equal(manager.respond('stale-request', true), false);
  assert.deepEqual(confirmations, []);
  assert.deepEqual(manager.getPending(), request);
});

test('clears previous pending requests when a new confirmation starts', () => {
  const manager = new ManualConfirmationManager();
  const confirmations: boolean[] = [];

  manager.start({ newIP: '1.1.1.1', deviceCount: 1, timeoutMs: 5000 }, (confirmed) =>
    confirmations.push(confirmed)
  );

  const latestRequest = manager.start(
    { newIP: '2.2.2.2', deviceCount: 3, timeoutMs: 5000 },
    (confirmed) => confirmations.push(confirmed)
  );

  assert.deepEqual(confirmations, [false]);
  assert.deepEqual(manager.getPending(), latestRequest);
});

test('timeouts and cancellations are reported separately from an explicit rejection', async () => {
  const manager = new ManualConfirmationManager();
  const results: unknown[][] = [];
  const rejected = manager.start({ newIP: '1.1.1.1', deviceCount: 1, timeoutMs: 5000 }, (...args) =>
    results.push(args)
  );
  manager.respond(rejected.requestId, false);
  manager.start({ newIP: '1.1.1.1', deviceCount: 1, timeoutMs: 5000 }, (...args) =>
    results.push(args)
  );
  manager.clear(false);
  manager.start({ newIP: '1.1.1.1', deviceCount: 1, timeoutMs: 1 }, (...args) =>
    results.push(args)
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(results, [[false], [false, 'cancelled'], [false, 'timeout']]);
  assert.equal(manager.getPending(), null);
});
