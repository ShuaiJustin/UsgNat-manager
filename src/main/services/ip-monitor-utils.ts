const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
// Candidates must not be part of a longer dotted/numeric token (e.g. 1.2.3.4567).
const IPV4_CANDIDATE_PATTERN = /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?!\.?\d)/g;

const parseIPv4Octets = (ip: string): number[] | null => {
  const match = ip.match(IPV4_PATTERN);
  if (!match) return null;
  const parts = match.slice(1, 5);
  // Leading-zero octets are ambiguous (octal in some parsers) and are rejected.
  if (parts.some((part) => part.length > 1 && part.startsWith('0'))) return null;
  const octets = parts.map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
};

export const isValidIPv4 = (ip: string): boolean => parseIPv4Octets(ip) !== null;

// [network, prefixLength] ranges that are never a usable public egress address.
const NON_GLOBAL_IPV4_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10.0.0.0/8
  [0x64400000, 10], // 100.64.0.0/10 CGNAT
  [0x7f000000, 8], // 127.0.0.0/8
  [0xa9fe0000, 16], // 169.254.0.0/16
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0000000, 24], // 192.0.0.0/24
  [0xc0a80000, 16], // 192.168.0.0/16
  [0xc6120000, 15], // 198.18.0.0/15
  [0xe0000000, 4], // 224.0.0.0/4 multicast
  [0xf0000000, 4], // 240.0.0.0/4 reserved, includes 255.255.255.255
];

/** Accepts only syntactically canonical, globally routable unicast IPv4 addresses. */
export const isGlobalUnicastIPv4 = (ip: string): boolean => {
  const octets = parseIPv4Octets(ip);
  if (!octets) return false;
  const value = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  return !NON_GLOBAL_IPV4_RANGES.some(([network, prefix]) => {
    const mask = (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) >>> 0 === network;
  });
};

/** Returns the first standalone, canonical IPv4 in text; falls back to the trimmed text. */
export const extractIPv4 = (text: string): string => {
  for (const [candidate] of text.matchAll(IPV4_CANDIDATE_PATTERN)) {
    if (isValidIPv4(candidate)) return candidate;
  }
  return text.trim();
};

export const selectMostCommonIP = (ips: readonly string[]): string => {
  const ipCounts = new Map<string, number>();

  for (const ip of ips) {
    ipCounts.set(ip, (ipCounts.get(ip) || 0) + 1);
  }

  let mostCommonIP = ips[0] ?? '';
  let maxCount = 0;

  for (const [ip, count] of ipCounts.entries()) {
    if (count > maxCount) {
      mostCommonIP = ip;
      maxCount = count;
    }
  }

  return mostCommonIP;
};

export const selectConsensusIP = (ips: readonly string[], minimumMatches: number = 2): string => {
  if (minimumMatches <= 1) {
    return ips[0] ?? '';
  }

  const ipCounts = new Map<string, number>();

  for (const ip of ips) {
    const nextCount = (ipCounts.get(ip) || 0) + 1;
    if (nextCount >= minimumMatches) {
      return ip;
    }
    ipCounts.set(ip, nextCount);
  }

  return '';
};

export const hasReachedIPConsensus = (
  ips: readonly string[],
  minimumMatches: number = 2
): boolean => {
  if (minimumMatches <= 1) {
    return ips.length > 0;
  }

  const ipCounts = new Map<string, number>();

  for (const ip of ips) {
    const nextCount = (ipCounts.get(ip) || 0) + 1;
    if (nextCount >= minimumMatches) {
      return true;
    }
    ipCounts.set(ip, nextCount);
  }

  return false;
};

export const getIPSourceDiagnosticLogOptions = (): { persistToDatabase: false } => ({
  persistToDatabase: false,
});

export const getSourceFailureLogLevel = (allSourcesFailed: boolean): 'WARNING' | 'ERROR' =>
  allSourcesFailed ? 'ERROR' : 'WARNING';

export const recordIPChangeCandidate = (
  confirmations: Map<string, number>,
  currentIP: string,
  candidateIP: string,
  requiredConfirmations: number
): {
  confirmCount: number;
  confirmed: boolean;
} => {
  if (candidateIP === currentIP) {
    confirmations.clear();
    return {
      confirmCount: 0,
      confirmed: false,
    };
  }

  const confirmCount = (confirmations.get(candidateIP) || 0) + 1;
  confirmations.clear();
  confirmations.set(candidateIP, confirmCount);

  return {
    confirmCount,
    confirmed: confirmCount >= Math.max(1, requiredConfirmations),
  };
};

export const redactURLCredentials = (value: string): string =>
  value.replace(/^([a-z][a-z\d+.-]*:\/\/)([^/@\s]+)@/i, '$1***:***@');
