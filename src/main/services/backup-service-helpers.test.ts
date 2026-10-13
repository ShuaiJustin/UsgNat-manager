import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { DATABASE_SETUP_STATEMENTS } from './database-service-helpers.ts';
import { replaceBackupData, validateBackupPayload } from './backup-service-helpers.ts';

test('restore is atomic when insertion fails after deletion', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'usg-backup-test-'));
  const client = new PrismaClient({
    datasources: { db: { url: `file:${path.join(dir, 'test.db')}` } },
  });
  try {
    for (const sql of DATABASE_SETUP_STATEMENTS) await client.$executeRawUnsafe(sql);
    await client.device.create({
      data: { id: 'original', name: 'original-device', host: '192.0.2.1' },
    });
    await client.config.create({ data: { key: 'app', value: '{"language":"zh-CN"}' } });
    const originalDevices = await client.device.findMany();
    const originalConfigs = await client.config.findMany();
    await client.$executeRawUnsafe(
      "CREATE TRIGGER fail_restore BEFORE INSERT ON configs WHEN NEW.key = 'fail' BEGIN SELECT RAISE(ABORT, 'injected restore failure'); END"
    );
    await assert.rejects(
      replaceBackupData(client, {
        devices: [{ ...originalDevices[0], id: 'replacement' }],
        rules: [],
        credentials: [],
        logs: [],
        configs: [{ ...originalConfigs[0], key: 'fail' }],
      })
    );
    assert.deepEqual(
      await client.device.findMany(),
      originalDevices,
      'failed restore must retain original devices'
    );
    assert.deepEqual(
      await client.config.findMany(),
      originalConfigs,
      'failed restore must retain original settings'
    );
  } finally {
    await client.$disconnect();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('restore keeps local ssh host fingerprints and ignores fingerprints from the backup', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'usg-backup-test-'));
  const client = new PrismaClient({
    datasources: { db: { url: `file:${path.join(dir, 'test.db')}` } },
  });
  try {
    for (const sql of DATABASE_SETUP_STATEMENTS) await client.$executeRawUnsafe(sql);
    await client.config.create({ data: { key: 'ssh-host:d1', value: '{"fingerprint":"local"}' } });
    await client.config.create({ data: { key: 'app', value: '{"language":"zh-CN"}' } });
    const now = new Date();
    await replaceBackupData(client, {
      devices: [],
      rules: [],
      credentials: [],
      logs: [],
      configs: [
        {
          id: 'c1',
          key: 'ssh-host:d1',
          value: '{"fingerprint":"forged"}',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'c2',
          key: 'ssh-host:d2',
          value: '{"fingerprint":"forged"}',
          createdAt: now,
          updatedAt: now,
        },
        { id: 'c3', key: 'update', value: '{}', createdAt: now, updatedAt: now },
      ],
    });
    const configs = await client.config.findMany({ orderBy: { key: 'asc' } });
    assert.deepEqual(
      configs.map(({ key, value }) => [key, value]),
      [
        ['ssh-host:d1', '{"fingerprint":"local"}'],
        ['update', '{}'],
      ]
    );
  } finally {
    await client.$disconnect();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('backup rejects missing tables, wrong field types and orphan ownership before restore', () => {
  const empty = {
    version: '1.1.0',
    data: { devices: [], rules: [], credentials: [], logs: [], configs: [] },
  };
  assert.deepEqual(validateBackupPayload(empty).data, empty.data);
  assert.throws(
    () => validateBackupPayload({ version: '1.0.2', data: { devices: [] } }),
    /缺少完整数据表/
  );
  const device = {
    id: 'd',
    name: 'test',
    host: '192.0.2.1',
    port: 22,
    connectionType: 'SSH',
    description: null,
    enabled: true,
    online: false,
    lastConnected: null,
    createdAt: '2026-10-09T00:00:00Z',
    updatedAt: '2026-10-09T00:00:00Z',
  };
  assert.throws(
    () =>
      validateBackupPayload({
        ...empty,
        data: { ...empty.data, devices: [{ ...device, enabled: 'false' }] },
      }),
    /字段类型/
  );
  assert.throws(
    () => validateBackupPayload({ ...empty, data: { ...empty.data, devices: [device, device] } }),
    /重复/
  );
  const rule = {
    id: 'r',
    deviceId: 'missing',
    ruleName: 'test',
    protocol: 'TCP',
    globalIp: '192.0.2.2',
    globalPort: '443',
    insideIp: '10.0.0.1',
    insidePort: '443',
    enabled: true,
    description: null,
    noReverse: false,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
  };
  assert.throws(
    () =>
      validateBackupPayload({
        ...empty,
        data: { ...empty.data, devices: [device], rules: [rule] },
      }),
    /关联/
  );
  assert.throws(
    () =>
      validateBackupPayload({
        ...empty,
        data: {
          ...empty.data,
          configs: [
            {
              id: 'c',
              key: 'app',
              value: 'broken',
              createdAt: device.createdAt,
              updatedAt: device.updatedAt,
            },
          ],
        },
      }),
    /JSON/
  );
});
