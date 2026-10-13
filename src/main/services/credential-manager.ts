import fs from 'fs/promises';
import { prisma } from './prisma-client';
import { secretStorage } from './secret-protection';

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

type MfaType = Credential['mfaType'];

/**
 * 凭据管理器
 * 负责安全地存储和检索设备凭据
 */
class CredentialManager {
  /**
   * 保存凭据
   */
  async saveCredential(credential: Credential): Promise<void> {
    const encryptedPassword =
      'credential:v1:' +
      (await secretStorage.protect(
        JSON.stringify({
          password: credential.password,
          passphrase: credential.passphrase,
        })
      ));

    // 处理私钥
    let privateKeyContent: string | undefined;
    if (credential.privateKeyPath) {
      privateKeyContent = await fs.readFile(credential.privateKeyPath, 'utf-8');
    } else if (credential.privateKey) {
      privateKeyContent = credential.privateKey;
    }
    if (privateKeyContent) privateKeyContent = await secretStorage.protect(privateKeyContent);

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
    const credentialRef = await prisma.credentialRef.findUnique({
      where: { deviceId },
    });

    if (!credentialRef) {
      return null;
    }

    const secrets = credentialRef.secretRef?.startsWith('credential:v1:')
      ? (JSON.parse(
          await secretStorage.reveal(credentialRef.secretRef.slice('credential:v1:'.length))
        ) as { password?: string; passphrase?: string })
      : {
          password: credentialRef.secretRef
            ? await secretStorage.reveal(credentialRef.secretRef)
            : undefined,
        };
    if (
      !secrets ||
      typeof secrets !== 'object' ||
      Array.isArray(secrets) ||
      (secrets.password !== undefined && typeof secrets.password !== 'string') ||
      (secrets.passphrase !== undefined && typeof secrets.passphrase !== 'string')
    ) {
      throw new Error('凭据内容无效，请重新录入');
    }
    const privateKey = credentialRef.privateKey
      ? secretStorage.isProtected(credentialRef.privateKey)
        ? await secretStorage.reveal(credentialRef.privateKey)
        : credentialRef.privateKey
      : undefined;
    // Migrate legacy plaintext keys on successful read without losing the authentication payload.
    const migrateKey = privateKey && !secretStorage.isProtected(credentialRef.privateKey!);
    const migrateSecret =
      credentialRef.secretRef && !credentialRef.secretRef.startsWith('credential:v1:');
    if (migrateKey || migrateSecret) {
      await prisma.credentialRef.updateMany({
        where: {
          id: credentialRef.id,
          privateKey: credentialRef.privateKey,
          secretRef: credentialRef.secretRef,
        },
        data: {
          privateKey: migrateKey ? await secretStorage.protect(privateKey) : undefined,
          secretRef: migrateSecret
            ? 'credential:v1:' + (await secretStorage.protect(JSON.stringify(secrets)))
            : undefined,
        },
      });
    }

    return {
      deviceId: credentialRef.deviceId,
      authType: credentialRef.authType as AuthType,
      username: credentialRef.username || undefined,
      password: secrets.password,
      passphrase: secrets.passphrase,
      privateKey,
      certificate: credentialRef.certificate || undefined,
      mfaType: credentialRef.mfaType as MfaType,
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
    const current = await this.getCredential(deviceId);
    const encryptedPassword =
      'credential:v1:' +
      (await secretStorage.protect(
        JSON.stringify({
          password: newPassword,
          passphrase: current?.passphrase,
        })
      ));
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
      data: { privateKey: await secretStorage.protect(privateKeyContent) },
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
