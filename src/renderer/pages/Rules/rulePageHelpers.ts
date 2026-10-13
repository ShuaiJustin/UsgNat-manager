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

export type RuleRowSyncState =
  | 'synced'
  | 'pendingAdd'
  | 'pendingChange'
  | 'pendingRemove'
  | 'localDisabled'
  | 'deviceOnly';

export const SYNC_STATE_META: Record<RuleRowSyncState, { label: string; color: string }> = {
  synced: { label: '已同步', color: 'success' },
  pendingAdd: { label: '待新增', color: 'processing' },
  pendingChange: { label: '待修改', color: 'warning' },
  pendingRemove: { label: '待从设备删除', color: 'error' },
  localDisabled: { label: '仅本地（已禁用）', color: 'default' },
  deviceOnly: { label: '仅设备上有，下发时会删除', color: 'purple' },
};

const PENDING_STATES: RuleRowSyncState[] = ['pendingAdd', 'pendingChange', 'pendingRemove'];

// Everything a push would change on the device, including rules only the device has.
export const countPendingChanges = (comparison: {
  states: Record<string, string>;
  deviceOnly: unknown[];
}): number =>
  Object.values(comparison.states).filter((state) =>
    PENDING_STATES.includes(state as RuleRowSyncState)
  ).length + comparison.deviceOnly.length;

export const isPendingState = (state?: RuleRowSyncState): boolean =>
  state === 'deviceOnly' || (!!state && PENDING_STATES.includes(state));
