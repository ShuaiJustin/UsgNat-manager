export type ManagedSelection = {
  selectedDevices: string[];
  managedRuleIds: string[];
};

// Checking a device selects all of its enabled rules (the usual intent); unchecking drops them,
// so a saved selection never keeps rules of a device that is no longer managed.
export const toggleManagedDevice = (
  current: ManagedSelection,
  deviceId: string,
  checked: boolean,
  deviceRuleIds: string[]
): [string[], string[]] => {
  const otherRules = current.managedRuleIds.filter((id) => !deviceRuleIds.includes(id));
  if (!checked) return [current.selectedDevices.filter((id) => id !== deviceId), otherRules];
  return [
    current.selectedDevices.includes(deviceId)
      ? current.selectedDevices
      : [...current.selectedDevices, deviceId],
    [...otherRules, ...deviceRuleIds],
  ];
};

// Devices that are selected but have no managed rule; saving them would do nothing.
export const getDevicesWithoutManagedRules = (
  selection: ManagedSelection,
  rules: { id: string; deviceId: string }[]
): string[] =>
  selection.selectedDevices.filter(
    (deviceId) =>
      !rules.some(
        (rule) => rule.deviceId === deviceId && selection.managedRuleIds.includes(rule.id)
      )
  );

const MONITOR_FIELDS = ['ipMonitorEnabled', 'checkInterval', 'confirmCount', 'checkSources'];

// Which tab of the automation page holds a form field, used to reveal validation errors.
export const getAutomationFieldTab = (field: string): 'update' | 'monitor' | 'notify' =>
  MONITOR_FIELDS.includes(field)
    ? 'monitor'
    : /^(smtp|sender|recipient|emailNotify|windowsNotify|notifyTypes)/.test(field)
      ? 'notify'
      : 'update';
