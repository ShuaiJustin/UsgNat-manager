import assert from 'node:assert/strict';
import test from 'node:test';

import { assertBatchUpdateIPInput, getRuleIdsOutsideDevice } from './rule-handler-helpers.ts';
import * as helpers from './rule-handler-helpers.ts';
import { usgParser } from '../../services/usg-parser.ts';

const rule = {
  ruleName: 'web',
  protocol: 'TCP' as const,
  globalIp: '1.2.3.4',
  globalPort: '80',
  insideIp: '192.168.1.2',
  insidePort: '80',
  enabled: true,
};

test('persisted device syntax preserves named NAT-looking identities across all writes', () => {
  for (const name of ['NAT_1.2.3.4_80', 'NAT_1.2.3.4_80_TCP']) {
    for (const prefix of [name, `name ${name}`]) {
      const [live] = usgParser.parseNatServerSnapshot(
        `nat server ${prefix} protocol tcp global 1.2.3.4 80 inside 192.168.1.2 80`,
        true
      );
      const local = { ...live, id: 'saved' };
      assert.ok(
        usgParser
          .generateSyncToDeviceCommands([], [local])
          .includes(usgParser.generateNatServerCommand(live))
      );
      assert.deepEqual(helpers.getRuleSyncPreview('d', [live], [local]).added, []);
      assert.deepEqual(helpers.getRuleSyncPreview('d', [live], [local]).deleted, []);
      assert.deepEqual(usgParser.generateSyncToDeviceCommands([live], [local]), []);
      assert.equal(helpers.compareLocalWithDevice([live], [local]).states.saved, 'synced');
      const edited = { ...local, insidePort: '81' };
      const commands = usgParser.generateSyncToDeviceCommands([live], [edited]);
      assert.ok(commands.includes(`undo nat server name ${name}`));
      assert.ok(
        commands.includes(
          `nat server ${prefix} protocol tcp global 1.2.3.4 80 inside 192.168.1.2 81`
        )
      );
      assert.equal(helpers.equalDeviceRules([live], [local]), true);
      const expected = helpers.getBatchIPTarget([live], [local], '5.6.7.8');
      const changed = { ...live, globalIp: '5.6.7.8' };
      assert.equal(helpers.equalDeviceRules([changed], expected), true);
      assert.ok(
        usgParser
          .generateBatchUpdateIPCommands([local], '5.6.7.8', [live])
          .includes(`nat server ${prefix} protocol tcp global 5.6.7.8 80 inside 192.168.1.2 80`)
      );
    }
  }
});

test('completed device snapshots remove stale cached rules atomically and preserve stable ids', async () => {
  let rows = [
    { ...rule, id: 'keep', deviceId: 'd' },
    { ...rule, id: 'stale', ruleName: 'deleted-on-device', deviceId: 'd' },
  ];
  let transactions = 0;
  const database = {
    $transaction: async (run) => {
      transactions++;
      const original = rows.map((row) => ({ ...row }));
      try {
        return await run({
          natRule: {
            findMany: async () => rows.map((row) => ({ ...row })),
            deleteMany: async ({ where }) => {
              rows = rows.filter(
                (row) =>
                  row.deviceId !== where.deviceId ||
                  (where.id
                    ? where.id.notIn.includes(row.id)
                    : where.ruleName.notIn.includes(row.ruleName))
              );
            },
            upsert: async ({ where, update, create }) => {
              const existing = rows.find((row) =>
                where.id ? row.id === where.id : row.ruleName === where.deviceId_ruleName.ruleName
              );
              if (existing) {
                Object.assign(existing, update);
                return existing;
              }
              const fresh = { ...create, id: 'new' };
              rows.push(fresh);
              return fresh;
            },
          },
        });
      } catch (error) {
        rows = original;
        throw error;
      }
    },
  };
  await helpers.replaceDeviceRuleSnapshot(database, 'd', [rule]);
  assert.equal(transactions, 1);
  assert.deepEqual(
    rows.map((row) => row.id),
    ['keep']
  );
  const [range] = usgParser.parseNatServerSnapshot(
    'nat server web protocol tcp global 1.2.3.4 20000 20053 inside 192.168.1.2 30000 30053 no-reverse unr-route',
    true
  );
  await helpers.replaceDeviceRuleSnapshot(database, 'd', [range]);
  assert.equal(rows[0].id, 'keep');
  assert.equal(rows[0].globalPort, '20000-20053');
  assert.equal(rows[0].insidePort, '30000-30053');
  assert.equal(rows[0].addSyntax, 'direct-name');
  assert.equal(
    usgParser.generateNatServerCommand(rows[0]),
    'nat server web protocol tcp global 1.2.3.4 20000 20053 inside 192.168.1.2 30000 30053 no-reverse unr-route'
  );
  await helpers.replaceDeviceRuleSnapshot(database, 'd', []);
  assert.deepEqual(rows, []);
});

test('range writes verify canonical read-back and build rollback commands with the full range', async () => {
  const original = usgParser.parseNatServerSnapshot(
    'nat server web protocol tcp global 1.2.3.4 20000 20053 inside 192.168.1.2 30000 30053 no-reverse unr-route',
    true
  );
  const target = helpers.getBatchIPTarget(original, original, '5.6.7.8');
  let actual = original;
  let saved = false;
  const commands = helpers.splitSaveCommands(
    usgParser.generateSyncToDeviceCommands(original, target)
  );
  const result = await helpers.executeVerifiedRuleWrite(original, target, {
    backup: async () => 'range-backup',
    execute: async () => {
      actual = usgParser.parseNatServerSnapshot(
        commands.filter((line) => line.startsWith('nat server')).join('\n'),
        true
      );
      return { success: true };
    },
    read: async () => actual,
    save: async () => {
      saved = true;
      return { success: true };
    },
    rollback: async () => {
      throw new Error('unexpected rollback');
    },
  });
  assert.equal(result.status, 'verified');
  assert.equal(saved, true);
  assert.equal(helpers.equalDeviceRules(actual, target), true);
  const restore = usgParser.generateSyncToDeviceCommands(actual, original);
  assert.ok(
    restore.includes(
      'nat server web protocol tcp global 1.2.3.4 20000 20053 inside 192.168.1.2 30000 30053 no-reverse unr-route'
    )
  );
});

test('manual writes stop when backup fails, and classify partial/unknown readback instead of success', async () => {
  let executed = false;
  await assert.rejects(
    () =>
      helpers.executeVerifiedRuleWrite([rule], [{ ...rule, globalIp: '5.6.7.8' }], {
        backup: async () => {
          throw new Error('backup failed');
        },
        execute: async () => {
          executed = true;
          return { success: true };
        },
        read: async () => [],
      }),
    /backup failed/
  );
  assert.equal(executed, false);
  const partial = await helpers.executeVerifiedRuleWrite(
    [rule],
    [{ ...rule, globalIp: '5.6.7.8' }],
    {
      backup: async () => 'backup-id',
      execute: async () => ({ success: false, error: 'stream closed' }),
      read: async () => [],
    }
  );
  assert.equal(partial.status, 'partial');
  assert.equal(partial.success, false);
  const unknown = await helpers.executeVerifiedRuleWrite([rule], [], {
    backup: async () => 'backup-id',
    execute: async () => ({ success: true }),
    read: async () => {
      throw new Error('read unavailable');
    },
  });
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.success, false);
  const verified = await helpers.executeVerifiedRuleWrite([rule], [], {
    backup: async () => 'backup-id',
    execute: async () => ({ success: true }),
    read: async () => [],
  });
  assert.equal(verified.status, 'verified');
});

test('renaming old unnamed endpoint caches preserves selected rule ids and keeps DNS protocols separate', async () => {
  let rows = [
    {
      ...rule,
      ruleName: 'NAT_1.2.3.4_53',
      globalPort: '53',
      insidePort: '53',
      id: 'allowlisted-rule',
      deviceId: 'd',
    },
  ];
  const database = {
    $transaction: async (run) =>
      run({
        natRule: {
          findMany: async () => rows.map((row) => ({ ...row })),
          deleteMany: async ({ where }) => {
            rows = rows.filter((row) =>
              where.id
                ? where.id.notIn.includes(row.id)
                : where.ruleName.notIn.includes(row.ruleName)
            );
          },
          upsert: async ({ where, update, create }) => {
            const match = rows.find((row) =>
              where.id ? row.id === where.id : row.ruleName === where.deviceId_ruleName.ruleName
            );
            if (match) {
              Object.assign(match, update);
              return match;
            }
            const fresh = { ...create, id: 'new-udp' };
            rows.push(fresh);
            return fresh;
          },
        },
      }),
  };
  const tcp = {
    ...rule,
    globalPort: '53',
    insidePort: '53',
    ruleName: 'NAT_1.2.3.4_53_TCP',
    addSyntax: 'endpoint' as const,
  };
  const udp = { ...tcp, protocol: 'UDP' as const, ruleName: 'NAT_1.2.3.4_53_UDP' };
  await helpers.replaceDeviceRuleSnapshot(database, 'd', [tcp, udp]);
  assert.equal(rows.find((row) => row.protocol === 'TCP')?.id, 'allowlisted-rule');
  assert.equal(rows.find((row) => row.protocol === 'UDP')?.ruleName, udp.ruleName);
  assert.equal(rows.length, 2);
  const preview = helpers.getRuleSyncPreview('d', [tcp], [{ ...tcp, ruleName: 'NAT_1.2.3.4_53' }]);
  assert.deepEqual([preview.added, preview.deleted, preview.updated], [[], [], []]);
});

test('preview token invalidates when either device rules or local intent changes', () => {
  const baseline = helpers.getRuleSyncPreview('d', [rule], [rule]);
  const changed = helpers.getRuleSyncPreview('d', [rule], [{ ...rule, globalIp: '5.6.7.8' }]);
  assert.notEqual(baseline.token, changed.token);
  assert.equal(changed.updated.length, 1);
  assert.equal(helpers.getRuleSyncPreview('d', [rule], []).deleted.length, 1);
  assert.equal(helpers.getRuleSyncPreview('d', [], [rule]).added.length, 1);
});

test('rejects invalid IPv4 values for batch rule IP updates', () => {
  assert.throws(
    () =>
      assertBatchUpdateIPInput({
        deviceId: 'device-1',
        ruleIds: ['rule-1'],
        newIP: '999.1.1.1',
      }),
    /IP/
  );
});

test('rejects empty rule selections for batch rule IP updates', () => {
  assert.throws(
    () =>
      assertBatchUpdateIPInput({
        deviceId: 'device-1',
        ruleIds: [],
        newIP: '1.2.3.4',
      }),
    /rule/
  );
});

test('identifies selected rules that do not belong to the requested device', () => {
  assert.deepEqual(
    getRuleIdsOutsideDevice(
      [
        { id: 'rule-1', deviceId: 'device-1' },
        { id: 'rule-2', deviceId: 'device-2' },
      ],
      'device-1'
    ),
    ['rule-2']
  );
});

test('verified writes save only after read-back and failed writes roll back without saving', async () => {
  const target = [{ ...rule, globalIp: '5.6.7.8' }];
  const calls: string[] = [];
  const verified = await helpers.executeVerifiedRuleWrite([rule], target, {
    backup: async () => 'backup-id',
    execute: async () => (calls.push('execute'), { success: true }),
    read: async () => (calls.push('read'), target),
    save: async () => (calls.push('save'), { success: true }),
  });
  assert.equal(verified.status, 'verified');
  assert.deepEqual(calls, ['execute', 'read', 'save']);

  let device: (typeof rule)[] = [];
  let saved = false;
  const rolledBack = await helpers.executeVerifiedRuleWrite([rule], target, {
    backup: async () => 'backup-id',
    execute: async () => ({ success: false, error: 'rejected' }),
    read: async () => device,
    save: async () => ((saved = true), { success: true }),
    rollback: async (actual) => {
      assert.deepEqual(actual, []);
      device = [rule];
      return { success: true };
    },
  });
  assert.equal(rolledBack.status, 'failed');
  assert.match(rolledBack.message, /已自动回滚/);
  assert.equal(saved, false);

  const stuck = await helpers.executeVerifiedRuleWrite([rule], target, {
    backup: async () => 'backup-id',
    execute: async () => ({ success: false }),
    read: async () => [],
    rollback: async () => ({ success: false, error: 'closed' }),
  });
  assert.equal(stuck.status, 'partial');
});

test('save commands are split off generated batches', () => {
  assert.deepEqual(helpers.splitSaveCommands(['system-view', 'x', 'quit', 'save', 'y']), [
    'system-view',
    'x',
    'quit',
  ]);
  assert.deepEqual(helpers.splitSaveCommands(['system-view', 'x']), ['system-view', 'x']);
});

test('device snapshots keep local-only disabled rules', async () => {
  let where: unknown;
  const database = {
    $transaction: async (run) =>
      run({
        natRule: {
          findMany: async () => [],
          deleteMany: async (args) => {
            where = args.where;
          },
          upsert: async ({ create }) => create,
        },
      }),
  };
  await helpers.replaceDeviceRuleSnapshot(database as never, 'd', []);
  assert.equal((where as { enabled: boolean }).enabled, true);
});

test('read-back decides: matching target is kept despite channel errors; unsaved is flagged', async () => {
  const target = [{ ...rule, globalIp: '5.6.7.8' }];
  let rolledBack = false;
  const kept = await helpers.executeVerifiedRuleWrite([rule], target, {
    backup: async () => 'backup-id',
    execute: async () => ({ success: false, error: 'timeout' }),
    read: async () => target,
    save: async () => ({ success: true }),
    rollback: async () => ((rolledBack = true), { success: true }),
  });
  assert.equal(kept.status, 'verified');
  assert.equal(rolledBack, false);
  const unsaved = await helpers.executeVerifiedRuleWrite([rule], target, {
    backup: async () => 'backup-id',
    execute: async () => ({ success: true }),
    read: async () => target,
    save: async () => ({ success: false, error: 'save rejected' }),
  });
  assert.equal(unsaved.status, 'unsaved');
  assert.equal(unsaved.success, true);
  let reads = 0;
  const lost = await helpers.executeVerifiedRuleWrite([rule], target, {
    backup: async () => 'backup-id',
    execute: async () => ({ success: false }),
    read: async () => {
      if (reads++ === 0) return [];
      throw new Error('link down');
    },
    rollback: async () => ({ success: true }),
  });
  assert.equal(lost.status, 'unknown');
  assert.match(lost.message, /已执行自动回滚/);
});

test('saved rules are classified against the device the same way a push would treat them', () => {
  const device = [
    { ...rule, ruleName: 'same' },
    { ...rule, ruleName: 'changed', globalPort: '81' },
    { ...rule, ruleName: 'disabledHere', globalPort: '82' },
    { ...rule, ruleName: 'onlyOnDevice', globalPort: '83' },
  ];
  const local = [
    { ...rule, id: '1', ruleName: 'same' },
    { ...rule, id: '2', ruleName: 'changed', globalPort: '8081' },
    { ...rule, id: '3', ruleName: 'disabledHere', globalPort: '82', enabled: false },
    { ...rule, id: '4', ruleName: 'newRule', globalPort: '84' },
    { ...rule, id: '5', ruleName: 'parked', globalPort: '85', enabled: false },
  ];
  const result = helpers.compareLocalWithDevice(device, local);
  assert.deepEqual(result.states, {
    '1': 'synced',
    '2': 'pendingChange',
    '3': 'pendingRemove',
    '4': 'pendingAdd',
    '5': 'localDisabled',
  });
  assert.deepEqual(
    result.deviceOnly.map((item) => item.ruleName),
    ['onlyOnDevice']
  );
});

test('a disabled rule sharing a key with an enabled synced rule is not reported as pending', () => {
  const live = { ...rule, ruleName: 'NAT_1.2.3.4_80_TCP', addSyntax: 'endpoint' as const };
  const result = helpers.compareLocalWithDevice(
    [{ ...live, addSyntax: 'endpoint' as const }],
    [
      { ...live, id: 'on' },
      { ...live, id: 'off', enabled: false, insideIp: '192.168.1.99' },
    ]
  );
  assert.deepEqual(result.states, { on: 'synced', off: 'localDisabled' });
});

test('legacy ambiguous identities fail closed until a complete device read persists their syntax', () => {
  const local = { ...rule, ruleName: 'NAT_1.2.3.4_80', id: 'legacy' };
  assert.throws(() => helpers.getRuleSyncPreview('d', [], [local]), /历史身份不明确/);
  assert.throws(() => usgParser.generateSyncToDeviceCommands([], [local]), /历史身份不明确/);
});
