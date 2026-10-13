import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { setImmediate } from 'node:timers';
import { MandatoryUpdateBusinessGate } from '../../services/mandatory-update-business-gate.ts';

test('maintenance blocks runtime configuration changes and waits for admitted changes through logging', async () => {
  /* eslint-disable @typescript-eslint/no-explicit-any -- This fixture reflects IPC callbacks and transpiled VM exports; assertions below retain concrete gate behavior. */
  const gate = new MandatoryUpdateBusinessGate();
  const handlers = new Map<string, (...args: any[]) => Promise<any>>();
  let changes = 0;
  let finishLog: (() => void) | undefined;
  const modules: Record<string, any> = {
    electron: {
      ipcMain: { handle: (channel: string, handler: any) => handlers.set(channel, handler) },
      BrowserWindow: { getAllWindows: () => [] },
    },
    '../../manual-confirmation-lifecycle': { registerManualConfirmationLifecycle() {} },
    '../../services/automation-service': {
      automationService: {
        updateConfig() {
          changes++;
        },
      },
    },
    '../../services/custom-updater': { customUpdater: { replayCurrentState() {} } },
    '../../services/logger': {
      logger: {
        info: () =>
          new Promise<void>((resolve) => {
            finishLog = resolve;
          }),
        error: async () => {},
      },
    },
    '../../services/mandatory-update-business-gate': { mandatoryUpdateBusinessGate: gate },
    './shared': { getErrorMessage: (error: Error) => error.message },
  };
  const source = readFileSync(new URL('./automation-handlers.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: any = {};
  vm.runInNewContext(output, { exports, require: (name: string) => modules[name] });
  exports.registerAutomationHandlers({});
  /* eslint-enable @typescript-eslint/no-explicit-any */
  gate.block('maintenance');
  assert.equal((await handlers.get('automation:updateConfig')!(null, {})).success, false);
  assert.equal(changes, 0);
  gate.unblock('maintenance');
  const operation = handlers.get('automation:updateConfig')!(null, {});
  await new Promise<void>((resolve) => setImmediate(resolve));
  gate.block('maintenance');
  let idle = false;
  const waiting = gate.waitForIdle().then(() => {
    idle = true;
  });
  await Promise.resolve();
  assert.equal(idle, false);
  finishLog?.();
  assert.equal((await operation).success, true);
  await waiting;
  assert.equal(changes, 1);
  assert.equal(idle, true);
});
