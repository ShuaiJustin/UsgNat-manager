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
function monitorFixture(resolver?: () => Promise<string>, env: Record<string, string> = {}) {
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
    process: { env },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
  const monitor = new exports.IPMonitor({ confirmCount: 3 }, resolver);
  monitor.on('error', () => {});
  return monitor;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

test('firewall WAN resolver wins over a unanimous TUN proxy exit address', async () => {
  const monitor = monitorFixture(async () => '8.8.8.8');
  let websiteCalls = 0;
  monitor.fetchIPFromSource = async () => {
    websiteCalls++;
    return '9.9.9.9';
  };
  assert.equal(await monitor.checkIP(), '8.8.8.8');
  assert.equal(websiteCalls, 0);
});

test('failed WAN reads never fall back to websites and invalidate the old displayed address', async () => {
  let offline = false;
  const monitor = monitorFixture(async () => {
    if (offline) throw new Error('WAN unavailable');
    return '8.8.8.8';
  });
  monitor.fetchIPFromSource = async () => {
    throw new Error('website must not be used');
  };
  assert.equal(await monitor.checkIP(), '8.8.8.8');
  offline = true;
  await assert.rejects(monitor.checkIP(), /WAN unavailable/);
  assert.equal(monitor.getCurrentIPSync(), '');
  assert.equal(monitor.getLastConfirmedCheck(), null);
  await assert.rejects(monitor.fetchCurrentIP(), /WAN unavailable/);
});

test('switching from a website observation to WAN discards a pending proxy sample', async () => {
  const monitor = monitorFixture();
  monitor.fetchCurrentIP = async () => '9.9.9.9';
  await monitor.checkIP();
  delete monitor.fetchCurrentIP;
  monitor.setIPResolver(async () => '8.8.8.8');
  assert.equal(monitor.getCurrentIPSync(), '');
  assert.equal(await monitor.checkIP(), '8.8.8.8');
});

test('stopping a WAN monitor clears the address before a different device is started', async () => {
  const monitor = monitorFixture(async () => '8.8.8.8');
  await monitor.checkIP();
  monitor.stop();
  assert.equal(monitor.getCurrentIPSync(), '');
  assert.equal(monitor.getLastConfirmedCheck(), null);
});

test('website checks do not inherit HTTP proxy environment variables', async () => {
  let proxyCalls = 0;
  const direct = http.createServer((_req, res) => res.end('8.8.8.8'));
  const proxy = http.createServer((_req, res) => {
    proxyCalls++;
    res.end('9.9.9.9');
  });
  await new Promise<void>((resolve) => direct.listen(0, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const keys = [
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'http_proxy',
    'https_proxy',
    'all_proxy',
    'NO_PROXY',
    'no_proxy',
  ];
  const saved = keys.map((key) => [key, process.env[key]] as const);
  try {
    const target = direct.address();
    const proxyAddress = proxy.address();
    assert.ok(target && typeof target !== 'string');
    assert.ok(proxyAddress && typeof proxyAddress !== 'string');
    for (const key of keys)
      process.env[key] =
        key.toLowerCase() === 'no_proxy' ? '' : `http://127.0.0.1:${proxyAddress.port}`;
    const monitor = monitorFixture(undefined, { HTTPS_PROXY: process.env.HTTPS_PROXY! });
    assert.equal(
      await monitor.fetchIPFromSource(
        {
          name: 'fixture',
          url: `http://127.0.0.1:${target.port}`,
          parser: (value: string) => value.trim(),
        },
        1
      ),
      '8.8.8.8'
    );
    assert.equal(proxyCalls, 0);
    monitor.axiosInstance.defaults.httpAgent.destroy();
    monitor.axiosInstance.defaults.httpsAgent.destroy();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    direct.closeAllConnections();
    proxy.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => direct.close(() => resolve())),
      new Promise<void>((resolve) => proxy.close(() => resolve())),
    ]);
  }
});

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

test('a fresh device scope checks immediately while the cancelled old device check is still in flight', async () => {
  let finish: (value: string) => void = () => {};
  let started: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let first = true;
  const monitor = monitorFixture(async () => {
    if (!first) return '9.9.9.9';
    first = false;
    started();
    return new Promise<string>((resolve) => {
      finish = resolve;
    });
  });
  const old = monitor.checkIP();
  const rejected = assert.rejects(old, /已变化|取消/);
  await ready;
  monitor.invalidateObservation();
  const fresh = monitor.checkIP();
  assert.notEqual(fresh, old);
  assert.equal(await fresh, '9.9.9.9');
  finish('8.8.8.8');
  await rejected;
  assert.equal(monitor.getCurrentIPSync(), '9.9.9.9');
});
