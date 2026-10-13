import assert from 'node:assert/strict';
import test from 'node:test';

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
  ]);
  assert.deepEqual(buildNatRuleMigrationStatements([{ name: 'id' }, { name: 'noReverse' }]), [
    'ALTER TABLE "nat_rules" ADD COLUMN "unrRoute" INTEGER NOT NULL DEFAULT 0',
  ]);
});

test('buildNatRuleMigrationStatements keeps an existing unrRoute column', () => {
  // Only the NULL clean-up runs; the column is never dropped.
  assert.deepEqual(
    buildNatRuleMigrationStatements([{ name: 'id' }, { name: 'noReverse' }, { name: 'unrRoute' }]),
    ['UPDATE "nat_rules" SET "unrRoute" = 0 WHERE "unrRoute" IS NULL']
  );
});

test('an existing unrRoute column gets NULLs cleared', () => {
  assert.deepEqual(buildNatRuleMigrationStatements([{ name: 'noReverse' }, { name: 'unrRoute' }]), [
    'UPDATE "nat_rules" SET "unrRoute" = 0 WHERE "unrRoute" IS NULL',
  ]);
});
