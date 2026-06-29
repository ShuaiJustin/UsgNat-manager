const SOURCE_ALIASES: Record<string, string> = {
  cip: 'cip.cc',
  ip138: 'cip.cc',
};

export const DEFAULT_IP_CHECK_SOURCES = ['ipip', 'ddnspod', 'pconline'] as const;

const OLD_DEFAULT_IP_CHECK_SOURCES = new Set(['cip.cc', 'ipip']);

const SUPPORTED_IP_CHECK_SOURCES = new Set<string>([
  ...DEFAULT_IP_CHECK_SOURCES,
  'cip.cc',
  'ip.sb',
  'ipify',
  'icanhazip',
  'ipinfo',
  'ifconfig',
]);

export const normalizeIPCheckSources = (sources?: readonly string[] | null): string[] => {
  const sourceList = sources ?? [];
  const normalizedSources = (sources ?? [])
    .map((source) => SOURCE_ALIASES[source] ?? source)
    .filter((source) => SUPPORTED_IP_CHECK_SOURCES.has(source));

  const uniqueSources = Array.from(new Set(normalizedSources));
  const isLegacyAliasOnly =
    uniqueSources.length === 1 &&
    uniqueSources[0] === 'cip.cc' &&
    sourceList.every((source) => source === 'cip' || source === 'ip138');
  const isOldDefaultPair =
    uniqueSources.length === OLD_DEFAULT_IP_CHECK_SOURCES.size &&
    uniqueSources.every((source) => OLD_DEFAULT_IP_CHECK_SOURCES.has(source));

  if (uniqueSources.length === 0 || isLegacyAliasOnly || isOldDefaultPair) {
    return [...DEFAULT_IP_CHECK_SOURCES];
  }

  return uniqueSources;
};
