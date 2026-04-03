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
