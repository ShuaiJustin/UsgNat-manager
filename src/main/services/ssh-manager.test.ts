import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getBatchShellOpenRecoveryAction,
  getBatchShellStartupAction,
  formatBatchCommandError,
  hasBatchCommandResponse,
  getDeviceCommandError,
  getShellCommandFinishAction,
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

test('formats batch command errors with command position and text', () => {
  assert.equal(
    formatBatchCommandError({
      error: 'Error: Unrecognized command found at "^" position.',
      commandNumber: 3,
      commandCount: 12,
      command: 'nat server name web protocol tcp global 1.2.3.4 80 inside 192.168.1.10 80',
    }),
    'Error: Unrecognized command found at "^" position. (命令 3/12: nat server name web protocol tcp global 1.2.3.4 80 inside 192.168.1.10 80)'
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
  assert.equal(isCliPromptReady('Are you sure to continue?[Y/N]'), true);
  assert.equal(isCliPromptReady('Continue? (y/n):'), true);
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

test('starts batch commands when USG shell opens without an initial prompt', async () => {
  const baseState = {
    waitForPrompt: true,
    currentCommandIndex: 0,
    commandCount: 1,
    nudgeAfterMs: 300,
    startAfterMs: 1200,
  };

  assert.equal(
    getBatchShellStartupAction({
      ...baseState,
      elapsedMs: 299,
      promptNudged: false,
    }),
    'wait'
  );

  assert.equal(
    getBatchShellStartupAction({
      ...baseState,
      elapsedMs: 300,
      promptNudged: false,
    }),
    'nudge-prompt'
  );

  assert.equal(
    getBatchShellStartupAction({
      ...baseState,
      elapsedMs: 1200,
      promptNudged: true,
    }),
    'start-command'
  );

  assert.equal(
    getBatchShellStartupAction({
      ...baseState,
      waitForPrompt: false,
      elapsedMs: 1200,
      promptNudged: true,
    }),
    'wait'
  );
});

test('does not treat a stale prompt as batch command completion', () => {
  assert.equal(hasBatchCommandResponse('[USG6300]', 'system-view'), false);
  assert.equal(
    hasBatchCommandResponse(
      'system-view\nEnter system view, return user view with Ctrl+Z.\n[USG6300]',
      'system-view'
    ),
    true
  );
  assert.equal(
    hasBatchCommandResponse(
      'Error: Unrecognized command found at "^" position.\n[USG6300]',
      'system-view'
    ),
    true
  );
});

test('accepts save confirmation answers that only return a device prompt', () => {
  assert.equal(
    hasBatchCommandResponse('The current configuration will be written. Continue?[Y/N]', 'save'),
    true
  );
  assert.equal(hasBatchCommandResponse('<USG6300>', 'y'), true);
});

test('waits for a single command shell to close before resolving', () => {
  assert.equal(
    getShellCommandFinishAction({
      resolved: false,
      waitingForStreamClose: false,
      hasActiveStream: true,
    }),
    'wait-for-stream-close'
  );

  assert.equal(
    getShellCommandFinishAction({
      resolved: false,
      waitingForStreamClose: true,
      hasActiveStream: true,
    }),
    'ignore'
  );

  assert.equal(
    getShellCommandFinishAction({
      resolved: false,
      waitingForStreamClose: false,
      hasActiveStream: false,
    }),
    'resolve'
  );
});

test('recovers batch shell startup when the shell callback never arrives', () => {
  const baseState = {
    shellOpened: false,
    commandExecuted: false,
    attemptedRecovery: false,
    hasReconnectConfig: true,
    recoverAfterMs: 3000,
  };

  assert.equal(
    getBatchShellOpenRecoveryAction({
      ...baseState,
      elapsedMs: 2999,
    }),
    'wait'
  );

  assert.equal(
    getBatchShellOpenRecoveryAction({
      ...baseState,
      elapsedMs: 3000,
    }),
    'retry-connection'
  );

  assert.equal(
    getBatchShellOpenRecoveryAction({
      ...baseState,
      attemptedRecovery: true,
      elapsedMs: 3000,
    }),
    'fail'
  );

  assert.equal(
    getBatchShellOpenRecoveryAction({
      ...baseState,
      hasReconnectConfig: false,
      elapsedMs: 3000,
    }),
    'fail'
  );

  assert.equal(
    getBatchShellOpenRecoveryAction({
      ...baseState,
      shellOpened: true,
      elapsedMs: 3000,
    }),
    'wait'
  );
});
