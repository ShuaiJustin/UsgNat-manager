import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertRuleVerificationSucceeded,
  collectIntegrityCheckIssues,
  createNatRulePayloads,
  createRuleSnapshots,
  parseScheduledTimeParts,
} from './automation-service-helpers.ts';

test('parses valid scheduled times into hour and minute parts', () => {
  assert.deepEqual(parseScheduledTimeParts('09:30'), { hour: 9, minute: 30 });
  assert.deepEqual(parseScheduledTimeParts('23:59'), { hour: 23, minute: 59 });
});

test('rejects malformed scheduled time strings', () => {
  assert.equal(parseScheduledTimeParts('24:00'), null);
  assert.equal(parseScheduledTimeParts('09:60'), null);
  assert.equal(parseScheduledTimeParts('bad-value'), null);
});

test('collects integrity issues for conflicting rules and invalid addresses', () => {
  const issues = collectIntegrityCheckIssues(
    [
      {
        ruleName: 'web-1',
        enabled: true,
        protocol: 'tcp',
        globalPort: '80',
        insideIp: '192.168.1.10',
        insidePort: '8080',
      },
      {
        ruleName: 'web-2',
        enabled: true,
        protocol: 'tcp',
        globalPort: '80',
        insideIp: 'not-an-ip',
        insidePort: '70000',
      },
      {
        ruleName: 'web-1',
        enabled: true,
        protocol: 'udp',
        globalPort: 'abc',
        insideIp: '192.168.1.20',
        insidePort: '53',
      },
    ],
    '999.1.1.1'
  );

  assert.ok(issues.some((issue) => issue.includes('规则冲突')));
  assert.ok(issues.some((issue) => issue.includes('IP地址格式无效')));
  assert.ok(issues.some((issue) => issue.includes('端口无效')));
  assert.ok(issues.some((issue) => issue.includes('内网端口无效')));
  assert.ok(issues.some((issue) => issue.includes('内网IP格式无效')));
  assert.ok(issues.some((issue) => issue.includes('规则名称重复')));
});

test('ignores disabled rules and returns no issues for a valid ruleset', () => {
  const issues = collectIntegrityCheckIssues(
    [
      {
        ruleName: 'web-1',
        enabled: true,
        protocol: 'tcp',
        globalPort: '80',
        insideIp: '192.168.1.10',
        insidePort: '8080',
      },
      {
        ruleName: 'disabled-rule',
        enabled: false,
        protocol: 'tcp',
        globalPort: '80',
        insideIp: 'not-an-ip',
        insidePort: '99999',
      },
    ],
    '1.2.3.4'
  );

  assert.deepEqual(issues, []);
});

test('creates rule snapshots with stable rollback fields', () => {
  assert.deepEqual(
    createRuleSnapshots([
      {
        id: 'rule-1',
        ruleName: 'web-1',
        protocol: 'tcp',
        globalIp: '1.1.1.1',
        globalPort: '80',
        insideIp: '192.168.1.10',
        insidePort: '8080',
        enabled: true,
        noReverse: null,
      },
    ]),
    [
      {
        id: 'rule-1',
        ruleName: 'web-1',
        protocol: 'tcp',
        globalIp: '1.1.1.1',
        globalPort: '80',
        insideIp: '192.168.1.10',
        insidePort: '8080',
        enabled: true,
        noReverse: false,
      },
    ]
  );
});

test('creates NAT rule payloads for command generation', () => {
  assert.deepEqual(
    createNatRulePayloads([
      {
        ruleName: 'ssh',
        protocol: 'tcp',
        globalIp: '2.2.2.2',
        globalPort: '22',
        insideIp: '192.168.1.22',
        insidePort: '22',
        enabled: true,
        noReverse: true,
      },
      {
        ruleName: 'dns',
        protocol: 'udp',
        globalIp: '2.2.2.2',
        globalPort: '53',
        insideIp: '192.168.1.53',
        insidePort: '53',
        enabled: false,
        noReverse: undefined,
      },
    ]),
    [
      {
        ruleName: 'ssh',
        protocol: 'tcp',
        globalIp: '2.2.2.2',
        globalPort: '22',
        insideIp: '192.168.1.22',
        insidePort: '22',
        enabled: true,
        noReverse: true,
      },
      {
        ruleName: 'dns',
        protocol: 'udp',
        globalIp: '2.2.2.2',
        globalPort: '53',
        insideIp: '192.168.1.53',
        insidePort: '53',
        enabled: false,
        noReverse: false,
      },
    ]
  );
});

test('turns enabled rule verification failures into update-blocking errors', () => {
  assert.doesNotThrow(() => assertRuleVerificationSucceeded(true));
  assert.throws(() => assertRuleVerificationSucceeded(false), /verification/i);
});
