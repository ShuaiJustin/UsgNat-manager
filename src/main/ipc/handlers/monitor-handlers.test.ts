import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { setImmediate } from 'node:timers';
import { MandatoryUpdateBusinessGate } from '../../services/mandatory-update-business-gate.ts';

/* eslint-disable @typescript-eslint/no-explicit-any -- Only this fixture reflects IPC callbacks, module exports and persistent-write payloads inside an isolated VM. */
function handlersFixture() {
  const handlers = new Map<string, (...args: any[]) => Promise<any>>();
  const gate = new MandatoryUpdateBusinessGate();
  let writes = 0;
  let finishLog: (() => void) | undefined;
  const modules: Record<string, any> = {
    electron: {
      ipcMain: { handle: (channel: string, handler: any) => handlers.set(channel, handler) },
    },
    '../../services/credential-manager': {
      credentialManager: {
        saveCredential: async () => {
          writes++;
        },
        deleteCredential: async () => {
          writes++;
        },
      },
    },
    '../../services/ip-monitor': { ipMonitor: {} },
    '../../services/automation-service': { automationService: {} },
    '../../services/logger': {
      logger: {
        cleanup: async () => {
          writes++;
          return 1;
        },
        info: () =>
          new Promise<void>((resolve) => {
            finishLog = resolve;
          }),
        error: async () => {},
      },
    },
    '../../services/custom-updater': { customUpdater: { replayCurrentState() {} } },
    '../../services/mandatory-update-business-gate': { mandatoryUpdateBusinessGate: gate },
    './monitor-handler-helpers': {},
    './shared': { getErrorMessage: (error: Error) => error.message },
  };
  const source = readFileSync(new URL('./monitor-handlers.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: any = {};
  vm.runInNewContext(output, { exports, require: (name: string) => modules[name] });
  exports.registerMonitorHandlers();
  return { gate, handlers, getWrites: () => writes, finishLog: () => finishLog?.() };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

test('maintenance blocks credential save and delete before any persistent mutation', async () => {
  const f = handlersFixture();
  f.gate.block();
  await assert.rejects(
    f.handlers.get('credential:save')!(null, 'device', { username: 'isolated' }),
    /暂停/
  );
  await assert.rejects(f.handlers.get('credential:delete')!(null, 'device'), /暂停/);
  await assert.rejects(f.handlers.get('log:cleanup')!(null, 30), /暂停/);
  assert.equal(f.getWrites(), 0);
});

test('credential operations stay registered through logging so maintenance waits for completion', async () => {
  for (const channel of ['credential:save', 'credential:delete', 'log:cleanup']) {
    const f = handlersFixture();
    const operation = f.handlers.get(channel)!(null, 'device', {});
    await new Promise<void>((resolve) => setImmediate(resolve));
    f.gate.block();
    let idle = false;
    const waiting = f.gate.waitForIdle().then(() => {
      idle = true;
    });
    await Promise.resolve();
    assert.equal(idle, false);
    assert.equal(f.getWrites(), 1);
    f.finishLog();
    await operation;
    await waiting;
    assert.equal(idle, true);
  }
});
