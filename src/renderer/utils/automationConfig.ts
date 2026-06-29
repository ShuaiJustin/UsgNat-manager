export const DEFAULT_AUTOMATION_CHECK_SOURCES = ['ipip', 'ddnspod', 'pconline'] as const;

const SOURCE_ALIASES: Record<string, string> = {
  cip: 'cip.cc',
  ip138: 'cip.cc',
};

const OLD_DEFAULT_AUTOMATION_CHECK_SOURCES = new Set(['cip.cc', 'ipip']);

const SUPPORTED_AUTOMATION_CHECK_SOURCES = new Set<string>([
  ...DEFAULT_AUTOMATION_CHECK_SOURCES,
  'cip.cc',
  'ip.sb',
  'ipify',
  'icanhazip',
]);

export const AUTOMATION_CHECK_SOURCE_OPTIONS = [
  { label: 'ipip.net', value: 'ipip' },
  { label: 'DNSPod', value: 'ddnspod' },
  { label: '太平洋网络', value: 'pconline' },
  { label: 'cip.cc', value: 'cip.cc' },
  { label: 'ipify.org', value: 'ipify' },
  { label: 'ip.sb', value: 'ip.sb' },
  { label: 'icanhazip.com', value: 'icanhazip' },
];

export const normalizeAutomationCheckSources = (sources?: readonly string[] | null): string[] => {
  const sourceList = sources ?? [];
  const normalizedSources = (sources ?? [])
    .map((source) => SOURCE_ALIASES[source] ?? source)
    .filter((source) => SUPPORTED_AUTOMATION_CHECK_SOURCES.has(source));

  const uniqueSources = Array.from(new Set(normalizedSources));
  const isLegacyAliasOnly =
    uniqueSources.length === 1 &&
    uniqueSources[0] === 'cip.cc' &&
    sourceList.every((source) => source === 'cip' || source === 'ip138');
  const isOldDefaultPair =
    uniqueSources.length === OLD_DEFAULT_AUTOMATION_CHECK_SOURCES.size &&
    uniqueSources.every((source) => OLD_DEFAULT_AUTOMATION_CHECK_SOURCES.has(source));

  if (uniqueSources.length === 0 || isLegacyAliasOnly || isOldDefaultPair) {
    return [...DEFAULT_AUTOMATION_CHECK_SOURCES];
  }

  return uniqueSources;
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
