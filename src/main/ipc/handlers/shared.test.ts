import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSupportedAuthType,
  assertSupportedConnectionType,
  assertSupportedDeviceAccess,
} from './shared.ts';

test('accepts supported SSH connection and auth types', () => {
  assert.doesNotThrow(() => {
    assertSupportedConnectionType('SSH', 'USG-1');
    assertSupportedAuthType('Password');
    assertSupportedAuthType('PrivateKey');
    assertSupportedDeviceAccess({ name: 'USG-1', connectionType: 'SSH' }, { authType: 'Password' });
  });
});

test('rejects unsupported connection types with the device name in the error', () => {
  assert.throws(
    () => assertSupportedConnectionType('HTTPS', 'USG-2'),
    /Device USG-2 uses unsupported connection type HTTPS/
  );
});

test('rejects unsupported auth types', () => {
  assert.throws(
    () => assertSupportedAuthType('Certificate'),
    /Only Password and PrivateKey auth are supported/
  );
});
