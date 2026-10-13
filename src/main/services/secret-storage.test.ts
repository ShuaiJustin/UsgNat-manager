import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import CryptoJS from 'crypto-js';
import { SecretStorage } from './secret-storage.ts';

test('concurrent initialization shares one key and preserves all encrypted values', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'usg-secret-test-'));
  try {
    const store = new SecretStorage(path.join(dir, 'key'), {
      isEncryptionAvailable: () => false,
      encryptString: () => {
        throw new Error('unavailable');
      },
      decryptString: () => {
        throw new Error('unavailable');
      },
    });
    const values = await Promise.all(
      Array.from({ length: 30 }, (_, i) => store.protect(`password-${i}`))
    );
    assert.deepEqual(
      await Promise.all(values.map((v) => store.reveal(v))),
      Array.from({ length: 30 }, (_, i) => `password-${i}`)
    );
    const key = await fs.readFile(path.join(dir, 'key'), 'utf8');
    assert.equal(await store.reveal(CryptoJS.AES.encrypt('legacy', key).toString()), 'legacy');
    await assert.rejects(
      store.reveal(CryptoJS.AES.encrypt('other', 'other-key').toString()),
      /密钥不匹配/
    );
    const damaged = Buffer.from(values[0].slice('aes:v2:'.length), 'base64');
    damaged[damaged.length - 1] ^= 1;
    await assert.rejects(store.reveal('aes:v2:' + damaged.toString('base64')), /密文损坏/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('OS encryption is preferred and cannot silently decode on another account', async () => {
  const store = new SecretStorage('unused', {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value),
    decryptString: (value) => value.toString(),
  });
  const protectedValue = await store.protect('private-key');
  assert.match(protectedValue, /^safe:v1:/);
  assert.equal(await store.reveal(protectedValue), 'private-key');
  const other = new SecretStorage('unused', {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value),
    decryptString: () => {
      throw new Error('wrong account');
    },
  });
  await assert.rejects(other.reveal(protectedValue), /不属于当前系统账户/);
});
