import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as configServiceHelpers from '../../services/config-service-helpers.ts';
import { MandatoryUpdateBusinessGate } from '../../services/mandatory-update-business-gate.ts';
import { getErrorMessage } from './shared.ts';

async function setup(
  save: () => Promise<void>,
  afterConfigChange?: (type: string) => Promise<void>
) {
  const handlers = new Map<
    string,
    (...args: unknown[]) => Promise<{ success: boolean; error?: string }>
  >();
  const gate = new MandatoryUpdateBusinessGate();
  let runtimeWrites = 0;
  const dependencies: Record<string, unknown> = {
    electron: {
      ipcMain: {
        handle: (channel: string, handler: (...args: unknown[]) => Promise<{ success: boolean }>) =>
          handlers.set(channel, handler),
      },
    },
    '../../services/config-service': { configService: { saveConfig: save } },
    '../../services/config-service-helpers': configServiceHelpers,
    '../../services/email-service': { emailService: { configure: () => runtimeWrites++ } },
    '../../services/backup-service': { backupService: {} },
    '../../services/custom-updater': { customUpdater: {} },
    '../../services/logger': { logger: { info: async () => {}, error: async () => {} } },
    '../../services/notifier': { notifier: { updateConfig: () => {} } },
    '../../services/mandatory-update-business-gate': { mandatoryUpdateBusinessGate: gate },
    './shared': { getErrorMessage },
  };
  const source = await fs.readFile(new URL('config-handlers.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const module = {
    exports: {} as {
      registerConfigHandlers?: (options?: {
        afterConfigChange?: (type: string) => Promise<void>;
      }) => void;
    },
  };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (id: string) => dependencies[id],
    console,
  });
  module.exports.registerConfigHandlers!({ afterConfigChange });
  return { gate, handlers, runtimeWrites: () => runtimeWrites };
}

test('configuration and email writes are rejected while maintenance holds the business gate', async () => {
  let persisted = 0;
  const service = await setup(async () => {
    persisted++;
  });
  service.gate.block('maintenance');
  assert.equal((await service.handlers.get('email:configure')!({}, {})).success, false);
  assert.equal((await service.handlers.get('config:save')!({}, 'app', {})).success, false);
  assert.equal((await service.handlers.get('config:save')!({}, 'update', {})).success, false);
  assert.equal(persisted, 0);
  assert.equal(service.runtimeWrites(), 0);
});

test('email configuration applies persisted data through the supplied serialized lifecycle', async () => {
  let persisted = false;
  const applied: string[] = [];
  const service = await setup(
    async () => {
      persisted = true;
    },
    async (type) => {
      assert.equal(persisted, true);
      applied.push(type);
    }
  );
  assert.equal((await service.handlers.get('email:configure')!({}, {})).success, true);
  assert.deepEqual(applied, ['email']);
  assert.equal(service.runtimeWrites(), 0);
  await service.gate.waitForIdle();
});

test('in-flight configuration is drained by maintenance and failing persistence releases the gate', async () => {
  let rejectSave!: (error: Error) => void;
  const saving = new Promise<void>((_resolve, reject) => {
    rejectSave = reject;
  });
  const service = await setup(() => saving);
  const result = service.handlers.get('email:configure')!({}, {});
  let drained = false;
  service.gate.block('maintenance');
  const waiting = service.gate.waitForIdle().then(() => {
    drained = true;
  });
  await Promise.resolve();
  assert.equal(drained, false);
  rejectSave(new Error('persistence failed'));
  assert.equal((await result).success, false);
  await waiting;
  assert.equal(drained, true);
  assert.equal(service.runtimeWrites(), 0);
});

test('config:save rejects ssh host fingerprints and unknown config keys', async () => {
  let persisted = 0;
  const service = await setup(async () => {
    persisted++;
  });
  for (const type of ['ssh-host:device-1', 'unknown', undefined]) {
    const result = await service.handlers.get('config:save')!({}, type, {});
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /未知配置类型/);
  }
  assert.equal(persisted, 0);
  assert.equal((await service.handlers.get('config:save')!({}, 'app', {})).success, true);
  assert.equal(persisted, 1);
  await service.gate.waitForIdle();
});
