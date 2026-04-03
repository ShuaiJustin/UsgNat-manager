import assert from 'node:assert/strict';
import test from 'node:test';

import dayjs from 'dayjs';

import { matchesLogDateRange } from './logDateFilter.ts';

test('includes log records at both the start and end of the selected range', () => {
  const range: [dayjs.Dayjs, dayjs.Dayjs] = [dayjs('2026-04-01'), dayjs('2026-04-03')];

  assert.equal(matchesLogDateRange('2026-04-01T00:00:00.000', range), true);
  assert.equal(matchesLogDateRange('2026-04-03T23:59:59.999', range), true);
});

test('excludes log records outside the selected range', () => {
  const range: [dayjs.Dayjs, dayjs.Dayjs] = [dayjs('2026-04-01'), dayjs('2026-04-03')];

  assert.equal(matchesLogDateRange('2026-03-31T23:59:59.999', range), false);
  assert.equal(matchesLogDateRange('2026-04-04T00:00:00.000', range), false);
});

test('treats incomplete date ranges as unfiltered', () => {
  assert.equal(matchesLogDateRange('2026-04-04T00:00:00.000', [dayjs('2026-04-01'), null]), true);
});
