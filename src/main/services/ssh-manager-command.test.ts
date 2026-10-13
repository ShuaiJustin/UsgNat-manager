import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { setImmediate } from 'node:timers';
import vm from 'node:vm';
import ts from 'typescript';
import * as helpers from './ssh-manager-helpers.ts';

/* eslint-disable @typescript-eslint/no-explicit-any -- VM fixture reflects transpiled exports and a fake ssh2 stream. */

// A VRP-like shell: prompt after login, honours `screen-length 0 temporary`, otherwise pages
// long output at "---- More ----" and waits for a space.
const fakeVrpShell = (
  lines: string[],
  options: { pagingSupported: boolean; redrawBeforeEcho?: boolean; stallWith?: string }
) => {
  const written: string[] = [];
  let pagingOff = false;
  const stream: any = new EventEmitter();
  stream.stderr = new EventEmitter();
  let pending: string[] = [];
  const send = (text: string) => setImmediate(() => stream.emit('data', Buffer.from(text)));
  const page = () => {
    const chunk = pending.splice(0, pagingOff ? pending.length : 3);
    send(chunk.map((line) => line + '\r\n').join(''));
    send(pending.length ? '  ---- More ----' : '<usg6300>');
  };
  stream.write = (text: string) => {
    written.push(text);
    const line = text.replace(/\n$/, '');
    if (text === ' ') {
      send('\x1b[16D                \x1b[16D');
      page();
    } else if (line === helpers.DISABLE_PAGING_COMMAND) {
      pagingOff = options.pagingSupported;
      if (options.redrawBeforeEcho) send('\r\n<usg6300>');
      send(
        line +
          '\r\n' +
          (options.pagingSupported
            ? 'Info: takes effect on this terminal.'
            : 'Error: Unrecognized command') +
          '\r\n<usg6300>'
      );
    } else if (options.stallWith) {
      send(line + '\r\n' + options.stallWith);
    } else {
      send(line + '\r\n');
      pending = [...lines];
      page();
    }
    return true;
  };
  stream.end = () => setImmediate(() => stream.emit('close'));
  setImmediate(() => send('Info: The max number of VTY users is 5.\r\n<usg6300>'));
  return { stream, written };
};

const loadManager = () => {
  const source = readFileSync(new URL('./ssh-manager.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const exports: any = {};
  const noop = async () => {};
  const modules: Record<string, unknown> = {
    ssh2: { Client: class {} },
    events: { EventEmitter },
    buffer: { Buffer },
    './logger': { logger: { info: noop, warning: noop, error: noop, success: noop } },
    './prisma-client': { prisma: {} },
    './ssh-manager-helpers': helpers,
  };
  vm.runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      if (!(name in modules)) throw new Error(`Unexpected dependency ${name}`);
      return modules[name];
    },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    Buffer,
  });
  return exports;
};

const interfaceLines = Array.from({ length: 10 }, (_, index) =>
  index === 0
    ? 'Dialer0                           203.0.113.7/32       up         up(s)'
    : `GigabitEthernet0/0/${index}             192.168.${index}.1/24       up         up`
);

for (const pagingSupported of [true, false]) {
  test(`a long read completes ${pagingSupported ? 'with paging turned off' : 'by paging through More'}`, async () => {
    const { SSHManager } = loadManager();
    const manager = new SSHManager();
    const shell = fakeVrpShell(interfaceLines, { pagingSupported });
    manager.connections.set('d', { shell: (callback: any) => callback(undefined, shell.stream) });
    const result = await manager.executeCommand(
      'd',
      'display ip interface brief | include /',
      5000
    );
    assert.equal(result.success, true, result.error);
    assert.equal(result.complete, true);
    assert.equal(shell.written[0], helpers.DISABLE_PAGING_COMMAND + '\n');
    assert.match(result.output, /203\.0\.113\.7\/32/);
    assert.match(result.output, /192\.168\.9\.1\/24/);
    assert.doesNotMatch(result.output, /More/);
  });
}

test('a shell that never opens times out saying so, without device output', async () => {
  const { SSHManager } = loadManager();
  const manager = new SSHManager();
  manager.connections.set('d', { shell: () => {} });
  const result = await manager.executeCommand('d', 'display ip interface brief | include /', 50);
  assert.equal(result.success, false);
  assert.match(result.error, /VTY/);
});
test('a prompt redrawn before the paging echo does not leak its error into the result', async () => {
  const { SSHManager } = loadManager();
  const manager = new SSHManager();
  const shell = fakeVrpShell(interfaceLines, { pagingSupported: false, redrawBeforeEcho: true });
  manager.connections.set('d', { shell: (callback: any) => callback(undefined, shell.stream) });
  const result = await manager.executeCommand('d', 'display ip interface brief | include /', 5000);
  assert.equal(result.success, true, result.error);
  assert.doesNotMatch(result.output, /Unrecognized/);
});

test('a read that stalls mid-output reports the stage but never the device output', async () => {
  const { SSHManager } = loadManager();
  const manager = new SSHManager();
  const shell = fakeVrpShell([], {
    pagingSupported: true,
    stallWith: ' ike peer x\r\n  pre-shared-key %^%#secret%^%#\r\n',
  });
  manager.connections.set('d', { shell: (callback: any) => callback(undefined, shell.stream) });
  const result = await manager.executeCommand('d', 'display current-configuration', 300);
  assert.equal(result.success, false);
  assert.match(result.error, /命令已发送/);
  assert.doesNotMatch(result.error, /secret|pre-shared/);
});
test('a shell the device never opens is retried once on a fresh connection', async () => {
  const { SSHManager } = loadManager();
  const manager = new SSHManager();
  let reconnects = 0;
  manager.connections.set('d', { shell: () => {}, end: () => {} });
  manager.connectionConfigs.set('d', { host: 'h', port: 22, username: 'u' });
  manager.connect = async (id: string) => {
    reconnects += 1;
    // The device only greets once the channel exists, so the fake shell starts here.
    const shell = fakeVrpShell(interfaceLines, { pagingSupported: true });
    manager.connections.set(id, {
      shell: (callback: any) => callback(undefined, shell.stream),
      end: () => {},
    });
    return { success: true, message: 'ok' };
  };
  const result = await manager.executeCommand('d', 'display ip interface brief | include /', 10000);
  assert.equal(reconnects, 1);
  assert.equal(result.success, true, result.error);
  assert.match(result.output, /203\.0\.113\.7\/32/);
});

test('a finished command closes its channel instead of only sending EOF', async () => {
  const { SSHManager } = loadManager();
  const manager = new SSHManager();
  const shell = fakeVrpShell(interfaceLines, { pagingSupported: true });
  let closed = false;
  shell.stream.close = () => {
    closed = true;
  };
  manager.connections.set('d', { shell: (callback: any) => callback(undefined, shell.stream) });
  const result = await manager.executeCommand('d', 'display ip interface brief | include /', 5000);
  assert.equal(result.success, true, result.error);
  assert.equal(closed, true);
});
test('a device that drops the connection after each command is logged in to again', async () => {
  const { SSHManager } = loadManager();
  const manager = new SSHManager();
  let logins = 0;
  const login = () => {
    logins += 1;
    const shell = fakeVrpShell(interfaceLines, { pagingSupported: true });
    // VRP ends the SSH connection once the command's channel is closed.
    shell.stream.close = () => manager.connections.delete('d');
    manager.connections.set('d', {
      shell: (callback: any) => callback(undefined, shell.stream),
      end: () => {},
    });
  };
  login();
  manager.connectionConfigs.set('d', { host: 'h', port: 22, username: 'u' });
  manager.connect = async () => {
    login();
    return { success: true, message: 'ok' };
  };
  const first = await manager.executeCommand('d', 'display ip interface brief | include /', 5000);
  const second = await manager.executeCommand('d', 'display ip interface brief | include /', 5000);
  assert.equal(first.success, true, first.error);
  assert.equal(second.success, true, second.error);
  assert.equal(logins, 2);
  // After an explicit disconnect the manager must not log in again on its own.
  await manager.disconnect('d');
  const after = await manager.executeCommand('d', 'display ip interface brief | include /', 500);
  assert.equal(after.success, false);
  assert.equal(logins, 2);
});

test('a refused channel is retried on a new connection right away', async () => {
  const { SSHManager } = loadManager();
  const manager = new SSHManager();
  manager.connections.set('d', {
    shell: (callback: any) => callback(new Error('Channel open failure')),
    end: () => {},
  });
  manager.connectionConfigs.set('d', { host: 'h', port: 22, username: 'u' });
  manager.connect = async (id: string) => {
    const shell = fakeVrpShell(interfaceLines, { pagingSupported: true });
    manager.connections.set(id, {
      shell: (callback: any) => callback(undefined, shell.stream),
      end: () => {},
    });
    return { success: true, message: 'ok' };
  };
  const started = Date.now();
  const result = await manager.executeCommand('d', 'display ip interface brief | include /', 10000);
  assert.equal(result.success, true, result.error);
  assert.ok(Date.now() - started < 2500);
});
test('a connection that is closing (shell throws) is replaced, not left running in the background', async () => {
  const { SSHManager } = loadManager();
  const manager = new SSHManager();
  let logins = 0;
  manager.connections.set('d', {
    shell: () => {
      throw new Error('Not connected');
    },
    end: () => {},
  });
  manager.connectionConfigs.set('d', { host: 'h', port: 22, username: 'u' });
  manager.connect = async (id: string) => {
    logins += 1;
    const shell = fakeVrpShell(interfaceLines, { pagingSupported: true });
    manager.connections.set(id, {
      shell: (callback: any) => callback(undefined, shell.stream),
      end: () => {},
    });
    return { success: true, message: 'ok' };
  };
  const result = await manager.executeCommand('d', 'display ip interface brief | include /', 5000);
  assert.equal(result.success, true, result.error);
  // Nothing may log in again after the command has finished.
  await new Promise((resolve) => setTimeout(resolve, 3300));
  assert.equal(logins, 1);
});
/* eslint-enable @typescript-eslint/no-explicit-any */
