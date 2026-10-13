const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  PINNED_UPDATE_PUBLIC_KEY_SHA256,
  assertInstallerVersionMatchesRelease,
  createPolicySignaturePayload,
  generateSigningKeyPair,
  getPublicKeyFingerprint,
  signUpdate,
  verifyUpdate,
} = require('./sign-update.cjs');

const releaseMetadata = {
  version: '1.2.3',
  releaseDate: '2026-07-15',
  mandatory: false,
  minimumVersion: null,
  changelog: [{ type: 'fix', description: 'Fixed update flow' }],
};

const fixtureInstallerOptions = {
  readInstallerVersions: () => ({ fileVersion: '1.2.3', productVersion: '1.2.3.0' }),
};

const fixtureOptionsForKey = (publicKeyPath) => ({
  ...fixtureInstallerOptions,
  expectedPublicKeyFingerprint: getPublicKeyFingerprint(
    fs.readFileSync(publicKeyPath, 'utf8')
  ),
});

test('release key gate matches the public key pinned by the client', () => {
  const clientSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'main', 'services', 'custom-updater-helpers.ts'),
    'utf8'
  );
  const match = clientSource.match(
    /UPDATE_SIGNING_PUBLIC_KEY = `(-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----)`/
  );
  assert.ok(match, 'client pinned public key not found');
  assert.equal(getPublicKeyFingerprint(match[1]), PINNED_UPDATE_PUBLIC_KEY_SHA256);
});

test('installer PE file and product versions must match release metadata', () => {
  assert.equal(typeof assertInstallerVersionMatchesRelease, 'function');
  assert.doesNotThrow(() =>
    assertInstallerVersionMatchesRelease('setup.exe', '1.2.3', () => ({
      fileVersion: '1.2.3',
      productVersion: '1.2.3.0',
    }))
  );
  assert.throws(
    () =>
      assertInstallerVersionMatchesRelease('setup.exe', '1.2.3', () => ({
        fileVersion: '1.2.2.0',
        productVersion: '1.2.3',
      })),
    /PE版本.*发布版本/
  );
});

test('signUpdate binds version, size, and hash in an Ed25519 signature', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usg-update-signing-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const installerPath = path.join(tempDir, 'USG-NAT-Manager-Setup-1.2.3.exe');
  const privateKeyPath = path.join(tempDir, 'private.pem');
  const publicKeyPath = path.join(tempDir, 'public.pem');
  const signaturePath = `${installerPath}.sig`;
  fs.writeFileSync(installerPath, 'signed update fixture');

  generateSigningKeyPair(privateKeyPath, publicKeyPath);
  const result = await signUpdate(
    installerPath,
    releaseMetadata,
    privateKeyPath,
    signaturePath,
    undefined,
    fixtureOptionsForKey(publicKeyPath)
  );

  const publicKey = fs.readFileSync(publicKeyPath, 'utf8');
  const signature = Buffer.from(fs.readFileSync(signaturePath, 'utf8').trim(), 'base64');
  assert.equal(result.signaturePath, signaturePath);
  assert.equal(fs.existsSync(result.policySignaturePath), true);
  assert.equal(result.sha256.length, 64);
  const payload = Buffer.from(
    `USG-NAT-Manager-Update-v1\nversion=1.2.3\nsize=${result.size}\nsha256=${result.sha256}\n`
  );
  assert.equal(crypto.verify(null, payload, publicKey, signature), true);
  assert.equal(
    crypto.verify(null, Buffer.from(payload.toString().replace('1.2.3', '1.2.4')), publicKey, signature),
    false
  );
});

test('policy signature binds release policy and display metadata', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usg-update-policy-signing-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const installerPath = path.join(tempDir, 'USG-NAT-Manager-Setup-1.2.3.exe');
  const privateKeyPath = path.join(tempDir, 'private.pem');
  const publicKeyPath = path.join(tempDir, 'public.pem');
  fs.writeFileSync(installerPath, 'signed update fixture');
  generateSigningKeyPair(privateKeyPath, publicKeyPath);

  const signed = await signUpdate(
    installerPath,
    releaseMetadata,
    privateKeyPath,
    undefined,
    undefined,
    fixtureOptionsForKey(publicKeyPath)
  );
  const policySignature = Buffer.from(
    fs.readFileSync(signed.policySignaturePath, 'utf8').trim(),
    'base64'
  );
  const publicKey = fs.readFileSync(publicKeyPath, 'utf8');

  assert.equal(
    crypto.verify(
      null,
      Buffer.from(createPolicySignaturePayload(releaseMetadata, signed.size, signed.sha256)),
      publicKey,
      policySignature
    ),
    true
  );
  assert.equal(
    crypto.verify(
      null,
      Buffer.from(
        createPolicySignaturePayload({ ...releaseMetadata, mandatory: true }, signed.size, signed.sha256)
      ),
      publicKey,
      policySignature
    ),
    false
  );
});

test('release metadata rejects changelog entries the client cannot parse', () => {
  assert.throws(
    () => createPolicySignaturePayload({ ...releaseMetadata, changelog: [42] }, 1, 'a'.repeat(64)),
    /发布元数据格式无效/
  );
});

test('signUpdate rejects a private key that does not match the client pinned key', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usg-update-wrong-key-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const installerPath = path.join(tempDir, 'USG-NAT-Manager-Setup-1.2.3.exe');
  const privateKeyPath = path.join(tempDir, 'private.pem');
  const publicKeyPath = path.join(tempDir, 'public.pem');
  fs.writeFileSync(installerPath, 'wrong key fixture');
  generateSigningKeyPair(privateKeyPath, publicKeyPath);

  await assert.rejects(
    signUpdate(
      installerPath,
      releaseMetadata,
      privateKeyPath,
      undefined,
      undefined,
      fixtureInstallerOptions
    ),
    /客户端固定公钥/
  );
});

test('generateSigningKeyPair refuses to overwrite an existing private key', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usg-update-key-'));
  const privateKeyPath = path.join(tempDir, 'private.pem');
  const publicKeyPath = path.join(tempDir, 'public.pem');

  try {
    fs.writeFileSync(privateKeyPath, 'keep-me');
    assert.throws(
      () => generateSigningKeyPair(privateKeyPath, publicKeyPath),
      /密钥文件已存在/
    );
    assert.equal(fs.readFileSync(privateKeyPath, 'utf8'), 'keep-me');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('verifyUpdate rejects a tampered installer before release', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usg-update-verification-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const installerPath = path.join(tempDir, 'USG-NAT-Manager-Setup-1.2.3.exe');
  const privateKeyPath = path.join(tempDir, 'private.pem');
  const publicKeyPath = path.join(tempDir, 'public.pem');
  fs.writeFileSync(installerPath, 'release fixture');
  generateSigningKeyPair(privateKeyPath, publicKeyPath);
  await signUpdate(
    installerPath,
    releaseMetadata,
    privateKeyPath,
    undefined,
    undefined,
    fixtureOptionsForKey(publicKeyPath)
  );

  const result = await verifyUpdate(
    installerPath,
    releaseMetadata,
    publicKeyPath,
    undefined,
    undefined,
    fixtureOptionsForKey(publicKeyPath)
  );
  assert.equal(result.version, '1.2.3');
  assert.equal(result.size, fs.statSync(installerPath).size);

  fs.appendFileSync(installerPath, 'tampered');
  await assert.rejects(
    verifyUpdate(
      installerPath,
      releaseMetadata,
      publicKeyPath,
      undefined,
      undefined,
      fixtureOptionsForKey(publicKeyPath)
    ),
    /签名验证失败/
  );
});

test('signUpdate rejects a filename that does not match release version', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usg-update-version-mismatch-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const installerPath = path.join(tempDir, 'USG-NAT-Manager-Setup-9.9.9.exe');
  const privateKeyPath = path.join(tempDir, 'private.pem');
  const publicKeyPath = path.join(tempDir, 'public.pem');
  fs.writeFileSync(installerPath, 'release fixture');
  generateSigningKeyPair(privateKeyPath, publicKeyPath);

  await assert.rejects(
    signUpdate(
      installerPath,
      releaseMetadata,
      privateKeyPath,
      undefined,
      undefined,
      fixtureInstallerOptions
    ),
    /文件名版本.*发布版本/
  );
});
