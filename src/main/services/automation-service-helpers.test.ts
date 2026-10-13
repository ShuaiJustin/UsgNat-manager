import assert from 'node:assert/strict';
import test from 'node:test';

import * as automationHelpers from './automation-service-helpers.ts';
import {
  ManualConfirmationRequestController,
  assertRuleVerificationSucceeded,
  buildScopedRollbackCommands,
  buildBatchUpdateIPCommands,
  collectIntegrityCheckIssues,
  createNatRulePayloads,
  createRuleSnapshots,
  getUpdatedRuleVerificationIssues,
  hasWriteRelevantConfigChange,
  parseScheduledTimeParts,
  shouldClearPendingScheduledIP,
  shouldClearPendingUpdateTasks,
  shouldScheduleDailyUpdate,
} from './automation-service-helpers.ts';
import { usgParser } from './usg-parser.ts';

type AutomationRunControllerLike = {
  begin: () => number;
  isCancelled: (token: number) => boolean;
  track: (task: Promise<void>) => Promise<void>;
  cancelAndWait: (cancelPending?: () => void) => Promise<void>;
};

test('automation cancellation invalidates the run and waits for its safe completion', async () => {
  const Controller = (
    automationHelpers as unknown as {
      AutomationRunController?: new () => AutomationRunControllerLike;
    }
  ).AutomationRunController;
  assert.equal(typeof Controller, 'function');

  const controller = new Controller!();
  const token = controller.begin();
  let finishRun: (() => void) | undefined;
  const activeRun = controller.track(
    new Promise<void>((resolve) => {
      finishRun = resolve;
    })
  );
  let stopped = false;
  const stop = controller.cancelAndWait(() => {
    stopped = true;
  });

  await Promise.resolve();
  assert.equal(stopped, true);
  assert.equal(controller.isCancelled(token), true);
  let stopFinished = false;
  void stop.then(() => {
    stopFinished = true;
  });
  await Promise.resolve();
  assert.equal(stopFinished, false);

  finishRun?.();
  await Promise.all([activeRun, stop]);
  assert.equal(stopFinished, true);
  assert.equal(controller.isCancelled(controller.begin()), false);
});

test('cancelled runs reject late manual confirmation requests before emitting them', async () => {
  const controller = new ManualConfirmationRequestController();
  let emitted = false;

  const confirmed = await controller.request(
    () => true,
    () => {
      emitted = true;
    }
  );

  assert.equal(confirmed, 'cancelled');
  assert.equal(emitted, false);
});

test('cancelling a pending manual confirmation resolves it once', async () => {
  const controller = new ManualConfirmationRequestController();
  let respond: ((confirmed: boolean) => void) | undefined;
  const pending = controller.request(
    () => false,
    (callback) => {
      respond = callback;
    }
  );

  controller.cancel();
  respond?.(true);

  assert.equal(await pending, 'cancelled');
});

test('manual confirmation distinguishes explicit rejection from timeout', async () => {
  const controller = new ManualConfirmationRequestController();
  const outcomes = await Promise.all([
    controller.request(
      () => false,
      (respond) => respond(false)
    ),
    controller.request(
      () => false,
      (respond) => respond(false, 'timeout')
    ),
    controller.request(
      () => false,
      (respond) => respond(true)
    ),
  ]);
  assert.deepEqual(outcomes, ['rejected', 'timeout', 'confirmed']);
});

test('only write-relevant config changes count as a new write scope', () => {
  const base = {
    enabled: true,
    selectedDevices: ['a'],
    notifyTypes: ['ipChange'],
    checkInterval: 5,
  };
  assert.equal(hasWriteRelevantConfigChange(base, { ...base }), false);
  assert.equal(
    hasWriteRelevantConfigChange(base, {
      ...base,
      notifyTypes: [],
      checkInterval: 10,
      windowsNotifyEnabled: false,
      confirmCount: 2,
      checkSources: ['ip.sb'],
    }),
    false
  );
  assert.equal(hasWriteRelevantConfigChange(base, { ...base, selectedDevices: ['a', 'b'] }), true);
  assert.equal(
    hasWriteRelevantConfigChange(base, { ...base, securityOptions: ['manualConfirm'] }),
    true
  );
});

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
        protocol: 'TCP',
        globalIp: '2.2.2.2',
        globalPort: '22',
        insideIp: '192.168.1.22',
        insidePort: '22',
        enabled: true,
        noReverse: true,
      },
      {
        ruleName: 'dns',
        protocol: 'UDP',
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
        protocol: 'TCP',
        globalIp: '2.2.2.2',
        globalPort: '22',
        insideIp: '192.168.1.22',
        insidePort: '22',
        enabled: true,
        noReverse: true,
      },
      {
        ruleName: 'dns',
        protocol: 'UDP',
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

test('builds automatic batch update commands with matching device rule names', () => {
  const commands = buildBatchUpdateIPCommands(
    [
      {
        ruleName: 'local-web',
        protocol: 'tcp',
        globalIp: '180.158.214.247',
        globalPort: '18444',
        insideIp: '192.168.1.164',
        insidePort: '18444',
        enabled: true,
        noReverse: false,
      },
    ],
    '116.232.123.242',
    'nat server name device-web protocol tcp global 180.158.214.247 18444 inside 192.168.1.164 18444',
    usgParser
  );

  assert.equal(commands[1], 'undo nat server name device-web');
  assert.equal(
    commands[2],
    'nat server name local-web protocol tcp global 116.232.123.242 18444 inside 192.168.1.164 18444'
  );
});

test('builds automatic batch update commands when the device currently has no NAT rules', () => {
  const commands = buildBatchUpdateIPCommands(
    [
      {
        ruleName: 'shcrystal',
        protocol: 'tcp',
        globalIp: '116.232.123.242',
        globalPort: '10443',
        insideIp: '172.16.51.10',
        insidePort: '443',
        enabled: true,
        noReverse: true,
      },
    ],
    '116.232.123.187',
    '',
    usgParser
  );

  assert.deepEqual(commands.slice(0, 2), [
    'system-view',
    'nat server shcrystal protocol tcp global 116.232.123.187 10443 inside 172.16.51.10 443 no-reverse',
  ]);
  assert.equal(commands.includes('undo nat server name shcrystal'), false);
});

test('schedules daily updates whenever scheduled auto update is enabled', () => {
  assert.equal(
    shouldScheduleDailyUpdate({
      autoUpdateEnabled: true,
      triggerType: 'scheduled',
      scheduledTime: '09:30',
    }),
    true
  );
  assert.equal(
    shouldScheduleDailyUpdate({
      autoUpdateEnabled: false,
      triggerType: 'scheduled',
      scheduledTime: '09:30',
    }),
    false
  );
  assert.equal(
    shouldScheduleDailyUpdate({
      autoUpdateEnabled: true,
      triggerType: 'immediate',
      scheduledTime: '09:30',
    }),
    false
  );
});

test('clears pending update tasks when auto update is disabled or strategy changes', () => {
  assert.equal(
    shouldClearPendingUpdateTasks(
      { autoUpdateEnabled: true, triggerType: 'delayed' },
      { autoUpdateEnabled: false, triggerType: 'delayed' }
    ),
    true
  );
  assert.equal(
    shouldClearPendingUpdateTasks(
      { autoUpdateEnabled: true, triggerType: 'delayed' },
      { autoUpdateEnabled: true, triggerType: 'scheduled' }
    ),
    true
  );
  assert.equal(
    shouldClearPendingUpdateTasks(
      { autoUpdateEnabled: true, triggerType: 'scheduled', scheduledTime: '09:30' },
      { autoUpdateEnabled: true, triggerType: 'scheduled', scheduledTime: '10:00' }
    ),
    true
  );
  assert.equal(
    shouldClearPendingUpdateTasks(
      { autoUpdateEnabled: true, triggerType: 'scheduled', scheduledTime: '09:30' },
      { autoUpdateEnabled: true, triggerType: 'scheduled', scheduledTime: '09:30' }
    ),
    false
  );
});

test('clears pending scheduled IP only when scheduled updates are no longer valid', () => {
  assert.equal(
    shouldClearPendingScheduledIP(
      { autoUpdateEnabled: true, triggerType: 'scheduled', scheduledTime: '09:30' },
      { autoUpdateEnabled: false, triggerType: 'scheduled', scheduledTime: '09:30' }
    ),
    true
  );
  assert.equal(
    shouldClearPendingScheduledIP(
      { autoUpdateEnabled: true, triggerType: 'scheduled', scheduledTime: '09:30' },
      { autoUpdateEnabled: true, triggerType: 'immediate', scheduledTime: '09:30' }
    ),
    true
  );
  assert.equal(
    shouldClearPendingScheduledIP(
      { autoUpdateEnabled: true, triggerType: 'scheduled', scheduledTime: '09:30' },
      { autoUpdateEnabled: true, triggerType: 'scheduled', scheduledTime: '10:00' }
    ),
    false
  );
});

test('builds rollback commands without deleting unrelated device NAT rules', () => {
  const commands = buildScopedRollbackCommands(
    [
      {
        id: 'rule-1',
        ruleName: 'managed-web',
        protocol: 'tcp',
        globalIp: '1.1.1.1',
        globalPort: '80',
        insideIp: '192.168.1.10',
        insidePort: '80',
        enabled: true,
        noReverse: false,
      },
    ],
    [
      'nat server name managed-web protocol tcp global 2.2.2.2 80 inside 192.168.1.10 80',
      'nat server name unrelated protocol tcp global 9.9.9.9 443 inside 192.168.1.20 443',
    ].join('\n'),
    usgParser
  );

  assert.deepEqual(commands, [
    'system-view',
    'undo nat server name managed-web',
    'nat server name managed-web protocol tcp global 1.1.1.1 80 inside 192.168.1.10 80',
    'quit',
    'save',
    'y',
  ]);
});

test('rollback commands preserve direct-name syntax from current USG6330 rules', () => {
  const commands = buildScopedRollbackCommands(
    [
      {
        id: 'rule-1',
        ruleName: 'managed-web',
        protocol: 'tcp',
        globalIp: '1.1.1.1',
        globalPort: '80',
        insideIp: '192.168.1.10',
        insidePort: '80',
        enabled: true,
        noReverse: true,
      },
    ],
    'nat server managed-web protocol tcp global 2.2.2.2 80 inside 192.168.1.10 80 no-reverse',
    usgParser
  );

  assert.deepEqual(commands.slice(0, 3), [
    'system-view',
    'undo nat server name managed-web',
    'nat server managed-web protocol tcp global 1.1.1.1 80 inside 192.168.1.10 80 no-reverse',
  ]);
});

test('verifies only updated managed NAT rules and ignores unrelated device rules', () => {
  const issues = getUpdatedRuleVerificationIssues(
    [
      {
        ruleName: 'managed-web',
        protocol: 'tcp',
        globalIp: '1.1.1.1',
        globalPort: '80',
        insideIp: '192.168.1.10',
        insidePort: '80',
        enabled: true,
        noReverse: false,
      },
    ],
    '2.2.2.2',
    [
      'nat server name managed-web protocol tcp global 2.2.2.2 80 inside 192.168.1.10 80',
      'nat server name unrelated protocol tcp global 9.9.9.9 443 inside 192.168.1.20 443',
    ].join('\n'),
    usgParser
  );

  assert.deepEqual(issues, []);
});

test('reports missing managed NAT rules after update verification', () => {
  const issues = getUpdatedRuleVerificationIssues(
    [
      {
        ruleName: 'managed-web',
        protocol: 'tcp',
        globalIp: '1.1.1.1',
        globalPort: '80',
        insideIp: '192.168.1.10',
        insidePort: '80',
        enabled: true,
        noReverse: false,
      },
    ],
    '2.2.2.2',
    'nat server name unrelated protocol tcp global 9.9.9.9 443 inside 192.168.1.20 443',
    usgParser
  );

  assert.deepEqual(issues, ['规则 managed-web 未在设备上生效']);
});

test('turns enabled rule verification failures into update-blocking errors', () => {
  assert.doesNotThrow(() => assertRuleVerificationSucceeded(true));
  assert.throws(() => assertRuleVerificationSucceeded(false), /verification/i);
});

test('rollback and verification never adopt a different named rule with the same endpoint', () => {
  const old = {
    id: 'managed',
    ruleName: 'managed',
    protocol: 'TCP',
    globalIp: '1.1.1.1',
    globalPort: '80',
    insideIp: '192.168.1.10',
    insidePort: '80',
    enabled: true,
    noReverse: false,
  };
  const output = 'nat server unrelated protocol tcp global 2.2.2.2 80 inside 192.168.1.10 80';
  const commands = buildScopedRollbackCommands([old], output, usgParser);
  assert.equal(
    commands.some((command) => command.startsWith('undo nat server')),
    false
  );
  assert.equal(getUpdatedRuleVerificationIssues([old], '2.2.2.2', output, usgParser).length, 1);
});
