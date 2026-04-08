export const DEFAULT_AUTOMATION_CHECK_SOURCES = ['cip.cc', 'ipip'] as const;

const SOURCE_ALIASES: Record<string, string> = {
  cip: 'cip.cc',
  ip138: 'cip.cc',
};

const SUPPORTED_AUTOMATION_CHECK_SOURCES = new Set<string>([
  ...DEFAULT_AUTOMATION_CHECK_SOURCES,
  'ip.sb',
  'ipify',
  'icanhazip',
]);

export const AUTOMATION_CHECK_SOURCE_OPTIONS = [
  { label: 'cip.cc', value: 'cip.cc' },
  { label: 'ipip.net', value: 'ipip' },
  { label: 'ipify.org', value: 'ipify' },
  { label: 'ip.sb', value: 'ip.sb' },
  { label: 'icanhazip.com', value: 'icanhazip' },
];

export const normalizeAutomationCheckSources = (sources?: readonly string[] | null): string[] => {
  const normalizedSources = (sources ?? [])
    .map((source) => SOURCE_ALIASES[source] ?? source)
    .filter((source) => SUPPORTED_AUTOMATION_CHECK_SOURCES.has(source));

  const uniqueSources = Array.from(new Set(normalizedSources));
  return uniqueSources.length > 0 ? uniqueSources : [...DEFAULT_AUTOMATION_CHECK_SOURCES];
};

export const hasSelectedAutomationDevices = (
  autoUpdateEnabled: boolean,
  selectedDevices?: readonly string[] | null
): boolean => !autoUpdateEnabled || (selectedDevices?.length ?? 0) > 0;

export const hasSelectedAutomationCheckSources = (
  ipMonitorEnabled: boolean,
  selectedSources?: readonly string[] | null
): boolean => {
  if (!ipMonitorEnabled) {
    return true;
  }

  return (selectedSources ?? [])
    .map((source) => SOURCE_ALIASES[source] ?? source)
    .some((source) => SUPPORTED_AUTOMATION_CHECK_SOURCES.has(source));
};
