import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createConfigExportPayload,
  decryptSensitiveConfig,
  encryptSensitiveConfig,
  parseStoredConfigs,
  summarizeConfigStats,
} from './config-service-helpers.ts';

test('encryptSensitiveConfig encrypts the email password only', () => {
  const encrypted = encryptSensitiveConfig(
    'email',
    {
      host: 'smtp.example.com',
      auth: {
        user: 'admin',
        pass: 'secret-password',
      },
    },
    'test-key'
  );

  assert.notEqual(encrypted.auth.pass, 'secret-password');
  assert.equal(encrypted.auth.user, 'admin');
  assert.deepEqual(
    encryptSensitiveConfig('system', { auth: { pass: 'secret-password' } }, 'test-key'),
    { auth: { pass: 'secret-password' } }
  );
});

test('decryptSensitiveConfig returns plaintext when the payload was encrypted', () => {
  const encrypted = encryptSensitiveConfig(
    'email',
    {
      auth: {
        pass: 'secret-password',
      },
    },
    'test-key'
  );

  assert.deepEqual(decryptSensitiveConfig('email', encrypted, 'test-key', true), {
    auth: {
      pass: 'secret-password',
    },
  });
});

test('decryptSensitiveConfig preserves legacy or unavailable-key payloads', () => {
  const legacyPayload = {
    auth: {
      pass: 'plain-text-password',
    },
  };

  assert.deepEqual(decryptSensitiveConfig('email', legacyPayload, 'test-key', true), legacyPayload);
  assert.deepEqual(decryptSensitiveConfig('email', legacyPayload, '', false), legacyPayload);
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
