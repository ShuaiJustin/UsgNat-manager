import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('Windows types and enable switch do not suppress independent email notifications', async () => {
  /* eslint-disable @typescript-eslint/no-explicit-any -- Only the reflected VM notification fixture uses dynamic module and Electron boundary payloads. */
  const windows: any[] = [];
  const emails: string[] = [];
  const noop = async () => {};
  const modules: Record<string, any> = {
    electron: {
      Notification: class {
        options: any;
        constructor(options: any) {
          this.options = options;
        }
        show() {
          windows.push(this.options);
        }
      },
    },
    './email-service': {
      emailService: {
        notifyIPChange: async () => emails.push('ipChange'),
        notifyUpdateFailed: async () => emails.push('updateFailed'),
      },
    },
    './logger': { logger: { info: noop, error: noop } },
  };
  const source = readFileSync(new URL('./notifier.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: any = {};
  vm.runInNewContext(output, { exports, require: (name: string) => modules[name], console });
  const notifier = exports.notifier;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  notifier.updateConfig({
    windowsNotifyEnabled: true,
    emailNotifyEnabled: true,
    notifyTypes: ['updateFailed'],
  });
  await notifier.notifyIPChange('1.1.1.1', '2.2.2.2');
  assert.deepEqual(emails, ['ipChange']);
  assert.equal(windows.length, 0);
  notifier.updateConfig({ windowsNotifyEnabled: false });
  await notifier.notifyUpdateFailed('isolated', 'test error');
  assert.deepEqual(emails, ['ipChange', 'updateFailed']);
  assert.equal(windows.length, 0);
});

test('manual confirmation reminder is shown only while no app window is visible', async () => {
  /* eslint-disable @typescript-eslint/no-explicit-any -- Reflected VM fixture with an Electron boundary stub. */
  const shown: any[] = [];
  let windows: any[] = [];
  const noop = async () => {};
  const modules: Record<string, any> = {
    electron: {
      BrowserWindow: { getAllWindows: () => windows },
      Notification: class {
        options: any;
        constructor(options: any) {
          this.options = options;
        }
        show() {
          shown.push(this.options);
        }
      },
    },
    './email-service': { emailService: {} },
    './logger': { logger: { info: noop, error: noop } },
  };
  const source = readFileSync(new URL('./notifier.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: any = {};
  vm.runInNewContext(output, { exports, require: (name: string) => modules[name], console });
  const notifier = exports.notifier;
  const window = (visible: boolean, minimized = false) => ({
    isDestroyed: () => false,
    isVisible: () => visible,
    isMinimized: () => minimized,
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
  windows = [window(true)];
  await notifier.notifyManualConfirmationRequired('8.8.8.8');
  assert.equal(shown.length, 0);
  windows = [window(false)];
  await notifier.notifyManualConfirmationRequired('8.8.8.8');
  windows = [window(true, true)];
  await notifier.notifyManualConfirmationRequired('8.8.8.8');
  assert.equal(shown.length, 2);
  assert.match(shown[0].body, /8\.8\.8\.8/);
});
