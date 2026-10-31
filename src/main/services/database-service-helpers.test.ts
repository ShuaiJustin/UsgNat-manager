import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { replaceDeviceRuleSnapshot } from '../ipc/handlers/rule-handler-helpers.ts';
import { usgParser } from './usg-parser.ts';
import { validateBackupPayload, replaceBackupData } from './backup-service-helpers.ts';

import {
  DATABASE_SETUP_STATEMENTS,
  buildNatRuleMigrationStatements,
} from './database-service-helpers.ts';

test('DATABASE_SETUP_STATEMENTS covers core tables and indexes', () => {
  assert.equal(DATABASE_SETUP_STATEMENTS.length, 8);
  assert.ok(DATABASE_SETUP_STATEMENTS.some((statement) => statement.includes('"devices"')));
  assert.ok(DATABASE_SETUP_STATEMENTS.some((statement) => statement.includes('"nat_rules"')));
  assert.ok(
    DATABASE_SETUP_STATEMENTS.some((statement) => statement.includes('"idx_nat_rules_deviceId"'))
  );
});

test('buildNatRuleMigrationStatements adds missing option columns', () => {
  assert.deepEqual(buildNatRuleMigrationStatements([{ name: 'id' }, { name: 'ruleName' }]), [
    'ALTER TABLE "nat_rules" ADD COLUMN "noReverse" INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE "nat_rules" ADD COLUMN "unrRoute" INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE "nat_rules" ADD COLUMN "addSyntax" TEXT',
  ]);
  assert.deepEqual(buildNatRuleMigrationStatements([{ name: 'id' }, { name: 'noReverse' }]), [
    'ALTER TABLE "nat_rules" ADD COLUMN "unrRoute" INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE "nat_rules" ADD COLUMN "addSyntax" TEXT',
  ]);
});

test('buildNatRuleMigrationStatements keeps an existing unrRoute column', () => {
  // Only the NULL clean-up runs; the column is never dropped.
  assert.deepEqual(
    buildNatRuleMigrationStatements([{ name: 'id' }, { name: 'noReverse' }, { name: 'unrRoute' }]),
    [
      'UPDATE "nat_rules" SET "unrRoute" = 0 WHERE "unrRoute" IS NULL',
      'ALTER TABLE "nat_rules" ADD COLUMN "addSyntax" TEXT',
    ]
  );
});

test('an existing unrRoute column gets NULLs cleared', () => {
  assert.deepEqual(buildNatRuleMigrationStatements([{ name: 'noReverse' }, { name: 'unrRoute' }]), [
    'UPDATE "nat_rules" SET "unrRoute" = 0 WHERE "unrRoute" IS NULL',
    'ALTER TABLE "nat_rules" ADD COLUMN "addSyntax" TEXT',
  ]);
});

test('legacy SQLite migration preserves data, persists actual rule syntax and round-trips new and old backups', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'usg-rule-identity-'));
  const client = new PrismaClient({
    datasources: { db: { url: `file:${path.join(dir, 'test.db')}` } },
  });
  try {
    for (const sql of DATABASE_SETUP_STATEMENTS)
      await client.$executeRawUnsafe(sql.replace('"addSyntax" TEXT,', ''));
    await client.device.create({ data: { id: 'd', name: 'legacy', host: '192.0.2.1' } });
    await client.$executeRawUnsafe(
      `INSERT INTO nat_rules (id, deviceId, ruleName, protocol, globalIp, globalPort, insideIp, insidePort, enabled) VALUES ('r', 'd', 'NAT_1.2.3.4_80', 'TCP', '1.2.3.4', '80', '192.168.1.2', '80', 1)`
    );
    const before = await client.$queryRawUnsafe('SELECT * FROM nat_rules');
    const columns = await client.$queryRawUnsafe<Array<{ name: string }>>(
      'PRAGMA table_info(nat_rules)'
    );
    for (const sql of buildNatRuleMigrationStatements(columns)) await client.$executeRawUnsafe(sql);
    const after = await client.natRule.findMany();
    assert.equal(after.length, 1);
    assert.equal(after[0].addSyntax, null);
    assert.equal(after[0].id, before[0].id);
    assert.equal(after[0].globalIp, before[0].globalIp);
    const live = usgParser.parseNatServerSnapshot(
      'nat server NAT_1.2.3.4_80 protocol tcp global 1.2.3.4 80 inside 192.168.1.2 80',
      true
    );
    await replaceDeviceRuleSnapshot(client, 'd', live);
    const saved = await client.natRule.findMany();
    assert.equal(saved[0].id, 'r');
    assert.equal(saved[0].addSyntax, 'direct-name');
    const payload = {
      version: '1.1.0',
      data: {
        devices: await client.device.findMany(),
        rules: saved,
        credentials: [],
        logs: [],
        configs: [],
      },
    };
    const checked = validateBackupPayload(payload).data;
    assert.equal(checked.rules[0].addSyntax, 'direct-name');
    await replaceBackupData(client, checked);
    assert.equal((await client.natRule.findMany())[0].addSyntax, 'direct-name');
    const legacy = JSON.parse(JSON.stringify(payload));
    delete legacy.data.rules[0].addSyntax;
    assert.equal(validateBackupPayload(legacy).data.rules[0].addSyntax, null);
    legacy.data.rules[0].addSyntax = 'injected';
    assert.throws(() => validateBackupPayload(legacy), /语法身份/);
    const migrated = await client.$queryRawUnsafe<Array<{ name: string }>>(
      'PRAGMA table_info(nat_rules)'
    );
    assert.ok(!buildNatRuleMigrationStatements(migrated).some((sql) => sql.includes('ADD COLUMN')));
    assert.deepEqual(await client.$queryRawUnsafe('PRAGMA quick_check'), [{ quick_check: 'ok' }]);
  } finally {
    await client.$disconnect();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
