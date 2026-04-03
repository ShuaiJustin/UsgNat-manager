import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCredentialPayload,
  getDeviceAccessValidationError,
  getFieldsToValidate,
  shouldSaveCredential,
} from './deviceModalHelpers.ts';

test('rejects unsupported connection types before submission', () => {
  assert.equal(getDeviceAccessValidationError('HTTPS', 'Password'), 'unsupported-connection');
  assert.equal(getDeviceAccessValidationError('SSH', 'Certificate'), 'unsupported-auth');
  assert.equal(getDeviceAccessValidationError('SSH', 'Password'), null);
});

test('builds credential payload by preferring form values over stored credential values', () => {
  const payload = buildCredentialPayload(
    {
      authType: 'Password',
      username: 'new-admin',
      password: 'new-secret',
      privateKeyPath: '',
      certificatePath: '',
      mfaType: undefined,
    },
    {
      authType: 'Password',
      username: 'old-admin',
      password: 'old-secret',
      privateKey: 'stored-key',
      certificate: 'stored-cert',
      mfaType: 'TOTP',
    }
  );

  assert.deepEqual(payload, {
    authType: 'Password',
    username: 'new-admin',
    password: 'new-secret',
    privateKeyPath: undefined,
    privateKey: 'stored-key',
    certificatePath: undefined,
    certificate: 'stored-cert',
    mfaType: 'TOTP',
  });
});

test('requires password validation fields when password auth is selected', () => {
  const fields = getFieldsToValidate(
    { host: '1.1.1.1', port: 22, username: 'admin' },
    'Password',
    null
  );

  assert.deepEqual(fields, ['host', 'port', 'username', 'password']);
});

test('requires private key path when no stored private key exists', () => {
  const fields = getFieldsToValidate(
    { host: '1.1.1.1', port: 22, username: 'admin' },
    'PrivateKey',
    null
  );

  assert.deepEqual(fields, ['host', 'port', 'username', 'privateKeyPath']);
});

test('uses stored certificate material to avoid re-requesting file fields', () => {
  const fields = getFieldsToValidate(
    { host: '1.1.1.1', port: 22, username: 'admin' },
    'Certificate',
    {
      authType: 'Certificate',
      privateKey: 'stored-key',
      certificate: 'stored-cert',
    }
  );

  assert.deepEqual(fields, ['host', 'port', 'username']);
});

test('saves credentials only when a complete supported credential payload exists', () => {
  assert.equal(
    shouldSaveCredential('device-1', {
      authType: 'Password',
      username: 'admin',
      password: 'secret',
    }),
    true
  );

  assert.equal(
    shouldSaveCredential('device-1', {
      authType: 'PrivateKey',
      username: 'admin',
      privateKeyPath: 'C:/id_rsa',
    }),
    true
  );

  assert.equal(
    shouldSaveCredential('device-1', {
      authType: 'Password',
      username: 'admin',
    }),
    false
  );
});
