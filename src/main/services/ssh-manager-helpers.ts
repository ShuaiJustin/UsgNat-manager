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
