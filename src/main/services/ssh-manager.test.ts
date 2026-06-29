import assert from 'node:assert/strict';
import test from 'node:test';

import { getDeviceCommandError } from './ssh-manager-helpers.ts';

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
