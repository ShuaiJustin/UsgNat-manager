import assert from 'node:assert/strict';
import test from 'node:test';

import { usgParser } from './usg-parser.ts';

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
