import { BrowserWindow, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import * as os from 'os';
import { exec } from 'child_process';
import { logger } from './logger';
import { configService } from './config-service';
import { backupService } from './backup-service';

/**
 * 自定义更新服务 - API 版本
 * 
 * 改进点：
 * 1. 使用 RESTful API 而非静态文件
 * 2. 支持灰度发布控制
 * 3. 自动上报统计数据
 * 4. 更丰富的版本信息
 */
class CustomUpdaterAPI {
  private mainWindow: BrowserWindow | null = null;
  private isChecking = false;
  private isDownloading = false;
  
  // API 服务器地址（不再是静态文件路径）
  private updateServerUrls = [
    'http://shcrystal.top:8123',      // 主服务器 API
    'http://192.168.1.164:8123',      // 备用服务器 API
  ];
  
  private downloadedFilePath: string | null = null;
  private latestVersionInfo: any = null; // 保存版本信息用于统计上报
  private periodicCheckTimer: NodeJS.Timeout | null = null;
  private lastCheckTime: number = 0;
  private downloadRetryCount = 0;
  private maxRetries = 3;
  private userId: string | null = null; // 缓存用户ID

  /**
   * 设置主窗口引用
   */
  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
    this.startPeriodicCheck();
  }

  /**
   * 获取机器唯一标识
   */
  private async getUserId(): Promise<string> {
    // 如果已缓存，直接返回
    if (this.userId) {
      return this.userId;
    }

    try {
      // 使用机器名 + MAC 地址生成唯一标识
      const hostname = os.hostname();
      const networkInterfaces = os.networkInterfaces();
      
      let macAddress = '';
      for (const name of Object.keys(networkInterfaces)) {
        const iface = networkInterfaces[name];
        if (iface) {
          for (const item of iface) {
            if (!item.internal && item.mac && item.mac !== '00:00:00:00:00:00') {
              macAddress = item.mac;
              break;
            }
          }
        }
        if (macAddress) break;
      }
      
      // 生成唯一标识（哈希保护隐私）
      const identifier = `${hostname}-${macAddress}`;
      const hash = crypto.createHash('sha256').update(identifier).digest('hex');
      
      this.userId = hash.substring(0, 32); // 返回32位ID
      return this.userId;
    } catch (error) {
      // 降级：使用随机ID
      this.userId = crypto.randomBytes(16).toString('hex');
      return this.userId;
    }
  }

  /**
   * 启动定期检查更新
   */
  async startPeriodicCheck() {
    if (this.periodicCheckTimer) {
      clearInterval(this.periodicCheckTimer);
    }

    const updateConfig = await configService.getConfig('update');
    const autoCheck = updateConfig?.autoCheck !== false;
    const checkFrequency = updateConfig?.checkFrequency || 'daily';

    if (!autoCheck || checkFrequency === 'manual') {
      await logger.info('自动更新', '定期检查已禁用');
      return;
    }

    const intervals: Record<string, number> = {
      daily: 24 * 60 * 60 * 1000,
      weekly: 7 * 24 * 60 * 60 * 1000,
    };
    const interval = intervals[checkFrequency] || intervals.daily;

    await logger.info('自动更新', `启动定期检查，间隔: ${checkFrequency}`, { interval });

    this.periodicCheckTimer = setInterval(async () => {
      const now = Date.now();
      if (now - this.lastCheckTime > 60 * 60 * 1000) {
        await logger.info('自动更新', '执行定期检查更新');
        await this.checkForUpdates(false);
        this.lastCheckTime = now;
      }
    }, interval);
  }

  /**
   * 停止定期检查
   */
  stopPeriodicCheck() {
    if (this.periodicCheckTimer) {
      clearInterval(this.periodicCheckTimer);
      this.periodicCheckTimer = null;
      logger.info('自动更新', '定期检查已停止').catch(() => {});
    }
  }

  /**
   * 向窗口发送消息
   */
  private sendMessage(event: string, data?: any) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('updater-message', { event, data });
    }
  }

  /**
   * 检查更新
   */
  async checkForUpdates(showNoUpdateMessage = true): Promise<{
    success: boolean;
    message?: string;
    hasUpdate?: boolean;
    currentVersion?: string;
    latestVersion?: string;
  }> {
    if (this.isChecking) {
      return {
        success: false,
        message: '正在检查更新中，请稍候',
        hasUpdate: false,
      };
    }

    this.isChecking = true;
    this.sendMessage('checking-for-update');

    try {
      const currentVersion = app.getVersion();

      // 请求服务器获取最新版本信息（通过 API）
      const versionInfo = await this.fetchVersionInfo();

      if (!versionInfo) {
        throw new Error('无法获取版本信息');
      }

      // 保存版本信息用于后续统计上报
      this.latestVersionInfo = versionInfo;

      const latestVersion = versionInfo.version;

      // 检查是否被灰度阻止
      if (versionInfo.rolloutBlocked) {
        logger.info('自动更新', '新版本发布中，您的设备暂未进入更新名单', {
          currentVersion,
          latestVersion,
          rolloutPercentage: versionInfo.rolloutPercentage || 0,
        });
        
        this.sendMessage('update-available', versionInfo);
        
        if (showNoUpdateMessage) {
          this.sendMessage('show-update-dialog', {
            type: 'rollout-blocked',
            version: latestVersion,
            currentVersion,
            rolloutPercentage: versionInfo.rolloutPercentage || 0,
          });
        }

        this.isChecking = false;
        return {
          success: true,
          message: '新版本发布中，您的设备暂未进入更新名单',
          hasUpdate: true,
          currentVersion,
          latestVersion,
        };
      }

      // 比较版本号
      if (this.compareVersions(currentVersion, latestVersion) >= 0) {
        logger.info('自动更新', '当前已是最新版本', { currentVersion });
        this.sendMessage('update-not-available', { version: currentVersion });

        if (showNoUpdateMessage) {
          this.sendMessage('show-update-dialog', {
            type: 'no-update',
            version: currentVersion,
          });
        }

        this.isChecking = false;
        return {
          success: true,
          message: '当前已是最新版本',
          hasUpdate: false,
          currentVersion,
          latestVersion,
        };
      }

      // 发现新版本
      logger.info('自动更新', '发现新版本', { currentVersion, latestVersion });
      this.sendMessage('update-available', versionInfo);
      this.sendMessage('show-update-dialog', {
        type: 'update-available',
        version: latestVersion,
        currentVersion,
        changelog: versionInfo.changelog || [],
        releaseDate: versionInfo.releaseDate || '',
        isMandatory: versionInfo.mandatory || false,
      });

      this.isChecking = false;
      return {
        success: true,
        message: `发现新版本 v${latestVersion}`,
        hasUpdate: true,
        currentVersion,
        latestVersion,
      };
    } catch (error: any) {
      logger.error('自动更新', '检查更新失败', { error: error.message });
      this.sendMessage('update-error', error.message);

      if (showNoUpdateMessage) {
        this.sendMessage('show-update-dialog', {
          type: 'update-error',
          message: error.message,
        });
      }

      this.isChecking = false;
      return {
        success: false,
        message: error.message,
        hasUpdate: false,
      };
    }
  }

  /**
   * 从服务器获取版本信息（支持多个服务器地址，自动尝试备用地址）
   */
  private async fetchVersionInfo(): Promise<any> {
    let lastError: Error | null = null;

    for (const serverUrl of this.updateServerUrls) {
      try {
        const versionInfo = await this.fetchFromServer(serverUrl);
        logger.info('自动更新', `从服务器获取版本信息成功: ${serverUrl}`);
        return versionInfo;
      } catch (error: any) {
        logger.warning('自动更新', `服务器 ${serverUrl} 访问失败: ${error.message}`);
        lastError = error;
      }
    }

    throw lastError || new Error('所有更新服务器均无法访问');
  }

  /**
   * 从 API 服务器获取版本信息
   */
  private async fetchFromServer(serverUrl: string): Promise<any> {
    const currentVersion = app.getVersion();
    const platform = process.platform;
    const arch = process.arch;
    const userId = await this.getUserId();
    
    // API 端点
    const apiUrl = `${serverUrl}/api/v1/updates/check`;
    
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        current_version: currentVersion,
        platform: platform,
        arch: arch,
        user_id: userId,
        channel: 'stable' // stable/beta/alpha
      });
      
      const parsedUrl = new URL(apiUrl);
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': `USG-NAT-Manager/${currentVersion}`
        },
        timeout: 10000
      };
      
      const client = parsedUrl.protocol === 'https:' ? https : http;
      
      const req = client.request(options, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`服务器返回错误: ${res.statusCode}`));
          return;
        }
        
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const jsonData = JSON.parse(data);
            
            // 验证响应格式
            if (!jsonData.success || !jsonData.data) {
              reject(new Error('响应格式错误'));
              return;
            }

            // 如果没有更新
            if (!jsonData.data.has_update) {
              resolve({
                version: currentVersion,
                hasUpdate: false,
              });
              return;
            }
            
            // 转换为内部格式
            const versionInfo = {
              version: jsonData.data.latest_version,
              releaseDate: jsonData.data.release_date,
              downloadUrl: jsonData.data.download_url,
              sha256: jsonData.data.file_hash,
              fileSize: jsonData.data.file_size,
              mandatory: jsonData.data.is_mandatory || false,
              changelog: jsonData.data.changelog || [],
              rolloutBlocked: jsonData.data.rollout_blocked || false,
              rolloutPercentage: jsonData.data.rollout_percentage || 100,
              minimumVersion: jsonData.data.minimum_version || '1.0.0',
              _serverUrl: serverUrl // 保存服务器地址用于后续下载
            };
            
            resolve(versionInfo);
          } catch (error) {
            reject(new Error('解析版本信息失败'));
          }
        });
      });
      
      req.on('error', (error) => {
        reject(error);
      });
      
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('请求超时'));
      });
      
      req.write(postData);
      req.end();
    });
  }

  /**
   * 下载更新（支持重试和完整性校验）
   */
  async downloadUpdate(): Promise<void> {
    if (this.isDownloading) {
      throw new Error('正在下载中，请稍候');
    }

    if (!this.latestVersionInfo) {
      throw new Error('版本信息不存在');
    }

    this.isDownloading = true;
    this.downloadRetryCount = 0;

    try {
      // 上报下载开始
      await this.reportDownloadStats('started');
      
      await this.downloadUpdateWithRetry();
      
      // 上报下载成功
      await this.reportDownloadStats('completed');
    } catch (error: any) {
      // 上报下载失败
      await this.reportDownloadStats('failed', error.message);
      
      this.isDownloading = false;
      throw error;
    }

    this.isDownloading = false;
  }

  /**
   * 带重试机制的下载
   */
  private async downloadUpdateWithRetry(): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.info('自动更新', `开始下载更新 (尝试 ${attempt}/${this.maxRetries})`);

        const versionInfo = this.latestVersionInfo;
        if (!versionInfo || !versionInfo.downloadUrl) {
          throw new Error('无法获取下载地址');
        }

        // 使用保存的服务器地址
        const serverUrl = versionInfo._serverUrl || this.updateServerUrls[0];
        const downloadUrl = `${serverUrl}${versionInfo.downloadUrl}`;
        const tempDir = app.getPath('temp');
        const fileName = path.basename(versionInfo.downloadUrl);
        const filePath = path.join(tempDir, fileName);

        await this.downloadFile(downloadUrl, filePath);

        // SHA-256 完整性校验
        if (versionInfo.sha256) {
          logger.info('自动更新', '正在校验文件完整性...');
          const fileHash = await this.calculateSHA256(filePath);
          
          if (fileHash.toLowerCase() !== versionInfo.sha256.toLowerCase()) {
            fs.unlinkSync(filePath);
            throw new Error('文件校验失败，SHA256不匹配');
          }
          
          logger.success('自动更新', '文件完整性校验通过');
        }

        this.downloadedFilePath = filePath;
        logger.success('自动更新', '更新下载完成', { filePath });

        this.sendMessage('update-downloaded', versionInfo);
        this.sendMessage('show-update-dialog', {
          type: 'update-downloaded',
          version: versionInfo.version,
        });

        return;
      } catch (error: any) {
        lastError = error;
        logger.error('自动更新', `下载失败 (尝试 ${attempt}/${this.maxRetries})`, {
          error: error.message,
        });

        if (attempt < this.maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          logger.info('自动更新', `${delay}ms 后重试...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    logger.error('自动更新', `下载失败，已重试 ${this.maxRetries} 次`);
    this.sendMessage('show-update-dialog', {
      type: 'download-error',
      message: lastError?.message || '下载失败',
    });
    throw lastError || new Error('下载失败');
  }

  /**
   * 计算文件 SHA256
   */
  private calculateSHA256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (chunk) => {
        hash.update(chunk);
      });

      stream.on('end', () => {
        resolve(hash.digest('hex'));
      });

      stream.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * 下载文件
   */
  private downloadFile(url: string, filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const file = fs.createWriteStream(filePath);

      const req = client.get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`下载失败: ${res.statusCode}`));
          return;
        }

        const totalSize = parseInt(res.headers['content-length'] || '0', 10);
        let downloadedSize = 0;

        res.on('data', (chunk) => {
          downloadedSize += chunk.length;
          file.write(chunk);

          if (totalSize > 0) {
            const percent = (downloadedSize / totalSize) * 100;
            this.sendMessage('download-progress', {
              percent,
              transferred: downloadedSize,
              total: totalSize,
            });
          }
        });

        res.on('end', () => {
          file.end();
          resolve();
        });
      });

      req.on('error', (error) => {
        file.close();
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        reject(error);
      });

      req.setTimeout(300000, () => {
        req.destroy();
        file.close();
        reject(new Error('下载超时'));
      });
    });
  }

  /**
   * 退出并安装（安装前自动备份）
   */
  async quitAndInstall(): Promise<void> {
    if (!this.downloadedFilePath || !fs.existsSync(this.downloadedFilePath)) {
      await logger.error('自动更新', '安装失败：找不到安装包');
      throw new Error('找不到安装包');
    }

    try {
      // 上报安装开始
      await this.reportInstallStats('started');
      
      // 安装前自动创建备份
      await logger.info('自动更新', '正在创建更新前备份...');
      const currentVersion = this.getCurrentVersion();
      const backupInfo = await backupService.createBackup(
        `更新前自动备份 (v${currentVersion})`
      );

      await logger.success('自动更新', '备份创建成功', {
        filename: backupInfo.filename,
        backupId: backupInfo.id,
      });
    } catch (error: any) {
      await logger.warning('自动更新', '备份创建失败，但将继续安装', {
        error: error.message,
      });
    }

    await logger.info('自动更新', '开始安装更新', { path: this.downloadedFilePath });

    exec(`"${this.downloadedFilePath}"`, (error) => {
      if (error) {
        logger.error('自动更新', '启动安装程序失败', { error: error.message });
        // 上报安装失败
        this.reportInstallStats('failed', error.message).catch(() => {});
      }
    });

    setTimeout(() => {
      app.quit();
    }, 500);
  }

  /**
   * 上报下载统计
   */
  private async reportDownloadStats(status: string, errorMessage?: string): Promise<void> {
    try {
      const versionInfo = this.latestVersionInfo;
      if (!versionInfo) return;
      
      const userId = await this.getUserId();
      const currentVersion = this.getCurrentVersion();
      
      const statsData = {
        user_id: userId,
        version: versionInfo.version,
        from_version: currentVersion,
        platform: process.platform,
        arch: process.arch,
        status: status,
        error_message: errorMessage || null,
      };
      
      // 发送到所有可用服务器
      for (const serverUrl of this.updateServerUrls) {
        try {
          await this.sendStats(`${serverUrl}/api/v1/updates/stats/download`, statsData);
          break; // 成功则退出
        } catch (err) {
          // 继续尝试下一个服务器
        }
      }
    } catch (error) {
      // 统计上报失败不影响主流程
      console.error('上报下载统计失败:', error);
    }
  }

  /**
   * 上报安装统计
   */
  private async reportInstallStats(status: string, errorMessage?: string): Promise<void> {
    try {
      const versionInfo = this.latestVersionInfo;
      if (!versionInfo) return;
      
      const userId = await this.getUserId();
      const currentVersion = this.getCurrentVersion();
      
      const statsData = {
        user_id: userId,
        from_version: currentVersion,
        to_version: versionInfo.version,
        platform: process.platform,
        arch: process.arch,
        status: status,
        error_message: errorMessage || null,
      };
      
      for (const serverUrl of this.updateServerUrls) {
        try {
          await this.sendStats(`${serverUrl}/api/v1/updates/stats/install`, statsData);
          break;
        } catch (err) {
          // 继续尝试
        }
      }
    } catch (error) {
      console.error('上报安装统计失败:', error);
    }
  }

  /**
   * 发送统计数据
   */
  private sendStats(url: string, data: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(data);
      const parsedUrl = new URL(url);
      
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: 5000
      };
      
      const client = parsedUrl.protocol === 'https:' ? https : http;
      
      const req = client.request(options, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
        // 消费响应数据
        res.on('data', () => {});
      });
      
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
      
      req.write(postData);
      req.end();
    });
  }

  /**
   * 比较版本号
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    const maxLength = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < maxLength; i++) {
      const num1 = parts1[i] || 0;
      const num2 = parts2[i] || 0;
      if (num1 > num2) return 1;
      if (num1 < num2) return -1;
    }
    return 0;
  }

  /**
   * 获取当前版本
   */
  getCurrentVersion(): string {
    return app.getVersion();
  }
}

export const customUpdater = new CustomUpdaterAPI();

