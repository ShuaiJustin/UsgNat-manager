import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { ManualConfirmationManager } from './manual-confirmation.ts';
import { registerManualConfirmationLifecycle } from './manual-confirmation-lifecycle.ts';
import { MandatoryUpdateBusinessGate } from './services/mandatory-update-business-gate.ts';

type ConfirmationPayload = {
  newIP: string;
  deviceCount: number;
  callback: (confirmed: boolean) => void;
};

const createHarness = () => {
  const automationEvents = new EventEmitter();
  const gate = new MandatoryUpdateBusinessGate();
  const manager = new ManualConfirmationManager();
  const requests: ReturnType<ManualConfirmationManager['getPending']>[] = [];
  let cancellationNotices = 0;

  registerManualConfirmationLifecycle({
    automationEvents,
    gate,
    manager,
    notifyRequest: (request) => requests.push(request),
    notifyCancelled: () => {
      cancellationNotices += 1;
    },
  });

  const emitRequest = () => {
    const confirmations: boolean[] = [];
    const payload: ConfirmationPayload = {
      newIP: '203.0.113.8',
      deviceCount: 2,
      callback: (confirmed) => confirmations.push(confirmed),
    };
    automationEvents.emit('manual-confirm-request', payload);
    return confirmations;
  };

  return {
    automationEvents,
    cancellationNotices: () => cancellationNotices,
    emitRequest,
    gate,
    manager,
    requests,
  };
};

test('blocked confirmation requests are rejected without creating pending state', () => {
  const harness = createHarness();
  harness.gate.block();

  const confirmations = harness.emitRequest();

  assert.deepEqual(confirmations, [false]);
  assert.equal(harness.manager.getPending(), null);
  assert.deepEqual(harness.requests, []);
});

test('stopping automation clears pending confirmation and notifies the renderer', () => {
  const harness = createHarness();
  const confirmations = harness.emitRequest();
  assert.notEqual(harness.manager.getPending(), null);
  assert.equal(harness.requests.length, 1);

  harness.automationEvents.emit('stopped');

  assert.deepEqual(confirmations, [false]);
  assert.equal(harness.manager.getPending(), null);
  assert.equal(harness.cancellationNotices(), 1);
});

test('mandatory blocking clears pending state and rejects a late request', () => {
  const harness = createHarness();
  const activeConfirmations = harness.emitRequest();

  harness.gate.block();

  assert.deepEqual(activeConfirmations, [false]);
  assert.equal(harness.manager.getPending(), null);
  assert.equal(harness.cancellationNotices(), 1);

  const lateConfirmations = harness.emitRequest();
  assert.deepEqual(lateConfirmations, [false]);
  assert.equal(harness.manager.getPending(), null);
  assert.equal(harness.requests.length, 1);
});
