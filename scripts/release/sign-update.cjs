const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { readCredential } = require('./signing-credentials.cjs');

const SEMANTIC_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const RELEASE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PINNED_UPDATE_PUBLIC_KEY_SHA256 =
  '353a53ff3d403508bda9b653ea0341d59fb5675ba858d33d5613f2b6431e8744';

function getPublicKeyFingerprint(key) {
  const publicKey = crypto.createPublicKey(key);
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(spki).digest('hex');
}

function assertPinnedUpdateKey(key, expectedFingerprint = PINNED_UPDATE_PUBLIC_KEY_SHA256) {
  if (getPublicKeyFingerprint(key) !== expectedFingerprint) {
    throw new Error('签名密钥与客户端固定公钥不匹配');
  }
}

function generateSigningKeyPair(privateKeyPath, publicKeyPath) {
  if (fs.existsSync(privateKeyPath) || fs.existsSync(publicKeyPath)) {
    throw new Error('密钥文件已存在，拒绝覆盖');
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  fs.mkdirSync(path.dirname(privateKeyPath), { recursive: true });
  fs.mkdirSync(path.dirname(publicKeyPath), { recursive: true });
  fs.writeFileSync(privateKeyPath, privateKey, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  fs.writeFileSync(publicKeyPath, publicKey, { encoding: 'utf8', flag: 'wx' });
}

function calculateSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function createSignaturePayload(version, size, sha256) {
  if (!SEMANTIC_VERSION_PATTERN.test(version)) {
    throw new Error('Version must use x.y.z format');
  }

  return `USG-NAT-Manager-Update-v1\nversion=${version}\nsize=${size}\nsha256=${sha256.toLowerCase()}\n`;
}

function isReleaseChangelogItem(value) {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  return (
    value !== null &&
    typeof value === 'object' &&
    (value.type === 'feature' || value.type === 'improve' || value.type === 'fix') &&
    typeof value.description === 'string' &&
    value.description.trim().length > 0
  );
}

function normalizeReleaseMetadata(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    !SEMANTIC_VERSION_PATTERN.test(String(value.version)) ||
    !RELEASE_DATE_PATTERN.test(String(value.releaseDate)) ||
    typeof value.mandatory !== 'boolean' ||
    (value.minimumVersion !== null &&
      value.minimumVersion !== undefined &&
      !SEMANTIC_VERSION_PATTERN.test(String(value.minimumVersion))) ||
    (!Array.isArray(value.changelog) || !value.changelog.every(isReleaseChangelogItem))
  ) {
    throw new Error('发布元数据格式无效');
  }

  return {
    version: String(value.version),
    releaseDate: String(value.releaseDate),
    mandatory: value.mandatory,
    minimumVersion: value.minimumVersion ? String(value.minimumVersion) : null,
    changelog: value.changelog,
  };
}

function createPolicySignaturePayload(metadata, size, sha256) {
  const release = normalizeReleaseMetadata(metadata);
  return [
    'USG-NAT-Manager-Update-Policy-v1',
    `version=${release.version}`,
    `releaseDate=${release.releaseDate}`,
    `mandatory=${release.mandatory ? 'true' : 'false'}`,
    `minimumVersion=${release.minimumVersion || ''}`,
    `changelog=${JSON.stringify(release.changelog)}`,
    `size=${size}`,
    `sha256=${sha256.toLowerCase()}`,
    '',
  ].join('\n');
}

function assertInstallerFileNameVersion(installerPath, version) {
  const expected = `USG-NAT-Manager-Setup-${version}.exe`;
  if (path.basename(installerPath) !== expected) {
    throw new Error(`安装包文件名版本必须与发布版本一致: 预期 ${expected}`);
  }
}

function normalizeWindowsVersion(value) {
  const match = String(value || '')
    .trim()
    .match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (!match) {
    throw new Error(`安装包PE版本格式无效: ${value || 'missing'}`);
  }

  const parts = match.slice(1).filter((part) => part !== undefined);
  while (parts.length > 3 && parts.at(-1) === '0') {
    parts.pop();
  }
  return parts.join('.');
}

function readWindowsInstallerVersions(installerPath) {
  if (process.platform !== 'win32') {
    throw new Error('安装包PE版本校验目前需要在Windows上执行');
  }

  const command = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$info = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($env:USG_INSTALLER_VERSION_PATH)',
    '@{ fileVersion = $info.FileVersion; productVersion = $info.ProductVersion } | ConvertTo-Json -Compress',
  ].join('; ');
  return JSON.parse(
    execFileSync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
      {
        encoding: 'utf8',
        env: { ...process.env, USG_INSTALLER_VERSION_PATH: path.resolve(installerPath) },
        windowsHide: true,
      }
    ).trim()
  );
}

function assertInstallerVersionMatchesRelease(
  installerPath,
  version,
  readInstallerVersions = readWindowsInstallerVersions
) {
  const installerVersions = readInstallerVersions(installerPath);
  const expectedVersion = normalizeWindowsVersion(version);
  const fileVersion = normalizeWindowsVersion(installerVersions.fileVersion);
  const productVersion = normalizeWindowsVersion(installerVersions.productVersion);
  if (fileVersion !== expectedVersion || productVersion !== expectedVersion) {
    throw new Error(
      `安装包PE版本与发布版本不一致: FileVersion=${installerVersions.fileVersion}, ` +
        `ProductVersion=${installerVersions.productVersion}, release=${version}`
    );
  }
}

function readReleaseMetadata(metadataPath) {
  return normalizeReleaseMetadata(JSON.parse(fs.readFileSync(metadataPath, 'utf8')));
}

function assertReleaseVersionMatchesPackage(version) {
  const packageVersion = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')
  ).version;
  if (version !== packageVersion) {
    throw new Error(`发布版本 ${version} 与 package.json 版本 ${packageVersion} 不一致`);
  }
}

async function signUpdate(
  installerPath,
  metadata,
  privateKeyPath,
  signaturePath = `${installerPath}.sig`,
  policySignaturePath = `${installerPath}.policy.sig`,
  options = {}
) {
  const release = normalizeReleaseMetadata(metadata);
  assertInstallerFileNameVersion(installerPath, release.version);
  assertInstallerVersionMatchesRelease(
    installerPath,
    release.version,
    options.readInstallerVersions
  );
  const sha256 = await calculateSha256(installerPath);
  const size = fs.statSync(installerPath).size;
  const privateKey = privateKeyPath.startsWith('wincred:')
    ? readCredential(privateKeyPath.slice('wincred:'.length))
    : fs.readFileSync(privateKeyPath, 'utf8');
  if (!privateKey) throw new Error('Signing credential not found');
  assertPinnedUpdateKey(privateKey, options.expectedPublicKeyFingerprint);
  const signature = crypto
    .sign(null, Buffer.from(createSignaturePayload(release.version, size, sha256)), privateKey)
    .toString('base64');
  const policySignature = crypto
    .sign(null, Buffer.from(createPolicySignaturePayload(release, size, sha256)), privateKey)
    .toString('base64');

  fs.writeFileSync(signaturePath, `${signature}\n`, { encoding: 'ascii', mode: 0o644 });
  fs.writeFileSync(policySignaturePath, `${policySignature}\n`, {
    encoding: 'ascii',
    mode: 0o644,
  });
  return {
    sha256,
    signaturePath,
    policySignaturePath,
    size,
    version: release.version,
  };
}

async function verifyUpdate(
  installerPath,
  metadata,
  publicKeyPath,
  signaturePath = `${installerPath}.sig`,
  policySignaturePath = `${installerPath}.policy.sig`,
  options = {}
) {
  const release = normalizeReleaseMetadata(metadata);
  assertInstallerFileNameVersion(installerPath, release.version);
  assertInstallerVersionMatchesRelease(
    installerPath,
    release.version,
    options.readInstallerVersions
  );
  const sha256 = await calculateSha256(installerPath);
  const size = fs.statSync(installerPath).size;
  const publicKey = fs.readFileSync(publicKeyPath, 'utf8');
  assertPinnedUpdateKey(publicKey, options.expectedPublicKeyFingerprint);
  const signatureText = fs.readFileSync(signaturePath, 'ascii').trim();
  const policySignatureText = fs.readFileSync(policySignaturePath, 'ascii').trim();
  const signature = Buffer.from(signatureText, 'base64');
  const policySignature = Buffer.from(policySignatureText, 'base64');

  if (
    signature.length !== 64 ||
    signature.toString('base64') !== signatureText ||
    !crypto.verify(
      null,
      Buffer.from(createSignaturePayload(release.version, size, sha256)),
      publicKey,
      signature
    )
  ) {
    throw new Error('更新安装包签名验证失败');
  }

  if (
    policySignature.length !== 64 ||
    policySignature.toString('base64') !== policySignatureText ||
    !crypto.verify(
      null,
      Buffer.from(createPolicySignaturePayload(release, size, sha256)),
      publicKey,
      policySignature
    )
  ) {
    throw new Error('更新策略签名验证失败');
  }

  return { sha256, signaturePath, policySignaturePath, size, version: release.version };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (command === 'generate' && args.length === 2) {
    generateSigningKeyPair(args[0], args[1]);
    process.stdout.write(`Signing key pair created. Public key: ${args[1]}\n`);
    return;
  }

  if (command === 'sign' && (args.length === 3 || args.length === 4)) {
    const metadata = readReleaseMetadata(args[1]);
    assertReleaseVersionMatchesPackage(metadata.version);
    const result = await signUpdate(args[0], metadata, args[2], args[3]);
    process.stdout.write(
      `SHA-256: ${result.sha256}\nSignature: ${result.signaturePath}\nPolicy signature: ${result.policySignaturePath}\n`
    );
    return;
  }

  if (command === 'verify' && (args.length === 3 || args.length === 4)) {
    const metadata = readReleaseMetadata(args[1]);
    assertReleaseVersionMatchesPackage(metadata.version);
    const result = await verifyUpdate(args[0], metadata, args[2], args[3]);
    process.stdout.write(
      `Verified: version=${result.version} size=${result.size} sha256=${result.sha256}\n`
    );
    return;
  }

  throw new Error(
    'Usage:\n' +
      '  node sign-update.cjs generate <private-key.pem> <public-key.pem>\n' +
      '  node sign-update.cjs sign <installer> <release-metadata.json> <private-key.pem|wincred:target> [installer.sig]\n' +
      '  node sign-update.cjs verify <installer> <release-metadata.json> <public-key.pem> [installer.sig]'
  );
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  PINNED_UPDATE_PUBLIC_KEY_SHA256,
  assertInstallerVersionMatchesRelease,
  assertPinnedUpdateKey,
  calculateSha256,
  createPolicySignaturePayload,
  createSignaturePayload,
  generateSigningKeyPair,
  getPublicKeyFingerprint,
  signUpdate,
  verifyUpdate,
};
