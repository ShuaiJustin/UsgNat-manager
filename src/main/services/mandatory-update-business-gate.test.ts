import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('maintenance and mandatory-update blocks cannot release each other', async () => {
  const { MandatoryUpdateBusinessGate } = await import('./mandatory-update-business-gate.ts');
  const gate = new MandatoryUpdateBusinessGate();
  gate.block('maintenance');
  gate.block();
  gate.unblock();
  assert.equal(gate.isBlocked(), true);
  assert.equal(gate.tryEnter(), null);
  gate.unblock('maintenance');
  assert.equal(gate.isBlocked(), false);
});
import { fileURLToPath } from 'node:url';

type BusinessGate = {
  block: () => void;
  unblock: () => void;
  isBlocked: () => boolean;
  tryEnter: () => (() => void) | null;
  waitForIdle: () => Promise<void>;
  onBlocked: (callback: () => void) => () => void;
};

const loadGate = async () => {
  const helperPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'mandatory-update-business-gate.ts'
  );
  assert.equal(fs.existsSync(helperPath), true, 'missing mandatory business gate');
  return import('./mandatory-update-business-gate.ts') as Promise<{
    MandatoryUpdateBusinessGate: new () => BusinessGate;
  }>;
};

test('blocking rejects new work and waits for work that passed the pre-check', async () => {
  const { MandatoryUpdateBusinessGate } = await loadGate();
  const gate = new MandatoryUpdateBusinessGate();
  const release = gate.tryEnter();
  assert.equal(typeof release, 'function');

  gate.block();
  assert.equal(gate.isBlocked(), true);
  assert.equal(gate.tryEnter(), null);

  let idle = false;
  const waiting = gate.waitForIdle().then(() => {
    idle = true;
  });
  await Promise.resolve();
  assert.equal(idle, false);

  release?.();
  await waiting;
  assert.equal(idle, true);

  gate.unblock();
  const nextRelease = gate.tryEnter();
  assert.equal(typeof nextRelease, 'function');
  nextRelease?.();
});

test('blocking cancels pending confirmation callbacks once per transition', async () => {
  const { MandatoryUpdateBusinessGate } = await loadGate();
  const gate = new MandatoryUpdateBusinessGate();
  let cancellations = 0;
  const unsubscribe = gate.onBlocked(() => {
    cancellations += 1;
  });

  gate.block();
  gate.block();
  gate.unblock();
  gate.block();
  unsubscribe();
  gate.unblock();
  gate.block();

  assert.equal(cancellations, 2);
});

test('one failing blocked callback cannot prevent the remaining safety callbacks', async () => {
  const { MandatoryUpdateBusinessGate } = await loadGate();
  const gate = new MandatoryUpdateBusinessGate();
  let completedCallbacks = 0;
  const callbackErrors: unknown[][] = [];
  const originalConsoleError = console.error;

  gate.onBlocked(() => {
    throw new Error('callback failed');
  });
  gate.onBlocked(() => {
    completedCallbacks += 1;
  });

  console.error = (...args: unknown[]) => callbackErrors.push(args);
  try {
    assert.doesNotThrow(() => gate.block());
    assert.equal(gate.isBlocked(), true);
    assert.equal(completedCallbacks, 1);
    assert.equal(callbackErrors.length, 1);
  } finally {
    console.error = originalConsoleError;
  }
});

test('mandatory gate is wired through every business entry point and waits for automation to stop', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const automationSource = fs.readFileSync(
    path.join(root, 'services', 'automation-service.ts'),
    'utf8'
  );
  const automationHandlersSource = fs.readFileSync(
    path.join(root, 'ipc', 'handlers', 'automation-handlers.ts'),
    'utf8'
  );
  const monitorHandlersSource = fs.readFileSync(
    path.join(root, 'ipc', 'handlers', 'monitor-handlers.ts'),
    'utf8'
  );
  const mainSource = fs.readFileSync(path.join(root, 'main.ts'), 'utf8');

  assert.match(automationSource, /AutomationRunController/);
  assert.match(automationSource, /mandatoryUpdateBusinessGate\.isBlocked\(\)/);
  assert.match(automationSource, /updateRuns\.cancelAndWait/);
  assert.match(automationHandlersSource, /mandatoryUpdateBusinessGate\.tryEnter\(\)/);
  assert.match(monitorHandlersSource, /mandatoryUpdateBusinessGate\.tryEnter\(\)/);
  assert.match(mainSource, /mandatoryUpdateBusinessGate\.block\(\)/);
  assert.match(mainSource, /mandatoryUpdateBusinessGate\.unblock\(\)/);
  assert.match(mainSource, /mandatoryUpdateBusinessGate\.waitForIdle\(\)/);
});

test('renderer exposes and handles confirmation cancellation notifications', () => {
  const mainRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const sourceRoot = path.resolve(mainRoot, '..');
  const preloadSource = fs.readFileSync(path.join(mainRoot, 'preload.ts'), 'utf8');
  const dialogSource = fs.readFileSync(
    path.join(sourceRoot, 'renderer', 'components', 'AutomationConfirmDialog.tsx'),
    'utf8'
  );

  assert.match(preloadSource, /automation:confirm-cancelled/);
  assert.match(dialogSource, /onConfirmCancelled/);
});
