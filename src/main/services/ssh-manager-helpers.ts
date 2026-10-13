import { createHash, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

export const createHostKeyVerifier =
  (
    trustedFingerprint?: string,
    onObserved?: (fingerprint: string) => void
  ): ((key: Buffer) => boolean) =>
  (key) => {
    const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
    onObserved?.(fingerprint);
    if (!trustedFingerprint) return false;
    const expected = Buffer.from(trustedFingerprint);
    const actual = Buffer.from(fingerprint);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  };

export const getSingleCommandCloseResult = (completed: boolean, output: string) => {
  const error = completed ? getDeviceCommandError(output) : '设备在命令完成前关闭连接，结果不完整';
  return { success: error === null, complete: completed, ...(error ? { error } : {}) };
};

export const isBatchCloseComplete = (
  sentCount: number,
  commandCount: number,
  activeCommand: string | null
): boolean => {
  return sentCount === commandCount && activeCommand === null;
};

export type HostKeyChallenge = {
  fingerprint: string;
  host: string;
  port: number;
  changed: boolean;
  expiresAt: number;
};
export const isValidFirstHostKeyTrust = (
  challenge: HostKeyChallenge | undefined,
  device: { host: string; port: number } | null,
  fingerprint: string,
  now = Date.now()
): boolean =>
  Boolean(
    challenge &&
      device &&
      !challenge.changed &&
      challenge.expiresAt >= now &&
      challenge.fingerprint === fingerprint &&
      challenge.host === device.host &&
      challenge.port === device.port
  );

const COMMAND_ERROR_PATTERNS = [
  /^error\s*:/i,
  /^% ?error/i,
  /^invalid input/i,
  /^incomplete command/i,
  /^too many parameters/i,
  /^unrecognized command/i,
  /^wrong parameter/i,
  /^command authorization failed/i,
  /^the command is not found/i,
  /^permission denied/i,
];

const BENIGN_DISCONNECT_PATTERNS = [
  /connection is closed by ssh server/i,
  /read econnreset/i,
  /econnreset/i,
];

const CONFIRMATION_PROMPT_PATTERN = /(?:\[[Yy]\/[Nn]\]|\([Yy]\/[Nn]\))\s*:?\s*$/;

export type BatchShellStartupAction = 'wait' | 'nudge-prompt' | 'start-command';
export type BatchShellOpenRecoveryAction = 'wait' | 'retry-connection' | 'fail';
export type ShellCommandFinishAction = 'ignore' | 'wait-for-stream-close' | 'resolve';

export interface BatchShellStartupState {
  waitForPrompt: boolean;
  currentCommandIndex: number;
  commandCount: number;
  elapsedMs: number;
  promptNudged: boolean;
  nudgeAfterMs: number;
  startAfterMs: number;
}

export interface BatchShellOpenRecoveryState {
  shellOpened: boolean;
  commandExecuted: boolean;
  attemptedRecovery: boolean;
  hasReconnectConfig: boolean;
  elapsedMs: number;
  recoverAfterMs: number;
}

export interface ShellCommandFinishState {
  resolved: boolean;
  waitingForStreamClose: boolean;
  hasActiveStream: boolean;
}

export interface BatchCommandErrorContext {
  error: string;
  commandNumber?: number;
  commandCount: number;
  command?: string | null;
}

export const getDeviceCommandError = (output: string): string | null => {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (COMMAND_ERROR_PATTERNS.some((pattern) => pattern.test(line))) {
      return line;
    }
  }

  return null;
};

export const formatBatchCommandError = ({
  error,
  commandNumber,
  commandCount,
  command,
}: BatchCommandErrorContext): string => {
  const position =
    commandNumber && commandNumber > 0
      ? `命令 ${commandNumber}/${commandCount}`
      : `已执行 ${commandCount} 条命令`;

  return command ? `${error} (${position}: ${command})` : `${error} (${position})`;
};

export const isCliPromptReady = (text: string): boolean => {
  return isDevicePromptReady(text) || CONFIRMATION_PROMPT_PATTERN.test(text.trimEnd());
};

// A '#' configuration separator, login banner or confirmation question is never a completed read.
// HRP_M / HRP_S (and HRP_A on some versions) prefix the prompt on firewalls in a hot-standby pair.
export const isDevicePromptReady = (text: string): boolean =>
  /(?:^|\r?\n)[ \t]*(?:HRP_[A-Z])?(?:<[^<>\r\n\s]+>|\[(?![Yy]\/[Nn]\])[^<>[\]\r\n\s]+\])[ \t]*$/.test(
    text.trimEnd()
  );

export const isConfirmationPromptPending = (text: string): boolean =>
  !isDevicePromptReady(text) && CONFIRMATION_PROMPT_PATTERN.test(text.trimEnd());

// The standby member of an HRP pair must not be configured directly.
export const isHrpStandbyPrompt = (text: string): boolean =>
  /(?:^|\r?\n)[ \t]*HRP_S[<[][^\r\n]*$/.test(text.trimEnd());

const PAGER_PROMPT_PATTERN = /[ \t]*-{2,}[ \t]*More[ \t]*-{2,}[ \t]*$/;

// VRP pages long output on VTYs that keep the default screen-length.
export const isPagerPromptPending = (text: string): boolean =>
  PAGER_PROMPT_PATTERN.test(text.trimEnd());

export const stripPagerArtifacts = (text: string): string =>
  text
    .replace(/[ \t]*-{2,}[ \t]*More[ \t]*-{2,}[ \t]*/g, '')
    // Cursor movement and line-erase sequences from the pager redraw and VTY line editing.
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[\d;?]*[A-Za-z]/g, '');

export const getBatchShellStartupAction = ({
  waitForPrompt,
  currentCommandIndex,
  commandCount,
  elapsedMs,
  promptNudged,
  nudgeAfterMs,
  startAfterMs,
}: BatchShellStartupState): BatchShellStartupAction => {
  if (!waitForPrompt || currentCommandIndex > 0 || commandCount === 0) {
    return 'wait';
  }

  if (elapsedMs >= startAfterMs) {
    return 'start-command';
  }

  if (!promptNudged && elapsedMs >= nudgeAfterMs) {
    return 'nudge-prompt';
  }

  return 'wait';
};

export const getBatchShellOpenRecoveryAction = ({
  shellOpened,
  commandExecuted,
  attemptedRecovery,
  hasReconnectConfig,
  elapsedMs,
  recoverAfterMs,
}: BatchShellOpenRecoveryState): BatchShellOpenRecoveryAction => {
  if (shellOpened || commandExecuted || elapsedMs < recoverAfterMs) {
    return 'wait';
  }

  if (!attemptedRecovery && hasReconnectConfig) {
    return 'retry-connection';
  }

  return 'fail';
};

export const getShellCommandFinishAction = ({
  resolved,
  waitingForStreamClose,
  hasActiveStream,
}: ShellCommandFinishState): ShellCommandFinishAction => {
  if (resolved || waitingForStreamClose) {
    return 'ignore';
  }

  if (hasActiveStream) {
    return 'wait-for-stream-close';
  }

  return 'resolve';
};

export const hasBatchCommandResponse = (output: string, command: string): boolean => {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const normalizedCommand = command.trim();
  const isConfirmationAnswer = /^[yn]$/i.test(normalizedCommand);

  return lines.some((line) => {
    if (line.includes(normalizedCommand)) {
      return true;
    }

    if (COMMAND_ERROR_PATTERNS.some((pattern) => pattern.test(line))) {
      return true;
    }

    if (CONFIRMATION_PROMPT_PATTERN.test(line)) {
      return true;
    }

    if (isConfirmationAnswer && isCliPromptReady(line)) {
      return true;
    }

    return !/^[<[].*[>\]]#?\s*$/.test(line) && !/^[>#$]$/.test(line);
  });
};

export const isBenignSshDisconnectError = (error: Error): boolean => {
  const code = (error as Error & { code?: string }).code;
  const message = error.message || String(error);

  return (
    code === 'ECONNRESET' || BENIGN_DISCONNECT_PATTERNS.some((pattern) => pattern.test(message))
  );
};
