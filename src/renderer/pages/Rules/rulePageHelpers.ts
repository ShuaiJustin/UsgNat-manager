type RuleCsvRow = {
  ruleName: string;
  protocol: string;
  globalIp: string;
  globalPort: string;
  insideIp: string;
  insidePort: string;
  enabled: boolean;
  description?: string | null;
};

type RuleDevice = {
  id: string;
};

const escapeCsvCell = (value: unknown): string => {
  const rawValue = String(value ?? '');
  const sanitizedValue = /^[=+\-@]/.test(rawValue) ? `'${rawValue}` : rawValue;
  return `"${sanitizedValue.replace(/"/g, '""')}"`;
};

export const resolveCurrentRuleDevice = <T extends RuleDevice>(
  devices: readonly T[] | undefined,
  activeDeviceId: string
): T | undefined => devices?.find((device) => device.id === activeDeviceId) ?? devices?.[0];

export const resolveActiveRuleDeviceId = (
  devices: readonly RuleDevice[] | undefined,
  selectedDeviceId: string
): string => {
  if (selectedDeviceId && devices?.some((device) => device.id === selectedDeviceId)) {
    return selectedDeviceId;
  }

  return devices?.[0]?.id ?? '';
};

export const buildRulesCsv = (
  headers: readonly string[],
  rules: readonly RuleCsvRow[],
  enabledLabel: string,
  disabledLabel: string
): string =>
  [
    headers,
    ...rules.map((rule) => [
      rule.ruleName,
      rule.protocol,
      rule.globalIp,
      rule.globalPort,
      rule.insideIp,
      rule.insidePort,
      rule.enabled ? enabledLabel : disabledLabel,
      rule.description ?? '',
    ]),
  ]
    .map((row) => row.map(escapeCsvCell).join(','))
    .join('\n');

export const shouldShowRuleBatchActions = (selectedCount: number): boolean => selectedCount > 0;
