import { Buffer } from 'node:buffer';
import { verify, type KeyLike } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import { existsSync, unlinkSync, type WriteStream } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { URL } from 'node:url';

const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const WEEKLY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_UPDATE_SIZE_BYTES = 500 * 1024 * 1024;
const SEMANTIC_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const SHA256_PATTERN = /^[a-f\d]{64}$/i;

export const UPDATE_SIGNING_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAu8pAbC0+vCTEYT7EK9ccvdUgEaT6nFS2XPXvkvL13GQ=
-----END PUBLIC KEY-----`;

export type UpdateAssetInfo = {
  url: string;
  sha256: string;
  signature: string;
  size: number;
};

export type UpdateChangelogItem =
  | string
  | {
      type: 'feature' | 'improve' | 'fix';
      description: string;
    };

export type UpdateVersionInfo = {
  version: string;
  changelog?: UpdateChangelogItem[];
  releaseDate?: string;
  mandatory?: boolean;
  minimumVersion?: string | null;
  policySignature: string;
  files: {
    full: UpdateAssetInfo;
  };
  _serverUrl?: string;
};

export type UpdateOperationState = 'idle' | 'checking' | 'downloading' | 'installing';

export type DownloadProgress = {
  percent: number;
  transferred: number;
  total: number;
};

export const createDownloadProgressReporter = (
  report: (progress: DownloadProgress) => void
): ((transferred: number, total: number) => void) => {
  let lastPercent = -1;

  return (transferred, total) => {
    if (total <= 0) {
      return;
    }

    const percent = Math.min(100, Math.max(0, Math.floor((transferred / total) * 100)));
    if (percent === lastPercent) {
      return;
    }

    lastPercent = percent;
    report({ percent, transferred, total });
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isEd25519Signature = (value: unknown): value is string => {
  if (typeof value !== 'string') {
    return false;
  }

  const decoded = Buffer.from(value, 'base64');
  return decoded.length === 64 && decoded.toString('base64') === value;
};

const isUpdateChangelogItem = (value: unknown): value is UpdateChangelogItem => {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return (
    isRecord(value) &&
    (value.type === 'feature' || value.type === 'improve' || value.type === 'fix') &&
    typeof value.description === 'string' &&
    value.description.trim().length > 0
  );
};

export const parseUpdateVersionInfo = (value: unknown): UpdateVersionInfo => {
  if (!isRecord(value) || !SEMANTIC_VERSION_PATTERN.test(String(value.version))) {
    throw new Error('版本信息格式无效');
  }

  const files = value.files;
  const full = isRecord(files) ? files.full : undefined;

  if (
    !isRecord(full) ||
    typeof full.url !== 'string' ||
    full.url.length === 0 ||
    !Number.isSafeInteger(full.size) ||
    Number(full.size) <= 0 ||
    Number(full.size) > MAX_UPDATE_SIZE_BYTES ||
    typeof full.sha256 !== 'string' ||
    !SHA256_PATTERN.test(full.sha256) ||
    !isEd25519Signature(full.signature)
  ) {
    throw new Error('版本信息格式无效');
  }

  if (
    (value.releaseDate !== undefined && typeof value.releaseDate !== 'string') ||
    (value.mandatory !== undefined && typeof value.mandatory !== 'boolean') ||
    (value.changelog !== undefined &&
      (!Array.isArray(value.changelog) || !value.changelog.every(isUpdateChangelogItem))) ||
    (value.minimumVersion !== undefined &&
      value.minimumVersion !== null &&
      (typeof value.minimumVersion !== 'string' ||
        !SEMANTIC_VERSION_PATTERN.test(value.minimumVersion))) ||
    !isEd25519Signature(value.policySignature)
  ) {
    throw new Error('版本信息格式无效');
  }

  return value as UpdateVersionInfo;
};

export const createUpdateSignaturePayload = (
  version: string,
  size: number,
  sha256: string
): string =>
  `USG-NAT-Manager-Update-v1\nversion=${version}\nsize=${size}\nsha256=${sha256.toLowerCase()}\n`;

export const createUpdatePolicySignaturePayload = (
  release: Pick<
    UpdateVersionInfo,
    'version' | 'releaseDate' | 'mandatory' | 'minimumVersion' | 'changelog' | 'files'
  >
): string =>
  [
    'USG-NAT-Manager-Update-Policy-v1',
    `version=${release.version}`,
    `releaseDate=${release.releaseDate || ''}`,
    `mandatory=${release.mandatory === true ? 'true' : 'false'}`,
    `minimumVersion=${release.minimumVersion || ''}`,
    `changelog=${JSON.stringify(release.changelog || [])}`,
    `size=${release.files.full.size}`,
    `sha256=${release.files.full.sha256.toLowerCase()}`,
    '',
  ].join('\n');

export const verifyUpdateSignature = (
  version: string,
  asset: UpdateAssetInfo,
  publicKey: KeyLike
): boolean => {
  if (
    !SEMANTIC_VERSION_PATTERN.test(version) ||
    !SHA256_PATTERN.test(asset.sha256) ||
    !isEd25519Signature(asset.signature)
  ) {
    return false;
  }

  try {
    return verify(
      null,
      Buffer.from(createUpdateSignaturePayload(version, asset.size, asset.sha256)),
      publicKey,
      Buffer.from(asset.signature, 'base64')
    );
  } catch {
    return false;
  }
};

export const verifyUpdatePolicySignature = (
  release: UpdateVersionInfo,
  publicKey: KeyLike
): boolean => {
  if (!isEd25519Signature(release.policySignature)) {
    return false;
  }

  try {
    return verify(
      null,
      Buffer.from(createUpdatePolicySignaturePayload(release)),
      publicKey,
      Buffer.from(release.policySignature, 'base64')
    );
  } catch {
    return false;
  }
};

export const parseVerifiedUpdateVersionInfo = (
  value: unknown,
  publicKey: KeyLike
): UpdateVersionInfo => {
  const versionInfo = parseUpdateVersionInfo(value);

  if (!verifyUpdateSignature(versionInfo.version, versionInfo.files.full, publicKey)) {
    throw new Error('版本信息签名无效');
  }

  if (!verifyUpdatePolicySignature(versionInfo, publicKey)) {
    throw new Error('更新策略签名无效');
  }

  return versionInfo;
};

export const validateDownloadedUpdate = (
  version: string,
  asset: UpdateAssetInfo,
  actualSize: number,
  actualSha256: string,
  publicKey: KeyLike
): void => {
  if (actualSize !== asset.size) {
    throw new Error(`文件大小不匹配: 预期 ${asset.size}，实际 ${actualSize}`);
  }

  if (actualSha256.toLowerCase() !== asset.sha256.toLowerCase()) {
    throw new Error('文件校验失败，SHA-256不匹配');
  }

  if (!verifyUpdateSignature(version, asset, publicKey)) {
    throw new Error('文件校验失败，数字签名无效');
  }
};

export const assertSafeUpdateRedirect = (sourceUrl: string, targetUrl: string): void => {
  const source = new URL(sourceUrl);
  const target = new URL(targetUrl);
  const supportedProtocols = new Set(['http:', 'https:']);
  const isSameOrigin = source.origin === target.origin;
  const isSameHostHttpsUpgrade =
    source.protocol === 'http:' &&
    target.protocol === 'https:' &&
    source.hostname === target.hostname;

  if (
    !supportedProtocols.has(source.protocol) ||
    !supportedProtocols.has(target.protocol) ||
    target.username.length > 0 ||
    target.password.length > 0 ||
    (!isSameOrigin && !isSameHostHttpsUpgrade)
  ) {
    throw new Error('不安全的更新重定向');
  }
};

export const assertDownloadWithinExpectedSize = (transferred: number, expected: number): void => {
  if (transferred > expected) {
    throw new Error('下载数据超过预期大小');
  }
};

export const readUpdateManifestResponse = (
  response: IncomingMessage,
  maxBytes: number
): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let isSettled = false;

    const fail = (error: unknown) => {
      if (isSettled) {
        return;
      }
      isSettled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    response.on('data', (chunk: Buffer | string) => {
      if (isSettled) {
        return;
      }

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      receivedBytes += buffer.length;
      if (receivedBytes > maxBytes) {
        fail(new Error('版本信息超过大小限制'));
        response.destroy();
        return;
      }
      chunks.push(buffer);
    });

    response.once('aborted', () => fail(new Error('版本信息响应中断')));
    response.once('error', fail);
    response.once('end', () => {
      if (isSettled) {
        return;
      }
      if (!response.complete) {
        fail(new Error('版本信息响应不完整'));
        return;
      }

      isSettled = true;
      resolve(Buffer.concat(chunks, receivedBytes).toString('utf8'));
    });
  });

export const initializeUpdater = async (
  cleanupOldInstallers: () => Promise<void>,
  startPeriodicCheck: () => Promise<void>
): Promise<void> => {
  await cleanupOldInstallers();
  await startPeriodicCheck();
};

export const runPeriodicUpdateCheck = async (
  checkForUpdates: (showNoUpdateMessage: boolean) => Promise<unknown>
): Promise<boolean> => {
  const result = await checkForUpdates(false);
  return isRecord(result) && result.success === true;
};

export const runDownloadOperation = async <T>(
  operation: () => Promise<T>,
  onError: (error: unknown) => void | Promise<void>,
  onFinally: () => void
): Promise<T> => {
  try {
    return await operation();
  } catch (error: unknown) {
    await onError(error);
    throw error;
  } finally {
    onFinally();
  }
};

export const restoreAutomationUnlessMandatory = async (
  isMandatoryUpdateRequired: () => boolean,
  start: () => Promise<void>,
  stop: () => Promise<void>
): Promise<boolean> => {
  if (isMandatoryUpdateRequired()) {
    return false;
  }

  await start();
  if (isMandatoryUpdateRequired()) {
    await stop();
    return false;
  }

  return true;
};

export const resolveDownloadedInstaller = (
  installerPath: string | null,
  versionInfo: UpdateVersionInfo | null,
  fileExists: (filePath: string) => boolean
): { installerPath: string | null; versionInfo: UpdateVersionInfo } => {
  if (!versionInfo) {
    throw new Error('找不到安装包');
  }

  return {
    installerPath: installerPath && fileExists(installerPath) ? installerPath : null,
    versionInfo,
  };
};

export const ensureUpdateBackup = async <T>(createBackup: () => Promise<T>): Promise<T> => {
  try {
    return await createBackup();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`更新前备份失败，已取消安装: ${message}`);
  }
};

export const closeAndDeleteFile = (
  stream: Pick<WriteStream, 'closed' | 'destroy' | 'once'>,
  filePath: string
): Promise<void> =>
  new Promise((resolve, reject) => {
    const removeFile = () => {
      try {
        if (existsSync(filePath)) {
          unlinkSync(filePath);
        }
        resolve();
      } catch (error: unknown) {
        reject(error);
      }
    };

    if (stream.closed) {
      removeFile();
      return;
    }

    stream.once('close', removeFile);
    stream.destroy();
  });

export const withUnverifiedDownloadCleanup = async <T>(
  filePath: string,
  operation: () => Promise<T>
): Promise<T> => {
  try {
    return await operation();
  } catch (error: unknown) {
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch (cleanupError: unknown) {
      const originalMessage = error instanceof Error ? error.message : String(error);
      const cleanupMessage =
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      throw new Error(`${originalMessage}; 删除未验证安装包失败: ${cleanupMessage}`);
    }
    throw error;
  }
};

export const waitForInstallerSpawn = (
  installer: Pick<EventEmitter, 'once' | 'removeListener'>
): Promise<void> =>
  new Promise((resolve, reject) => {
    const onSpawn = () => {
      installer.removeListener('error', onError);
      resolve();
    };
    const onError = (error: Error) => {
      installer.removeListener('spawn', onSpawn);
      reject(error);
    };

    installer.once('spawn', onSpawn);
    installer.once('error', onError);
  });

export const compareVersions = (left: string, right: string): number => {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;

    if (leftValue > rightValue) {
      return 1;
    }

    if (leftValue < rightValue) {
      return -1;
    }
  }

  return 0;
};

export const isUpdateMandatory = (
  currentVersion: string,
  release: Pick<UpdateVersionInfo, 'mandatory' | 'minimumVersion'>
): boolean =>
  release.mandatory === true ||
  (release.minimumVersion !== undefined &&
    release.minimumVersion !== null &&
    compareVersions(currentVersion, release.minimumVersion) < 0);

export const getUpdateCheckIntervalMs = (checkFrequency: string): number => {
  if (checkFrequency === 'weekly') {
    return WEEKLY_INTERVAL_MS;
  }

  return DAILY_INTERVAL_MS;
};

export const parseUpdateServerUrls = (
  configuredUrls: string | undefined,
  fallbackUrls: readonly string[]
): string[] => {
  const urls = configuredUrls
    ?.split(',')
    .map((url) => url.trim())
    .filter(Boolean);

  return urls?.length ? urls : [...fallbackUrls];
};

export const assertSecureUpdateServerUrl = (
  serverUrl: string,
  allowInsecureLocalhost = false
): void => {
  const url = new URL(serverUrl);
  const isLocalhost =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  const isAllowedLocalHttp = allowInsecureLocalhost && isLocalhost && url.protocol === 'http:';

  if (url.username || url.password || url.search || url.hash) {
    throw new Error('更新服务器地址无效');
  }

  if (url.protocol !== 'https:' && !isAllowedLocalHttp) {
    throw new Error('更新服务器必须使用HTTPS');
  }
};

export const buildLatestVersionApiUrl = (serverUrl: string): string =>
  new URL('api/versions/latest', ensureTrailingSlash(serverUrl)).href;

export const resolveUpdateAssetUrl = (assetUrl: string, serverUrl: string): string => {
  if (assetUrl.startsWith('http://') || assetUrl.startsWith('https://')) {
    return assetUrl;
  }

  return new URL(assetUrl, ensureTrailingSlash(serverUrl)).href;
};

export const createSetupInstallerFileName = (version: string): string =>
  `USG-NAT-Manager-Setup-${version}.exe`;

export const createInstallerLaunchArgs = (platform: string): string[] =>
  platform === 'win32' ? ['/S', '--updated', '--force-run'] : [];

export const assertUpdaterPlatformSupported = (
  platform: string,
  portableExecutableFile?: string
): void => {
  if (platform !== 'win32') {
    throw new Error('应用内自动更新目前仅支持 Windows，请手动安装新版本');
  }

  if (portableExecutableFile) {
    throw new Error('便携版不支持应用内安装，请下载新版便携版手动替换');
  }
};

export const assertUpdateOperationAllowed = (
  current: UpdateOperationState,
  _requested: Exclude<UpdateOperationState, 'idle'>
): void => {
  if (current === 'idle') {
    return;
  }

  const messages: Record<Exclude<UpdateOperationState, 'idle'>, string> = {
    checking: '正在检查更新中，请稍候',
    downloading: '正在下载更新中，请稍候',
    installing: '正在启动安装程序，请稍候',
  };
  throw new Error(messages[current]);
};

export const assertExpectedUpdateArtifact = (
  expectedVersion: string,
  expectedPolicySignature: string,
  actual: UpdateVersionInfo
): void => {
  if (expectedVersion !== actual.version || expectedPolicySignature !== actual.policySignature) {
    throw new Error('版本信息已变化，请重新检查更新');
  }
};

export const shouldBlockWindowClose = (
  isQuitting: boolean,
  mandatoryUpdateRequired: boolean
): boolean => !isQuitting && mandatoryUpdateRequired;

export const areUpdateArtifactsEqual = (
  left: UpdateVersionInfo,
  right: UpdateVersionInfo
): boolean =>
  left.version === right.version &&
  left.files.full.size === right.files.full.size &&
  left.files.full.sha256.toLowerCase() === right.files.full.sha256.toLowerCase() &&
  left.files.full.signature === right.files.full.signature &&
  left.policySignature === right.policySignature;

export const isUpdatedLaunch = (args: readonly string[]): boolean => args.includes('--updated');

const ensureTrailingSlash = (value: string): string => (value.endsWith('/') ? value : `${value}/`);
