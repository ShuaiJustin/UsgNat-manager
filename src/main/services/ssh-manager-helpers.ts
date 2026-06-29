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

export const isCliPromptReady = (text: string): boolean => {
  const trimmed = text.trimEnd();
  const patterns = [/<[^>]+>\s*$/, /\[[^\]]+\]\s*$/, /[>#$]\s*$/];

  return (
    patterns.some((pattern) => pattern.test(trimmed)) || text.includes('User Access Verification')
  );
};

export const isBenignSshDisconnectError = (error: Error): boolean => {
  const code = (error as Error & { code?: string }).code;
  const message = error.message || String(error);

  return (
    code === 'ECONNRESET' || BENIGN_DISCONNECT_PATTERNS.some((pattern) => pattern.test(message))
  );
};
