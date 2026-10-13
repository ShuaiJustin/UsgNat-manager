import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
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
  isDevicePromptReady,
  createHostKeyVerifier,
  getSingleCommandCloseResult,
  isValidFirstHostKeyTrust,
  isBatchCloseComplete,
} from './ssh-manager-helpers.ts';

test('SSH host keys require explicit matching trust and disclose unknown/changed fingerprints', () => {
  const key = Buffer.from('server-public-key');
  let observed: string | undefined;
  const unknown = createHostKeyVerifier(undefined, (fingerprint) => {
    observed = fingerprint;
  });
  assert.equal(unknown(key), false);
  assert.match(observed!, /^SHA256:/);
  assert.equal(createHostKeyVerifier(observed)(key), true);
  assert.equal(createHostKeyVerifier(observed)(Buffer.from('replacement-server-key')), false);
});

test('an SSH stream close before the command completion prompt is incomplete failure', () => {
  assert.deepEqual(getSingleCommandCloseResult(false, 'partial rule'), {
    success: false,
    complete: false,
    error: '设备在命令完成前关闭连接，结果不完整',
  });
  assert.equal(getSingleCommandCloseResult(true, '').complete, true);
});

test('closing after sending save confirmation but before acknowledgment is not batch success', () => {
  assert.equal(isBatchCloseComplete(5, 5, 'y'), false);
  assert.equal(isBatchCloseComplete(5, 5, null), true);
  assert.equal(isBatchCloseComplete(3, 5, null), false);
});

test('first host trust rejects forged, expired, changed or redirected challenges', () => {
  const challenge = {
    fingerprint: 'SHA256:expected',
    host: '192.0.2.1',
    port: 22,
    changed: false,
    expiresAt: 100,
  };
  const device = { host: challenge.host, port: challenge.port };
  assert.equal(isValidFirstHostKeyTrust(challenge, device, challenge.fingerprint, 10), true);
  assert.equal(isValidFirstHostKeyTrust(undefined, device, challenge.fingerprint, 10), false);
  assert.equal(isValidFirstHostKeyTrust(challenge, device, 'forged', 10), false);
  assert.equal(isValidFirstHostKeyTrust(challenge, device, challenge.fingerprint, 101), false);
  assert.equal(
    isValidFirstHostKeyTrust({ ...challenge, changed: true }, device, challenge.fingerprint, 10),
    false
  );
  assert.equal(
    isValidFirstHostKeyTrust(
      challenge,
      { ...device, host: '192.0.2.2' },
      challenge.fingerprint,
      10
    ),
    false
  );
});

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

test('configuration chunks ending in Huawei separators stay incomplete until the actual device prompt', () => {
  let output = '';
  const chunks = [
    'display current-configuration\r\n#',
    '\r\nsysname USG6300\r\n#',
    '\r\nnat server web protocol tcp global 1.2.3.4 80 inside 192.168.1.2 80\r\n#',
    '\r\n<USG',
    '6300>',
  ];
  for (const chunk of chunks.slice(0, -1)) {
    output += chunk;
    assert.equal(isCliPromptReady(output), false);
    assert.equal(getSingleCommandCloseResult(isDevicePromptReady(output), output).complete, false);
  }
  output += chunks.at(-1);
  assert.equal(isDevicePromptReady(output), true);
  assert.equal(getSingleCommandCloseResult(isDevicePromptReady(output), output).complete, true);
  for (const text of [
    '#',
    '>',
    '$',
    'value ending with #',
    'User Access Verification',
    'text <USG6300>',
    'Continue?[Y/N]',
  ]) {
    assert.equal(isDevicePromptReady(text), false);
  }
  assert.equal(isDevicePromptReady('[USG6300]'), true);
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

test('HRP prompts, pager prompts and unexpected confirmations are recognized', async () => {
  const helpers = await import('./ssh-manager-helpers.ts');
  assert.equal(isDevicePromptReady('\r\nHRP_M<FW>'), true);
  assert.equal(isDevicePromptReady('\r\nHRP_S[FW]'), true);
  assert.equal(helpers.isHrpStandbyPrompt('banner\r\nHRP_S<FW>'), true);
  assert.equal(helpers.isHrpStandbyPrompt('\r\nHRP_M<FW>'), false);
  assert.equal(helpers.isPagerPromptPending('nat server a\r\n  ---- More ----'), true);
  assert.equal(
    helpers.stripPagerArtifacts('a\r\n  ---- More ----\x1b[42D                \x1b[42Db'),
    'a\r\n                b'
  );
  assert.equal(helpers.isConfirmationPromptPending('Continue? [Y/N]:'), true);
  assert.equal(helpers.isConfirmationPromptPending('\r\n<FW>'), false);
});

test('HRP_A prompts and line-erase sequences are handled', async () => {
  const helpers = await import('./ssh-manager-helpers.ts');
  assert.equal(isDevicePromptReady('\r\nHRP_A<FW>'), true);
  assert.equal(helpers.stripPagerArtifacts('dis\x1b[Kplay'), 'display');
});
