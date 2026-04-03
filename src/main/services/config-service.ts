import { randomBytes } from 'node:crypto';
import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';

import {
  createConfigExportPayload,
  decryptSensitiveConfig,
  encryptSensitiveConfig,
  parseStoredConfigs,
  summarizeConfigStats,
} from './config-service-helpers';
import { logger } from './logger';
import { prisma } from './prisma-client';

export type ConfigType =
  | 'automation'
  | 'notification'
  | 'email'
  | 'wechat'
  | 'system'
  | 'appearance'
  | 'app'
  | 'update';

class ConfigService {
  private encryptionKey = '';
  private keyFilePath: string;
  private keyInitialized = false;

  constructor() {
    this.keyFilePath = path.join(app.getPath('userData'), '.credential-key');
    this.initializeEncryptionKey().catch((error: any) => {
      logger
        .error('Config', 'Failed to initialize encryption key', {
          error: error.message,
        })
        .catch(() => {});
    });
  }

  private async initializeEncryptionKey(): Promise<void> {
    try {
      const keyData = await fs.readFile(this.keyFilePath, 'utf-8');
      this.encryptionKey = keyData.trim();
      this.keyInitialized = true;
    } catch {
      this.encryptionKey = randomBytes(32).toString('hex');
      await fs.writeFile(this.keyFilePath, this.encryptionKey, { mode: 0o600 });
      this.keyInitialized = true;
    }
  }

  private async ensureKeyInitialized(): Promise<void> {
    if (!this.keyInitialized) {
      await this.initializeEncryptionKey();
    }
  }

  private encryptSensitiveData(type: ConfigType, data: any): any {
    return encryptSensitiveConfig(type, data, this.encryptionKey);
  }

  private decryptSensitiveData(type: ConfigType, data: any): any {
    return decryptSensitiveConfig(type, data, this.encryptionKey, this.keyInitialized);
  }

  async saveConfig(type: ConfigType, data: any): Promise<void> {
    try {
      await this.ensureKeyInitialized();

      const encryptedData = this.encryptSensitiveData(type, data);

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
    } catch (error: any) {
      await logger.error('Config', 'Failed to save config', {
        type,
        error: error.message,
      });
      throw error;
    }
  }

  async getConfig<T = any>(type: ConfigType, defaultValue?: T): Promise<T | null> {
    try {
      await this.ensureKeyInitialized();

      const config = await prisma.config.findUnique({
        where: { key: type },
      });

      if (!config) {
        return defaultValue || null;
      }

      const parsedData = JSON.parse(config.value) as T;
      return this.decryptSensitiveData(type, parsedData) as T;
    } catch (error: any) {
      await logger.error('Config', 'Failed to get config', {
        type,
        error: error.message,
      });
      return defaultValue || null;
    }
  }

  async deleteConfig(type: ConfigType): Promise<void> {
    try {
      await prisma.config.delete({
        where: { key: type },
      });

      await logger.info('Config', `Deleted config: ${type}`);
    } catch (error: any) {
      await logger.error('Config', 'Failed to delete config', {
        type,
        error: error.message,
      });
      throw error;
    }
  }

  async getAllConfigs(): Promise<Record<string, any>> {
    try {
      const configs = await prisma.config.findMany();
      return parseStoredConfigs(configs);
    } catch (error: any) {
      await logger.error('Config', 'Failed to get all configs', { error: error.message });
      return {};
    }
  }

  async exportConfig(filePath?: string): Promise<string> {
    try {
      const configs = await this.getAllConfigs();
      const exportData = createConfigExportPayload(configs);

      const defaultPath = path.join(app.getPath('userData'), `config-export-${Date.now()}.json`);
      const targetPath = filePath || defaultPath;

      await fs.writeFile(targetPath, JSON.stringify(exportData, null, 2), 'utf-8');

      await logger.success('Config', 'Exported config successfully', { path: targetPath });
      return targetPath;
    } catch (error: any) {
      await logger.error('Config', 'Failed to export config', { error: error.message });
      throw error;
    }
  }

  async importConfig(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const importData = JSON.parse(content);

      if (!importData.configs) {
        throw new Error('Invalid config file format');
      }

      for (const [key, value] of Object.entries(importData.configs)) {
        await this.saveConfig(key as ConfigType, value);
      }

      await logger.success('Config', 'Imported config successfully', {
        count: Object.keys(importData.configs).length,
      });
    } catch (error: any) {
      await logger.error('Config', 'Failed to import config', { error: error.message });
      throw error;
    }
  }

  async resetAllConfigs(): Promise<void> {
    try {
      await prisma.config.deleteMany({});
      await logger.warning('Config', 'Reset all configs');
    } catch (error: any) {
      await logger.error('Config', 'Failed to reset configs', { error: error.message });
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
    } catch (error: any) {
      await logger.error('Config', 'Failed to get config stats', { error: error.message });
      return {
        total: 0,
        types: [],
        lastUpdated: null,
      };
    }
  }
}

export const configService = new ConfigService();
