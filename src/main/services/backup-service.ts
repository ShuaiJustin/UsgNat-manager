import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';

import { logger } from './logger';
import { prisma } from './prisma-client';
import {
  validateBackupPayload,
  replaceBackupData,
  type BackupData,
} from './backup-service-helpers';
import { secretStorage } from './secret-protection';
import { removeMisplacedSecrets, assertStoredConfiguration } from './config-service-helpers';

export interface BackupInfo {
  id: string;
  filename: string;
  path: string;
  size: number;
  createdAt: Date;
  deviceCount: number;
  ruleCount: number;
  logCount: number;
}

type BackupFilePayload = {
  stats?: {
    deviceCount?: number;
    ruleCount?: number;
    logCount?: number;
  };
};

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

class BackupService {
  private backupDir: string;

  constructor() {
    this.backupDir = path.join(app.getPath('userData'), 'backups');
    this.ensureBackupDir();
  }

  private async ensureBackupDir(): Promise<void> {
    try {
      await fs.mkdir(this.backupDir, { recursive: true });
    } catch (error) {
      console.error('创建备份目录失败:', error);
    }
  }

  async createBackup(description?: string): Promise<BackupInfo> {
    try {
      await logger.info('备份服务', '开始创建备份');

      const data = await prisma.$transaction(async (tx) => ({
        devices: await tx.device.findMany(),
        rules: await tx.natRule.findMany(),
        logs: await tx.log.findMany({ orderBy: { createdAt: 'desc' }, take: 1000 }),
        configs: await tx.config.findMany(),
        credentials: await tx.credentialRef.findMany(),
      }));
      // Protect legacy plaintext private keys/config passwords before writing any backup file.
      await this.protectBackupSecrets(data);
      const { devices, rules, logs, configs, credentials } = data;

      const backupData = {
        version: '1.1.0',
        protection: {
          keyFingerprint: await secretStorage.fingerprint(),
          scope:
            'Credentials require the original OS account or matching legacy key. Keys are not included.',
        },
        createdAt: new Date().toISOString(),
        description: description || '手动备份',
        data: {
          devices,
          rules,
          logs,
          configs,
          credentials,
        },
        stats: {
          deviceCount: devices.length,
          ruleCount: rules.length,
          logCount: logs.length,
          configCount: configs.length,
        },
      };

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `backup-${timestamp}.json`;
      const filePath = path.join(this.backupDir, filename);

      await fs.writeFile(filePath, JSON.stringify(backupData, null, 2), 'utf-8');
      const stats = await fs.stat(filePath);

      const backupInfo: BackupInfo = {
        id: timestamp,
        filename,
        path: filePath,
        size: stats.size,
        createdAt: new Date(),
        deviceCount: devices.length,
        ruleCount: rules.length,
        logCount: logs.length,
      };

      await logger.success('备份服务', '备份创建成功', {
        filename,
        size: `${(stats.size / 1024).toFixed(2)} KB`,
      });

      return backupInfo;
    } catch (error) {
      const errorMessage = getErrorMessage(error, '创建备份失败');
      await logger.error('备份服务', '备份创建失败', { error: errorMessage });
      throw error;
    }
  }

  async restoreBackup(filePath: string): Promise<void> {
    try {
      await logger.info('备份服务', '开始恢复备份', { path: filePath });

      const content = await fs.readFile(filePath, 'utf-8');
      const { data, keyFingerprint } = validateBackupPayload(JSON.parse(content));
      for (const config of data.configs)
        assertStoredConfiguration(config.key, JSON.parse(config.value));
      const serialized = JSON.stringify(data);
      const needsLegacyKey =
        serialized.includes('aes:v1:') ||
        serialized.includes('aes:v2:') ||
        serialized.includes('U2FsdGVkX1');
      if (
        needsLegacyKey &&
        keyFingerprint &&
        keyFingerprint !== (await secretStorage.fingerprint())
      ) {
        throw new Error('备份凭据密钥不匹配，无法跨机恢复认证；原数据未变更');
      }
      // All OS/AES decryptions are checked before deleting anything; migrate old plaintext safely.
      await this.protectBackupSecrets(data);
      data.devices = data.devices.map((device) => ({ ...device, online: false }));
      data.configs = data.configs.map((config) =>
        config.key === 'automation'
          ? {
              ...config,
              value: JSON.stringify({
                ...JSON.parse(config.value),
                autoUpdateEnabled: false,
                clientEgressConfirmed: false,
              }),
            }
          : config
      );
      await replaceBackupData(prisma, data);
      const { devices, rules, logs } = data;

      await logger.success('备份服务', '备份恢复成功', {
        devices: devices.length,
        rules: rules.length,
        logs: logs.length,
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error, '恢复备份失败');
      await logger.error('备份服务', '备份恢复失败', { error: errorMessage });
      throw error;
    }
  }

  private async protectBackupSecrets(data: BackupData): Promise<void> {
    for (const credential of data.credentials) {
      if (credential.secretRef?.startsWith('credential:v1:')) {
        const plain = await secretStorage.reveal(
          credential.secretRef.slice('credential:v1:'.length)
        );
        const value = JSON.parse(plain) as { password?: unknown; passphrase?: unknown };
        if (
          !value ||
          typeof value !== 'object' ||
          Array.isArray(value) ||
          (value.password !== undefined && typeof value.password !== 'string') ||
          (value.passphrase !== undefined && typeof value.passphrase !== 'string')
        )
          throw new Error('备份凭据内容无效');
        credential.secretRef = 'credential:v1:' + (await secretStorage.protect(plain));
      } else if (credential.secretRef) {
        const password = await secretStorage.reveal(credential.secretRef);
        credential.secretRef =
          'credential:v1:' + (await secretStorage.protect(JSON.stringify({ password })));
      }
      if (credential.privateKey) {
        const plain = secretStorage.isProtected(credential.privateKey)
          ? await secretStorage.reveal(credential.privateKey)
          : credential.privateKey;
        credential.privateKey = await secretStorage.protect(plain);
      }
    }
    for (const config of data.configs) {
      const value = removeMisplacedSecrets(config.key, JSON.parse(config.value)) as {
        auth?: { pass?: string };
      };
      if (config.key === 'email' && value?.auth?.pass) {
        const password = value.auth.pass;
        const plain =
          secretStorage.isProtected(password) || password.startsWith('U2FsdGVkX1')
            ? await secretStorage.reveal(password)
            : password;
        value.auth.pass = await secretStorage.protect(plain);
      }
      config.value = JSON.stringify(value);
    }
  }

  async listBackups(): Promise<BackupInfo[]> {
    try {
      const files = await fs.readdir(this.backupDir);
      const backups: BackupInfo[] = [];

      for (const filename of files) {
        if (!filename.endsWith('.json')) {
          continue;
        }

        const filePath = path.join(this.backupDir, filename);
        const stats = await fs.stat(filePath);

        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const data = JSON.parse(content) as BackupFilePayload;

          backups.push({
            id: filename.replace('.json', ''),
            filename,
            path: filePath,
            size: stats.size,
            createdAt: stats.mtime,
            deviceCount: data.stats?.deviceCount || 0,
            ruleCount: data.stats?.ruleCount || 0,
            logCount: data.stats?.logCount || 0,
          });
        } catch (error) {
          console.error(`读取备份文件失败: ${filename}`, error);
        }
      }

      return backups.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    } catch (error) {
      await logger.error('备份服务', '获取备份列表失败', {
        error: getErrorMessage(error, '获取备份列表失败'),
      });
      return [];
    }
  }

  async deleteBackup(filename: string): Promise<void> {
    try {
      if (
        path.basename(filename) !== filename ||
        !filename.startsWith('backup-') ||
        !filename.endsWith('.json')
      )
        throw new Error('无效备份文件名');
      await fs.unlink(path.join(this.backupDir, filename));
      await logger.info('备份服务', '备份删除成功', { filename });
    } catch (error) {
      const errorMessage = getErrorMessage(error, '删除备份失败');
      await logger.error('备份服务', '备份删除失败', { error: errorMessage });
      throw error;
    }
  }

  async cleanupOldBackups(keepCount = 10): Promise<number> {
    try {
      if (!Number.isInteger(keepCount) || keepCount < 1) throw new Error('至少保留一个备份');
      const backups = await this.listBackups();

      if (backups.length <= keepCount) {
        return 0;
      }

      const toDelete = backups.slice(keepCount);
      let deletedCount = 0;

      for (const backup of toDelete) {
        try {
          await this.deleteBackup(backup.filename);
          deletedCount++;
        } catch (error) {
          console.error(`删除备份失败: ${backup.filename}`, error);
        }
      }

      await logger.info('备份服务', `清理了 ${deletedCount} 个旧备份`);
      return deletedCount;
    } catch (error) {
      await logger.error('备份服务', '清理备份失败', {
        error: getErrorMessage(error, '清理备份失败'),
      });
      return 0;
    }
  }

  getBackupDir(): string {
    return this.backupDir;
  }

  async getBackupStats(): Promise<{
    totalBackups: number;
    totalSize: number;
    oldestBackup: Date | null;
    newestBackup: Date | null;
  }> {
    try {
      const backups = await this.listBackups();

      if (backups.length === 0) {
        return {
          totalBackups: 0,
          totalSize: 0,
          oldestBackup: null,
          newestBackup: null,
        };
      }

      return {
        totalBackups: backups.length,
        totalSize: backups.reduce((sum, backup) => sum + backup.size, 0),
        oldestBackup: backups[backups.length - 1].createdAt,
        newestBackup: backups[0].createdAt,
      };
    } catch (error) {
      await logger.error('备份服务', '获取备份统计失败', {
        error: getErrorMessage(error, '获取备份统计失败'),
      });
      return {
        totalBackups: 0,
        totalSize: 0,
        oldestBackup: null,
        newestBackup: null,
      };
    }
  }
}

export const backupService = new BackupService();
