import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';

import {
  isConfigType,
  type ConfigType,
  createConfigExportPayload,
  SSH_HOST_KEY_PREFIX,
  mergeImportedConfig,
  removeMisplacedSecrets,
  parseStoredConfigs,
  summarizeConfigStats,
  assertStoredConfiguration,
} from './config-service-helpers';
import { logger } from './logger';
import { prisma } from './prisma-client';
import { secretStorage } from './secret-protection';

export type { ConfigType } from './config-service-helpers';

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

class ConfigService {
  private async transformSensitiveData<T>(type: ConfigType, data: T, encrypt: boolean): Promise<T> {
    const clean = removeMisplacedSecrets(type, data) as T;
    if (type !== 'email' || !clean || typeof clean !== 'object') return clean;
    const email = clean as { auth?: { pass?: string } };
    if (!email.auth?.pass) return clean;
    const pass = email.auth.pass;
    const protectedOrLegacy = secretStorage.isProtected(pass) || pass.startsWith('U2FsdGVkX1');
    return {
      ...clean,
      auth: {
        ...email.auth,
        pass: encrypt
          ? await secretStorage.protect(pass)
          : protectedOrLegacy
            ? await secretStorage.reveal(pass)
            : pass,
      },
    } as T;
  }

  async saveConfig<T>(type: ConfigType, data: T): Promise<void> {
    try {
      assertStoredConfiguration(type, data);
      const encryptedData = await this.transformSensitiveData(type, data, true);

      await prisma.config.upsert({
        where: { key: type },
        create: {
          key: type,
          value: JSON.stringify(encryptedData),
        },
        update: {
          value: JSON.stringify(encryptedData),
        },
      });

      await logger.info('Config', `Saved config: ${type}`);
    } catch (error: unknown) {
      await logger.error('Config', 'Failed to save config', {
        type,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  async getConfig<T = unknown>(type: ConfigType, defaultValue?: T): Promise<T | null> {
    try {
      const config = await prisma.config.findUnique({
        where: { key: type },
      });

      if (!config) {
        return defaultValue ?? null;
      }

      const parsedData = JSON.parse(config.value) as T;
      const clearData = await this.transformSensitiveData(type, parsedData, false);
      const emailPass =
        type === 'email' && parsedData && typeof parsedData === 'object'
          ? (parsedData as { auth?: { pass?: string } }).auth?.pass
          : undefined;
      if (
        JSON.stringify(removeMisplacedSecrets(type, parsedData)) !== JSON.stringify(parsedData) ||
        (emailPass && !secretStorage.isProtected(emailPass))
      ) {
        const migrated = await this.transformSensitiveData(type, clearData, true);
        await prisma.config.updateMany({
          where: { id: config.id, value: config.value },
          data: { value: JSON.stringify(migrated) },
        });
      }
      return clearData;
    } catch (error: unknown) {
      await logger.error('Config', 'Failed to get config', {
        type,
        error: getErrorMessage(error),
      });
      return defaultValue ?? null;
    }
  }

  async deleteConfig(type: ConfigType): Promise<void> {
    try {
      await prisma.config.delete({
        where: { key: type },
      });

      await logger.info('Config', `Deleted config: ${type}`);
    } catch (error: unknown) {
      await logger.error('Config', 'Failed to delete config', {
        type,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  async getAllConfigs(): Promise<Record<string, unknown>> {
    try {
      const configs = await prisma.config.findMany();
      return Object.fromEntries(
        Object.entries(parseStoredConfigs(configs)).map(([key, value]) => [
          key,
          removeMisplacedSecrets(key, value),
        ])
      );
    } catch (error: unknown) {
      await logger.error('Config', 'Failed to get all configs', { error: getErrorMessage(error) });
      return {};
    }
  }

  async exportConfig(): Promise<string> {
    try {
      const configs = await this.getAllConfigs();
      const exportData = createConfigExportPayload(configs);

      // 导出路径由主进程决定，不接受渲染进程传入的任意路径。
      const targetPath = path.join(app.getPath('userData'), `config-export-${Date.now()}.json`);

      await fs.writeFile(targetPath, JSON.stringify(exportData, null, 2), 'utf-8');

      await logger.success('Config', 'Exported config successfully', { path: targetPath });
      return targetPath;
    } catch (error: unknown) {
      await logger.error('Config', 'Failed to export config', { error: getErrorMessage(error) });
      throw error;
    }
  }

  async importConfig(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const importData = JSON.parse(content) as { configs?: Record<string, unknown> };

      if (
        !importData.configs ||
        typeof importData.configs !== 'object' ||
        Array.isArray(importData.configs)
      ) {
        throw new Error('Invalid config file format');
      }

      // Older exports may carry host-key trust (ssh-host:*) or retired keys; those are skipped,
      // never imported, so trust can only be established by the SSH first-connection flow.
      const entries = Object.entries(importData.configs).flatMap(([key, value]) =>
        isConfigType(key) ? [[key, value] as const] : []
      );
      const skipped = Object.keys(importData.configs).filter((key) => !isConfigType(key));
      if (skipped.length)
        await logger.warning('Config', 'Skipped non-importable config keys', { keys: skipped });
      const prepared = await Promise.all(
        entries.map(async ([key, value]) => {
          assertStoredConfiguration(key, value);
          const merged = mergeImportedConfig(key, value, await this.getConfig(key));
          assertStoredConfiguration(key, merged);
          return {
            key,
            value: JSON.stringify(await this.transformSensitiveData(key, merged, true)),
          };
        })
      );
      await prisma.$transaction(
        prepared.map(({ key, value }) =>
          prisma.config.upsert({
            where: { key },
            create: { key, value },
            update: { value },
          })
        )
      );

      await logger.success('Config', 'Imported config successfully', {
        count: entries.length,
      });
    } catch (error: unknown) {
      await logger.error('Config', 'Failed to import config', { error: getErrorMessage(error) });
      throw error;
    }
  }

  async resetAllConfigs(): Promise<void> {
    try {
      // SSH 主机指纹只能经首次信任流程维护，重置配置时保留。
      await prisma.config.deleteMany({
        where: { NOT: { key: { startsWith: SSH_HOST_KEY_PREFIX } } },
      });
      await logger.warning('Config', 'Reset all configs');
    } catch (error: unknown) {
      await logger.error('Config', 'Failed to reset configs', { error: getErrorMessage(error) });
      throw error;
    }
  }

  async getConfigStats(): Promise<{
    total: number;
    types: string[];
    lastUpdated: Date | null;
  }> {
    try {
      const configs = await prisma.config.findMany({
        orderBy: { updatedAt: 'desc' },
      });

      return summarizeConfigStats(configs);
    } catch (error: unknown) {
      await logger.error('Config', 'Failed to get config stats', { error: getErrorMessage(error) });
      return {
        total: 0,
        types: [],
        lastUpdated: null,
      };
    }
  }
}

export const configService = new ConfigService();
