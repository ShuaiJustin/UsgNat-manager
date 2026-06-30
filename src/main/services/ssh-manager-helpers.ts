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
  const trimmed = text.trimEnd();
  const patterns = [/<[^>]+>\s*$/, /\[[^\]]+\]\s*$/, CONFIRMATION_PROMPT_PATTERN, /[>#$]\s*$/];

  return (
    patterns.some((pattern) => pattern.test(trimmed)) || text.includes('User Access Verification')
  );
};

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
