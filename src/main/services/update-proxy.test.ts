import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Socket } from 'node:net';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as helpers from './custom-updater-helpers.ts';
import { resolveUpdateProxyAgent } from './update-proxy.ts';

test('update proxy resolution honors DIRECT, HTTP(S), unsupported routes and rejects credential-bearing results', async () => {
  const url = 'https://github.com/release';
  for (const result of ['DIRECT', 'SOCKS5 127.0.0.1:1080', 'DIRECT; PROXY 127.0.0.1:8080'])
    assert.equal(await resolveUpdateProxyAgent(url, async () => result), undefined);
  for (const result of ['PROXY 127.0.0.1:7897; DIRECT', 'HTTPS [::1]:8443']) {
    const agent = await resolveUpdateProxyAgent(url, async () => result);
    assert.ok(agent);
    agent.destroy();
  }
  await assert.rejects(
    resolveUpdateProxyAgent(url, async () => 'PROXY user:secret@host:80'),
    /地址无效/
  );
  await assert.rejects(
    resolveUpdateProxyAgent(url, async () => {
      throw new Error('secret');
    }),
    (error: Error) => !error.message.includes('secret') && /系统/.test(error.message)
  );
});

test('manifest and installer downloads use the resolved local proxy on every redirect without origin DNS', async (t) => {
  const sockets = new Set<Socket>();
  const origin = createServer((req, res) => {
    if (req.url === '/start') res.writeHead(302, { location: '/manifest.json' }).end();
    else if (req.url === '/manifest.json') res.end('{"version":"1.1.15"}');
    else if (req.url === '/setup') res.writeHead(302, { location: '/installer.exe' }).end();
    else if (req.url === '/installer.exe') res.end('installer-test-payload');
    else res.writeHead(404).end();
  });
  const proxy = createServer();
  proxy.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  proxy.on('connect', (_req, socket, head) => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) socket.unshift(head);
    origin.emit('connection', socket);
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    proxy.close();
    origin.close();
  });
  const address = proxy.address();
  assert.ok(address && typeof address !== 'string');
  const resolved: string[] = [];
  const resolveProxy = async (url: string) => {
    resolved.push(url);
    return `PROXY 127.0.0.1:${address.port}`;
  };
  const agent = (url: string) => resolveUpdateProxyAgent(url, resolveProxy);
  const base = 'http://no-direct-dns.invalid';
  assert.equal(
    await helpers.fetchUpdateManifest(`${base}/start`, 'test', 0, agent),
    '{"version":"1.1.15"}'
  );
  assert.deepEqual(resolved, [`${base}/start`, `${base}/manifest.json`]);

  // Execute the actual downloader while isolating Electron and production services.
  const exports: Record<
    string,
    { downloadFile: (url: string, file: string, size: number) => Promise<void> }
  > = {};
  const dependencies: Record<string, unknown> = {
    electron: { session: { defaultSession: { resolveProxy } } },
    './custom-updater-helpers': helpers,
    './update-proxy': { resolveUpdateProxyAgent },
    './logger': { logger: { info: async () => {} } },
    './config-service': {},
    './backup-service': {},
    '../runtime-mode': {},
  };
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const source = ts.transpileModule(
    readFileSync(join(process.cwd(), 'src/main/services/custom-updater.ts'), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    }
  ).outputText;
  vm.runInNewContext(source, {
    exports,
    require: (id: string) => dependencies[id] ?? require(id),
    process,
    Buffer,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
  });
  const dir = mkdtempSync(join(tmpdir(), 'usg-update-proxy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'installer.exe');
  await exports.customUpdater.downloadFile(
    `${base}/setup`,
    file,
    Buffer.byteLength('installer-test-payload')
  );
  assert.equal(readFileSync(file, 'utf8'), 'installer-test-payload');
  assert.deepEqual(resolved.slice(2), [`${base}/setup`, `${base}/installer.exe`]);
});

test('silent CONNECT and destination TLS handshakes time out and close their proxy sockets', async (t) => {
  for (const tunnel of [false, true]) {
    const sockets = new Set<Socket>();
    const proxy = createServer();
    proxy.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      socket.once('end', () => socket.end());
    });
    proxy.on('connect', (_req, socket) => {
      if (tunnel) socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      socket.resume();
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    t.after(() => {
      for (const socket of sockets) socket.destroy();
      proxy.close();
    });
    const address = proxy.address();
    assert.ok(address && typeof address !== 'string');
    const started = Date.now();
    const agent = (url: string) =>
      resolveUpdateProxyAgent(url, async () => `PROXY 127.0.0.1:${address.port}`, 100);
    await assert.rejects(
      helpers.fetchUpdateManifest('https://silent.invalid/manifest.json', 'test', 0, agent)
    );
    assert.ok(
      Date.now() - started < 2000,
      'handshake must not wait for the normal request timeout'
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    assert.equal(sockets.size, 0, 'timed-out handshake must release the proxy connection');
  }
});
