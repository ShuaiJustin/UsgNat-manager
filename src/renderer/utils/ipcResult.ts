export const ensureIpcSuccess = <T>(result: T, fallbackMessage: string): T => {
  if (
    result &&
    typeof result === 'object' &&
    'success' in result &&
    (result as { success?: boolean }).success === false
  ) {
    const failedResult = result as { error?: string; message?: string };
    throw new Error(failedResult.error || failedResult.message || fallbackMessage);
  }

  return result;
};
