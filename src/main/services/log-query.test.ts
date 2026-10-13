import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { DATABASE_SETUP_STATEMENTS } from './database-service-helpers.ts';
import { buildLogQuery, escapeCsvCell } from './log-query.ts';

test('search and date filters include older database rows before pagination', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'usg-log-test-'));
  const client = new PrismaClient({
    datasources: { db: { url: `file:${path.join(dir, 'test.db')}` } },
  });
  try {
    for (const sql of DATABASE_SETUP_STATEMENTS) await client.$executeRawUnsafe(sql);
    await client.log.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        level: 'INFO',
        operation: 'routine',
        message: `recent-${i}`,
        createdAt: new Date('2026-10-09'),
      })),
    });
    await client.log.create({
      data: {
        level: 'ERROR',
        operation: 'SSH',
        message: 'older connection failed',
        createdAt: new Date('2026-01-01'),
      },
    });
    const options = buildLogQuery({
      search: 'connection failed',
      level: 'ERROR',
      endDate: '2026-02-01',
      limit: 20,
    });
    const rows = await client.log.findMany({ ...options, orderBy: { createdAt: 'desc' } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].message, 'older connection failed');
    assert.equal(await client.log.count({ where: options.where }), 1);
  } finally {
    await client.$disconnect();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('invalid pagination and dates fail without widening a destructive filter', () => {
  assert.throws(() => buildLogQuery({ startDate: 'bad-date' }), /日期/);
  assert.throws(() => buildLogQuery({ limit: -1 }), /分页/);
  assert.throws(() => buildLogQuery({ level: 'INVALID' as 'INFO' }), /级别/);
});

test('csv cells neutralize spreadsheet formula prefixes and escape quotes', () => {
  for (const value of ['=1+1', '+1', '-1', '@SUM(A1)', '\tcmd', '\rcmd'])
    assert.equal(escapeCsvCell(value), `"'${value}"`);
  assert.equal(escapeCsvCell('a "quoted" value'), '"a ""quoted"" value"');
  assert.equal(escapeCsvCell(null), '""');
  assert.equal(escapeCsvCell('普通消息'), '"普通消息"');
});
