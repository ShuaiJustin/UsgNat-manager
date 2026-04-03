import type { Config, CredentialRef, Device, Log, NatRule } from '@prisma/client';
import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';

import { logger } from './logger';
import { prisma } from './prisma-client';

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
  data?: {
    devices?: Device[];
    rules?: NatRule[];
    logs?: Log[];
    configs?: Config[];
    credentials?: CredentialRef[];
  };
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

      const devices = await prisma.device.findMany();
      const rules = await prisma.natRule.findMany();
      const logs = await prisma.log.findMany({
        orderBy: { createdAt: 'desc' },
        take: 1000,
      });
      const configs = await prisma.config.findMany();
      const credentials = await prisma.credentialRef.findMany();

      const backupData = {
        version: '1.0.2',
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
      const backupData = JSON.parse(content) as BackupFilePayload;

      if (!backupData.data) {
        throw new Error('无效的备份文件格式');
      }

      await prisma.$transaction([
        prisma.natRule.deleteMany({}),
        prisma.device.deleteMany({}),
        prisma.log.deleteMany({}),
        prisma.config.deleteMany({}),
        prisma.credentialRef.deleteMany({}),
      ]);

      const {
        devices = [],
        rules = [],
        logs = [],
        configs = [],
        credentials = [],
      } = backupData.data;

      if (devices.length > 0) {
        await prisma.device.createMany({ data: devices });
      }

      if (rules.length > 0) {
        await prisma.natRule.createMany({ data: rules });
      }

      if (logs.length > 0) {
        await prisma.log.createMany({ data: logs });
      }

      if (configs.length > 0) {
        await prisma.config.createMany({ data: configs });
      }

      if (credentials.length > 0) {
        await prisma.credentialRef.createMany({ data: credentials });
      }

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
