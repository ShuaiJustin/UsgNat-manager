import assert from 'node:assert/strict';
import test from 'node:test';

import type { SMTPConfig } from './email-service.ts';
import {
  createBaseTransportConfig,
  createTestTransportConfig,
  getEmailErrorInfo,
  getSMTPConfigValidationError,
  normalizeNotifyTypes,
} from './email-service-helpers.ts';

const createConfig = (overrides: Partial<SMTPConfig> = {}): SMTPConfig => ({
  enabled: true,
  host: 'smtp.example.com',
  port: 465,
  secure: true,
  auth: {
    user: 'admin@example.com',
    pass: 'secret',
  },
  from: {
    name: 'USG',
    address: 'noreply@example.com',
  },
  to: ['ops@example.com'],
  ...overrides,
});

test('normalizeNotifyTypes falls back to the default set when no types are provided', () => {
  assert.deepEqual(normalizeNotifyTypes(undefined), [
    'ipChange',
    'updateSuccess',
    'updateFailed',
    'deviceOffline',
    'dailyReport',
  ]);
  assert.deepEqual(normalizeNotifyTypes([]), [
    'ipChange',
    'updateSuccess',
    'updateFailed',
    'deviceOffline',
    'dailyReport',
  ]);
});

test('normalizeNotifyTypes preserves an explicit notify-type list', () => {
  assert.deepEqual(normalizeNotifyTypes(['updateFailed']), ['updateFailed']);
});

test('getSMTPConfigValidationError returns the first required-field failure', () => {
  assert.equal(getSMTPConfigValidationError(createConfig({ enabled: false })), '邮件通知未启用');
  assert.equal(getSMTPConfigValidationError(createConfig({ host: '' })), 'SMTP 服务器地址不能为空');
  assert.equal(
    getSMTPConfigValidationError(createConfig({ auth: { user: '', pass: 'secret' } })),
    'SMTP 用户名不能为空'
  );
  assert.equal(
    getSMTPConfigValidationError(createConfig({ auth: { user: 'admin', pass: '' } })),
    'SMTP 密码不能为空'
  );
  assert.equal(
    getSMTPConfigValidationError(createConfig({ from: { name: 'USG', address: '' } })),
    '发件人邮箱不能为空'
  );
  assert.equal(getSMTPConfigValidationError(createConfig({ to: [] })), '收件人邮箱不能为空');
  assert.equal(getSMTPConfigValidationError(createConfig()), null);
});

test('createBaseTransportConfig builds the shared SMTP transport shape', () => {
  assert.deepEqual(createBaseTransportConfig(createConfig()), {
    host: 'smtp.example.com',
    port: 465,
    secure: true,
    auth: {
      user: 'admin@example.com',
      pass: 'secret',
    },
  });
});

test('createBaseTransportConfig preserves STARTTLS and plain-text flags when provided', () => {
  assert.deepEqual(
    createBaseTransportConfig(
      createConfig({
        secure: false,
        requireTLS: true,
      })
    ),
    {
      host: 'smtp.example.com',
      port: 465,
      secure: false,
      requireTLS: true,
      auth: {
        user: 'admin@example.com',
        pass: 'secret',
      },
    }
  );

  assert.deepEqual(
    createBaseTransportConfig(
      createConfig({
        secure: false,
        ignoreTLS: true,
      })
    ),
    {
      host: 'smtp.example.com',
      port: 465,
      secure: false,
      ignoreTLS: true,
      auth: {
        user: 'admin@example.com',
        pass: 'secret',
      },
    }
  );
});

test('createTestTransportConfig extends the base transport config with safe timeouts', () => {
  assert.deepEqual(createTestTransportConfig(createConfig()), {
    host: 'smtp.example.com',
    port: 465,
    secure: true,
    auth: {
      user: 'admin@example.com',
      pass: 'secret',
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    logger: false,
    debug: false,
  });
});

test('getEmailErrorInfo extracts known fields from unknown error values', () => {
  assert.deepEqual(
    getEmailErrorInfo({
      message: 'boom',
      code: 'EAUTH',
      command: 'AUTH LOGIN',
    }),
    {
      message: 'boom',
      code: 'EAUTH',
      command: 'AUTH LOGIN',
    }
  );

  assert.deepEqual(getEmailErrorInfo('plain-text-error'), {
    message: 'plain-text-error',
    code: undefined,
    command: undefined,
  });
});
