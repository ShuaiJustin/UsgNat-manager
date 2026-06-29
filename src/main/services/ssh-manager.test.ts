import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getDeviceCommandError,
  isBenignSshDisconnectError,
  isCliPromptReady,
} from './ssh-manager-helpers.ts';

test('detects command errors in USG shell output', () => {
  assert.equal(
    getDeviceCommandError(
      [
        '[USG]undo nat server name web',
        'Error: The specified NAT server does not exist.',
        '[USG]',
      ].join('\n')
    ),
    'Error: The specified NAT server does not exist.'
  );

  assert.equal(
    getDeviceCommandError(
      [
        '[USG]nat server name web protocol tcp global 1.2.3.4 8080 inside 192.168.1.10 80',
        '                 ^',
        'Error: Unrecognized command found at "^" position.',
      ].join('\n')
    ),
    'Error: Unrecognized command found at "^" position.'
  );
});

test('ignores successful USG shell output', () => {
  assert.equal(
    getDeviceCommandError(
      [
        '[USG]system-view',
        'Enter system view, return user view with Ctrl+Z.',
        '[USG]nat server name web protocol tcp global 1.2.3.4 8080 inside 192.168.1.10 80',
        '[USG]',
      ].join('\n')
    ),
    null
  );
});

test('recognizes Huawei CLI prompts across shell chunks', () => {
  assert.equal(isCliPromptReady('<USG6300>'), true);
  assert.equal(isCliPromptReady('nat server name web\n[USG6300]'), true);
  assert.equal(isCliPromptReady('partial command output without prompt'), false);
});

test('classifies server-side close/reset during intentional disconnect as benign', () => {
  assert.equal(
    isBenignSshDisconnectError(new Error('The connection is closed by SSH server\r\n')),
    true
  );

  const reset = new Error('read ECONNRESET') as Error & { code?: string };
  reset.code = 'ECONNRESET';
  assert.equal(isBenignSshDisconnectError(reset), true);

  assert.equal(
    isBenignSshDisconnectError(new Error('All configured authentication methods failed')),
    false
  );
});
