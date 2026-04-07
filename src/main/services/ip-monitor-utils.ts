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

export const getSourceFailureLogLevel = (allSourcesFailed: boolean): 'WARNING' | 'ERROR' =>
  allSourcesFailed ? 'ERROR' : 'WARNING';
