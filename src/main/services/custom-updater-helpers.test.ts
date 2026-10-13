import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { generateKeyPairSync, sign } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import type { IncomingMessage } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import * as updaterHelpers from './custom-updater-helpers.ts';

import {
  areUpdateArtifactsEqual,
  assertDownloadWithinExpectedSize,
  assertSecureUpdateServerUrl,
  assertSafeUpdateRedirect,
  assertUpdaterPlatformSupported,
  buildLatestVersionApiUrl,
  createDownloadProgressReporter,
  createInstallerLaunchArgs,
  createUpdatePolicySignaturePayload,
  createUpdateSignaturePayload,
  closeAndDeleteFile,
  createSetupInstallerFileName,
  ensureUpdateBackup,
  getUpdateCheckIntervalMs,
  initializeUpdater,
  isUpdateMandatory,
  isUpdatedLaunch,
  parseUpdateVersionInfo,
  parseUpdateServerUrls,
  parseVerifiedUpdateVersionInfo,
  readUpdateManifestResponse,
  resolveUpdateAssetUrl,
  runPeriodicUpdateCheck,
  withUnverifiedDownloadCleanup,
  validateDownloadedUpdate,
  verifyUpdatePolicySignature,
  verifyUpdateSignature,
  waitForInstallerSpawn,
  compareVersions,
  type UpdateVersionInfo,
} from './custom-updater-helpers.ts';

type UpdateStateGuard = (
  current: 'idle' | 'checking' | 'downloading' | 'installing',
  requested: 'checking' | 'downloading' | 'installing'
) => void;

type ExpectedArtifactGuard = (
  expectedVersion: string,
  expectedPolicySignature: string,
  actual: UpdateVersionInfo
) => void;

type WindowCloseGuard = (isQuitting: boolean, mandatoryUpdateRequired: boolean) => boolean;

type DownloadOperationRunner = <T>(
  operation: () => Promise<T>,
  onError: (error: unknown) => void | Promise<void>,
  onFinally: () => void
) => Promise<T>;

type AutomationRestoreGuard = (
  isMandatoryUpdateRequired: () => boolean,
  start: () => Promise<void>,
  stop: () => Promise<void>
) => Promise<boolean>;

type DownloadedInstallerResolver = (
  installerPath: string | null,
  versionInfo: UpdateVersionInfo | null,
  fileExists: (filePath: string) => boolean
) => { installerPath: string | null; versionInfo: UpdateVersionInfo };

test('update operations use one symmetric state guard', () => {
  const guard = (updaterHelpers as unknown as { assertUpdateOperationAllowed?: UpdateStateGuard })
    .assertUpdateOperationAllowed;

  assert.equal(typeof guard, 'function');
  assert.doesNotThrow(() => guard?.('idle', 'checking'));
  assert.throws(() => guard?.('checking', 'downloading'), /正在检查更新/);
  assert.throws(() => guard?.('downloading', 'installing'), /正在下载更新/);
  assert.throws(() => guard?.('installing', 'checking'), /正在启动安装程序/);
});

test('update actions are bound to the exact signed artifact shown by the dialog', () => {
  const guard = (
    updaterHelpers as unknown as { assertExpectedUpdateArtifact?: ExpectedArtifactGuard }
  ).assertExpectedUpdateArtifact;
  const release = { ...validVersionInfo, files: { full: { ...validVersionInfo.files.full } } };

  assert.equal(typeof guard, 'function');
  assert.doesNotThrow(() => guard?.(release.version, release.policySignature, release));
  assert.throws(() => guard?.('9.9.9', release.policySignature, release), /版本信息已变化/);
  assert.throws(
    () => guard?.(release.version, Buffer.alloc(64, 9).toString('base64'), release),
    /版本信息已变化/
  );
});

test('mandatory updates block window hiding but still allow an explicit app exit', () => {
  const shouldBlock = (updaterHelpers as unknown as { shouldBlockWindowClose?: WindowCloseGuard })
    .shouldBlockWindowClose;

  assert.equal(typeof shouldBlock, 'function');
  assert.equal(shouldBlock?.(false, true), true);
  assert.equal(shouldBlock?.(true, true), false);
  assert.equal(shouldBlock?.(false, false), false);
});

test('download preparation failures are reported and always release the operation state', async () => {
  const runDownloadOperation = (
    updaterHelpers as unknown as { runDownloadOperation?: DownloadOperationRunner }
  ).runDownloadOperation;
  const calls: string[] = [];

  assert.equal(typeof runDownloadOperation, 'function');
  await assert.rejects(
    runDownloadOperation?.(
      async () => {
        calls.push('prepare');
        throw new Error('disk full');
      },
      (error) => {
        calls.push(`error:${error instanceof Error ? error.message : String(error)}`);
      },
      () => {
        calls.push('idle');
      }
    ),
    /disk full/
  );
  assert.deepEqual(calls, ['prepare', 'error:disk full', 'idle']);
});

test('automation restore never leaves business work running behind a mandatory update', async () => {
  const restoreAutomation = (
    updaterHelpers as unknown as { restoreAutomationUnlessMandatory?: AutomationRestoreGuard }
  ).restoreAutomationUnlessMandatory;

  assert.equal(typeof restoreAutomation, 'function');

  let mandatory = true;
  const alreadyBlockedCalls: string[] = [];
  const alreadyBlocked = await restoreAutomation?.(
    () => mandatory,
    async () => {
      alreadyBlockedCalls.push('start');
    },
    async () => {
      alreadyBlockedCalls.push('stop');
    }
  );
  assert.equal(alreadyBlocked, false);
  assert.deepEqual(alreadyBlockedCalls, []);

  mandatory = false;
  const racedCalls: string[] = [];
  const raced = await restoreAutomation?.(
    () => mandatory,
    async () => {
      racedCalls.push('start');
      mandatory = true;
    },
    async () => {
      racedCalls.push('stop');
    }
  );
  assert.equal(raced, false);
  assert.deepEqual(racedCalls, ['start', 'stop']);
});

test('a missing installer retains signed release context for a recoverable re-download state', () => {
  const resolveDownloadedInstaller = (
    updaterHelpers as unknown as { resolveDownloadedInstaller?: DownloadedInstallerResolver }
  ).resolveDownloadedInstaller;
  const release = { ...validVersionInfo, files: { full: { ...validVersionInfo.files.full } } };

  assert.equal(typeof resolveDownloadedInstaller, 'function');
  assert.deepEqual(
    resolveDownloadedInstaller?.('missing.exe', release, () => false),
    {
      installerPath: null,
      versionInfo: release,
    }
  );
  assert.deepEqual(
    resolveDownloadedInstaller?.('ready.exe', release, () => true),
    {
      installerPath: 'ready.exe',
      versionInfo: release,
    }
  );
  assert.throws(() => resolveDownloadedInstaller?.(null, null, () => false), /找不到安装包/);
});

test('renderer readiness and updater IPC preserve current state and artifact identity', () => {
  const updaterSource = fs.readFileSync(
    path.join(process.cwd(), 'src/main/services/custom-updater.ts'),
    'utf8'
  );
  const windowSource = fs.readFileSync(path.join(process.cwd(), 'src/main/window.ts'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(process.cwd(), 'src/main/preload.ts'), 'utf8');
  const dialogSource = fs.readFileSync(
    path.join(process.cwd(), 'src/renderer/components/UpdateDialog.tsx'),
    'utf8'
  );

  assert.match(updaterSource, /getCurrentState\(\)/);
  assert.match(updaterSource, /type: 'update-downloading'/);
  assert.match(updaterSource, /resolveDownloadedInstaller/);
  assert.match(updaterSource, /clear-update-dialog/);
  assert.doesNotMatch(updaterSource, /private isChecking\s*=/);
  assert.match(windowSource, /isMandatoryUpdateRequired\(\)/);
  assert.match(windowSource, /replayCurrentState\(\)/);
  assert.match(preloadSource, /getState: \(\) => ipcRenderer\.invoke\('updater:getState'\)/);
  assert.match(preloadSource, /downloadUpdate: \(version: string, policySignature: string\)/);
  assert.match(preloadSource, /quitAndInstall: \(version: string, policySignature: string\)/);

  const listenerIndex = dialogSource.indexOf("api.on('updater-message'");
  const stateReplayIndex = dialogSource.indexOf('api.updater.getState()');
  assert.ok(listenerIndex >= 0 && stateReplayIndex > listenerIndex);
  assert.match(dialogSource, /quitApp/);
  assert.match(dialogSource, /case 'update-downloading'/);
});

test('compareVersions orders semantic version strings', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.2.0', '1.10.0'), -1);
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
});

test('getUpdateCheckIntervalMs supports known frequencies and defaults to daily', () => {
  assert.equal(getUpdateCheckIntervalMs('daily'), 24 * 60 * 60 * 1000);
  assert.equal(getUpdateCheckIntervalMs('weekly'), 7 * 24 * 60 * 60 * 1000);
  assert.equal(getUpdateCheckIntervalMs('unexpected'), 24 * 60 * 60 * 1000);
});

test('buildLatestVersionApiUrl appends the latest-version endpoint', () => {
  assert.equal(
    buildLatestVersionApiUrl('http://updates.example.com'),
    'http://updates.example.com/api/versions/latest'
  );
  assert.equal(
    buildLatestVersionApiUrl('https://updates.example.com/base/'),
    'https://updates.example.com/base/api/versions/latest'
  );
});

test('parseUpdateServerUrls uses configured addresses and falls back when empty', () => {
  const fallback = ['https://updates.example.com'];

  assert.deepEqual(
    parseUpdateServerUrls(
      ' https://updates.example.com,https://updates-backup.example.com/base ',
      fallback
    ),
    ['https://updates.example.com', 'https://updates-backup.example.com/base']
  );
  assert.deepEqual(parseUpdateServerUrls(' , ', fallback), fallback);
  assert.notEqual(parseUpdateServerUrls(undefined, fallback), fallback);
});

test('assertSecureUpdateServerUrl requires HTTPS except for local development', () => {
  assert.doesNotThrow(() => assertSecureUpdateServerUrl('https://updates.example.com'));
  assert.doesNotThrow(() => assertSecureUpdateServerUrl('http://127.0.0.1:8123', true));
  assert.throws(() => assertSecureUpdateServerUrl('http://updates.example.com'), /必须使用HTTPS/);
  assert.throws(() => assertSecureUpdateServerUrl('http://127.0.0.1:8123'), /必须使用HTTPS/);
  assert.throws(
    () => assertSecureUpdateServerUrl('https://user:pass@updates.example.com'),
    /更新服务器地址无效/
  );
  assert.throws(
    () => assertSecureUpdateServerUrl('https://updates.example.com?channel=stable'),
    /更新服务器地址无效/
  );
});

test('resolveUpdateAssetUrl keeps absolute URLs and resolves relative URLs against the server', () => {
  assert.equal(
    resolveUpdateAssetUrl('https://cdn.example.com/setup.exe', 'http://updates.example.com'),
    'https://cdn.example.com/setup.exe'
  );
  assert.equal(
    resolveUpdateAssetUrl('/downloads/setup.exe', 'http://updates.example.com'),
    'http://updates.example.com/downloads/setup.exe'
  );
  assert.equal(
    resolveUpdateAssetUrl('downloads/setup.exe', 'https://updates.example.com/base/'),
    'https://updates.example.com/base/downloads/setup.exe'
  );
});

test('createSetupInstallerFileName uses the expected installer naming pattern', () => {
  assert.equal(createSetupInstallerFileName('1.2.3'), 'USG-NAT-Manager-Setup-1.2.3.exe');
});

test('download progress reports only when the integer percentage changes', () => {
  const updates: Array<{ percent: number; transferred: number; total: number }> = [];
  const report = createDownloadProgressReporter((progress) => updates.push(progress));

  report(1, 1000);
  report(2, 1000);
  report(10, 1000);
  report(19, 1000);
  report(1000, 1000);

  assert.deepEqual(updates, [
    { percent: 0, transferred: 1, total: 1000 },
    { percent: 1, transferred: 10, total: 1000 },
    { percent: 100, transferred: 1000, total: 1000 },
  ]);
});

test('download progress ignores unknown totals', () => {
  let reports = 0;
  const report = createDownloadProgressReporter(() => {
    reports += 1;
  });

  report(10, 0);

  assert.equal(reports, 0);
});

test('createInstallerLaunchArgs uses silent Windows update arguments', () => {
  assert.deepEqual(createInstallerLaunchArgs('win32'), ['/S', '--updated', '--force-run']);
  assert.deepEqual(createInstallerLaunchArgs('darwin'), []);
});

test('assertUpdaterPlatformSupported rejects unsupported automatic-update platforms', () => {
  assert.doesNotThrow(() => assertUpdaterPlatformSupported('win32'));
  assert.throws(() => assertUpdaterPlatformSupported('darwin'), /仅支持 Windows/);
});

test('portable Windows builds do not launch the setup installer as an in-place update', () => {
  assert.throws(
    () => assertUpdaterPlatformSupported('win32', 'USG-NAT-Manager-Portable-1.1.6.exe'),
    /便携版/
  );
});

test('isUpdatedLaunch detects the NSIS post-update restart marker', () => {
  assert.equal(isUpdatedLaunch(['app.exe', '--updated']), true);
  assert.equal(isUpdatedLaunch(['app.exe']), false);
});

test('isUpdateMandatory enforces the release flag and minimum supported version', () => {
  assert.equal(isUpdateMandatory('1.2.3', { mandatory: true }), true);
  assert.equal(isUpdateMandatory('1.2.3', { minimumVersion: '1.2.4' }), true);
  assert.equal(isUpdateMandatory('1.2.3', { minimumVersion: '1.2.3' }), false);
  assert.equal(isUpdateMandatory('1.2.3', {}), false);
});

const validVersionInfo = {
  version: '1.2.3',
  releaseDate: '2026-07-15',
  mandatory: false,
  minimumVersion: null,
  changelog: [{ type: 'fix' as const, description: 'Fixed update flow' }],
  policySignature: Buffer.alloc(64, 2).toString('base64'),
  files: {
    full: {
      url: '/api/versions/1/download',
      size: 123,
      sha256: 'a'.repeat(64),
      signature: Buffer.alloc(64, 1).toString('base64'),
    },
  },
};

test('parseUpdateVersionInfo accepts a complete signed installer manifest', () => {
  assert.deepEqual(parseUpdateVersionInfo(validVersionInfo), validVersionInfo);
  assert.deepEqual(parseUpdateVersionInfo({ ...validVersionInfo, minimumVersion: null }), {
    ...validVersionInfo,
    minimumVersion: null,
  });
  assert.deepEqual(
    parseUpdateVersionInfo({
      ...validVersionInfo,
      changelog: ['Legacy note', { type: 'fix', description: 'Fixed update flow' }],
    }).changelog,
    ['Legacy note', { type: 'fix', description: 'Fixed update flow' }]
  );
});

test('parseUpdateVersionInfo rejects incomplete or malformed installer manifests', () => {
  const invalidManifests = [
    { ...validVersionInfo, version: '../1.2.3' },
    { ...validVersionInfo, files: { full: { ...validVersionInfo.files.full, url: '' } } },
    { ...validVersionInfo, files: { full: { ...validVersionInfo.files.full, size: 0 } } },
    {
      ...validVersionInfo,
      files: { full: { ...validVersionInfo.files.full, size: 500 * 1024 * 1024 + 1 } },
    },
    { ...validVersionInfo, files: { full: { ...validVersionInfo.files.full, sha256: '' } } },
    { ...validVersionInfo, files: { full: { ...validVersionInfo.files.full, signature: '' } } },
    { ...validVersionInfo, policySignature: '' },
    { ...validVersionInfo, changelog: [null] },
    { ...validVersionInfo, changelog: [1] },
    { ...validVersionInfo, changelog: [{ type: 'other', description: 'bad' }] },
    { ...validVersionInfo, changelog: [{ type: 'fix' }] },
  ];

  for (const manifest of invalidManifests) {
    assert.throws(() => parseUpdateVersionInfo(manifest), /版本信息格式无效/);
  }
});

test('parseVerifiedUpdateVersionInfo rejects tampered metadata before download', () => {
  const keys = generateKeyPairSync('ed25519');
  const asset = { ...validVersionInfo.files.full };
  asset.signature = sign(
    null,
    Buffer.from(createUpdateSignaturePayload(validVersionInfo.version, asset.size, asset.sha256)),
    keys.privateKey
  ).toString('base64');
  const manifest = { ...validVersionInfo, files: { full: asset } };
  manifest.policySignature = sign(
    null,
    Buffer.from(createUpdatePolicySignaturePayload(manifest)),
    keys.privateKey
  ).toString('base64');

  assert.deepEqual(parseVerifiedUpdateVersionInfo(manifest, keys.publicKey), manifest);
  assert.throws(
    () => parseVerifiedUpdateVersionInfo({ ...manifest, version: '1.2.4' }, keys.publicKey),
    /版本信息签名无效/
  );
  assert.throws(
    () => parseVerifiedUpdateVersionInfo({ ...manifest, mandatory: true }, keys.publicKey),
    /更新策略签名无效/
  );
  assert.throws(
    () =>
      parseVerifiedUpdateVersionInfo(
        { ...manifest, changelog: [{ type: 'fix', description: 'Tampered note' }] },
        keys.publicKey
      ),
    /更新策略签名无效/
  );
});

test('verifyUpdatePolicySignature authenticates policy and display metadata', () => {
  const keys = generateKeyPairSync('ed25519');
  const manifest = { ...validVersionInfo, files: { full: { ...validVersionInfo.files.full } } };
  manifest.policySignature = sign(
    null,
    Buffer.from(createUpdatePolicySignaturePayload(manifest)),
    keys.privateKey
  ).toString('base64');

  assert.equal(verifyUpdatePolicySignature(manifest, keys.publicKey), true);
  assert.equal(
    verifyUpdatePolicySignature({ ...manifest, minimumVersion: '1.2.2' }, keys.publicKey),
    false
  );
  assert.equal(
    verifyUpdatePolicySignature({ ...manifest, releaseDate: '2026-07-16' }, keys.publicKey),
    false
  );
});

test('areUpdateArtifactsEqual binds downloaded state to the exact signed release', () => {
  const manifest = { ...validVersionInfo, files: { full: { ...validVersionInfo.files.full } } };

  assert.equal(areUpdateArtifactsEqual(manifest, { ...manifest }), true);
  assert.equal(
    areUpdateArtifactsEqual(manifest, {
      ...manifest,
      files: { full: { ...manifest.files.full, sha256: 'b'.repeat(64) } },
    }),
    false
  );
  assert.equal(
    areUpdateArtifactsEqual(manifest, {
      ...manifest,
      policySignature: Buffer.alloc(64, 3).toString('base64'),
    }),
    false
  );
});

test('verifyUpdateSignature authenticates the installer digest with the pinned Ed25519 key', () => {
  const trustedKeys = generateKeyPairSync('ed25519');
  const otherKeys = generateKeyPairSync('ed25519');
  const sha256 = 'a'.repeat(64);
  const asset = { ...validVersionInfo.files.full, sha256 };
  const signature = sign(
    null,
    Buffer.from(createUpdateSignaturePayload('1.2.3', asset.size, sha256)),
    trustedKeys.privateKey
  ).toString('base64');
  asset.signature = signature;

  assert.equal(verifyUpdateSignature('1.2.3', asset, trustedKeys.publicKey), true);
  assert.equal(verifyUpdateSignature('1.2.4', asset, trustedKeys.publicKey), false);
  assert.equal(
    verifyUpdateSignature('1.2.3', { ...asset, sha256: 'b'.repeat(64) }, trustedKeys.publicKey),
    false
  );
  assert.equal(verifyUpdateSignature('1.2.3', asset, otherKeys.publicKey), false);
  assert.equal(
    verifyUpdateSignature('1.2.3', { ...asset, signature: 'not-base64' }, trustedKeys.publicKey),
    false
  );
});

test('createUpdateSignaturePayload binds version, size, and hash', () => {
  assert.equal(
    createUpdateSignaturePayload('1.2.3', 123, 'A'.repeat(64)),
    `USG-NAT-Manager-Update-v1\nversion=1.2.3\nsize=123\nsha256=${'a'.repeat(64)}\n`
  );
});

test('validateDownloadedUpdate requires matching size, hash, and signature', () => {
  const keys = generateKeyPairSync('ed25519');
  const sha256 = 'c'.repeat(64);
  const asset = { ...validVersionInfo.files.full, sha256 };
  asset.signature = sign(
    null,
    Buffer.from(createUpdateSignaturePayload('1.2.3', asset.size, sha256)),
    keys.privateKey
  ).toString('base64');

  assert.doesNotThrow(() => validateDownloadedUpdate('1.2.3', asset, 123, sha256, keys.publicKey));
  assert.throws(
    () => validateDownloadedUpdate('1.2.3', asset, 122, sha256, keys.publicKey),
    /文件大小不匹配/
  );
  assert.throws(
    () => validateDownloadedUpdate('1.2.3', asset, 123, 'd'.repeat(64), keys.publicKey),
    /SHA-256不匹配/
  );
  assert.throws(
    () =>
      validateDownloadedUpdate(
        '1.2.3',
        { ...asset, signature: Buffer.alloc(64, 2).toString('base64') },
        123,
        sha256,
        keys.publicKey
      ),
    /数字签名无效/
  );
});

test('assertSafeUpdateRedirect rejects protocol abuse and TLS downgrades', () => {
  assert.doesNotThrow(() =>
    assertSafeUpdateRedirect('http://updates.example.com/file', 'https://updates.example.com/file')
  );
  assert.doesNotThrow(() =>
    assertSafeUpdateRedirect('https://updates.example.com/file', 'https://updates.example.com/next')
  );
  assert.throws(
    () =>
      assertSafeUpdateRedirect('https://updates.example.com/file', 'https://cdn.example.com/file'),
    /不安全的更新重定向/
  );
  assert.throws(
    () =>
      assertSafeUpdateRedirect('https://updates.example.com/file', 'http://cdn.example.com/file'),
    /不安全的更新重定向/
  );
  assert.throws(
    () => assertSafeUpdateRedirect('https://updates.example.com/file', 'file:///tmp/file'),
    /不安全的更新重定向/
  );
});

test('waitForInstallerSpawn resolves only after the installer starts', async () => {
  const child = new EventEmitter();
  const result = waitForInstallerSpawn(child);

  child.emit('spawn');

  await result;
});

test('waitForInstallerSpawn rejects installer launch failures', async () => {
  const child = new EventEmitter();
  const result = waitForInstallerSpawn(child);

  child.emit('error', new Error('launch failed'));

  await assert.rejects(result, /launch failed/);
});

test('assertDownloadWithinExpectedSize stops oversized downloads', () => {
  assert.doesNotThrow(() => assertDownloadWithinExpectedSize(123, 123));
  assert.throws(() => assertDownloadWithinExpectedSize(124, 123), /超过预期大小/);
});

const createManifestResponse = (complete: boolean) =>
  Object.assign(new EventEmitter(), {
    complete,
    destroy() {},
  }) as unknown as IncomingMessage;

test('readUpdateManifestResponse preserves UTF-8 characters split across chunks', async () => {
  const response = createManifestResponse(true);
  const result = readUpdateManifestResponse(response, 1024);
  const prefix = Buffer.from('{"message":"');
  const chinese = Buffer.from('更新');

  response.emit('data', Buffer.concat([prefix, chinese.subarray(0, 1)]));
  response.emit('data', Buffer.concat([chinese.subarray(1), Buffer.from('"}')]));
  response.emit('end');

  assert.equal(await result, '{"message":"更新"}');
});

test('readUpdateManifestResponse rejects aborted responses', async () => {
  const response = createManifestResponse(false);
  const result = readUpdateManifestResponse(response, 1024);

  response.emit('aborted');

  await assert.rejects(result, /中断/);
});

test('readUpdateManifestResponse rejects response stream errors', async () => {
  const response = createManifestResponse(false);
  const result = readUpdateManifestResponse(response, 1024);

  response.emit('error', new Error('connection reset'));

  await assert.rejects(result, /connection reset/);
});

test('readUpdateManifestResponse rejects incomplete responses at end', async () => {
  const response = createManifestResponse(false);
  const result = readUpdateManifestResponse(response, 1024);

  response.emit('end');

  await assert.rejects(result, /不完整/);
});

test('initializeUpdater finishes cleanup before starting update checks', async () => {
  const calls: string[] = [];

  await initializeUpdater(
    async () => {
      calls.push('cleanup-start');
      await Promise.resolve();
      calls.push('cleanup-end');
    },
    async () => {
      calls.push('check');
    }
  );

  assert.deepEqual(calls, ['cleanup-start', 'cleanup-end', 'check']);
});

test('runPeriodicUpdateCheck reports success only for successful silent checks', async () => {
  const calls: string[] = [];

  const succeeded = await runPeriodicUpdateCheck(async (showNoUpdateMessage) => {
    calls.push(`check:${showNoUpdateMessage}`);
    return { success: true };
  });
  const failed = await runPeriodicUpdateCheck(async () => ({ success: false }));

  assert.deepEqual(calls, ['check:false']);
  assert.equal(succeeded, true);
  assert.equal(failed, false);
});

test('ensureUpdateBackup blocks installation when backup creation fails', async () => {
  await assert.rejects(
    ensureUpdateBackup(async () => {
      throw new Error('disk full');
    }),
    /更新前备份失败.*disk full/
  );
});

test('closeAndDeleteFile waits for stream close and removes the partial download', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usg-update-download-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const filePath = path.join(tempDir, 'setup.exe');
  const stream = fs.createWriteStream(filePath);
  stream.write('partial download');

  await closeAndDeleteFile(stream, filePath);

  assert.equal(fs.existsSync(filePath), false);
});

test('withUnverifiedDownloadCleanup removes a file when post-download validation fails', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usg-update-validation-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const filePath = path.join(tempDir, 'setup.exe');
  fs.writeFileSync(filePath, 'unverified installer');

  await assert.rejects(
    withUnverifiedDownloadCleanup(filePath, async () => {
      throw new Error('hash read failed');
    }),
    /hash read failed/
  );

  assert.equal(fs.existsSync(filePath), false);
});

test('withUnverifiedDownloadCleanup preserves a verified file', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usg-update-validation-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const filePath = path.join(tempDir, 'setup.exe');
  fs.writeFileSync(filePath, 'verified installer');

  await withUnverifiedDownloadCleanup(filePath, async () => undefined);

  assert.equal(fs.existsSync(filePath), true);
});
