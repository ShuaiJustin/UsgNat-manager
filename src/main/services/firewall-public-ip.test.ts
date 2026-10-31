import assert from 'node:assert/strict';
import test from 'node:test';
import { createFirewallPublicIPReader, selectFirewallWANIP } from './firewall-public-ip.ts';

const wan = 'Dialer0 8.8.8.8/32 up up(s)';

test('WAN address comes from the unique active public IPv4 interface, never NAT rules or private interfaces', () => {
  assert.equal(
    selectFirewallWANIP(
      [
        'Interface IP Address/Mask Physical Protocol',
        wan,
        wan,
        'LAN 192.168.1.1/24 up up',
        'OldWAN 9.9.9.9/32 down down',
        'PendingWAN 1.1.1.1/32 up down',
        'Unassigned unassigned up up',
        'Invalid 8.8.4.4/33 up up',
        'nat server test protocol tcp global 9.9.9.9 80 inside 192.168.1.1 80',
      ].join('\n')
    ),
    '8.8.8.8'
  );
  for (const output of [
    '',
    'LAN 10.0.0.1/24 up up',
    'WAN 100.64.0.1/32 up up',
    'WAN 08.8.8.8/32 up up',
  ]) {
    assert.throws(() => selectFirewallWANIP(output), /没有.*公网/);
  }
  assert.throws(() => selectFirewallWANIP(wan + '\nWAN2 9.9.9.9/24 up up'), /多个.*公网/);
});

function fixture() {
  const devices = [
    { id: 'a', name: 'A', enabled: true },
    { id: 'b', name: 'B', enabled: true },
  ];
  const state = {
    selected: ['a'],
    blocked: false,
    reads: [] as string[],
    releases: 0,
    result: { success: true, complete: true, output: wan },
    secondOutput: wan,
  };
  const read = createFirewallPublicIPReader({
    getDevices: async () => devices,
    getSelectedDeviceIds: async () => state.selected,
    enter: () =>
      state.blocked
        ? null
        : () => {
            state.releases++;
          },
    readInterfaces: async (id) => {
      state.reads.push(id);
      return { ...state.result, output: id === 'b' ? state.secondOutput : state.result.output };
    },
  });
  return { read, state, devices };
}

test('WAN reads honor device selection, collapse concurrent requests and always release the business gate', async () => {
  const { read, state } = fixture();
  assert.deepEqual(await Promise.all([read(), read()]), ['8.8.8.8', '8.8.8.8']);
  assert.deepEqual(state.reads, ['a']);
  assert.equal(state.releases, 1);
  state.result.complete = false;
  await assert.rejects(read(), /完整/);
  assert.equal(state.releases, 2);
  state.blocked = true;
  await assert.rejects(read(), /暂停/);
  assert.equal(state.reads.length, 2);
});

test('missing, disabled and ambiguous device scopes fail instead of choosing another public IP', async () => {
  const { read, state, devices } = fixture();
  state.selected = ['missing'];
  await assert.rejects(read(), /不存在|禁用/);
  devices[0].enabled = false;
  state.selected = ['a'];
  await assert.rejects(read(), /不存在|禁用/);
  devices[0].enabled = true;
  state.selected = ['a', 'b'];
  assert.equal(await read(), '8.8.8.8');
  state.secondOutput = 'WAN 9.9.9.9/24 up up';
  await assert.rejects(read(), /不一致/);
  state.selected = [];
  await assert.rejects(read(), /不一致/);
  devices.splice(1);
  assert.equal(await read(), '8.8.8.8');
  devices.splice(0);
  await assert.rejects(read(), /没有.*设备/);
});

test('scope invalidation prevents sharing or publishing an in-flight address from a previous device', async () => {
  let selected = ['a'];
  let finish: (value: { success: boolean; complete: boolean; output: string }) => void = () => {};
  let started: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const read = createFirewallPublicIPReader({
    enter: () => () => {},
    getDevices: async () => ['a', 'b'].map((id) => ({ id, name: id, enabled: true })),
    getSelectedDeviceIds: async () => selected,
    readInterfaces: async (id) => {
      if (id === 'a')
        return new Promise((resolve) => {
          finish = resolve;
          started();
        });
      return { success: true, complete: true, output: 'WAN 9.9.9.9/32 up up' };
    },
  });
  const old = read();
  const rejected = assert.rejects(old, /已变化/);
  await ready;
  selected = ['b'];
  read.invalidate();
  const fresh = read();
  finish({ success: true, complete: true, output: wan });
  assert.equal(await fresh, '9.9.9.9');
  await rejected;
  assert.equal(await read(), '9.9.9.9');
});

test('startup invalidation drains an old same-device SSH read before retrying, without a busy-device failure', async () => {
  let release: (result: { success: boolean; complete: boolean; output: string }) => void = () => {};
  let started: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let busy = false;
  let reads = 0;
  const read = createFirewallPublicIPReader({
    enter: () => () => {},
    getDevices: async () => [{ id: 'a', name: 'A', enabled: true }],
    getSelectedDeviceIds: async () => ['a'],
    readInterfaces: async () => {
      assert.equal(busy, false, 'a cancelled observation must drain its existing device lock');
      busy = true;
      reads++;
      try {
        if (reads === 1) {
          started();
          return await new Promise<{ success: boolean; complete: boolean; output: string }>(
            (resolve) => {
              release = resolve;
            }
          );
        }
        return { success: true, complete: true, output: 'WAN 9.9.9.9/32 up up' };
      } finally {
        busy = false;
      }
    },
  });
  const initial = read();
  const rejected = assert.rejects(initial, /已变化/);
  await ready;
  read.invalidate();
  const monitoring = read();
  release({ success: true, complete: true, output: wan });
  assert.equal(await monitoring, '9.9.9.9');
  await rejected;
  assert.equal(reads, 2);
});

test('the unique installed default route selects the actual WAN rather than a public-looking virtual template', () => {
  const output =
    'Dialer2 116.232.116.72/32 up up(s)\nVirtual-Template2 1.0.0.1/24 up up(s)\nLAN 172.16.51.1/24 up up';
  const routing =
    'Routing Table : Public\nSummary Count : 1\n0.0.0.0/0 Static 60 0 D 116.232.116.72 Dialer2';
  assert.equal(selectFirewallWANIP(output, routing), '116.232.116.72');
  for (const invalid of [
    routing.replace('Count : 1', 'Count : 2'),
    routing.replace(' D ', ' R '),
    routing.replace('Dialer2', 'LAN'),
    routing.replace('Public', 'VPN'),
    '',
    routing + '\n0.0.0.0/0 Static 60 0 D 1.0.0.1 Virtual-Template2',
  ])
    assert.throws(() => selectFirewallWANIP(output, invalid), /默认路由/);
});
