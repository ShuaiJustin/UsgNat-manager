export const extractIPv4 = (text: string): string => {
  const match = text.match(/(\d{1,3}\.){3}\d{1,3}/);
  return match ? match[0] : text.trim();
};

export const isValidIPv4 = (ip: string): boolean => {
  const ipPattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = ip.match(ipPattern);

  if (!match) {
    return false;
  }

  for (let i = 1; i <= 4; i++) {
    const num = parseInt(match[i], 10);
    if (num < 0 || num > 255) {
      return false;
    }
  }

  return true;
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
