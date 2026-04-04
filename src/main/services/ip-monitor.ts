import { EventEmitter } from 'events';
import axios, { AxiosInstance, type AxiosRequestConfig, type CreateAxiosDefaults } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import http from 'node:http';
import https from 'node:https';

import { DEFAULT_IP_CHECK_SOURCES, normalizeIPCheckSources } from '../ip-check-sources';
import { logger } from './logger';
import { createIPCheckSources, type IPCheckSource } from './ip-monitor-sources';
import { isValidIPv4, selectMostCommonIP } from './ip-monitor-utils';

export interface IPChangeEvent {
  oldIP: string;
  newIP: string;
  timestamp: Date;
  confirmCount: number;
}

export interface IPMonitorConfig {
  enabled: boolean;
  checkInterval: number;
  confirmCount: number;
  sources: string[];
}

const getErrorDetails = (error: unknown) => {
  if (axios.isAxiosError(error)) {
    return {
      code: error.code || 'UNKNOWN',
      message: error.message,
      syscall: '',
      errno: '',
    };
  }

  if (error instanceof Error) {
    const errorWithMetadata = error as Error & {
      code?: string;
      syscall?: string;
      errno?: string | number;
    };

    return {
      code: errorWithMetadata.code || 'UNKNOWN',
      message: errorWithMetadata.message,
      syscall: errorWithMetadata.syscall || '',
      errno: String(errorWithMetadata.errno || ''),
    };
  }

  return {
    code: 'UNKNOWN',
    message: String(error),
    syscall: '',
    errno: '',
  };
};

export class IPMonitor extends EventEmitter {
  private currentIP = '';
  private previousIP = '';
  // eslint-disable-next-line no-undef
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private changeConfirmations = new Map<string, number>();
  private config: IPMonitorConfig;
  private axiosInstance: AxiosInstance;
  private sources: Map<string, IPCheckSource> = createIPCheckSources();

  constructor(config?: Partial<IPMonitorConfig>) {
    super();

    const nextConfig: IPMonitorConfig = {
      enabled: true,
      checkInterval: 5,
      confirmCount: 3,
      sources: [...DEFAULT_IP_CHECK_SOURCES],
      ...config,
    };

    this.config = {
      ...nextConfig,
      sources: normalizeIPCheckSources(nextConfig.sources),
    };

    const axiosConfig: CreateAxiosDefaults = {
      timeout: 12000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Connection: 'keep-alive',
      },
      httpAgent: new http.Agent({
        keepAlive: true,
        keepAliveMsecs: 30000,
        maxSockets: 10,
        timeout: 8000,
      }),
      httpsAgent: new https.Agent({
        keepAlive: true,
        keepAliveMsecs: 30000,
        maxSockets: 10,
        timeout: 8000,
        rejectUnauthorized: true,
      }),
    };

    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    if (proxy) {
      try {
        axiosConfig.httpsAgent = new HttpsProxyAgent(proxy);
        logger.info('IP监控', `检测到代理配置，使用代理: ${proxy}`).catch(() => {});
      } catch {
        logger.warning('IP监控', `代理配置解析失败 (${proxy})，继续使用直连`).catch(() => {});
      }
    }

    this.axiosInstance = axios.create(axiosConfig);
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('监控服务已在运行');
    }

    this.isRunning = true;
    this.emit('started');

    this.checkIP().catch((error) => {
      console.error('首次IP检测失败:', error.message);
      this.emit('error', error);
    });

    const intervalMs = this.config.checkInterval * 60 * 1000;
    this.timer = setInterval(() => {
      this.checkIP().catch((error) => {
        console.error('IP检测失败:', error.message);
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.isRunning = false;
    this.changeConfirmations.clear();
    this.emit('stopped');
  }

  async checkIP(): Promise<string> {
    try {
      const ip = await this.getCurrentIP();

      if (!ip) {
        this.emit('error', new Error('无法获取公网IP'));
        return this.currentIP;
      }

      if (!this.currentIP) {
        this.currentIP = ip;
        this.previousIP = ip;
        this.emit('initialized', ip);
        return ip;
      }

      if (ip !== this.currentIP) {
        await this.handleIPChange(ip);
      } else {
        this.changeConfirmations.delete(ip);
        this.emit('checked', { ip, changed: false });
      }

      return ip;
    } catch (error) {
      this.emit('error', error);
      return this.currentIP;
    }
  }

  private async handleIPChange(newIP: string): Promise<void> {
    const confirmCount = (this.changeConfirmations.get(newIP) || 0) + 1;
    this.changeConfirmations.set(newIP, confirmCount);

    this.emit('checking', {
      oldIP: this.currentIP,
      newIP,
      confirmCount,
      required: this.config.confirmCount,
    });

    if (confirmCount >= this.config.confirmCount) {
      this.previousIP = this.currentIP;
      this.currentIP = newIP;
      this.changeConfirmations.clear();

      const event: IPChangeEvent = {
        oldIP: this.previousIP,
        newIP: this.currentIP,
        timestamp: new Date(),
        confirmCount,
      };

      this.emit('changed', event);
    }
  }

  private async getCurrentIP(): Promise<string> {
    const activeSources = this.config.sources
      .map((name) => this.sources.get(name))
      .filter((source): source is IPCheckSource => source !== undefined);

    if (activeSources.length === 0) {
      throw new Error('没有可用的IP检测源');
    }

    const results: string[] = [];
    const errors: string[] = [];

    for (const source of activeSources) {
      try {
        const ip = await this.fetchIPFromSource(source);
        if (ip && isValidIPv4(ip)) {
          results.push(ip);
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (error: unknown) {
        const { code: errorCode, message: errorMsg } = getErrorDetails(error);
        errors.push(`${source.name}: ${errorCode} - ${errorMsg}`);

        logger
          .error('IP监控', `从 ${source.name} 获取IP失败: ${errorMsg} (错误码: ${errorCode})`)
          .catch(() => {});
      }
    }

    if (results.length === 0) {
      throw new Error(`所有IP检测源都失败: ${errors.join('; ')}`);
    }

    return selectMostCommonIP(results);
  }

  private async fetchIPFromSource(source: IPCheckSource, retries = 2): Promise<string> {
    let lastError: unknown;

    for (let i = 0; i < retries; i++) {
      try {
        const config: AxiosRequestConfig = {};
        if (source.name === '淘宝IP接口') {
          config.headers = {
            Referer: 'https://www.taobao.com/',
          };
        }

        const response = await this.axiosInstance.get(source.url, config);
        return source.parser(response.data);
      } catch (error: unknown) {
        lastError = error;

        const { code: errorCode, syscall, errno: errnoDescription } = getErrorDetails(error);

        if (i < retries - 1) {
          const waitTime = 2000 * (i + 1);
          logger
            .warning(
              'IP监控',
              `${source.name} 请求失败 (${errorCode}${syscall ? '/' + syscall : ''})，${
                waitTime / 1000
              } 秒后重试...`
            )
            .catch(() => {});
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        } else {
          logger
            .error(
              'IP监控',
              `${source.name} 所有重试均失败 - 错误码: ${errorCode}, Syscall: ${syscall}, Errno: ${errnoDescription}`
            )
            .catch(() => {});
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  getCurrentIPSync(): string {
    return this.currentIP;
  }

  getPreviousIP(): string {
    return this.previousIP;
  }

  isMonitoring(): boolean {
    return this.isRunning;
  }

  updateConfig(config: Partial<IPMonitorConfig>): void {
    const nextConfig = { ...this.config, ...config };
    if (config.sources !== undefined) {
      nextConfig.sources = normalizeIPCheckSources(config.sources);
    }
    this.config = nextConfig;

    if (this.isRunning && config.checkInterval) {
      this.stop();
      void this.start();
    }
  }

  getConfig(): IPMonitorConfig {
    return { ...this.config };
  }
}

export const ipMonitor = new IPMonitor();
