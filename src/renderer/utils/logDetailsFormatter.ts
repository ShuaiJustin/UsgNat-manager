const normalizeLogText = (value: string) =>
  value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/g, '');

const sanitizeLogValue = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return normalizeLogText(value);
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeLogValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
        key,
        sanitizeLogValue(nestedValue),
      ])
    );
  }

  return value;
};

export const formatLogDetails = (details: unknown): string => {
  if (details == null) {
    return '';
  }

  if (typeof details === 'string') {
    try {
      const parsed = JSON.parse(details);
      return JSON.stringify(sanitizeLogValue(parsed), null, 2);
    } catch {
      return normalizeLogText(details);
    }
  }

  if (typeof details === 'object') {
    return JSON.stringify(sanitizeLogValue(details), null, 2);
  }

  return String(details);
};
