import { BrowserWindow, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import * as os from 'os';
import { spawn } from 'child_process';
import { logger } from './logger';
import { configService } from './config-service';
import { backupService } from './backup-service';

/**
 * 自定义更新服务
 * 
 * 使用 RESTful API 获取版本信息
 */
class CustomUpdater {
  private mainWindow: BrowserWindow | null = null;
  private isChecking = false;
  private isDownloading = false;
  
  // API 服务器地址
  // 注意：仅使用公网可访问的服务器地址
  // 如需配置备用服务器，请添加公网域名或IP，不要使用内网地址（如 192.168.x.x）
  private updateServerUrls = [
    'http://shcrystal.top:8123',      // 主服务器
    // 备用服务器示例（请替换为实际的公网地址）：
    // 'https://update-backup.yourdomain.com',
    // 'https://cdn.example.com/updates',
  ];
  
  private downloadedFilePath: string | null = null;
  private latestVersionInfo: any = null;
  private periodicCheckTimer: NodeJS.Timeout | null = null;
  private lastCheckTime: number = 0;
  private downloadRetryCount = 0;
  private maxRetries = 3;

  /**
   * 设置主窗口引用
   */
  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
    // 延迟启动定期检查，避免影响应用启动速度
    setTimeout(() => {
      this.startPeriodicCheck().catch((error) => {
        logger.error('自动更新', '启动定期检查失败', { error: error.message }).catch(() => {});
      });
    }, 1000);
  }

  /**
   * 启动定期检查更新
   */
  async startPeriodicCheck() {
    if (this.periodicCheckTimer) {
      clearInterval(this.periodicCheckTimer);
      this.periodicCheckTimer = null;
    }

    const updateConfig = await configService.getConfig('update');
    const autoCheck = updateConfig?.autoCheck !== false;
    const checkFrequency = updateConfig?.checkFrequency || 'daily';

    if (!autoCheck || checkFrequency === 'manual') {
      await logger.info('自动更新', '定期检查已禁用');
      this.lastCheckTime = 0; // 重置检查时间，以便下次启用时能立即检查
      return;
    }

    const intervals: Record<string, number> = {
      daily: 24 * 60 * 60 * 1000,
      weekly: 7 * 24 * 60 * 60 * 1000,
    };
    const interval = intervals[checkFrequency] || intervals.daily;

    await logger.info('自动更新', `启动定期检查，间隔: ${checkFrequency}`, { interval });

    // 计算下次检查时间（如果从未检查过，则立即检查）
    const now = Date.now();
    const timeSinceLastCheck = this.lastCheckTime === 0 ? interval : (now - this.lastCheckTime);
    const shouldCheckNow = this.lastCheckTime === 0 || timeSinceLastCheck >= interval;

    // 如果应该立即检查，则执行一次检查
    if (shouldCheckNow) {
      await logger.info('自动更新', '执行初始/定期检查更新');
      await this.checkForUpdates(false);
      this.lastCheckTime = now;
    } else {
      // 计算距离下次检查的剩余时间
      const timeUntilNextCheck = interval - timeSinceLastCheck;
      await logger.info('自动更新', `距离下次检查还有 ${Math.round(timeUntilNextCheck / 1000 / 60)} 分钟`);
    }

    // 使用最小检查间隔（1小时）作为定时器间隔，避免长时间等待
    // 在定时器回调中检查是否到了真正的检查时间
    const minCheckInterval = 60 * 60 * 1000; // 1小时
    this.periodicCheckTimer = setInterval(async () => {
      const currentTime = Date.now();
      const timeSinceLastCheck = currentTime - this.lastCheckTime;
      
      // 如果距离上次检查已经超过配置的间隔时间，则执行检查
      if (timeSinceLastCheck >= interval) {
        await logger.info('自动更新', '执行定期检查更新');
        await this.checkForUpdates(false);
        this.lastCheckTime = currentTime;
      }
    }, minCheckInterval);
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
      const message = data !== undefined ? { event, data } : { event };
      this.mainWindow.webContents.send('updater-message', message);
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

      this.latestVersionInfo = versionInfo;

      const latestVersion = versionInfo.version;

      // 比较版本号
      if (this.compareVersions(currentVersion, latestVersion) >= 0) {
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
    
    // API 端点
    const apiUrl = `${serverUrl}/api/versions/latest`;
    
    // 调试日志
    logger.info('自动更新', `请求更新服务器: ${apiUrl}`, {
      method: 'GET',
      currentVersion
    });
    
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(apiUrl);
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname,
        method: 'GET',
        headers: {
          'User-Agent': `USG-NAT-Manager/${currentVersion}`
        },
        timeout: 10000
      };
      
      const client = parsedUrl.protocol === 'https:' ? https : http;
      
      const req = client.request(options, (res) => {
        if (res.statusCode !== 200) {
          logger.error('自动更新', `HTTP错误: ${res.statusCode}`, {
            url: apiUrl,
            statusCode: res.statusCode,
            statusMessage: res.statusMessage
          });
          reject(new Error(`服务器返回错误: ${res.statusCode}`));
          return;
        }
        
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const versionInfo = JSON.parse(data);
            
            // 保存服务器地址用于后续下载
            versionInfo._serverUrl = serverUrl;
            
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
      await this.downloadUpdateWithRetry();
    } catch (error: any) {
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

        // 构建下载地址
        let downloadUrl: string;
        if (versionInfo.downloadUrl.startsWith('http://') || versionInfo.downloadUrl.startsWith('https://')) {
          // 完整 URL，直接使用
          downloadUrl = versionInfo.downloadUrl;
        } else {
          // 相对路径，拼接服务器地址
          const serverUrl = versionInfo._serverUrl || this.updateServerUrls[0];
          downloadUrl = `${serverUrl}${versionInfo.downloadUrl}`;
        }
        
        const tempDir = app.getPath('temp');
        // 使用版本号构建文件名，确保有正确的扩展名
        const fileName = `USG-NAT-Manager-Setup-${versionInfo.version}.exe`;
        const filePath = path.join(tempDir, fileName);

        await this.downloadFile(downloadUrl, filePath);

        // 验证文件是否存在
        if (!fs.existsSync(filePath)) {
          throw new Error('下载完成但文件不存在');
        }

        // 验证文件大小
        const fileStats = fs.statSync(filePath);
        if (fileStats.size === 0) {
          fs.unlinkSync(filePath);
          throw new Error('下载的文件大小为0');
        }

        logger.info('自动更新', '文件下载完成', {
          size: `${(fileStats.size / 1024 / 1024).toFixed(2)} MB`,
        });

        // SHA-256 完整性校验
        if (versionInfo.sha256) {
          logger.info('自动更新', '正在校验文件完整性...');
          const fileHash = await this.calculateSHA256(filePath);
          
          if (fileHash.toLowerCase() !== versionInfo.sha256.toLowerCase()) {
            // 确保删除前文件未被占用
            await new Promise(resolve => setTimeout(resolve, 100));
            try {
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.warning('自动更新', '删除校验失败的文件失败', { path: filePath });
            }
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
   * 下载文件（支持重定向和完整的错误处理）
   */
  private downloadFile(url: string, filePath: string, redirectCount = 0): Promise<void> {
    const maxRedirects = 5;
    
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const file = fs.createWriteStream(filePath);
      let isResolved = false;

      const cleanup = () => {
        try {
          file.close();
          // 等待文件流完全关闭后再删除
          setTimeout(() => {
            if (fs.existsSync(filePath)) {
              try {
                fs.unlinkSync(filePath);
              } catch (err) {
                logger.warning('自动更新', '清理临时文件失败', { path: filePath });
              }
            }
          }, 100);
        } catch (err) {
          // 忽略关闭错误
        }
      };

      const req = client.get(url, (res) => {
        // 处理重定向
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          const redirectLocation = res.headers.location;
          if (!redirectLocation) {
            cleanup();
            reject(new Error('重定向缺少 location 头'));
            return;
          }

          if (redirectCount >= maxRedirects) {
            cleanup();
            reject(new Error('重定向次数超过限制'));
            return;
          }

          // 将相对路径转换为绝对URL
          let redirectUrl: string;
          try {
            // 如果已经是完整URL，直接使用
            if (redirectLocation.startsWith('http://') || redirectLocation.startsWith('https://')) {
              redirectUrl = redirectLocation;
            } else {
              // 相对路径，基于当前URL解析为绝对URL
              const baseUrl = new URL(url);
              redirectUrl = new URL(redirectLocation, baseUrl).href;
            }
          } catch (error: any) {
            cleanup();
            reject(new Error(`解析重定向URL失败: ${error.message}`));
            return;
          }

          logger.info('自动更新', `跟随重定向 (${redirectCount + 1}/${maxRedirects})`, {
            from: url,
            to: redirectUrl,
          });

          file.close();
          // 递归处理重定向
          this.downloadFile(redirectUrl, filePath, redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          cleanup();
          reject(new Error(`下载失败: HTTP ${res.statusCode}`));
          return;
        }

        const totalSize = parseInt(res.headers['content-length'] || '0', 10);
        let downloadedSize = 0;

        res.on('data', (chunk) => {
          downloadedSize += chunk.length;
          
          if (!file.write(chunk)) {
            // 背压处理：暂停读取直到缓冲区排空
            res.pause();
            file.once('drain', () => {
              res.resume();
            });
          }

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
          if (!isResolved) {
            isResolved = true;
            file.end(() => {
              resolve();
            });
          }
        });

        res.on('error', (error) => {
          if (!isResolved) {
            isResolved = true;
            cleanup();
            reject(error);
          }
        });
      });

      req.on('error', (error) => {
        if (!isResolved) {
          isResolved = true;
          cleanup();
          reject(error);
        }
      });

      req.setTimeout(300000, () => {
        if (!isResolved) {
          isResolved = true;
          req.destroy();
          cleanup();
          reject(new Error('下载超时 (5分钟)'));
        }
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

    // 使用 spawn 替代 exec，更可靠地启动安装程序
    try {
      // 在 Windows 上，确保路径被正确处理
      const installerPath = this.downloadedFilePath;
      
      // 检查文件是否存在且可执行
      if (!fs.existsSync(installerPath)) {
        throw new Error(`安装程序文件不存在: ${installerPath}`);
      }

      const installer = spawn(installerPath, [], {
        detached: true,
        stdio: 'ignore',
        shell: true,
        windowsVerbatimArguments: false,
      });
      
      // 监听错误事件
      installer.on('error', (error) => {
        logger.error('自动更新', '安装程序启动错误', { error: error.message }).catch(() => {});
      });
      
      installer.unref(); // 允许父进程退出
      
      await logger.success('自动更新', '安装程序已启动', { path: installerPath });
      
      // 等待一小段时间确保安装程序启动
      setTimeout(() => {
        app.quit();
      }, 1000);
    } catch (error: any) {
      await logger.error('自动更新', '启动安装程序失败', { error: error.message });
      throw new Error(`启动安装程序失败: ${error.message}`);
    }
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

  /**
   * 清理临时目录中的旧安装包
   */
  async cleanupOldInstallers(): Promise<void> {
    try {
      const tempDir = app.getPath('temp');
      const files = fs.readdirSync(tempDir);
      
      const installerPatterns = [
        /^USG-NAT-Manager-Setup-[\d.]+\.exe$/,
        /^USG-NAT-Manager-Portable-[\d.]+\.exe$/,
      ];
      
      let cleanedCount = 0;
      
      for (const file of files) {
        const isInstaller = installerPatterns.some(pattern => pattern.test(file));
        
        if (isInstaller) {
          const filePath = path.join(tempDir, file);
          try {
            fs.unlinkSync(filePath);
            cleanedCount++;
            await logger.info('自动更新', `已清理旧安装包: ${file}`);
          } catch (error: any) {
            // 文件可能正在使用或无权限删除，忽略错误
            await logger.warning('自动更新', `清理安装包失败: ${file}`, {
              error: error.message,
            });
          }
        }
      }
      
      if (cleanedCount > 0) {
        await logger.success('自动更新', `清理完成，共删除 ${cleanedCount} 个旧安装包`);
      }
    } catch (error: any) {
      await logger.error('自动更新', '清理旧安装包失败', { error: error.message });
    }
  }
}

export const customUpdater = new CustomUpdater();

