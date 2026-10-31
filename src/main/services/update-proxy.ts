import type { Agent } from 'node:http';
import { URL } from 'node:url';
import { HttpsProxyAgent } from 'https-proxy-agent';

// Only update traffic follows the OS proxy. Firewall WAN discovery never uses this transport.
export const resolveUpdateProxyAgent = async (
  url: string,
  resolveProxy: (url: string) => Promise<string>,
  handshakeTimeoutMs = 10000
): Promise<Agent | undefined> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: string;
  try {
    result = await Promise.race([
      resolveProxy(url),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('系统代理解析超时')), 5000);
      }),
    ]);
  } catch {
    throw new Error('无法解析系统更新代理，请检查系统代理设置');
  } finally {
    clearTimeout(timer);
  }
  // Chromium has already evaluated PAC/bypass rules for this URL. Preserve its first route;
  // unsupported SOCKS routes keep the existing direct transport instead of guessing.
  const first = result.split(';')[0].trim();
  const match = first.match(/^(PROXY|HTTPS)\s+(\S+)$/i);
  if (!match) return undefined;
  let proxy: URL;
  try {
    proxy = new URL(`${match[1].toUpperCase() === 'HTTPS' ? 'https' : 'http'}://${match[2]}`);
    if (proxy.username || proxy.password || proxy.pathname !== '/' || proxy.search || proxy.hash)
      throw new Error();
  } catch {
    throw new Error('系统更新代理地址无效');
  }
  // ClientRequest has no socket while CONNECT is pending; its timeout cannot cover that stage.
  const controller = new globalThis.AbortController();
  const agent = new HttpsProxyAgent(proxy, { signal: controller.signal });
  const connect = agent.connect.bind(agent);
  agent.connect = async (request, options) => {
    const deadline = setTimeout(() => controller.abort(), handshakeTimeoutMs);
    try {
      const socket = await connect(request, options);
      // Request.setTimeout can replace socket timers before TLS completes, so use a separate deadline.
      if (options.secureEndpoint) {
        const tlsDeadline = setTimeout(
          () => socket.destroy(new Error('更新TLS连接超时')),
          handshakeTimeoutMs
        );
        socket.once('secureConnect', () => clearTimeout(tlsDeadline));
        socket.once('close', () => clearTimeout(tlsDeadline));
      }
      return socket;
    } finally {
      clearTimeout(deadline);
    }
  };
  return agent;
};
