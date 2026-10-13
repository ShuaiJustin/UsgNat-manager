import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createConfigExportPayload,
  assertConfigType,
  isSshHostKeyConfig,
  parseStoredConfigs,
  summarizeConfigStats,
  mergeImportedConfig,
  assertStoredConfiguration,
} from './config-service-helpers.ts';

test('config type whitelist rejects ssh host keys and unknown keys', () => {
  for (const type of ['app', 'update', 'email', 'automation'])
    assert.doesNotThrow(() => assertConfigType(type));
  for (const type of ['ssh-host:device-1', 'unknown', '', undefined, 1])
    assert.throws(() => assertConfigType(type), /未知配置类型/);
  assert.equal(isSshHostKeyConfig('ssh-host:device-1'), true);
  assert.equal(isSshHostKeyConfig('app'), false);
});

test('stored service config accepts defaulted legacy fields and rejects invalid runtime inputs', () => {
  assert.doesNotThrow(() => assertStoredConfiguration('app', {}));
  assert.doesNotThrow(() =>
    assertStoredConfiguration('automation', {
      enabled: false,
      checkSources: ['cip', 'ip138'],
      selectedDevices: [],
    })
  );
  assert.doesNotThrow(() => assertStoredConfiguration('email', { enabled: false }));
  for (const [type, value] of [
    ['app', { logRetentionDays: 0 }],
    ['app', { logRetentionDays: 7.5 }],
    ['automation', { enabled: 'true' }],
    ['automation', { triggerType: 'unexpected' }],
    ['automation', { checkInterval: 0 }],
    ['automation', { confirmCount: 1.5 }],
    ['automation', { checkSources: ['unknown'] }],
    ['automation', { selectedDevices: 'd' }],
    ['automation', { scheduledTime: '25:00' }],
    ['email', { enabled: true, host: 'smtp' }],
    ['email', { auth: { pass: 123 } }],
  ] as const)
    assert.throws(() => assertStoredConfiguration(type, value));
});

test('import of masked email password preserves the current secret', () => {
  assert.deepEqual(
    mergeImportedConfig(
      'email',
      { host: 'new-host', auth: { user: 'new-user', pass: '***masked***' } },
      { auth: { pass: 'original-secret' } }
    ),
    { host: 'new-host', auth: { user: 'new-user', pass: 'original-secret' } }
  );
});

test('masked password without existing secret requires re-entry', () => {
  assert.throws(
    () => mergeImportedConfig('email', { auth: { pass: '***masked***' } }, null),
    /重新录入/
  );
});

test('parseStoredConfigs parses JSON values and falls back to raw strings', () => {
  assert.deepEqual(
    parseStoredConfigs([
      { key: 'system', value: '{"theme":"dark"}' },
      { key: 'broken', value: 'not-json' },
    ]),
    {
      system: { theme: 'dark' },
      broken: 'not-json',
    }
  );
});

test('createConfigExportPayload masks the email password in exports', () => {
  const payload = createConfigExportPayload({
    email: {
      auth: {
        user: 'admin',
        pass: 'ciphertext',
      },
    },
    system: {
      theme: 'light',
    },
  });

  assert.equal(payload.version, '1.0.2');
  assert.equal(payload.configs.email.auth.pass, '***masked***');
  assert.equal(payload.configs.system.theme, 'light');
  assert.ok(typeof payload.exportTime === 'string');
});

test('summarizeConfigStats returns totals, keys, and the newest update time', () => {
  const newest = new Date('2026-04-03T10:00:00.000Z');
  const older = new Date('2026-04-01T10:00:00.000Z');

  assert.deepEqual(
    summarizeConfigStats([
      { key: 'system', updatedAt: newest },
      { key: 'email', updatedAt: older },
    ]),
    {
      total: 2,
      types: ['system', 'email'],
      lastUpdated: newest,
    }
  );
});

test('exports leave out host-key trust and unknown keys', () => {
  const payload = createConfigExportPayload({
    app: { theme: 'light' },
    'ssh-host:device-1': { host: '1.2.3.4', port: 22, fingerprint: 'x' },
    retired: true,
  });
  assert.deepEqual(Object.keys(payload.configs), ['app']);
});
