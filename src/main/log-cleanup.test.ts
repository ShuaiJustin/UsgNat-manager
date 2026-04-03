import assert from 'node:assert/strict';
import test from 'node:test';

import { createLogCleanupPlan } from './log-cleanup.ts';

test('treats zero-day cleanup as a full purge without recreating audit rows', () => {
  const plan = createLogCleanupPlan(new Date('2026-04-03T12:00:00.000Z'), 0);

  assert.equal(plan.deleteAll, true);
  assert.equal(plan.cutoffDate, null);
  assert.equal(plan.persistAuditToDatabase, false);
});

test('calculates a cutoff date for retention-based cleanup', () => {
  const plan = createLogCleanupPlan(new Date('2026-04-03T12:00:00.000Z'), 30);

  assert.equal(plan.deleteAll, false);
  assert.equal(plan.persistAuditToDatabase, true);
  assert.equal(plan.cutoffDate?.toISOString(), '2026-03-04T12:00:00.000Z');
});
