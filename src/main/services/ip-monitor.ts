import { EventEmitter } from 'events';
import axios, { AxiosInstance } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { logger } from './logger';

/**
 * IP检测源配置
 */
interface IPCheckSource {
  name: string;
  url: string;
  parser: (response: string) => string;
}

/**
 * IP变化事件
 */
export interface IPChangeEvent {
  oldIP: string;
  newIP: string;
  timestamp: Date;
  confirmCount: number;
}

/**
 * IP监控配置
 */
export interface IPMonitorConfig {
  enabled: boolean;
  checkInterval: number; // 检测间隔（分钟）
  confirmCount: number; // 变更确认次数
  sources: string[]; // 使用的检测源
}

/**
 * IP监控服务
 * 负责定时检测公网IP变化
 */
export class IPMonitor extends EventEmitter {
  private currentIP: string = '';
  private previousIP: string = '';
  // eslint-disable-next-line no-undef
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private changeConfirmations: Map<string, number> = new Map();
  private config: IPMonitorConfig;
  private axiosInstance: AxiosInstance;

  private extractIPv4(text: string): string {
    const match = text.match(/(\d{1,3}\.){3}\d{1,3}/);
    return match ? match[0] : text.trim();
  }

  // IP检测源列表（优先使用国内可访问的源）
  private sources: Map<string, IPCheckSource> = new Map([
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
        parser: (response) => this.extractIPv4(response),
      },
    ],
    [
      'cip.cc',
      {
        name: 'cip.cc',
        url: 'https://cip.cc',
        parser: (response) => this.extractIPv4(response),
      },
    ],
  ]);

  constructor(config?: Partial<IPMonitorConfig>) {
    super();
    this.config = {
      enabled: true,
      checkInterval: 5,
      confirmCount: 3,
      // 优先使用国内可访问的源
      sources: ['cip', 'ipip', 'ip138', 'ip.sb'],
      ...config,
    };

    // 创建 axios 实例，配置代理和连接保持
    const axiosConfig: any = {
      timeout: 12000, // 总超时12秒
      headers: {
        // 使用真实浏览器User-Agent避免被拦截
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
      },
      // 启用 HTTP Keep-Alive 避免频繁建立连接
      httpAgent: new (require('http').Agent)({
        keepAlive: true,
        keepAliveMsecs: 30000,
        maxSockets: 10,
        timeout: 8000, // Socket超时8秒
      }),
      httpsAgent: new (require('https').Agent)({
        keepAlive: true,
        keepAliveMsecs: 30000,
        maxSockets: 10,
        timeout: 8000, // Socket超时8秒
        rejectUnauthorized: true,
      }),
    };

    // 检测并使用系统代理（仅在明确配置时使用）
    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    if (proxy) {
      try {
        axiosConfig.httpsAgent = new HttpsProxyAgent(proxy);
        logger.info('IP监控', `检测到代理配置，使用代理: ${proxy}`).catch(() => {});
      } catch (error) {
        // 只在配置了代理但初始化失败时记录警告
        logger.warning('IP监控', `代理配置解析失败 (${proxy})，使用直连`).catch(() => {});
      }
    }
    // 国内网络通常不需要代理，直连即可

    this.axiosInstance = axios.create(axiosConfig);
  }

  /**
   * 启动监控
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('监控服务已在运行');
    }

    this.isRunning = true;
    this.emit('started');

    // 立即执行一次检测（不等待结果，避免阻塞启动）
    this.checkIP().catch((error) => {
      console.error('首次IP检测失败:', error.message);
      this.emit('error', error);
    });

    // 设置定时检测
    const intervalMs = this.config.checkInterval * 60 * 1000;
    this.timer = setInterval(() => {
      this.checkIP().catch((error) => {
        console.error('IP检测失败:', error.message);
      });
    }, intervalMs);
  }

  /**
   * 停止监控
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    this.changeConfirmations.clear();
    this.emit('stopped');
  }

  /**
   * 检测当前IP
   */
  async checkIP(): Promise<string> {
    try {
      const ip = await this.getCurrentIP();

      if (!ip) {
        this.emit('error', new Error('无法获取公网IP'));
        return this.currentIP;
      }

      // 如果是首次检测
      if (!this.currentIP) {
        this.currentIP = ip;
        this.previousIP = ip;
        this.emit('initialized', ip);
        return ip;
      }

      // 如果IP发生变化
      if (ip !== this.currentIP) {
        await this.handleIPChange(ip);
      } else {
        // IP未变化，清除该IP的确认计数
        this.changeConfirmations.delete(ip);
        this.emit('checked', { ip, changed: false });
      }

      return ip;
    } catch (error) {
      this.emit('error', error);
      return this.currentIP;
    }
  }

  /**
   * 处理IP变化
   */
  private async handleIPChange(newIP: string): Promise<void> {
    // 增加确认计数
    const confirmCount = (this.changeConfirmations.get(newIP) || 0) + 1;
    this.changeConfirmations.set(newIP, confirmCount);

    this.emit('checking', {
      oldIP: this.currentIP,
      newIP,
      confirmCount,
      required: this.config.confirmCount,
    });

    // 如果确认次数达到要求
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

  /**
   * 从多个源获取当前公网IP
   */
  private async getCurrentIP(): Promise<string> {
    const activeSources = this.config.sources
      .map((name) => this.sources.get(name))
      .filter((source): source is IPCheckSource => source !== undefined);

    if (activeSources.length === 0) {
      throw new Error('没有可用的IP检测源');
    }

    // 尝试从多个源获取IP
    const results: string[] = [];
    const errors: string[] = [];

    for (const source of activeSources) {
      try {
        const ip = await this.fetchIPFromSource(source);
        if (ip && this.isValidIP(ip)) {
          results.push(ip);
          // 成功获取一个IP后，添加短暂延迟避免频繁请求
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error: any) {
        // 收集详细错误信息
        const errorCode = error.code || 'UNKNOWN';
        const errorMsg = error.message || String(error);
        const detailedError = `${source.name}: ${errorCode} - ${errorMsg}`;
        errors.push(detailedError);
        
        // 记录详细错误
        logger.error('IP检测', `从 ${source.name} 获取IP失败: ${errorMsg} (错误码: ${errorCode})`).catch(() => {});
      }
    }

    if (results.length === 0) {
      const errorSummary = errors.join('; ');
      throw new Error(`所有IP检测源都失败: ${errorSummary}`);
    }

    // 返回出现次数最多的IP（多数投票）
    const ipCounts = new Map<string, number>();
    for (const ip of results) {
      ipCounts.set(ip, (ipCounts.get(ip) || 0) + 1);
    }

    let mostCommonIP = results[0];
    let maxCount = 0;

    for (const [ip, count] of ipCounts.entries()) {
      if (count > maxCount) {
        mostCommonIP = ip;
        maxCount = count;
      }
    }

    return mostCommonIP;
  }

  /**
   * 从指定源获取IP（带重试机制）
   */
  private async fetchIPFromSource(source: IPCheckSource, retries = 2): Promise<string> {
    let lastError: any;

    // 减少重试次数避免限流（从3次改为2次）
    for (let i = 0; i < retries; i++) {
      try {
        // 为特定源添加额外请求头
        const config: any = {};
        if (source.name === '淘宝IP接口') {
          config.headers = {
            'Referer': 'https://www.taobao.com/',
          };
        }
        const response = await this.axiosInstance.get(source.url, config);
        return source.parser(response.data);
      } catch (error: any) {
        lastError = error;
        
        // 记录详细的错误信息
        const errorCode = error.code || 'UNKNOWN';
        const syscall = error.syscall || '';
        const errnoDescription = error.errno || '';
        
        if (i < retries - 1) {
          // 指数退避：第1次等2秒
          const waitTime = 2000 * (i + 1);
          logger.warning(
            'IP检测',
            `${source.name} 请求失败 (${errorCode}${syscall ? '/' + syscall : ''}), ${(waitTime/1000)}秒后重试...`
          ).catch(() => {});
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        } else {
          // 最后一次失败，记录详细信息
          logger.error(
            'IP检测',
            `${source.name} 所有重试均失败 - 错误码: ${errorCode}, Syscall: ${syscall}, Errno: ${errnoDescription}`
          ).catch(() => {});
        }
      }
    }

    throw lastError;
  }

  /**
   * 验证IP地址格式
   */
  private isValidIP(ip: string): boolean {
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
  }

  /**
   * 获取当前IP
   */
  getCurrentIPSync(): string {
    return this.currentIP;
  }

  /**
   * 获取上一次的IP
   */
  getPreviousIP(): string {
    return this.previousIP;
  }

  /**
   * 检查是否正在运行
   */
  isMonitoring(): boolean {
    return this.isRunning;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<IPMonitorConfig>): void {
    this.config = { ...this.config, ...config };

    // 如果正在运行且间隔时间改变，重启监控
    if (this.isRunning && config.checkInterval) {
      this.stop();
      this.start();
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): IPMonitorConfig {
    return { ...this.config };
  }
}

// 导出单例
export const ipMonitor = new IPMonitor();
