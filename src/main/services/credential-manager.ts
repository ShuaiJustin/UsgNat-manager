import CryptoJS from 'crypto-js';
import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { prisma } from './prisma-client';

/**
 * 凭据类型
 */
export type AuthType = 'Password' | 'PrivateKey' | 'Certificate' | 'MultiFactor';

/**
 * 凭据信息
 */
export interface Credential {
  deviceId: string;
  authType: AuthType;
  username?: string;
  password?: string;
  privateKey?: string;
  privateKeyPath?: string;
  certificate?: string;
  certificatePath?: string;
  passphrase?: string;
  mfaType?: 'TOTP' | 'SMS' | 'Email' | 'Hardware';
  mfaSecret?: string;
}

/**
 * 凭据管理器
 * 负责安全地存储和检索设备凭据
 */
class CredentialManager {
  private encryptionKey: string;
  private keyFilePath: string;
  private keyInitialized: boolean = false;

  constructor() {
    // 生成或加载加密密钥
    this.keyFilePath = path.join(app.getPath('userData'), '.credential-key');
    this.encryptionKey = '';
    // 异步初始化，不阻塞构造函数
    this.initializeEncryptionKey().catch((error) => {
      console.error('凭据管理器初始化失败:', error);
    });
  }

  /**
   * 初始化加密密钥
   */
  private async initializeEncryptionKey(): Promise<void> {
    try {
      // 尝试读取现有密钥
      const keyData = await fs.readFile(this.keyFilePath, 'utf-8');
      this.encryptionKey = keyData.trim();
      this.keyInitialized = true;
    } catch {
      // 如果密钥文件不存在，生成新密钥
      this.encryptionKey = this.generateEncryptionKey();
      await fs.writeFile(this.keyFilePath, this.encryptionKey, { mode: 0o600 });
      this.keyInitialized = true;
    }
  }

  /**
   * 确保加密密钥已初始化
   */
  private async ensureKeyInitialized(): Promise<void> {
    if (!this.keyInitialized) {
      await this.initializeEncryptionKey();
    }
  }

  /**
   * 生成加密密钥
   */
  private generateEncryptionKey(): string {
    return CryptoJS.lib.WordArray.random(32).toString();
  }

  /**
   * 加密数据
   */
  private encrypt(data: string): string {
    return CryptoJS.AES.encrypt(data, this.encryptionKey).toString();
  }

  /**
   * 解密数据
   */
  private decrypt(encryptedData: string): string {
    const bytes = CryptoJS.AES.decrypt(encryptedData, this.encryptionKey);
    return bytes.toString(CryptoJS.enc.Utf8);
  }

  /**
   * 保存凭据
   */
  async saveCredential(credential: Credential): Promise<void> {
    // 确保加密密钥已初始化
    await this.ensureKeyInitialized();
    
    // 加密敏感信息
    const encryptedPassword = credential.password ? this.encrypt(credential.password) : undefined;
    // TODO: 如需支持 passphrase 和 MFA，可在此处加密
    // const encryptedPassphrase = credential.passphrase ? this.encrypt(credential.passphrase) : undefined;
    // const encryptedMfaSecret = credential.mfaSecret ? this.encrypt(credential.mfaSecret) : undefined;

    // 处理私钥
    let privateKeyContent: string | undefined;
    if (credential.privateKeyPath) {
      privateKeyContent = await fs.readFile(credential.privateKeyPath, 'utf-8');
    } else if (credential.privateKey) {
      privateKeyContent = credential.privateKey;
    }

    // 处理证书
    let certificateContent: string | undefined;
    if (credential.certificatePath) {
      certificateContent = await fs.readFile(credential.certificatePath, 'utf-8');
    } else if (credential.certificate) {
      certificateContent = credential.certificate;
    }

    // 保存到数据库
    await prisma.credentialRef.upsert({
      where: { deviceId: credential.deviceId },
      create: {
        deviceId: credential.deviceId,
        authType: credential.authType,
        username: credential.username,
        secretRef: encryptedPassword,
        privateKey: privateKeyContent,
        certificate: certificateContent,
        mfaType: credential.mfaType,
      },
      update: {
        authType: credential.authType,
        username: credential.username,
        secretRef: encryptedPassword,
        privateKey: privateKeyContent,
        certificate: certificateContent,
        mfaType: credential.mfaType,
      },
    });
  }

  /**
   * 获取凭据
   */
  async getCredential(deviceId: string): Promise<Credential | null> {
    // 确保加密密钥已初始化
    await this.ensureKeyInitialized();
    
    const credentialRef = await prisma.credentialRef.findUnique({
      where: { deviceId },
    });

    if (!credentialRef) {
      return null;
    }

    // 解密敏感信息
    const password = credentialRef.secretRef ? this.decrypt(credentialRef.secretRef) : undefined;

    return {
      deviceId: credentialRef.deviceId,
      authType: credentialRef.authType as AuthType,
      username: credentialRef.username || undefined,
      password,
      privateKey: credentialRef.privateKey || undefined,
      certificate: credentialRef.certificate || undefined,
      mfaType: credentialRef.mfaType as any,
    };
  }

  /**
   * 删除凭据
   */
  async deleteCredential(deviceId: string): Promise<void> {
    await prisma.credentialRef.deleteMany({
      where: { deviceId },
    });
  }

  /**
   * 验证凭据是否存在
   */
  async hasCredential(deviceId: string): Promise<boolean> {
    const count = await prisma.credentialRef.count({
      where: { deviceId },
    });
    return count > 0;
  }

  /**
   * 更新密码
   */
  async updatePassword(deviceId: string, newPassword: string): Promise<void> {
    // 确保加密密钥已初始化
    await this.ensureKeyInitialized();
    
    const encryptedPassword = this.encrypt(newPassword);
    await prisma.credentialRef.update({
      where: { deviceId },
      data: { secretRef: encryptedPassword },
    });
  }

  /**
   * 导入私钥文件
   */
  async importPrivateKey(deviceId: string, filePath: string): Promise<void> {
    const privateKeyContent = await fs.readFile(filePath, 'utf-8');
    await prisma.credentialRef.update({
      where: { deviceId },
      data: { privateKey: privateKeyContent },
    });
  }

  /**
   * 导出私钥到文件
   */
  async exportPrivateKey(deviceId: string, outputPath: string): Promise<void> {
    const credential = await this.getCredential(deviceId);
    if (!credential || !credential.privateKey) {
      throw new Error('私钥不存在');
    }
    await fs.writeFile(outputPath, credential.privateKey, { mode: 0o600 });
  }

  /**
   * 验证密码强度
   */
  validatePasswordStrength(password: string): {
    valid: boolean;
    strength: 'weak' | 'medium' | 'strong';
    issues: string[];
  } {
    const issues: string[] = [];
    let score = 0;

    // 长度检查
    if (password.length < 8) {
      issues.push('密码长度至少8个字符');
    } else if (password.length >= 12) {
      score += 2;
    } else {
      score += 1;
    }

    // 包含大写字母
    if (/[A-Z]/.test(password)) {
      score += 1;
    } else {
      issues.push('应包含大写字母');
    }

    // 包含小写字母
    if (/[a-z]/.test(password)) {
      score += 1;
    } else {
      issues.push('应包含小写字母');
    }

    // 包含数字
    if (/[0-9]/.test(password)) {
      score += 1;
    } else {
      issues.push('应包含数字');
    }

    // 包含特殊字符
    if (/[^A-Za-z0-9]/.test(password)) {
      score += 1;
    } else {
      issues.push('应包含特殊字符');
    }

    let strength: 'weak' | 'medium' | 'strong';
    if (score >= 5) {
      strength = 'strong';
    } else if (score >= 3) {
      strength = 'medium';
    } else {
      strength = 'weak';
    }

    return {
      valid: issues.length === 0 && score >= 3,
      strength,
      issues,
    };
  }

  /**
   * 清理所有凭据（危险操作）
   */
  async clearAllCredentials(): Promise<number> {
    const result = await prisma.credentialRef.deleteMany({});
    return result.count;
  }
}

// 导出单例
export const credentialManager = new CredentialManager();
