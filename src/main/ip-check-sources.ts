const SOURCE_ALIASES: Record<string, string> = {
  cip: 'cip.cc',
  ip138: 'ipify',
};

export const DEFAULT_IP_CHECK_SOURCES = ['cip.cc', 'ipip', 'ip.sb', 'icanhazip'] as const;

const SUPPORTED_IP_CHECK_SOURCES = new Set<string>([
  ...DEFAULT_IP_CHECK_SOURCES,
  'ipify',
  'icanhazip',
  'ipinfo',
  'ifconfig',
]);

export const normalizeIPCheckSources = (sources?: readonly string[] | null): string[] => {
  const normalizedSources = (sources ?? [])
    .map((source) => SOURCE_ALIASES[source] ?? source)
    .filter((source) => SUPPORTED_IP_CHECK_SOURCES.has(source));

  const uniqueSources = Array.from(new Set(normalizedSources));
  return uniqueSources.length > 0 ? uniqueSources : [...DEFAULT_IP_CHECK_SOURCES];
};
