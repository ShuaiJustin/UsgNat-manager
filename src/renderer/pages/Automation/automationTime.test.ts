import assert from 'node:assert/strict';
import test from 'node:test';

import dayjs from 'dayjs';

import { formatScheduledTime, parseScheduledTime } from './automationTime.ts';

test('parses HH:mm strings into a Dayjs instance', () => {
  const parsed = parseScheduledTime('08:45');

  assert.equal(parsed?.format('HH:mm'), '08:45');
});

test('formats supported time values as HH:mm', () => {
  assert.equal(formatScheduledTime(dayjs('2026-04-03T17:30:00')), '17:30');
  assert.equal(formatScheduledTime('09:05'), '09:05');
});

test('returns nullish results for unsupported time values', () => {
  assert.equal(parseScheduledTime('not-a-time'), null);
  assert.equal(formatScheduledTime(null), undefined);
});
