import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { setImmediate } from 'node:timers';
import * as helpers from './automation-service-helpers.ts';
import { usgParser } from './usg-parser.ts';
import { MandatoryUpdateBusinessGate } from './mandatory-update-business-gate.ts';

// Execute the real service while isolating Electron, storage, network and notifications.
/* eslint-disable @typescript-eslint/no-explicit-any -- Only this VM fixture reflects transpiled module exports and IPC/storage boundary payloads. */
function fixture(
  options: {
    backupFails?: boolean;
    batchFails?: boolean;
    alreadyCurrent?: boolean;
    incompleteRead?: boolean;
    verifyMismatch?: boolean;
    deviceEnabled?: boolean;
    ruleEnabled?: boolean;
    ruleDeviceId?: string;
    extraDevice?: boolean;
    deviceDisabledAfterPreflight?: boolean;
    ruleDisabledAfterPreflight?: boolean;
    credentialMissing?: boolean;
    natReadFailure?: { at: number; error: string };
    wanIP?: string;
  } = {}
) {
  const ip = '2.2.2.2';
  const gate = new MandatoryUpdateBusinessGate();
  const rule = {
    id: 'managed',
    deviceId: options.ruleDeviceId ?? 'device',
    ruleName: 'web',
    protocol: 'TCP',
    globalIp: '1.1.1.1',
    globalPort: '80',
    insideIp: '192.168.1.2',
    insidePort: '80',
    enabled: options.ruleEnabled !== false,
    noReverse: false,
  };
  const other = { ...rule, id: 'unmanaged', ruleName: 'other', globalPort: '81' };
  let observed = [rule, other]
    .map((r) =>
      usgParser.generateNatServerCommand({
        ...r,
        protocol: 'TCP',
        globalIp: options.alreadyCurrent ? ip : r.globalIp,
      })
    )
    .join('\n');
  const monitor = Object.assign(new EventEmitter(), {
    currentIP: ip,
    monitoring: false,
    async start() {
      this.monitoring = true;
      this.emit('initialized', this.currentIP);
    },
    stop() {
      this.monitoring = false;
    },
    isMonitoring() {
      return this.monitoring;
    },
    getCurrentIPSync() {
      return this.currentIP;
    },
    getLastSuccessfulCheck() {
      return new Date();
    },
    getLastConfirmedCheck() {
      return new Date();
    },
    async refreshConfirmedIP() {
      return this.currentIP;
    },
    updateConfig() {},
  });
  const mutations: string[][] = [];
  const databaseWrites: any[] = [];
  const reads: string[] = [];
  let batchFails = options.batchFails || false;
  let batchHook: (() => Promise<void>) | null = null;
  const device = {
    id: 'device',
    name: 'Firewall',
    host: 'test',
    port: 22,
    enabled: options.deviceEnabled !== false,
    connectionType: 'SSH',
  };
  const devices = options.extraDevice ? [device, { ...device, id: 'extra-device' }] : [device];
  let ruleReads = 0;
  const ssh = {
    async withDeviceOperation(_id: string, action: () => Promise<any>) {
      return action();
    },
    async connect() {
      return { success: true };
    },
    isConnected() {
      return true;
    },
    async disconnect() {},
    async executeCommand(_id: string, command: string) {
      reads.push(command);
      if (command === 'display ip interface brief | include /')
        return {
          success: true,
          complete: true,
          output: `Interface IP Address/Mask Physical Protocol
Dialer0 ${options.wanIP ?? monitor.currentIP}/32 up up(s)
GigabitEthernet0/0/1 192.168.1.1/24 up up`,
        };
      if (
        command.includes('include nat server') &&
        options.natReadFailure?.at ===
          reads.filter((item) => item.includes('include nat server')).length
      ) {
        return { success: false, complete: false, output: '', error: options.natReadFailure.error };
      }
      const output =
        options.verifyMismatch && mutations.length && command.includes('include nat server')
          ? observed.replaceAll('192.168.1.2', '192.168.1.99')
          : observed;
      return {
        success: !options.backupFails || command !== 'display current-configuration',
        complete: !options.incompleteRead,
        output,
        error: options.backupFails ? 'backup failed' : undefined,
      };
    },
    async executeBatchCommands(_id: string, commands: string[]) {
      mutations.push(commands);
      await batchHook?.();
      if (batchFails) return { success: false, error: 'connection lost' };
      for (const command of commands) {
        if (command.startsWith('undo nat server')) {
          const name = command.match(/^undo nat server(?: name)? (\S+)/)?.[1];
          observed = observed
            .split('\n')
            .filter((line) => !line.includes(` ${name} `))
            .join('\n');
        } else if (command.startsWith('nat server')) {
          observed += `\n${command}`;
        }
      }
      return { success: true };
    },
  };
  const noOp = async () => {};
  const notifications: unknown[][] = [];
  let notifyHook: (() => Promise<void>) | null = null;
  const logs: { level: string; operation: string; message: string }[] = [];
  let infoHook: ((message: string) => Promise<void>) | null = null;
  const log = (level: string) => async (operation: string, message: string) => {
    logs.push({ level, operation, message });
    if (level === 'info') await infoHook?.(message);
  };
  const jobs: (() => Promise<void>)[] = [];
  const timers: (() => Promise<void>)[] = [];
  let clock = Date.now();
  const timerRecords: {
    due: number;
    cancelled: boolean;
    fired: boolean;
    fire: () => Promise<void>;
    unref: () => void;
  }[] = [];
  class ClockDate extends Date {
    static now() {
      return clock;
    }
  }
  const modules: Record<string, any> = {
    events: { EventEmitter },
    electron: { app: { getPath: () => '/isolated' } },
    'fs/promises': { mkdir: noOp, writeFile: noOp, readdir: async () => [] },
    path: { join: (...parts: string[]) => parts.join('/') },
    'node-schedule': {
      RecurrenceRule: class {},
      scheduleJob: (_rule: any, callback: () => Promise<void>) => {
        jobs.push(callback);
        return { cancel() {} };
      },
    },
    './ip-monitor': { ipMonitor: monitor },
    './ssh-manager': { sshManager: ssh },
    './usg-parser': { usgParser },
    './logger': {
      logger: {
        info: log('info'),
        warning: log('warning'),
        error: log('error'),
        success: log('success'),
      },
    },
    './notifier': {
      notifier: {
        updateConfig() {},
        notifyIPChange: async () => {
          await notifyHook?.();
        },
        notifyUpdateSuccess: noOp,
        notifyUpdateFailed: async (...args: unknown[]) => {
          notifications.push(['failed', ...args]);
          await notifyHook?.();
        },
        notifyBatchUpdateCompleted: async (...args: unknown[]) => {
          notifications.push(['batch', ...args]);
          await notifyHook?.();
        },
        notifyManualConfirmationRequired: noOp,
      },
    },
    './credential-manager': {
      credentialManager: {
        getCredential: async () =>
          options.credentialMissing
            ? null
            : {
                authType: 'Password',
                username: 'test',
                password: 'isolated',
              },
      },
    },
    './prisma-client': {
      prisma: {
        device: {
          findMany: async ({ where }: any) =>
            devices.filter((item) => item.enabled && where.id.in.includes(item.id)),
          findUnique: async ({ where }: any) => {
            const found = devices.find((item) => item.id === where.id);
            return found && options.deviceDisabledAfterPreflight
              ? { ...found, enabled: false }
              : found;
          },
        },
        natRule: {
          findMany: async ({ where }: any) => {
            ruleReads++;
            return [rule, other].filter(
              (r) =>
                r.enabled &&
                !(options.ruleDisabledAfterPreflight && ruleReads > 1 && r.id === 'managed') &&
                (!where.id || where.id.in.includes(r.id)) &&
                (!where.deviceId ||
                  (typeof where.deviceId === 'string'
                    ? r.deviceId === where.deviceId
                    : where.deviceId.in.includes(r.deviceId)))
            );
          },
          updateMany: async (args: any) => {
            databaseWrites.push(args);
          },
          update: async (args: any) => {
            databaseWrites.push(args);
          },
        },
      },
    },
    './automation-service-helpers': helpers,
    './device-rule-snapshots': { deviceRuleSnapshots: { invalidate() {} } },
    './mandatory-update-business-gate': { mandatoryUpdateBusinessGate: gate },
    '../ip-check-sources': { DEFAULT_IP_CHECK_SOURCES: ['test'] },
  };
  const source = readFileSync(new URL('./automation-service.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const exports: any = {};
  vm.runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      if (!(name in modules)) throw new Error(`Unexpected dependency ${name}`);
      return modules[name];
    },
    console,
    setTimeout: (callback: () => void | Promise<void>, delay: number) => {
      const record = {
        due: clock + delay,
        cancelled: false,
        fired: false,
        unref() {},
        async fire() {
          if (record.cancelled || record.fired) return;
          record.fired = true;
          clock = Math.max(clock, record.due);
          await callback();
        },
      };
      timerRecords.push(record);
      timers.push(record.fire);
      return record;
    },
    clearTimeout: (timer: { cancelled: boolean }) => {
      timer.cancelled = true;
    },
    Date: ClockDate,
  });
  const service = exports.automationService;
  const config = {
    enabled: true,
    autoUpdateEnabled: true,
    triggerType: 'immediate',
    selectedDevices: ['device'],
    managedRuleIds: ['managed'],
    clientEgressConfirmed: true,
  };
  const drain = () => new Promise<void>((resolve) => setImmediate(resolve));
  return {
    service,
    gate,
    monitor,
    config,
    mutations,
    databaseWrites,
    reads,
    timers,
    logs,
    activeTimers: () => timerRecords.filter((timer) => !timer.cancelled && !timer.fired),
    async advance(milliseconds: number) {
      const until = clock + milliseconds;
      for (;;) {
        const next = timerRecords
          .filter((timer) => !timer.cancelled && !timer.fired && timer.due <= until)
          .sort((a, b) => a.due - b.due)[0];
        if (!next) break;
        await next.fire();
        await drain();
      }
      clock = until;
      await drain();
    },
    setInfoHook(hook: (message: string) => Promise<void>) {
      infoHook = hook;
    },
    jobs,
    drain,
    notifications,
    setNotifyHook(hook: () => Promise<void>) {
      notifyHook = hook;
    },
    setBatchFails(value: boolean) {
      batchFails = value;
    },
    setObserved(value: string) {
      observed = value;
    },
    setBatchHook(hook: () => Promise<void>) {
      batchHook = hook;
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

test('detected IP updates require a managed rule scope', async () => {
  const f = fixture();
  f.service.updateConfig({ ...f.config, managedRuleIds: [] });
  const empty = await f.service.manualUpdate();
  assert.equal(empty?.success, false);
  assert.match(empty.error, /受管规则/);
});

test('manual result preserves device failure and successful writes are strictly scoped', async () => {
  const f = fixture({ batchFails: true });
  f.service.updateConfig(f.config);
  const failed = await f.service.manualUpdate('2.2.2.2');
  assert.equal(failed?.success, false);
  assert.equal(failed.failedCount, 1);
  assert.match(failed.results[0].error, /connection lost/);
  f.setBatchFails(false);
  const result = await f.service.manualUpdate('2.2.2.2');
  assert.equal(result.success, true);
  assert.equal(result.successCount, 1);
  assert.equal(
    f.mutations[1].some((command) => command.includes(' other ')),
    false
  );
  assert.deepEqual(Array.from(f.databaseWrites[0].where.id.in), ['managed']);
});

test('backup failure blocks writes regardless of optional backup settings', async () => {
  const f = fixture({ backupFails: true });
  f.service.updateConfig(f.config);
  const result = await f.service.manualUpdate('2.2.2.2');
  assert.equal(result?.success, false);
  assert.equal(f.mutations.length, 0);
  assert.equal(f.databaseWrites.length, 0);
});

test('initial NAT read failure preserves the SSH reason and blocks device and cache writes', async () => {
  const f = fixture({ natReadFailure: { at: 1, error: '命令执行超时' } });
  f.service.updateConfig(f.config);
  const result = await f.service.manualUpdate('2.2.2.2');
  assert.equal(result.success, false);
  assert.match(result.results[0].error, /命令执行超时/);
  assert.ok(f.logs.some((entry) => entry.message.includes('命令执行超时')));
  assert.equal(f.mutations.length, 0);
  assert.equal(f.databaseWrites.length, 0);
});

test('prewrite NAT read failure preserves the command rejection and blocks writes', async () => {
  const f = fixture({ natReadFailure: { at: 2, error: 'Error: Unrecognized command' } });
  f.service.updateConfig(f.config);
  const result = await f.service.manualUpdate('2.2.2.2');
  assert.equal(result.success, false);
  assert.match(result.results[0].error, /Unrecognized command/);
  assert.equal(f.mutations.length, 0);
  assert.equal(f.databaseWrites.length, 0);
});

test('postwrite verification read failure reports the SSH reason without committing local success', async () => {
  const f = fixture({ natReadFailure: { at: 3, error: '设备在命令完成前关闭连接' } });
  f.service.updateConfig(f.config);
  const result = await f.service.manualUpdate('2.2.2.2');
  assert.equal(result.success, false);
  assert.equal(f.mutations.length, 1);
  assert.equal(f.databaseWrites.length, 0);
  assert.ok(f.logs.some((entry) => entry.message.includes('设备在命令完成前关闭连接')));
});

test('startup reconciles device observations and repeated checks do not rewrite matching rules', async () => {
  const f = fixture();
  await f.service.start(f.config);
  await f.drain();
  assert.equal(f.mutations.length, 1);
  f.monitor.emit('checked', { ip: f.monitor.currentIP, changed: false });
  await f.drain();
  assert.equal(f.mutations.length, 1);
  await f.service.stop();
});

test('same IP checks retry failed reconciliation by reading the device before another write', async () => {
  const f = fixture({ batchFails: true });
  await f.service.start(f.config);
  await f.drain();
  assert.equal(f.mutations.length, 1);
  f.setBatchFails(false);
  await f.timers.at(-1)?.();
  await f.drain();
  assert.equal(f.mutations.length, 2);
  assert.equal(
    f.reads.filter((command) => command.includes('include nat server')).length >= 3,
    true
  );
  await f.service.stop();
});

test('delayed updates refresh the target and stopping cancels waiting confirmation', async () => {
  const f = fixture();
  await f.service.start({ ...f.config, triggerType: 'delayed', delayMinutes: 1 });
  await f.drain();
  f.monitor.currentIP = '3.3.3.3';
  f.monitor.emit('changed', { oldIP: '2.2.2.2', newIP: '3.3.3.3' });
  await f.drain();
  await f.timers.at(-1)?.();
  await f.drain();
  assert.equal(
    f.mutations.at(-1)?.some((command) => command.includes('global 3.3.3.3')),
    true
  );
  f.service.updateConfig({ securityOptions: ['manualConfirm'] });
  const pending = f.service.manualUpdate('4.4.4.4');
  await f.drain();
  await f.service.stop();
  const result = await pending;
  assert.equal(result?.success, false);
  assert.equal(result.cancelled, true);
});

test('concurrent observations reserve only one five-minute delayed task before logging finishes', async () => {
  const f = fixture();
  let releaseLog!: () => void;
  const waitingLog = new Promise<void>((resolve) => {
    releaseLog = resolve;
  });
  f.setInfoHook((message) => (message.startsWith('延迟') ? waitingLog : Promise.resolve()));
  await f.service.start({ ...f.config, triggerType: 'delayed', delayMinutes: 5 });
  f.monitor.emit('checked', { ip: f.monitor.currentIP, changed: false });
  f.monitor.emit('checked', { ip: f.monitor.currentIP, changed: false });
  await f.drain();
  releaseLog();
  await f.drain();
  assert.equal(f.activeTimers().length, 1);
  assert.equal(f.mutations.length, 0);
  await f.service.stop();
  assert.equal(f.activeTimers().length, 0);
});

test('five-minute deadline refresh does not create a second timer for the same IP', async () => {
  const f = fixture();
  await f.service.start({ ...f.config, triggerType: 'delayed', delayMinutes: 5 });
  await f.drain();
  f.monitor.refreshConfirmedIP = async () => {
    f.monitor.emit('checked', { ip: f.monitor.currentIP, changed: false });
    return f.monitor.currentIP;
  };
  await f.advance(299999);
  assert.equal(f.mutations.length, 0);
  await f.advance(1);
  assert.equal(f.mutations.length, 1);
  assert.equal(f.activeTimers().length, 0);
  await f.service.stop();
});

test('a newly confirmed IP at the old deadline receives its own full five-minute delay', async () => {
  const f = fixture();
  await f.service.start({ ...f.config, triggerType: 'delayed', delayMinutes: 5 });
  await f.drain();
  f.monitor.refreshConfirmedIP = async () => {
    if (f.monitor.currentIP !== '3.3.3.3') {
      const oldIP = f.monitor.currentIP;
      f.monitor.currentIP = '3.3.3.3';
      f.monitor.emit('changed', { oldIP, newIP: f.monitor.currentIP });
    } else f.monitor.emit('checked', { ip: f.monitor.currentIP, changed: false });
    return f.monitor.currentIP;
  };
  await f.advance(300000);
  assert.equal(f.mutations.length, 0);
  assert.equal(f.activeTimers().length, 1);
  await f.advance(299999);
  assert.equal(f.mutations.length, 0);
  await f.advance(1);
  assert.equal(f.mutations.length, 1);
  assert.ok(f.mutations[0].some((command) => command.includes('global 3.3.3.3')));
  await f.service.stop();
});

test('stopping during the delayed refresh prevents the completed observation from restarting writes', async () => {
  const f = fixture();
  await f.service.start({ ...f.config, triggerType: 'delayed', delayMinutes: 5 });
  await f.drain();
  let finishSample!: (ip: string) => void;
  f.monitor.refreshConfirmedIP = () =>
    new Promise<string>((resolve) => {
      finishSample = resolve;
    });
  const waiting = f.timers.at(-1)!();
  await f.drain();
  await f.service.stop();
  // Later safety checks must not encounter the unresolved old sample again.
  f.monitor.refreshConfirmedIP = async () => f.monitor.currentIP;
  finishSample(f.monitor.currentIP);
  await waiting;
  await f.drain();
  assert.equal(f.mutations.length, 0);
  assert.equal(f.databaseWrites.length, 0);
});

test('a delayed automatic write blocked by the interface check leaves an actionable log', async () => {
  const f = fixture({ wanIP: '9.9.9.9' });
  await f.service.start({
    ...f.config,
    triggerType: 'delayed',
    delayMinutes: 5,
  });
  await f.drain();
  await f.advance(300000);
  assert.equal(f.mutations.length, 0);
  assert.ok(f.logs.some((entry) => /不在设备/.test(entry.message)));
  await f.service.stop();
});

test('device credential preflight failure is visible in the message instead of only batch details', async () => {
  const f = fixture({ credentialMissing: true });
  f.service.updateConfig(f.config);
  const result = await f.service.manualUpdate('2.2.2.2');
  assert.equal(result.success, false);
  assert.equal(f.mutations.length, 0);
  assert.ok(f.logs.some((entry) => /未配置.*凭据/.test(entry.message)));
});

test('retry observes a new confirmed target without bypassing its five-minute delay', async () => {
  const f = fixture({ batchFails: true });
  await f.service.start({ ...f.config, triggerType: 'delayed', delayMinutes: 5 });
  await f.drain();
  await f.advance(300000);
  assert.equal(f.mutations.length, 1);
  f.setBatchFails(false);
  f.monitor.refreshConfirmedIP = async () => {
    if (f.monitor.currentIP !== '3.3.3.3') {
      const oldIP = f.monitor.currentIP;
      f.monitor.currentIP = '3.3.3.3';
      f.monitor.emit('changed', { oldIP, newIP: f.monitor.currentIP });
    } else f.monitor.emit('checked', { ip: f.monitor.currentIP, changed: false });
    return f.monitor.currentIP;
  };
  await f.advance(30000);
  assert.equal(f.mutations.length, 1);
  assert.equal(f.activeTimers().length, 1);
  await f.advance(300000);
  assert.equal(f.mutations.length, 2);
  assert.ok(f.mutations[1].some((command) => command.includes('global 3.3.3.3')));
  await f.service.stop();
});

test('stop during a retry refresh prevents an old task from starting a new update run', async () => {
  const f = fixture({ batchFails: true });
  await f.service.start(f.config);
  await f.drain();
  assert.equal(f.mutations.length, 1);
  f.setBatchFails(false);
  let finishSample!: (ip: string) => void;
  f.monitor.refreshConfirmedIP = () =>
    new Promise<string>((resolve) => {
      finishSample = resolve;
    });
  const waiting = f.timers.at(-1)!();
  await f.drain();
  await f.service.stop();
  f.monitor.refreshConfirmedIP = async () => f.monitor.currentIP;
  finishSample(f.monitor.currentIP);
  await waiting;
  assert.equal(f.mutations.length, 1);
  assert.equal(f.databaseWrites.length, 0);
});

test('an older change notification finishing late cannot postpone the latest confirmed IP deadline', async () => {
  const f = fixture();
  await f.service.start({ ...f.config, triggerType: 'delayed', delayMinutes: 5 });
  await f.drain();
  await f.advance(60000);
  let releaseOldLog!: () => void;
  const oldLog = new Promise<void>((resolve) => {
    releaseOldLog = resolve;
  });
  f.setInfoHook((message) => (message.includes('-> 3.3.3.3') ? oldLog : Promise.resolve()));
  f.monitor.currentIP = '3.3.3.3';
  f.monitor.emit('changed', { oldIP: '2.2.2.2', newIP: '3.3.3.3' });
  f.monitor.currentIP = '4.4.4.4';
  f.monitor.emit('changed', { oldIP: '3.3.3.3', newIP: '4.4.4.4' });
  await f.drain();
  await f.advance(60000);
  releaseOldLog();
  await f.drain();
  await f.advance(240000);
  assert.equal(f.mutations.length, 1);
  assert.ok(f.mutations[0].some((command) => command.includes('global 4.4.4.4')));
  await f.service.stop();
});

test(
  'busy automation retains and reconciles the newest target after completing the active device',
  { timeout: 2000 },
  async () => {
    const f = fixture();
    let release: (() => void) | undefined;
    f.setBatchHook(async () => {
      if (f.mutations.length === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
    });
    await f.service.start(f.config);
    await f.drain();
    assert.equal(f.mutations.length, 1);
    f.monitor.currentIP = '3.3.3.3';
    f.monitor.emit('changed', { oldIP: '2.2.2.2', newIP: '3.3.3.3' });
    await f.drain();
    assert.equal(f.mutations.length, 1);
    const latestCompleted = new Promise<void>((resolve) =>
      f.service.on('update-completed', () => {
        if (f.mutations.length === 2) resolve();
      })
    );
    release?.();
    await latestCompleted;
    assert.equal(f.mutations.length, 2);
    assert.equal(
      f.mutations[1].some((command) => command.includes('global 3.3.3.3')),
      true
    );
    await f.service.stop();
  }
);

test('rollback restores the device observation rather than stale cached IP', async () => {
  const f = fixture();
  f.setObserved('nat server web protocol tcp global 9.9.9.9 80 inside 192.168.1.2 80');
  f.setBatchHook(async () => f.setBatchFails(f.mutations.length === 1));
  f.service.updateConfig({ ...f.config, backupOptions: ['autoRollback'] });
  const result = await f.service.manualUpdate('2.2.2.2');
  assert.equal(result.success, false);
  assert.equal(f.mutations.length, 2);
  assert.equal(
    f.mutations[1].some((command) => command.includes('global 9.9.9.9')),
    true
  );
  assert.equal(
    f.mutations[1].some((command) => command.includes('global 1.1.1.1')),
    false
  );
  assert.equal(f.databaseWrites[0].data.globalIp, '9.9.9.9');
});

test('incomplete device reads and verification mismatches never report success or update the cache', async () => {
  for (const options of [{ incompleteRead: true }, { verifyMismatch: true }]) {
    const f = fixture(options);
    f.service.updateConfig(f.config);
    const result = await f.service.manualUpdate('2.2.2.2');
    assert.equal(result.success, false);
    assert.equal(f.databaseWrites.length, 0);
    assert.equal(f.mutations.length, options.incompleteRead ? 0 : 1);
  }
});

test('deleted managed names are not replaced by a different named device rule', async () => {
  const f = fixture();
  f.setObserved('nat server unrelated protocol tcp global 1.1.1.1 80 inside 192.168.1.2 80');
  f.service.updateConfig(f.config);
  const result = await f.service.manualUpdate('2.2.2.2');
  assert.equal(result.success, false);
  assert.match(result.results[0].error, /删除|冲突/);
  assert.equal(f.mutations.length, 0);
});

test('resume reads the current device state even when the public IP has not changed', async () => {
  const f = fixture({ alreadyCurrent: true });
  await f.service.start(f.config);
  await f.drain();
  assert.equal(f.mutations.length, 0);
  f.setObserved('nat server web protocol tcp global 1.1.1.1 80 inside 192.168.1.2 80');
  await f.service.resume();
  await f.drain();
  assert.equal(f.mutations.length, 1);
  await f.service.stop();
});

test('matching device rules do not request confirmation again on unchanged observations', async () => {
  const f = fixture({ alreadyCurrent: true });
  let requests = 0;
  f.service.on('manual-confirm-request', () => {
    requests++;
  });
  await f.service.start({ ...f.config, securityOptions: ['manualConfirm'] });
  await f.drain();
  f.monitor.emit('checked', { ip: f.monitor.currentIP, changed: false });
  await f.drain();
  assert.equal(requests, 0);
  assert.equal(f.mutations.length, 0);
  await f.service.stop();
});

test('device changes during confirmation invalidate the plan before any mutating command', async () => {
  const f = fixture();
  f.service.updateConfig({ ...f.config, securityOptions: ['manualConfirm'] });
  f.service.on('manual-confirm-request', (request: { callback: (confirmed: boolean) => void }) => {
    f.setObserved('nat server web protocol tcp global 9.9.9.9 80 inside 192.168.1.2 80');
    request.callback(true);
  });
  const result = await f.service.manualUpdate('2.2.2.2');
  assert.equal(result.success, false);
  assert.equal(f.mutations.length, 0);
});

test('a mixed valid and invalid saved scope fails closed rather than silently updating a subset', async () => {
  for (const config of [
    { selectedDevices: ['device', 'deleted-device'], managedRuleIds: ['managed'] },
    { selectedDevices: ['device'], managedRuleIds: ['managed', 'deleted-rule'] },
  ]) {
    const f = fixture();
    f.service.updateConfig({ ...f.config, ...config });
    const result = await f.service.manualUpdate('2.2.2.2');
    assert.equal(result.success, false);
    assert.match(result.error, /deleted-/);
    assert.equal(f.mutations.length, 0);
  }
});

test('disabled devices, disabled rules, foreign rules and devices without managed rules all fail closed', async () => {
  for (const options of [
    { deviceEnabled: false },
    { ruleEnabled: false },
    { ruleDeviceId: 'unselected' },
    { extraDevice: true },
  ]) {
    const f = fixture(options);
    f.service.updateConfig({
      ...f.config,
      selectedDevices: options.extraDevice ? ['device', 'extra-device'] : ['device'],
    });
    const result = await f.service.manualUpdate('2.2.2.2');
    assert.equal(result.success, false);
    assert.match(result.error, /设备|规则/);
    assert.equal(f.mutations.length, 0);
  }
});

test('internal maintenance startup enables monitoring while all writes remain gated and mandatory remains prohibited', async () => {
  const f = fixture();
  f.gate.block('maintenance');
  await f.service.start(f.config, { duringMaintenance: true });
  await f.drain();
  assert.equal(f.monitor.isMonitoring(), true);
  assert.equal(f.mutations.length, 0);
  assert.equal((await f.service.manualUpdate('2.2.2.2')).success, false);
  f.gate.block('mandatory');
  await assert.rejects(f.service.start(f.config, { duringMaintenance: true }), /强制更新/);
  f.gate.unblock('mandatory');
  f.gate.unblock('maintenance');
  await f.service.resume();
  await f.drain();
  assert.equal(f.mutations.length, 1);
  await f.service.stop();
});

test('device or rule disablement after preflight is revalidated under the device lock before writing', async () => {
  for (const options of [
    { deviceDisabledAfterPreflight: true },
    { ruleDisabledAfterPreflight: true },
  ]) {
    const f = fixture(options);
    f.service.updateConfig({
      ...f.config,
      managedRuleIds: options.ruleDisabledAfterPreflight ? ['managed', 'unmanaged'] : ['managed'],
    });
    const result = await f.service.manualUpdate('2.2.2.2');
    assert.equal(result.success, false);
    assert.equal(f.mutations.length, 0);
  }
  const options = { ruleDisabledAfterPreflight: false };
  const f = fixture(options);
  f.service.updateConfig({ ...f.config, securityOptions: ['manualConfirm'] });
  f.service.on('manual-confirm-request', (request: { callback: (confirmed: boolean) => void }) => {
    options.ruleDisabledAfterPreflight = true;
    request.callback(true);
  });
  assert.equal((await f.service.manualUpdate('2.2.2.2')).success, false);
  assert.equal(f.mutations.length, 0);
});

test('a verified IP is not reconciled or announced again on unchanged checks', async () => {
  const f = fixture();
  await f.service.start(f.config);
  await f.drain();
  assert.equal(f.mutations.length, 1);
  assert.equal(f.notifications.filter((item) => item[0] === 'batch').length, 1);
  const readsAfterStart = f.reads.length;
  for (let i = 0; i < 3; i++) {
    f.monitor.emit('checked', { ip: f.monitor.currentIP, changed: false });
    await f.drain();
  }
  assert.equal(f.reads.length, readsAfterStart);
  assert.equal(f.notifications.filter((item) => item[0] === 'batch').length, 1);
  assert.equal(f.service.getStatus().lastAppliedIP, '2.2.2.2');
  f.monitor.currentIP = '3.3.3.3';
  f.monitor.emit('changed', { oldIP: '2.2.2.2', newIP: '3.3.3.3' });
  await f.drain();
  assert.equal(f.mutations.length, 2);
  await f.service.stop();
});

test('startup reconciliation of already matching devices sends no success notification', async () => {
  const f = fixture({ alreadyCurrent: true });
  await f.service.start(f.config);
  await f.drain();
  assert.equal(f.mutations.length, 0);
  assert.equal(f.notifications.length, 0);
  await f.service.stop();
});

test('confirmation timeout is re-asked next cycle while an explicit rejection suppresses the IP', async () => {
  const f = fixture();
  const answers: [boolean, string?][] = [
    [false, 'timeout'],
    [false, undefined],
  ];
  let requests = 0;
  f.service.on(
    'manual-confirm-request',
    (request: { callback: (confirmed: boolean, reason?: string) => void }) => {
      const [confirmed, reason] = answers[requests++] ?? [false, undefined];
      request.callback(confirmed, reason);
    }
  );
  await f.service.start({ ...f.config, securityOptions: ['manualConfirm'] });
  await f.drain();
  assert.equal(requests, 1);
  // An unanswered request backs off instead of prompting on every check.
  f.monitor.emit('checked', { ip: f.monitor.currentIP, changed: false });
  await f.drain();
  assert.equal(requests, 1);
  await f.advance(5 * 60000);
  f.monitor.emit('checked', { ip: f.monitor.currentIP, changed: false });
  await f.drain();
  assert.equal(requests, 2);
  f.monitor.emit('checked', { ip: f.monitor.currentIP, changed: false });
  await f.drain();
  assert.equal(requests, 2);
  assert.equal(f.mutations.length, 0);
  await f.service.stop();
});

test('a start rejected by the gate after monitor startup leaves the service stopped', async () => {
  const f = fixture();
  const start = f.monitor.start.bind(f.monitor);
  f.monitor.start = async () => {
    f.gate.block('mandatory');
    await start();
  };
  await assert.rejects(f.service.start(f.config), /强制更新/);
  assert.equal(f.service.getStatus().isRunning, false);
  assert.equal(f.monitor.isMonitoring(), false);
});

test('stalled notifications do not block IP change handling or a failed update result', async () => {
  const f = fixture({ batchFails: true });
  f.setNotifyHook(() => new Promise<void>(() => {}));
  f.service.updateConfig(f.config);
  const failed = await f.service.manualUpdate('2.2.2.2');
  assert.equal(failed.success, false);
  f.setBatchFails(false);
  await f.service.start(f.config);
  await f.drain();
  const before = f.mutations.length;
  f.monitor.currentIP = '3.3.3.3';
  f.monitor.emit('changed', { oldIP: '2.2.2.2', newIP: '3.3.3.3' });
  await f.drain();
  assert.equal(f.mutations.length, before + 1);
  await f.service.stop();
});

test('automatic retries stop after five consecutive failures until the IP changes', async () => {
  const f = fixture({ batchFails: true });
  await f.service.start(f.config);
  await f.drain();
  await f.advance(60 * 60000);
  assert.equal(f.mutations.length, 5);
  assert.equal(f.activeTimers().length, 0);
  const status = f.service.getStatus();
  assert.equal(status.needsAttention, true);
  assert.equal(status.consecutiveFailures, 5);
  assert.ok(f.logs.some((entry) => entry.level === 'error' && /连续 5 次/.test(entry.message)));
  assert.equal(f.notifications.filter((item) => item[1] === '自动更新').length, 1);
  f.monitor.emit('checked', { ip: f.monitor.currentIP, changed: false });
  await f.advance(60 * 60000);
  assert.equal(f.mutations.length, 5);
  f.setBatchFails(false);
  f.monitor.currentIP = '3.3.3.3';
  f.monitor.emit('changed', { oldIP: '2.2.2.2', newIP: '3.3.3.3' });
  await f.drain();
  assert.equal(f.mutations.length, 6);
  assert.equal(f.service.getStatus().needsAttention, false);
  await f.service.stop();
});

test('notification-only config changes do not cancel an in-flight batch', async () => {
  const f = fixture();
  let release!: () => void;
  f.setBatchHook(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  f.service.updateConfig(f.config);
  const running = f.service.manualUpdate('2.2.2.2');
  for (let i = 0; i < 20 && !release; i++) await f.drain();
  f.service.updateConfig({
    ...f.config,
    notifyTypes: [],
    windowsNotifyEnabled: false,
    checkInterval: 5,
  });
  release();
  const result = await running;
  assert.equal(result.success, true);
  assert.equal(result.cancelled, false);
});

test('an unchanged verified IP is still re-read hourly and after outside rule writes', async () => {
  const f = fixture();
  await f.service.start(f.config);
  await f.drain();
  const readsAfterStart = f.reads.length;
  await f.advance(60 * 60000);
  f.monitor.emit('checked', { ip: f.monitor.currentIP, changed: false });
  await f.drain();
  assert.ok(f.reads.length > readsAfterStart);
  const readsAfterHourly = f.reads.length;
  f.service.invalidateAppliedState();
  f.monitor.emit('checked', { ip: f.monitor.currentIP, changed: false });
  await f.drain();
  assert.ok(f.reads.length > readsAfterHourly);
  await f.service.stop();
});

test('a run that started before an outside rule write does not re-mark the IP as applied', async () => {
  const f = fixture();
  await f.service.start(f.config);
  await f.drain();
  f.service.invalidateAppliedState();
  assert.equal(f.service.getStatus().lastAppliedIP, null);
  await f.service.stop();
});

test('a detected IP that the firewall does not hold on any interface is never written', async () => {
  const f = fixture({ wanIP: '9.9.9.9' });
  await f.service.start(f.config);
  await f.drain();
  assert.equal(f.mutations.length, 0);
  assert.ok(f.reads.includes('display ip interface brief | include /'));
  await f.service.stop();
});

test('a persistent interface mismatch stops retries with the cause in the alert', async () => {
  const f = fixture({ wanIP: '9.9.9.9' });
  await f.service.start(f.config);
  await f.drain();
  await f.advance(60 * 60000);
  assert.equal(f.mutations.length, 0);
  assert.equal(f.service.getStatus().needsAttention, true);
  assert.ok(f.logs.some((log) => log.level === 'error' && /不在设备/.test(log.message)));
  await f.service.stop();
});
