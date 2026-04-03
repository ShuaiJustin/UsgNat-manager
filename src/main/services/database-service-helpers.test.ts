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

test('buildNatRuleMigrationStatements adds noReverse when the column is missing', () => {
  assert.deepEqual(buildNatRuleMigrationStatements([{ name: 'id' }, { name: 'ruleName' }]), [
    'ALTER TABLE "nat_rules" ADD COLUMN "noReverse" INTEGER NOT NULL DEFAULT 0',
  ]);
});

test('buildNatRuleMigrationStatements rebuilds nat_rules when unrRoute exists', () => {
  const statements = buildNatRuleMigrationStatements([
    { name: 'id' },
    { name: 'noReverse' },
    { name: 'unrRoute' },
  ]);

  assert.equal(statements.length, 4);
  assert.ok(statements[0].includes('CREATE TABLE "nat_rules_new"'));
  assert.ok(statements[1].includes('INSERT INTO "nat_rules_new"'));
  assert.equal(statements[2], 'DROP TABLE "nat_rules"');
  assert.equal(statements[3], 'ALTER TABLE "nat_rules_new" RENAME TO "nat_rules"');
});

test('buildNatRuleMigrationStatements is empty when no migration is needed', () => {
  assert.deepEqual(buildNatRuleMigrationStatements([{ name: 'id' }, { name: 'noReverse' }]), []);
});
