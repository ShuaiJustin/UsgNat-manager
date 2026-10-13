const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vault = fs.existsSync(path.join(__dirname, 'signing-credentials.cjs'))
  ? require('./signing-credentials.cjs')
  : {};

test('credential targets stay within the signing namespace', () => {
  assert.equal(typeof vault.readCredential, 'function');
  for (const target of ['OtherApp/key', 'USG-NAT-Manager/update-signing/test/short', 'bad\ntarget']) {
    assert.throws(() => vault.readCredential(target), /credential target/i);
  }
});

test('native credential roundtrip refuses overwrite and deletes only test entries', {
  skip: process.platform !== 'win32',
}, (t) => {
  const target = 'USG-NAT-Manager/update-signing/test/' + crypto.randomBytes(16).toString('hex');
  let owned = false;
  assert.equal(typeof vault.writeNewCredential, 'function');
  t.after(() => { if (owned) vault.deleteTestCredential(target); });
  assert.equal(vault.readCredential(target), null);
  const value = 'synthetic-test-' + crypto.randomBytes(16).toString('hex');
  vault.writeNewCredential(target, value);
  owned = true;
  assert.ok(vault.readCredential(target) === value, 'credential roundtrip mismatch');
  assert.throws(() => vault.writeNewCredential(target, 'replacement'), /credential operation failed/i);
  assert.ok(vault.readCredential(target) === value, 'existing credential was overwritten');
  let actionCalled = false;
  assert.throws(() => vault.withTestCredential(target, 'replacement', () => { actionCalled = true; }), /credential operation failed/i);
  assert.equal(actionCalled, false);
  assert.ok(vault.readCredential(target) === value, 'rejected temporary creation deleted another owner');
  assert.throws(() => vault.deleteTestCredential(
    'USG-NAT-Manager/update-signing/key/' + 'a'.repeat(64)
  ), /test credential/i);
});

test('real signer reads its private key from the Windows credential store', {
  skip: process.platform !== 'win32',
}, async (t) => {
  const target = 'USG-NAT-Manager/update-signing/test/' + crypto.randomBytes(16).toString('hex');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'usg-vault-signing-'));
  let owned = false;
  t.after(() => { if (owned) vault.deleteTestCredential(target); fs.rmSync(directory, { recursive: true, force: true }); });
  const keys = crypto.generateKeyPairSync('ed25519');
  const publicPem = keys.publicKey.export({ format: 'pem', type: 'spki' });
  vault.writeNewCredential(target, keys.privateKey.export({ format: 'pem', type: 'pkcs8' }));
  owned = true;
  const installer = path.join(directory, 'USG-NAT-Manager-Setup-1.2.3.exe');
  const publicPath = path.join(directory, 'public.pem');
  fs.writeFileSync(installer, 'synthetic installer');
  fs.writeFileSync(publicPath, publicPem);
  const signer = require('./sign-update.cjs');
  const metadata = { version: '1.2.3', releaseDate: '2026-10-13', mandatory: false, minimumVersion: null, changelog: [] };
  const options = { expectedPublicKeyFingerprint: signer.getPublicKeyFingerprint(publicPem), readInstallerVersions: () => ({ fileVersion: '1.2.3', productVersion: '1.2.3' }) };
  const signed = await signer.signUpdate(installer, metadata, 'wincred:' + target, undefined, undefined, options);
  const verified = await signer.verifyUpdate(installer, metadata, publicPath, undefined, undefined, options);
  assert.equal(verified.sha256, signed.sha256);
  assert.equal(verified.size, fs.statSync(installer).size);
  assert.equal(fs.readdirSync(directory).filter(name => /private/i.test(name)).length, 0);
});

test('concurrent processes create one credential without replacing the winner', {
  skip: process.platform !== 'win32',
}, async (t) => {
  const target = 'USG-NAT-Manager/update-signing/test/' + crypto.randomBytes(16).toString('hex');
  let owned = false;
  t.after(() => { if (owned) vault.deleteTestCredential(target); });
  const modulePath = path.join(__dirname, 'signing-credentials.cjs');
  const code = `const v=require(process.argv[1]);try{v.writeNewCredential(process.argv[2],process.argv[3]);process.stdout.write('created')}catch{process.stdout.write('refused')}`;
  const values = Array.from({ length: 4 }, (_, i) => `synthetic-concurrent-${i}`);
  const outcomes = await Promise.all(values.map(value => new Promise((resolve, reject) => {
    execFile(process.execPath, ['-e', code, modulePath, target, value], { windowsHide: true, timeout: 30000 },
      (error, stdout) => error ? reject(new Error('Synthetic credential worker failed')) : resolve(stdout));
  })));
  owned = outcomes.includes('created');
  assert.equal(outcomes.filter(value => value === 'created').length, 1);
  assert.equal(outcomes.filter(value => value === 'refused').length, values.length - 1);
  assert.equal(vault.readCredential(target), values[outcomes.indexOf('created')]);
});
