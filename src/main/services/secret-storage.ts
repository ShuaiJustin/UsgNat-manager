import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import path from 'node:path';
import CryptoJS from 'crypto-js';

export interface SafeStorageProvider {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}

const OS_PREFIX = 'safe:v1:';
const AES_PREFIX = 'aes:v1:';
const AES_GCM_PREFIX = 'aes:v2:';

/** One initializer per service instance; callers share the exported app instance. */
export class SecretStorage {
  private keyPromise?: Promise<string>;
  private keyPath: string;
  private osStorage: SafeStorageProvider;

  constructor(keyPath: string, osStorage: SafeStorageProvider) {
    this.keyPath = keyPath;
    this.osStorage = osStorage;
  }

  private key(): Promise<string> {
    this.keyPromise ??= (async () => {
      await fs.mkdir(path.dirname(this.keyPath), { recursive: true });
      try {
        const key = (await fs.readFile(this.keyPath, 'utf8')).trim();
        if (!/^[a-f\d]{64}$/i.test(key)) throw new Error('凭据密钥文件损坏');
        return key;
      } catch (error) {
        if ((error as { code?: string }).code !== 'ENOENT') throw error;
        const key = randomBytes(32).toString('hex');
        try {
          await fs.writeFile(this.keyPath, key, { flag: 'wx', mode: 0o600 });
          return key;
        } catch (writeError) {
          if ((writeError as { code?: string }).code !== 'EEXIST') throw writeError;
          const existing = (await fs.readFile(this.keyPath, 'utf8')).trim();
          if (!/^[a-f\d]{64}$/i.test(existing)) throw new Error('凭据密钥文件损坏');
          return existing;
        }
      }
    })();
    return this.keyPromise;
  }

  private osAvailable(): boolean {
    return (
      this.osStorage.isEncryptionAvailable() &&
      this.osStorage.getSelectedStorageBackend?.() !== 'basic_text'
    );
  }

  isProtected(value: string): boolean {
    return (
      value.startsWith(OS_PREFIX) ||
      value.startsWith(AES_PREFIX) ||
      value.startsWith(AES_GCM_PREFIX)
    );
  }

  async protect(value: string): Promise<string> {
    if (this.osAvailable()) {
      return OS_PREFIX + this.osStorage.encryptString(value).toString('base64');
    }
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(await this.key(), 'hex'), nonce);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return (
      AES_GCM_PREFIX + Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64')
    );
  }

  async reveal(value: string): Promise<string> {
    if (value.startsWith(OS_PREFIX)) {
      if (!this.osAvailable())
        throw new Error('当前系统无法解密凭据，请在原系统账户恢复或重新录入');
      try {
        return this.osStorage.decryptString(Buffer.from(value.slice(OS_PREFIX.length), 'base64'));
      } catch {
        throw new Error('凭据不属于当前系统账户或已损坏，请重新录入');
      }
    }
    if (value.startsWith(AES_GCM_PREFIX)) {
      try {
        const payload = Buffer.from(value.slice(AES_GCM_PREFIX.length), 'base64');
        if (payload.length < 28) throw new Error('invalid encrypted payload');
        const decipher = createDecipheriv(
          'aes-256-gcm',
          Buffer.from(await this.key(), 'hex'),
          payload.subarray(0, 12)
        );
        decipher.setAuthTag(payload.subarray(12, 28));
        return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString(
          'utf8'
        );
      } catch {
        throw new Error('凭据密钥不匹配或密文损坏，请重新录入');
      }
    }
    const cipher = value.startsWith(AES_PREFIX) ? value.slice(AES_PREFIX.length) : value;
    try {
      const result = CryptoJS.AES.decrypt(cipher, await this.key()).toString(CryptoJS.enc.Utf8);
      if (!result) throw new Error('empty');
      return result;
    } catch {
      throw new Error('凭据密钥不匹配或密文损坏，请重新录入');
    }
  }

  async fingerprint(): Promise<string> {
    return createHash('sha256')
      .update(await this.key())
      .digest('hex');
  }
}
