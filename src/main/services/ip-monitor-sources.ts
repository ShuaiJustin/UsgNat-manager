export interface IPCheckSource {
  name: string;
  url: string;
  parser: (response: string) => string;
}

// ponytail: kept local (same pattern as ip-monitor-utils) because src tests load this file without a resolver;
// ip-monitor rejects non-global or non-canonical results via isGlobalUnicastIPv4.
const extractIPv4 = (text: string): string =>
  text.match(/(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?!\.?\d)/)?.[0] ?? text.trim();

export const createIPCheckSources = (): Map<string, IPCheckSource> =>
  new Map([
    [
      'ip.sb',
      {
        name: 'ip.sb',
        url: 'https://api.ip.sb/ip',
        parser: (response) => response.trim(),
      },
    ],
    [
      'icanhazip',
      {
        name: 'icanhazip',
        url: 'https://icanhazip.com',
        parser: (response) => response.trim(),
      },
    ],
    [
      'ipinfo',
      {
        name: 'ipinfo.io',
        url: 'https://ipinfo.io/ip',
        parser: (response) => response.trim(),
      },
    ],
    [
      'ifconfig',
      {
        name: 'ifconfig.me',
        url: 'https://ifconfig.me/ip',
        parser: (response) => response.trim(),
      },
    ],
    [
      'ipify',
      {
        name: 'ipify',
        url: 'https://api.ipify.org',
        parser: (response) => response.trim(),
      },
    ],
    [
      'ipip',
      {
        name: 'ipip.net',
        url: 'https://myip.ipip.net/s',
        parser: extractIPv4,
      },
    ],
    [
      'ddnspod',
      {
        name: 'DNSPod',
        url: 'https://ip.ddnspod.com',
        parser: extractIPv4,
      },
    ],
    [
      'pconline',
      {
        name: '太平洋网络',
        url: 'https://whois.pconline.com.cn/ipJson.jsp?json=true',
        parser: extractIPv4,
      },
    ],
    [
      'cip.cc',
      {
        name: 'cip.cc',
        url: 'https://cip.cc',
        parser: extractIPv4,
      },
    ],
  ]);
