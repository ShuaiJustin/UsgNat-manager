const SOURCE_ALIASES: Record<string, string> = {
  cip: 'cip.cc',
  ip138: 'cip.cc',
};

export const DEFAULT_IP_CHECK_SOURCES = ['cip.cc', 'ipip'] as const;

const SUPPORTED_IP_CHECK_SOURCES = new Set<string>([
  ...DEFAULT_IP_CHECK_SOURCES,
  'ip.sb',
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
