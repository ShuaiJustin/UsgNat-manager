import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import vm from 'node:vm';
import ts from 'typescript';
import axios from 'axios';
import * as sources from './ip-monitor-sources.ts';
import * as utils from './ip-monitor-utils.ts';
import * as sourceConfig from '../ip-check-sources.ts';

/* eslint-disable @typescript-eslint/no-explicit-any -- This fixture reflects isolated VM module exports, without accessing real network or storage. */
function monitorFixture() {
  const noop = async () => {};
  const modules: Record<string, any> = {
    events: { EventEmitter },
    axios,
    'node:http': http,
    'node:https': https,
    'https-proxy-agent': { HttpsProxyAgent: class {} },
    './ip-monitor-sources': sources,
    './ip-monitor-utils': utils,
    '../ip-check-sources': sourceConfig,
    './logger': { logger: { info: noop, warning: noop, error: noop } },
  };
  const source = readFileSync(new URL('./ip-monitor.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const exports: any = {};
  vm.runInNewContext(output, {
    exports,
    require: (name: string) => modules[name],
    console,
    process: { env: {} },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
  const monitor = new exports.IPMonitor({ confirmCount: 3 });
  monitor.on('error', () => {});
  return monitor;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

test('fresh observations wait for candidate confirmation and failures cannot fall back to cached IP', async () => {
  const monitor = monitorFixture();
  let samples = 0;
  monitor.fetchCurrentIP = async () => {
    samples++;
    return samples === 1 ? '1.1.1.1' : '2.2.2.2';
  };
  assert.equal(monitor.getLastSuccessfulCheck(), null);
  assert.equal(await monitor.checkIP(), '1.1.1.1');
  assert.equal(await monitor.checkIP(), '1.1.1.1');
  assert.equal(monitor.getCurrentIPSync(), '1.1.1.1');
  assert.equal(await monitor.refreshConfirmedIP(), '2.2.2.2');
  assert.equal(samples, 4);
  assert.equal(monitor.getLastSuccessfulCheck() !== null, true);
  monitor.fetchCurrentIP = async () => {
    throw new Error('offline');
  };
  await assert.rejects(monitor.refreshConfirmedIP(), /offline/);
  assert.equal(monitor.getCurrentIPSync(), '2.2.2.2');
});

test('stopping discards an in-flight sample and overlapping checks share one network observation', async () => {
  const monitor = monitorFixture();
  let resolve: ((ip: string) => void) | undefined;
  let calls = 0;
  monitor.fetchCurrentIP = () => {
    calls++;
    return new Promise<string>((done) => {
      resolve = done;
    });
  };
  const first = monitor.checkIP();
  const second = monitor.checkIP();
  assert.equal(calls, 1);
  monitor.stop();
  resolve?.('1.1.1.1');
  await assert.rejects(first, /取消/);
  await assert.rejects(second, /取消/);
  assert.equal(monitor.getCurrentIPSync(), '');
  assert.equal(monitor.getLastSuccessfulCheck(), null);
});

test('changing detection sources invalidates the old confirmed observation', async () => {
  const monitor = monitorFixture();
  monitor.fetchCurrentIP = async () => '1.1.1.1';
  await monitor.checkIP();
  monitor.updateConfig({ sources: ['ip.sb'] });
  assert.equal(monitor.getCurrentIPSync(), '');
  assert.equal(monitor.getLastConfirmedCheck(), null);
  assert.throws(() => monitor.updateConfig({ confirmCount: 0 }), /确认/);
});

test('unchanged check interval does not restart a running monitor', async () => {
  const monitor = monitorFixture();
  monitor.fetchCurrentIP = async () => '1.1.1.1';
  let restarts = 0;
  monitor.on('stopped', () => restarts++);
  await monitor.start();
  monitor.updateConfig({ checkInterval: 5, confirmCount: 3 });
  assert.equal(restarts, 0);
  monitor.updateConfig({ checkInterval: 6 });
  assert.equal(restarts, 1);
  monitor.stop();
});
