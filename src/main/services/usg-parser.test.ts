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
