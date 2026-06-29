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
    }),
    'nat server name web protocol tcp global 1.2.3.4 8080 inside 192.168.1.10 80 no-reverse'
  );
});

test('deletes named NAT server rules by endpoints instead of display name', () => {
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
    'undo nat server protocol tcp global 1.2.3.4 8080 inside 192.168.1.10 80'
  );
});

test('batch IP update deletes the old NAT rule by endpoints instead of display name', () => {
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
    'undo nat server protocol tcp global 180.158.214.247 18444 inside 192.168.1.164 18444'
  );
  assert.equal(commands.includes('undo nat server name test122'), false);
});
