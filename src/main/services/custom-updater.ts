import { BrowserWindow, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import { URL } from 'node:url';
import { isDevMode } from '../runtime-mode';
import { logger } from './logger';
import { configService } from './config-service';
import { backupService } from './backup-service';
import {
  areUpdateArtifactsEqual,
  assertDownloadWithinExpectedSize,
  assertExpectedUpdateArtifact,
  assertSecureUpdateServerUrl,
  assertSafeUpdateRedirect,
  assertUpdateOperationAllowed,
  assertUpdaterPlatformSupported,
  buildLatestVersionApiUrl,
  closeAndDeleteFile,
  compareVersions,
  createInstallerLaunchArgs,
  createDownloadProgressReporter,
  createSetupInstallerFileName,
  ensureUpdateBackup,
  getUpdateCheckIntervalMs,
  initializeUpdater,
  isUpdateMandatory,
  isUpdatedLaunch,
  parseVerifiedUpdateVersionInfo,
  parseUpdateServerUrls,
  readUpdateManifestResponse,
  resolveDownloadedInstaller,
  resolveUpdateAssetUrl,
  runDownloadOperation,
  runPeriodicUpdateCheck,
  validateDownloadedUpdate,
  waitForInstallerSpawn,
  withUnverifiedDownloadCleanup,
  type UpdateOperationState,
  type UpdateVersionInfo,
  UPDATE_SIGNING_PUBLIC_KEY,
} from './custom-updater-helpers';

type UpdateConfig = {
  autoCheck?: boolean;
  checkFrequency?: string;
};

type UpdateDialogPayload = {
  type:
    | 'no-update'
    | 'update-available'
    | 'update-downloading'
    | 'update-downloaded'
    | 'update-installed'
    | 'update-error'
    | 'download-error';
  version?: string;
  currentVersion?: string;
  changelog?: UpdateVersionInfo['changelog'];
  releaseDate?: string;
  message?: string;
  isMandatory?: boolean;
  policySignature?: string;
};

type UpdaterMessage = {
  event: string;
  data?: unknown;
};

type AppWithQuitState = typeof app & {
  isQuitting?: boolean;
};

type MandatoryUpdateStateHandler = (required: boolean) => void | Promise<void>;

const MAX_UPDATE_MANIFEST_BYTES = 1024 * 1024;
const DEFAULT_UPDATE_SERVER_URLS = ['https://updates.shcrystal.top'];

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * 自定义更新服务
 *
 * 使用 RESTful API 获取版本信息
 */
class CustomUpdater {
  private mainWindow: BrowserWindow | null = null;
  private operationState: UpdateOperationState = 'idle';
  private currentDialogMessage: UpdaterMessage | null = null;

  private updateServerUrls = parseUpdateServerUrls(
    process.env.USG_UPDATE_SERVER_URLS,
    DEFAULT_UPDATE_SERVER_URLS
  );

  private downloadedFilePath: string | null = null;
  private downloadedVersionInfo: UpdateVersionInfo | null = null;
  private downloadDirectoryPath: string | null = null;
  private latestVersionInfo: UpdateVersionInfo | null = null;
  private periodicCheckTimer: ReturnType<typeof setInterval> | null = null;
  private lastCheckTime: number = 0;
  private readonly maxRetries = 3;
  private mandatoryUpdateStateHandler: MandatoryUpdateStateHandler | null = null;

  /**
   * 设置主窗口引用
   */
  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
    if (isUpdatedLaunch(process.argv)) {
      window.webContents.once('did-finish-load', () => {
        this.showDialog({
          type: 'update-installed',
          version: app.getVersion(),
        });
        logger.success('自动更新', '新版已成功启动', { version: app.getVersion() }).catch(() => {});
      });
    }

    // 延迟启动定期检查，避免影响应用启动速度
    setTimeout(() => {
      initializeUpdater(
        () => this.cleanupOldInstallers(),
        () => this.startPeriodicCheck()
      ).catch((error: unknown) => {
        logger
          .error('自动更新', '初始化更新服务失败', { error: getErrorMessage(error) })
          .catch(() => {});
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

    if (isDevMode()) {
      await logger.info('自动更新', '开发环境跳过自动更新');
      return;
    }

    const updateConfig = (await configService.getConfig<UpdateConfig>('update')) ?? {};
    const autoCheck = updateConfig?.autoCheck !== false;
    const checkFrequency = updateConfig?.checkFrequency || 'daily';

    if (!autoCheck || checkFrequency === 'manual') {
      await logger.info('自动更新', '定期检查已禁用');
      this.lastCheckTime = 0; // 重置检查时间，以便下次启用时能立即检查
      return;
    }

    const interval = getUpdateCheckIntervalMs(checkFrequency);

    await logger.info('自动更新', `启动定期检查，间隔: ${checkFrequency}`, { interval });

    // 计算下次检查时间（如果从未检查过，则立即检查）
    const now = Date.now();
    const timeSinceLastCheck = this.lastCheckTime === 0 ? interval : now - this.lastCheckTime;
    const shouldCheckNow = this.lastCheckTime === 0 || timeSinceLastCheck >= interval;

    // 如果应该立即检查，则执行一次检查
    if (shouldCheckNow) {
      await logger.info('自动更新', '执行初始/定期检查更新');
      const checkSucceeded = await runPeriodicUpdateCheck((showNoUpdateMessage) =>
        this.checkForUpdates(showNoUpdateMessage)
      );
      if (checkSucceeded) {
        this.lastCheckTime = Date.now();
      }
    } else {
      // 计算距离下次检查的剩余时间
      const timeUntilNextCheck = interval - timeSinceLastCheck;
      await logger.info(
        '自动更新',
        `距离下次检查还有 ${Math.round(timeUntilNextCheck / 1000 / 60)} 分钟`
      );
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
        const checkSucceeded = await runPeriodicUpdateCheck((showNoUpdateMessage) =>
          this.checkForUpdates(showNoUpdateMessage)
        );
        if (checkSucceeded) {
          this.lastCheckTime = Date.now();
        }
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
  private sendMessage(event: string, data?: unknown) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const message = data !== undefined ? { event, data } : { event };
      this.mainWindow.webContents.send('updater-message', message);
    }
  }

  private showDialog(data: UpdateDialogPayload): void {
    this.currentDialogMessage = { event: 'show-update-dialog', data };
    this.sendMessage('show-update-dialog', data);
  }

  getCurrentState(): UpdaterMessage | null {
    return this.currentDialogMessage;
  }

  replayCurrentState(): void {
    if (this.currentDialogMessage) {
      this.sendMessage(this.currentDialogMessage.event, this.currentDialogMessage.data);
    }
  }

  setMandatoryUpdateStateHandler(handler: MandatoryUpdateStateHandler): void {
    this.mandatoryUpdateStateHandler = handler;
    void this.notifyMandatoryUpdateState();
  }

  isMandatoryUpdateRequired(): boolean {
    return this.latestVersionInfo?.mandatory === true;
  }

  quitApp(): void {
    (app as AppWithQuitState).isQuitting = true;
    app.quit();
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
    try {
      assertUpdateOperationAllowed(this.operationState, 'checking');
    } catch (error: unknown) {
      return {
        success: false,
        message: getErrorMessage(error),
        hasUpdate: false,
      };
    }

    this.operationState = 'checking';
    this.sendMessage('checking-for-update');

    try {
      assertUpdaterPlatformSupported(process.platform, process.env.PORTABLE_EXECUTABLE_FILE);
      const currentVersion = app.getVersion();

      // 请求服务器获取最新版本信息（通过 API）
      const versionInfo = await this.fetchVersionInfo();

      if (!versionInfo) {
        throw new Error('无法获取版本信息');
      }

      const latestVersion = versionInfo.version;
      versionInfo.mandatory = isUpdateMandatory(currentVersion, versionInfo);

      // 比较版本号
      if (compareVersions(currentVersion, latestVersion) >= 0) {
        this.discardDownloadedUpdate();
        this.latestVersionInfo = null;
        await this.notifyMandatoryUpdateState();
        this.currentDialogMessage = null;
        this.sendMessage('clear-update-dialog');
        this.sendMessage('update-not-available', { version: currentVersion });

        if (showNoUpdateMessage) {
          this.showDialog({
            type: 'no-update',
            version: currentVersion,
          });
        }

        return {
          success: true,
          message: '当前已是最新版本',
          hasUpdate: false,
          currentVersion,
          latestVersion,
        };
      }

      if (
        this.downloadedVersionInfo &&
        !areUpdateArtifactsEqual(this.downloadedVersionInfo, versionInfo)
      ) {
        this.discardDownloadedUpdate();
      }

      this.latestVersionInfo = versionInfo;
      await this.notifyMandatoryUpdateState();

      if (
        this.downloadedVersionInfo &&
        this.downloadedFilePath &&
        fs.existsSync(this.downloadedFilePath)
      ) {
        this.sendDownloadedUpdateMessage(this.downloadedVersionInfo);
        return {
          success: true,
          message: `新版本 v${latestVersion} 已下载，可立即安装`,
          hasUpdate: true,
          currentVersion,
          latestVersion,
        };
      }

      // 发现新版本
      logger.info('自动更新', '发现新版本', { currentVersion, latestVersion });
      this.sendMessage('update-available', versionInfo);
      this.showDialog({
        type: 'update-available',
        version: latestVersion,
        currentVersion,
        changelog: versionInfo.changelog || [],
        releaseDate: versionInfo.releaseDate || '',
        isMandatory: versionInfo.mandatory || false,
        policySignature: versionInfo.policySignature,
      });

      return {
        success: true,
        message: `发现新版本 v${latestVersion}`,
        hasUpdate: true,
        currentVersion,
        latestVersion,
      };
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      logger.error('自动更新', '检查更新失败', { error: errorMessage });
      this.sendMessage('update-error', errorMessage);

      if (showNoUpdateMessage && !this.isMandatoryUpdateRequired()) {
        this.showDialog({
          type: 'update-error',
          message: errorMessage,
        });
      } else if (this.isMandatoryUpdateRequired()) {
        this.replayCurrentState();
      }

      return {
        success: false,
        message: errorMessage,
        hasUpdate: false,
      };
    } finally {
      this.operationState = 'idle';
    }
  }

  /**
   * 从服务器获取版本信息（支持多个服务器地址，自动尝试备用地址）
   */
  private async fetchVersionInfo(): Promise<UpdateVersionInfo> {
    let lastError: Error | null = null;

    for (const serverUrl of this.updateServerUrls) {
      try {
        assertSecureUpdateServerUrl(serverUrl, isDevMode());
        const versionInfo = await this.fetchFromServer(serverUrl);
        logger.info('自动更新', `从服务器获取版本信息成功: ${serverUrl}`);
        return versionInfo;
      } catch (error: unknown) {
        logger.warning('自动更新', `服务器 ${serverUrl} 访问失败: ${getErrorMessage(error)}`);
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    throw lastError || new Error('所有更新服务器均无法访问');
  }

  /**
   * 从 API 服务器获取版本信息
   */
  private async fetchFromServer(serverUrl: string): Promise<UpdateVersionInfo> {
    const currentVersion = app.getVersion();

    // API 端点
    const apiUrl = buildLatestVersionApiUrl(serverUrl);

    // 调试日志
    logger.info('自动更新', `请求更新服务器: ${apiUrl}`, {
      method: 'GET',
      currentVersion,
    });

    return new Promise<UpdateVersionInfo>((resolve, reject) => {
      const parsedUrl = new URL(apiUrl);
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname,
        method: 'GET',
        headers: {
          'User-Agent': `USG-NAT-Manager/${currentVersion}`,
        },
        timeout: 10000,
      };

      const client = parsedUrl.protocol === 'https:' ? https : http;

      const req = client.request(options, (res) => {
        if (res.statusCode !== 200) {
          logger.error('自动更新', `HTTP错误: ${res.statusCode}`, {
            url: apiUrl,
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
          });
          res.once('error', () => {});
          res.resume();
          reject(new Error(`服务器返回错误: ${res.statusCode}`));
          return;
        }

        void readUpdateManifestResponse(res, MAX_UPDATE_MANIFEST_BYTES).then((data) => {
          try {
            const versionInfo = parseVerifiedUpdateVersionInfo(
              JSON.parse(data) as unknown,
              UPDATE_SIGNING_PUBLIC_KEY
            );

            // 保存服务器地址用于后续下载
            versionInfo._serverUrl = serverUrl;

            resolve(versionInfo);
          } catch {
            reject(new Error('解析版本信息失败'));
          }
        }, reject);
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
  async downloadUpdate(expectedVersion: string, expectedPolicySignature: string): Promise<void> {
    assertUpdateOperationAllowed(this.operationState, 'downloading');

    if (!this.latestVersionInfo) {
      throw new Error('版本信息不存在');
    }

    assertUpdaterPlatformSupported(process.platform, process.env.PORTABLE_EXECUTABLE_FILE);
    const versionInfo = this.latestVersionInfo;
    assertExpectedUpdateArtifact(expectedVersion, expectedPolicySignature, versionInfo);
    this.operationState = 'downloading';

    await runDownloadOperation(
      async () => {
        this.discardDownloadedUpdate();
        this.downloadDirectoryPath = fs.mkdtempSync(path.join(app.getPath('temp'), 'usg-update-'));
        if (versionInfo.mandatory) {
          this.showDialog({
            type: 'update-downloading',
            version: versionInfo.version,
            isMandatory: true,
            policySignature: versionInfo.policySignature,
          });
        }
        await this.downloadUpdateWithRetry(versionInfo);
      },
      (error) => {
        this.discardDownloadedUpdate();
        this.showDialog({
          type: 'download-error',
          message: getErrorMessage(error),
          version: versionInfo.version,
          isMandatory: versionInfo.mandatory || false,
          policySignature: versionInfo.policySignature,
        });
      },
      () => {
        this.operationState = 'idle';
      }
    );

    this.sendMessage('update-downloaded', versionInfo);
    this.sendDownloadedUpdateMessage(versionInfo);
  }

  /**
   * 带重试机制的下载
   */
  private async downloadUpdateWithRetry(versionInfo: UpdateVersionInfo): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.info('自动更新', `开始下载更新 (尝试 ${attempt}/${this.maxRetries})`);

        const fullFile = versionInfo.files.full;

        // 构建下载地址
        const serverUrl = versionInfo._serverUrl || this.updateServerUrls[0];
        assertSecureUpdateServerUrl(serverUrl, isDevMode());
        const downloadUrl = resolveUpdateAssetUrl(fullFile.url, serverUrl);
        assertSafeUpdateRedirect(serverUrl, downloadUrl);

        if (!this.downloadDirectoryPath) {
          throw new Error('更新下载目录不存在');
        }
        // 使用版本号构建文件名，确保有正确的扩展名
        const fileName = createSetupInstallerFileName(versionInfo.version);
        const filePath = path.join(this.downloadDirectoryPath, fileName);

        await withUnverifiedDownloadCleanup(filePath, async () => {
          await this.downloadFile(downloadUrl, filePath, fullFile.size);

          if (!fs.existsSync(filePath)) {
            throw new Error('下载完成但文件不存在');
          }

          const fileStats = fs.statSync(filePath);
          logger.info('自动更新', '文件下载完成', {
            size: `${(fileStats.size / 1024 / 1024).toFixed(2)} MB`,
          });

          logger.info('自动更新', '正在校验文件大小、SHA-256和数字签名...');
          const fileHash = await this.calculateSHA256(filePath);

          validateDownloadedUpdate(
            versionInfo.version,
            fullFile,
            fileStats.size,
            fileHash,
            UPDATE_SIGNING_PUBLIC_KEY
          );
        });

        logger.success('自动更新', '文件大小、SHA-256和数字签名校验通过');

        this.downloadedFilePath = filePath;
        this.downloadedVersionInfo = versionInfo;
        logger.success('自动更新', '更新下载完成', { filePath });

        return;
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.error('自动更新', `下载失败 (尝试 ${attempt}/${this.maxRetries})`, {
          error: getErrorMessage(error),
        });

        if (attempt < this.maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          logger.info('自动更新', `${delay}ms 后重试...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    logger.error('自动更新', `下载失败，已重试 ${this.maxRetries} 次`);
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
  private downloadFile(
    url: string,
    filePath: string,
    expectedSize: number,
    redirectCount = 0
  ): Promise<void> {
    const maxRedirects = 5;

    return new Promise((resolve, reject) => {
      assertSafeUpdateRedirect(url, url);
      const client = url.startsWith('https') ? https : http;
      const file = fs.createWriteStream(filePath);
      let isSettled = false;
      let request: http.ClientRequest | null = null;
      let response: http.IncomingMessage | null = null;

      const fail = (error: unknown) => {
        if (isSettled) {
          return;
        }

        isSettled = true;
        response?.destroy();
        request?.destroy();
        closeAndDeleteFile(file, filePath)
          .then(() => reject(error))
          .catch(reject);
      };

      file.once('error', fail);

      request = client.get(url, (res) => {
        response = res;

        // 处理重定向
        if (
          res.statusCode === 301 ||
          res.statusCode === 302 ||
          res.statusCode === 307 ||
          res.statusCode === 308
        ) {
          const redirectLocation = res.headers.location;
          if (!redirectLocation) {
            res.resume();
            fail(new Error('重定向缺少 location 头'));
            return;
          }

          if (redirectCount >= maxRedirects) {
            res.resume();
            fail(new Error('重定向次数超过限制'));
            return;
          }

          // 将相对路径转换为绝对URL
          let redirectUrl: string;
          try {
            redirectUrl = resolveUpdateAssetUrl(redirectLocation, url);
            assertSafeUpdateRedirect(url, redirectUrl);
          } catch (error: unknown) {
            res.resume();
            fail(new Error(`解析重定向URL失败: ${getErrorMessage(error)}`));
            return;
          }

          logger.info('自动更新', `跟随重定向 (${redirectCount + 1}/${maxRedirects})`, {
            from: url,
            to: redirectUrl,
          });

          isSettled = true;
          res.resume();
          closeAndDeleteFile(file, filePath)
            .then(() => this.downloadFile(redirectUrl, filePath, expectedSize, redirectCount + 1))
            .then(resolve)
            .catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          fail(new Error(`下载失败: HTTP ${res.statusCode}`));
          return;
        }

        const totalSize = parseInt(res.headers['content-length'] || '0', 10);
        let downloadedSize = 0;
        const reportProgress = createDownloadProgressReporter((progress) =>
          this.sendMessage('download-progress', progress)
        );

        try {
          if (totalSize > 0) {
            assertDownloadWithinExpectedSize(totalSize, expectedSize);
          }
        } catch (error: unknown) {
          fail(error);
          return;
        }

        res.on('data', (chunk) => {
          if (isSettled) {
            return;
          }

          downloadedSize += chunk.length;

          try {
            assertDownloadWithinExpectedSize(downloadedSize, expectedSize);
          } catch (error: unknown) {
            fail(error);
            return;
          }

          if (!file.write(chunk)) {
            // 背压处理：暂停读取直到缓冲区排空
            res.pause();
            file.once('drain', () => {
              res.resume();
            });
          }

          reportProgress(downloadedSize, totalSize);
        });

        res.on('end', () => {
          if (!isSettled) {
            file.end(() => {
              if (!isSettled) {
                isSettled = true;
                resolve();
              }
            });
          }
        });

        res.on('error', fail);
      });

      request.on('error', fail);

      request.setTimeout(300000, () => {
        fail(new Error('下载超时 (5分钟)'));
      });
    });
  }

  /**
   * 退出并安装（安装前自动备份）
   */
  async quitAndInstall(expectedVersion: string, expectedPolicySignature: string): Promise<void> {
    assertUpdaterPlatformSupported(process.platform, process.env.PORTABLE_EXECUTABLE_FILE);
    assertUpdateOperationAllowed(this.operationState, 'installing');

    let downloadedInstaller: ReturnType<typeof resolveDownloadedInstaller>;
    try {
      downloadedInstaller = resolveDownloadedInstaller(
        this.downloadedFilePath,
        this.downloadedVersionInfo,
        fs.existsSync
      );
    } catch (error: unknown) {
      await logger.error('自动更新', '安装失败：找不到安装包');
      throw error;
    }

    const { installerPath, versionInfo } = downloadedInstaller;
    assertExpectedUpdateArtifact(expectedVersion, expectedPolicySignature, versionInfo);
    if (!installerPath) {
      this.discardDownloadedUpdate();
      this.showDialog({
        type: 'download-error',
        message: '安装包已失效，请重新下载',
        version: versionInfo.version,
        isMandatory: versionInfo.mandatory || false,
        policySignature: versionInfo.policySignature,
      });
      await logger.error('自动更新', '安装失败：找不到安装包');
      throw new Error('找不到安装包，请重新下载');
    }
    if (this.latestVersionInfo && !areUpdateArtifactsEqual(this.latestVersionInfo, versionInfo)) {
      throw new Error('版本信息已变化，请重新检查更新');
    }
    this.operationState = 'installing';

    try {
      // 安装前自动创建备份
      await logger.info('自动更新', '正在创建更新前备份...');
      const currentVersion = this.getCurrentVersion();
      const backupInfo = await ensureUpdateBackup(() =>
        backupService.createBackup(`更新前自动备份 (v${currentVersion})`)
      );

      await logger.success('自动更新', '备份创建成功', {
        filename: backupInfo.filename,
        backupId: backupInfo.id,
      });
    } catch (error: unknown) {
      this.operationState = 'idle';
      await logger.error('自动更新', '备份创建失败，已取消安装', {
        error: getErrorMessage(error),
      });
      throw error;
    }

    await logger.info('自动更新', '开始安装更新', { path: installerPath });

    // 使用 spawn 启动安装程序，Windows NSIS 更新走静默安装并重启应用
    try {
      // 在 Windows 上，确保路径被正确处理
      const installerArgs = createInstallerLaunchArgs(process.platform);

      await withUnverifiedDownloadCleanup(installerPath, async () => {
        const fileStats = fs.statSync(installerPath);
        const fileHash = await this.calculateSHA256(installerPath);
        validateDownloadedUpdate(
          versionInfo.version,
          versionInfo.files.full,
          fileStats.size,
          fileHash,
          UPDATE_SIGNING_PUBLIC_KEY
        );
      });

      const installer = spawn(installerPath, installerArgs, {
        detached: true,
        stdio: 'ignore',
        shell: false,
        windowsVerbatimArguments: false,
      });

      await waitForInstallerSpawn(installer);

      installer.unref(); // 允许父进程退出

      await logger.success('自动更新', '安装程序已启动', {
        path: installerPath,
        args: installerArgs,
      });

      // 等待一小段时间确保安装程序启动
      setTimeout(() => {
        this.quitApp();
      }, 1000);
    } catch (error: unknown) {
      this.operationState = 'idle';
      if (!fs.existsSync(installerPath)) {
        this.discardDownloadedUpdate();
        this.showDialog({
          type: 'download-error',
          message: '安装包已失效，请重新下载',
          version: versionInfo.version,
          isMandatory: versionInfo.mandatory || false,
          policySignature: versionInfo.policySignature,
        });
      }
      const errorMessage = getErrorMessage(error);
      await logger.error('自动更新', '启动安装程序失败', { error: errorMessage });
      throw new Error(`启动安装程序失败: ${errorMessage}`);
    }
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
      const entries = fs.readdirSync(tempDir, { withFileTypes: true });

      const installerPatterns = [
        /^USG-NAT-Manager-Setup-[\d.]+\.exe$/,
        /^USG-NAT-Manager-Portable-[\d.]+\.exe$/,
      ];

      let cleanedCount = 0;

      for (const entry of entries) {
        const isInstaller =
          entry.isFile() && installerPatterns.some((pattern) => pattern.test(entry.name));
        const isUpdateDirectory = entry.isDirectory() && entry.name.startsWith('usg-update-');

        if (isInstaller || isUpdateDirectory) {
          const filePath = path.join(tempDir, entry.name);
          try {
            fs.rmSync(filePath, { recursive: isUpdateDirectory, force: true });
            cleanedCount++;
            await logger.info('自动更新', `已清理旧安装包: ${entry.name}`);
          } catch (error: unknown) {
            // 文件可能正在使用或无权限删除，忽略错误
            await logger.warning('自动更新', `清理安装包失败: ${entry.name}`, {
              error: getErrorMessage(error),
            });
          }
        }
      }

      if (cleanedCount > 0) {
        await logger.success('自动更新', `清理完成，共删除 ${cleanedCount} 个旧安装包`);
      }
    } catch (error: unknown) {
      await logger.error('自动更新', '清理旧安装包失败', { error: getErrorMessage(error) });
    }
  }

  private sendDownloadedUpdateMessage(versionInfo: UpdateVersionInfo): void {
    this.showDialog({
      type: 'update-downloaded',
      version: versionInfo.version,
      isMandatory: versionInfo.mandatory || false,
      policySignature: versionInfo.policySignature,
    });
  }

  private async notifyMandatoryUpdateState(): Promise<void> {
    try {
      await this.mandatoryUpdateStateHandler?.(this.isMandatoryUpdateRequired());
    } catch (error: unknown) {
      await logger.error('自动更新', '切换强制更新业务门禁失败', {
        error: getErrorMessage(error),
      });
    }
  }

  private discardDownloadedUpdate(): void {
    const downloadDirectoryPath = this.downloadDirectoryPath;
    const downloadedFilePath = this.downloadedFilePath;
    this.downloadedFilePath = null;
    this.downloadedVersionInfo = null;
    this.downloadDirectoryPath = null;

    try {
      if (downloadDirectoryPath && fs.existsSync(downloadDirectoryPath)) {
        fs.rmSync(downloadDirectoryPath, { recursive: true, force: true });
      } else if (downloadedFilePath && fs.existsSync(downloadedFilePath)) {
        fs.unlinkSync(downloadedFilePath);
      }
    } catch (error: unknown) {
      logger
        .warning('自动更新', '清理已下载更新失败', { error: getErrorMessage(error) })
        .catch(() => {});
    }
  }
}

export const customUpdater = new CustomUpdater();
