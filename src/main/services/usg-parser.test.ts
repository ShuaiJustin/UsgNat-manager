import assert from 'node:assert/strict';
import test from 'node:test';

import { usgParser } from './usg-parser.ts';

const safetyRule = {
  ruleName: 'web',
  protocol: 'TCP' as const,
  globalIp: '1.2.3.4',
  globalPort: '8080',
  insideIp: '192.168.1.10',
  insidePort: '80',
  enabled: true,
};

test('disabled batch rules never generate device writes, including mixed selections', () => {
  const disabled = { ...safetyRule, ruleName: 'disabled', enabled: false };
  assert.deepEqual(
    usgParser.generateBatchUpdateIPCommands([disabled], '5.6.7.8', [safetyRule]),
    []
  );
  const commands = usgParser.generateBatchUpdateIPCommands([safetyRule, disabled], '5.6.7.8', [
    safetyRule,
  ]);
  assert.equal(
    commands.some((command) => command.includes('disabled')),
    false
  );
  assert.equal(
    commands.some((command) => command.includes('global 5.6.7.8')),
    true
  );
});

test('snapshot parsing rejects incomplete output and unsupported NAT syntax', () => {
  assert.throws(() => usgParser.parseNatServerSnapshot('', false), /完整/);
  assert.throws(
    () =>
      usgParser.parseNatServerSnapshot(
        'nat server protocol tcp global current-interface 80 inside 192.168.1.2 80',
        true
      ),
    /支持|解析/
  );
  assert.throws(
    () =>
      usgParser.parseNatServerSnapshot(
        'nat server web protocol tcp global 1.2.3.4 80 inside 192.168.1.2 80 vpn-instance secret',
        true
      ),
    /支持|解析/
  );
  assert.throws(() => usgParser.parseNatServerSnapshot('---- More ----', true), /支持|解析/);
  assert.deepEqual(usgParser.parseNatServerSnapshot('', true), []);
  assert.equal(
    usgParser.parseNatServerSnapshot(
      'nat server web protocol tcp global 1.2.3.4 80 inside 192.168.1.2 www no-reverse',
      true
    ).length,
    1
  );
});

test('Huawei timestamp header preserves all direct-name rules, mixed public IPs and no-reverse flags', () => {
  // Match the observed output shape with documentation addresses and synthetic service names.
  const lines = Array.from(
    { length: 21 },
    (_, i) =>
      `nat server service_${i} protocol tcp global ${i < 15 ? '203.0.113.10' : '198.51.100.20'} ${3000 + i} inside 192.0.2.${i + 1} ${4000 + i}${i === 17 ? '' : ' no-reverse'}`
  );
  const output = ['2026-10-12 15:38:22.840 +08:00', ...lines].join('\r\n');
  const parsed = usgParser.parseNatServerSnapshot(output, true);
  assert.equal(parsed.length, 21);
  assert.equal(parsed.filter((rule) => rule.globalIp === '203.0.113.10').length, 15);
  assert.equal(parsed.filter((rule) => rule.globalIp === '198.51.100.20').length, 6);
  assert.equal(parsed.filter((rule) => rule.noReverse).length, 20);
  assert.equal(parsed[17].noReverse, false);
  assert.deepEqual(
    parsed.map((rule) => rule.ruleName),
    Array.from({ length: 21 }, (_, i) => `service_${i}`)
  );
  const commands = usgParser.generateBatchUpdateIPCommands([parsed[0]], '198.51.100.20', parsed);
  assert.ok(commands.some((command) => command.includes('global 198.51.100.20 3000')));
  assert.ok(!commands.some((command) => /service_(?:[1-9]|1\d|20)\b/.test(command)));
});

test('timestamp-only completed NAT reads are empty snapshots; errors and unsupported lines still reject', () => {
  const header = '2026-10-12 15:38:22.840 +08:00';
  assert.deepEqual(usgParser.parseNatServerSnapshot(header, true), []);
  assert.throws(() => usgParser.parseNatServerSnapshot(header, false), /不完整/);
  assert.throws(
    () => usgParser.parseNatServerSnapshot(header + '\nError: Command authorization failed', true),
    /支持|解析/
  );
  assert.throws(
    () => usgParser.parseNatServerSnapshot(header + ' trailing data', true),
    /支持|解析/
  );
  assert.throws(
    () =>
      usgParser.parseNatServerSnapshot(
        header +
          '\n' +
          'nat server web protocol tcp global 203.0.113.10 80 inside 192.0.2.1 80 vpn-instance tenant',
        true
      ),
    /支持|解析/
  );
});

test('named NAT_ prefixed device rules retain their names while synthetic endpoints stay unnamed', () => {
  const named = usgParser.parseNatServerList(
    'nat server NAT_WEB protocol tcp global 1.2.3.4 8080 inside 192.168.1.10 80'
  )[0];
  assert.equal(usgParser.generateDeleteNatServerCommand(named), 'undo nat server name NAT_WEB');
  assert.match(
    usgParser.generateNatServerCommand({ ...named, addSyntax: undefined }),
    /^nat server NAT_WEB protocol/
  );
  const endpoint = usgParser.parseNatServerList(
    'nat server protocol tcp global 1.2.3.4 8080 inside 192.168.1.10 80'
  )[0];
  assert.match(usgParser.generateDeleteNatServerCommand(endpoint), /^undo nat server protocol/);
});

test('unnamed DNS TCP and UDP on the same public port remain distinct endpoint rules', () => {
  const rules = usgParser.parseNatServerSnapshot(
    [
      'nat server protocol tcp global 1.2.3.4 53 inside 192.168.1.2 53',
      'nat server protocol udp global 1.2.3.4 53 inside 192.168.1.2 53',
    ].join('\n'),
    true
  );
  assert.equal(new Set(rules.map((rule) => rule.ruleName)).size, 2);
  assert.deepEqual(
    rules.map((rule) => rule.ruleName),
    ['NAT_1.2.3.4_53_TCP', 'NAT_1.2.3.4_53_UDP']
  );
  for (const rule of rules) {
    assert.equal(rule.addSyntax, 'endpoint');
    assert.match(
      usgParser.generateDeleteNatServerCommand(rule),
      new RegExp('^undo nat server protocol ' + rule.protocol.toLowerCase() + ' global')
    );
    assert.match(
      usgParser.generateNatServerCommand({ ...rule, addSyntax: undefined }),
      /^nat server protocol/
    );
  }
  assert.deepEqual(
    usgParser.generateSyncToDeviceCommands(
      [rules[0]],
      [{ ...rules[0], ruleName: 'NAT_1.2.3.4_53', addSyntax: undefined }]
    ),
    []
  );
});

test('parses official named NAT server rules that use the name keyword', () => {
  const rules = usgParser.parseNatServerList(
    'nat server name web protocol tcp global 1.2.3.4 8080 inside 192.168.1.10 80 no-reverse'
  );

  assert.deepEqual(rules, [
    {
      ruleName: 'web',
      protocol: 'TCP',
      globalIp: '1.2.3.4',
      globalPort: '8080',
      insideIp: '192.168.1.10',
      insidePort: '80',
      enabled: true,
      noReverse: true,
      addSyntax: 'name-keyword',
      unrRoute: false,
    },
  ]);
});

test('parses USG6330 named NAT server rules that omit the name keyword', () => {
  const rules = usgParser.parseNatServerList(
    'nat server commercial protocol tcp global 116.232.123.242 1234 inside 172.16.51.53 www no-reverse'
  );

  assert.deepEqual(rules, [
    {
      ruleName: 'commercial',
      protocol: 'TCP',
      globalIp: '116.232.123.242',
      globalPort: '1234',
      insideIp: '172.16.51.53',
      insidePort: '80',
      enabled: true,
      noReverse: true,
      addSyntax: 'direct-name',
      unrRoute: false,
    },
  ]);
});

test('parses Huawei NAT server rules that use service names for well-known ports', () => {
  const rules = usgParser.parseNatServerList(
    [
      'nat server name commercial protocol tcp global 116.232.123.242 1234 inside 172.16.51.53 www',
      'nat server name SadaFtpTcp protocol tcp global 116.232.123.242 ftp inside 172.16.51.47 ftp',
      'nat server name SchoolTcp protocol tcp global 116.232.123.242 8888 inside 172.16.51.47 www',
      'nat server name sales protocol tcp global 116.232.123.242 1233 inside 172.16.51.53 8050',
      'nat server name sales_a protocol tcp global 116.232.123.187 8050 inside 172.16.51.53 8050',
    ].join('\n')
  );

  assert.deepEqual(
    rules.map((rule) => ({
      ruleName: rule.ruleName,
      globalPort: rule.globalPort,
      insidePort: rule.insidePort,
    })),
    [
      { ruleName: 'commercial', globalPort: '1234', insidePort: '80' },
      { ruleName: 'SadaFtpTcp', globalPort: '21', insidePort: '21' },
      { ruleName: 'SchoolTcp', globalPort: '8888', insidePort: '80' },
      { ruleName: 'sales', globalPort: '1233', insidePort: '8050' },
      { ruleName: 'sales_a', globalPort: '8050', insidePort: '8050' },
    ]
  );
});

test('generates official named NAT server commands with the name keyword', () => {
  assert.equal(
    usgParser.generateNatServerCommand({
      ruleName: 'web',
      protocol: 'TCP',
      globalIp: '1.2.3.4',
      globalPort: '8080',
      insideIp: '192.168.1.10',
      insidePort: '80',
      enabled: true,
      noReverse: true,
      addSyntax: 'name-keyword',
    }),
    'nat server name web protocol tcp global 1.2.3.4 8080 inside 192.168.1.10 80 no-reverse'
  );
});

test('generates USG6330-compatible named NAT server commands without the name keyword by default', () => {
  assert.equal(
    usgParser.generateNatServerCommand({
      ruleName: 'web',
      protocol: 'TCP',
      globalIp: '1.2.3.4',
      globalPort: '8080',
      insideIp: '192.168.1.10',
      insidePort: '80',
      enabled: true,
      noReverse: true,
    }),
    'nat server web protocol tcp global 1.2.3.4 8080 inside 192.168.1.10 80 no-reverse'
  );
});

test('deletes named NAT server rules by the device rule name', () => {
  assert.equal(
    usgParser.generateDeleteNatServerCommand({
      ruleName: 'web',
      protocol: 'TCP',
      globalIp: '1.2.3.4',
      globalPort: '8080',
      insideIp: '192.168.1.10',
      insidePort: '80',
      enabled: true,
      noReverse: false,
    }),
    'undo nat server name web'
  );
});

test('batch IP update adds selected rules when no current device rules are provided', () => {
  const commands = usgParser.generateBatchUpdateIPCommands(
    [
      {
        ruleName: 'test122',
        protocol: 'TCP',
        globalIp: '180.158.214.247',
        globalPort: '18444',
        insideIp: '192.168.1.164',
        insidePort: '18444',
        enabled: true,
        noReverse: false,
      },
    ],
    '116.232.123.242'
  );

  assert.equal(
    commands[1],
    'nat server test122 protocol tcp global 116.232.123.242 18444 inside 192.168.1.164 18444'
  );
  assert.equal(commands.includes('undo nat server name test122'), false);
  assert.equal(
    commands.includes(
      'undo nat server protocol tcp global 180.158.214.247 18444 inside 192.168.1.164 18444'
    ),
    false
  );
});

test('batch IP update deletes by the matching device rule name when local and device names differ', () => {
  const commands = usgParser.generateBatchUpdateIPCommands(
    [
      {
        ruleName: 'local-web',
        protocol: 'TCP',
        globalIp: '180.158.214.247',
        globalPort: '18444',
        insideIp: '192.168.1.164',
        insidePort: '18444',
        enabled: true,
        noReverse: false,
      },
    ],
    '116.232.123.242',
    [
      {
        ruleName: 'device-web',
        protocol: 'TCP',
        globalIp: '180.158.214.247',
        globalPort: '18444',
        insideIp: '192.168.1.164',
        insidePort: '18444',
        enabled: true,
        noReverse: false,
        addSyntax: 'name-keyword',
      },
    ]
  );

  assert.equal(commands[1], 'undo nat server name device-web');
  assert.equal(
    commands[2],
    'nat server name local-web protocol tcp global 116.232.123.242 18444 inside 192.168.1.164 18444'
  );
});

test('batch IP update preserves direct-name syntax from USG6330 device rules', () => {
  const commands = usgParser.generateBatchUpdateIPCommands(
    [
      {
        ruleName: 'commercial',
        protocol: 'TCP',
        globalIp: '116.232.123.242',
        globalPort: '1234',
        insideIp: '172.16.51.53',
        insidePort: '80',
        enabled: true,
        noReverse: true,
      },
    ],
    '116.232.123.187',
    usgParser.parseNatServerList(
      'nat server commercial protocol tcp global 116.232.123.242 1234 inside 172.16.51.53 www no-reverse'
    )
  );

  assert.deepEqual(commands.slice(0, 3), [
    'system-view',
    'undo nat server name commercial',
    'nat server commercial protocol tcp global 116.232.123.187 1234 inside 172.16.51.53 80 no-reverse',
  ]);
});

test('batch IP update matches device rules when local protocol casing differs', () => {
  const commands = usgParser.generateBatchUpdateIPCommands(
    [
      {
        ruleName: 'local-web',
        protocol: 'tcp' as 'TCP',
        globalIp: '180.158.214.247',
        globalPort: '18444',
        insideIp: '192.168.1.164',
        insidePort: '18444',
        enabled: true,
        noReverse: false,
      },
    ],
    '116.232.123.242',
    [
      {
        ruleName: 'device-web',
        protocol: 'TCP',
        globalIp: '180.158.214.247',
        globalPort: '18444',
        insideIp: '192.168.1.164',
        insidePort: '18444',
        enabled: true,
        noReverse: false,
      },
    ]
  );

  assert.equal(commands[1], 'undo nat server name device-web');
});

test('batch IP update falls back to a matching device rule name when endpoints differ', () => {
  const commands = usgParser.generateBatchUpdateIPCommands(
    [
      {
        ruleName: 'web',
        protocol: 'TCP',
        globalIp: '180.158.214.247',
        globalPort: '18444',
        insideIp: '192.168.1.164',
        insidePort: '18444',
        enabled: true,
        noReverse: false,
      },
    ],
    '116.232.123.242',
    [
      {
        ruleName: 'web',
        protocol: 'TCP',
        globalIp: '180.158.214.247',
        globalPort: '18445',
        insideIp: '192.168.1.164',
        insidePort: '18445',
        enabled: true,
        noReverse: false,
        addSyntax: 'name-keyword',
      },
    ]
  );

  assert.equal(commands[1], 'undo nat server name web');
  assert.equal(
    commands[2],
    'nat server name web protocol tcp global 116.232.123.242 18444 inside 192.168.1.164 18444'
  );
});

test('batch IP update adds selected local rules that are missing on the device', () => {
  const commands = usgParser.generateBatchUpdateIPCommands(
    [
      {
        ruleName: 'shcrystal',
        protocol: 'TCP',
        globalIp: '116.232.123.242',
        globalPort: '10443',
        insideIp: '172.16.51.10',
        insidePort: '443',
        enabled: true,
        noReverse: true,
      },
    ],
    '116.232.123.187',
    usgParser.parseNatServerList(
      'nat server commercial protocol tcp global 116.232.123.242 1234 inside 172.16.51.53 www no-reverse'
    )
  );

  assert.deepEqual(commands.slice(0, 2), [
    'system-view',
    'nat server shcrystal protocol tcp global 116.232.123.187 10443 inside 172.16.51.10 443 no-reverse',
  ]);
  assert.equal(commands.includes('undo nat server name shcrystal'), false);
});

test('sync to device deletes extra named device rules by name', () => {
  const commands = usgParser.generateSyncToDeviceCommands(
    [
      {
        ruleName: 'stale-device-rule',
        protocol: 'TCP',
        globalIp: '1.2.3.4',
        globalPort: '8080',
        insideIp: '192.168.1.10',
        insidePort: '80',
        enabled: true,
        noReverse: false,
      },
    ],
    []
  );

  assert.deepEqual(commands, [
    'system-view',
    'undo nat server name stale-device-rule',
    'quit',
    'save',
    'y',
  ]);
});

test('sync to device preserves direct-name syntax when updating an existing USG6330 rule', () => {
  const commands = usgParser.generateSyncToDeviceCommands(
    usgParser.parseNatServerList(
      'nat server commercial protocol tcp global 116.232.123.242 1234 inside 172.16.51.53 www no-reverse'
    ),
    [
      {
        ruleName: 'commercial',
        protocol: 'TCP',
        globalIp: '116.232.123.187',
        globalPort: '1234',
        insideIp: '172.16.51.53',
        insidePort: '80',
        enabled: true,
        noReverse: true,
      },
    ]
  );

  assert.deepEqual(commands.slice(0, 3), [
    'system-view',
    'undo nat server name commercial',
    'nat server commercial protocol tcp global 116.232.123.187 1234 inside 172.16.51.53 80 no-reverse',
  ]);
});

test('sync and batch IP updates delete every replaced rule before adding any rule', () => {
  const a = { ...safetyRule, ruleName: 'a', globalPort: '80' };
  const b = { ...safetyRule, ruleName: 'b', globalPort: '81' };
  const commands = usgParser.generateSyncToDeviceCommands(
    [a, b],
    [
      { ...a, globalPort: '81' },
      { ...b, globalPort: '82' },
    ]
  );
  const firstAdd = commands.findIndex((command) => command.startsWith('nat server'));
  const lastDelete = commands.findLastIndex((command) => command.startsWith('undo'));
  assert.ok(lastDelete >= 0 && firstAdd > lastDelete);
  assert.deepEqual(commands.slice(-3), ['quit', 'save', 'y']);
});

test('conflicting public endpoints are refused before any command is generated', () => {
  const a = { ...safetyRule, ruleName: 'a', globalIp: '1.1.1.1' };
  const b = { ...safetyRule, ruleName: 'b', globalIp: '2.2.2.2' };
  assert.throws(
    () => usgParser.generateBatchUpdateIPCommands([a, b], '3.3.3.3', [a, b]),
    /同一公网地址端口/
  );
  assert.throws(
    () =>
      usgParser.generateSyncToDeviceCommands(
        [],
        [a, { ...b, globalIp: '1.1.1.1', protocol: 'ALL' as const }]
      ),
    /同一公网地址端口/
  );
  assert.doesNotThrow(() =>
    usgParser.generateSyncToDeviceCommands(
      [],
      [a, { ...b, globalIp: '1.1.1.1', protocol: 'UDP' as const }]
    )
  );
});

test('rule names containing undo stay enabled and leading zeros are not writable', () => {
  const [parsed] = usgParser.parseNatServerSnapshot(
    'nat server undo_web protocol tcp global 1.2.3.4 80 inside 192.168.1.2 80',
    true
  );
  assert.equal(parsed.enabled, true);
  assert.throws(() => usgParser.assertWritableNatRule({ ...safetyRule, globalIp: '010.1.1.1' }));
  assert.throws(() => usgParser.assertWritableNatRule({ ...safetyRule, globalPort: '080' }));
  assert.doesNotThrow(() =>
    usgParser.assertWritableNatRule({ ...safetyRule, insideIp: '10.0.0.1' })
  );
});

test('existing overlaps between untouched device rules do not block an unrelated change', () => {
  const legacyA = {
    ...safetyRule,
    ruleName: 'legacy_a',
    globalIp: '9.9.9.9',
    protocol: 'ALL' as const,
  };
  const legacyB = { ...safetyRule, ruleName: 'legacy_b', globalIp: '9.9.9.9' };
  const web = { ...safetyRule, ruleName: 'web', globalIp: '1.1.1.1' };
  assert.doesNotThrow(() =>
    usgParser.generateBatchUpdateIPCommands([web], '2.2.2.2', [legacyA, legacyB, web])
  );
  assert.doesNotThrow(() =>
    usgParser.generateSyncToDeviceCommands(
      [legacyA, legacyB, web],
      [legacyA, legacyB, { ...web, globalIp: '2.2.2.2' }]
    )
  );
});

test('interface brief parsing collects assigned IPv4 addresses only', () => {
  const output = [
    'Interface                         IP Address/Mask      Physical   Protocol',
    'Dialer0                           203.0.113.7/32       up         up(s)',
    'GigabitEthernet0/0/1              192.168.1.1/24       up         up',
    'GigabitEthernet0/0/2              unassigned           down       down',
  ].join('\r\n');
  assert.deepEqual(usgParser.parseInterfaceAddresses(output), ['203.0.113.7', '192.168.1.1']);
});

test('interface addresses are found when the mask ends the line', () => {
  assert.deepEqual(usgParser.parseInterfaceAddresses('Dialer0 203.0.113.7/32'), ['203.0.113.7']);
});

test('interface addresses parse from real USG6300 interface brief output', () => {
  const output = [
    'display ip interface brief | include /',
    ' 2026-10-13 17:15:11.650 +08:00',
    ' *down: administratively down',
    ' (s): spoofing',
    ' The number of interface that is UP in Physical is 6',
    '',
    ' Interface                         IP Address/Mask      Physical   Protocol  ',
    ' Dialer0                           180.165.25.145/32    up         up(s)     ',
    ' GigabitEthernet0/0/0              192.168.0.1/24       down       down      ',
    ' GigabitEthernet0/0/1              unassigned           up         down      ',
    ' Virtual-Template0                 192.168.6.1/32       up         up(s)     ',
    ' XGigabitEthernet0/0/0             192.168.3.1/24       up         up        ',
  ].join('\r\n');
  assert.deepEqual(usgParser.parseInterfaceAddresses(output), [
    '180.165.25.145',
    '192.168.0.1',
    '192.168.6.1',
    '192.168.3.1',
  ]);
});

test('a disabled local rule sharing a key with an enabled synced one does not delete it', () => {
  const live = {
    ...safetyRule,
    ruleName: 'NAT_1.2.3.4_8080_TCP',
    addSyntax: 'endpoint' as const,
  };
  const commands = usgParser.generateSyncToDeviceCommands(
    [live],
    [
      { ...live, addSyntax: undefined },
      { ...live, addSyntax: undefined, enabled: false, insideIp: '192.168.1.99' },
    ]
  );
  assert.deepEqual(commands, []);
});

test('unr-route rules are read, compared and written back with their options', () => {
  const [rule] = usgParser.parseNatServerSnapshot(
    'nat server update protocol tcp global 116.232.123.242 6688 inside 172.16.51.151 6688 no-reverse unr-route',
    true
  );
  assert.equal(rule.noReverse, true);
  assert.equal(rule.unrRoute, true);
  assert.equal(
    usgParser.generateNatServerCommand({ ...rule, globalIp: '116.232.123.243' }),
    'nat server update protocol tcp global 116.232.123.243 6688 inside 172.16.51.151 6688 no-reverse unr-route'
  );
  const commands = usgParser.generateBatchUpdateIPCommands([rule], '116.232.123.243', [rule]);
  assert.ok(commands.some((command) => command.endsWith('no-reverse unr-route')));
  assert.deepEqual(
    usgParser.generateSyncToDeviceCommands([rule], [{ ...rule, unrRoute: false }]).slice(1, 3),
    [
      'undo nat server name update',
      'nat server update protocol tcp global 116.232.123.242 6688 inside 172.16.51.151 6688 no-reverse',
    ]
  );
  assert.throws(
    () =>
      usgParser.parseNatServerSnapshot(
        'nat server x protocol tcp global 1.2.3.4 80 inside 10.0.0.1 80 vpn-instance a',
        true
      ),
    /不支持/
  );
});

test('a batch IP change keeps the options the device rule has even if the local copy lacks them', () => {
  const [device] = usgParser.parseNatServerSnapshot(
    'nat server update protocol tcp global 116.232.123.242 6688 inside 172.16.51.151 6688 no-reverse unr-route',
    true
  );
  const stale = { ...device, noReverse: false, unrRoute: false, addSyntax: undefined };
  const commands = usgParser.generateBatchUpdateIPCommands([stale], '116.232.123.243', [device]);
  assert.ok(
    commands.includes(
      'nat server update protocol tcp global 116.232.123.243 6688 inside 172.16.51.151 6688 no-reverse unr-route'
    )
  );
});
