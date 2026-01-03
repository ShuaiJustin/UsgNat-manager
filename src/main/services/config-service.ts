import { logger } from './logger';
import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import { prisma } from './prisma-client';
import CryptoJS from 'crypto-js';

/**
 * 配置类型
 */
export type ConfigType =
  | 'automation' // 自动化配置
  | 'notification' // 通知配置
  | 'email' // 邮件配置
  | 'wechat' // 微信配置
  | 'system' // 系统配置
  | 'appearance' // 外观配置
  | 'app' // 应用配置（主题、开机自启动等）
  | 'update'; // 更新配置（自动检查、检查频率等）

/**
 * 配置服务
 * 负责配置的持久化存储和读取
 */
class ConfigService {
  private encryptionKey: string;
  private keyFilePath: string;
  private keyInitialized: boolean;

  constructor() {
    // 使用与凭据管理器相同的密钥
    this.keyFilePath = path.join(app.getPath('userData'), '.credential-key');
    this.encryptionKey = '';
    this.keyInitialized = false;
    this.initializeEncryptionKey();
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
      this.encryptionKey = CryptoJS.lib.WordArray.random(32).toString();
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
   * 加密敏感字段
   */
  private encryptSensitiveData(type: ConfigType, data: any): any {
    if (type === 'email' && data.auth?.pass) {
      return {
        ...data,
        auth: {
          ...data.auth,
          pass: CryptoJS.AES.encrypt(data.auth.pass, this.encryptionKey).toString(),
        },
      };
    }
    return data;
  }

  /**
   * 解密敏感字段
   */
  private decryptSensitiveData(type: ConfigType, data: any): any {
    if (type === 'email' && data.auth?.pass) {
      try {
        // 检查密钥是否已初始化
        if (!this.keyInitialized || !this.encryptionKey) {
          return data;
        }

        const bytes = CryptoJS.AES.decrypt(data.auth.pass, this.encryptionKey);
        const decrypted = bytes.toString(CryptoJS.enc.Utf8);

        // 如果解密结果为空，可能是未加密的旧数据，直接返回原值
        if (!decrypted) {
          return data;
        }

        return {
          ...data,
          auth: {
            ...data.auth,
            pass: decrypted,
          },
        };
      } catch (error: any) {
        // 解密失败时返回原值（兼容旧数据）
        return data;
      }
    }
    return data;
  }

  /**
   * 保存配置
   */
  async saveConfig(type: ConfigType, data: any): Promise<void> {
    try {
      // 确保加密密钥已初始化（等待完成）
      await this.ensureKeyInitialized();

      // 加密敏感数据
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

      await logger.info('配置管理', `保存配置: ${type}`);
    } catch (error: any) {
      await logger.error('配置管理', '保存配置失败', {
        type,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 获取配置
   */
  async getConfig<T = any>(type: ConfigType, defaultValue?: T): Promise<T | null> {
    try {
      // 确保加密密钥已初始化（等待完成）
      await this.ensureKeyInitialized();

      const config = await prisma.config.findUnique({
        where: { key: type },
      });

      if (!config) {
        return defaultValue || null;
      }

      const parsedData = JSON.parse(config.value) as T;
      // 解密敏感数据
      return this.decryptSensitiveData(type, parsedData) as T;
    } catch (error: any) {
      await logger.error('配置管理', '获取配置失败', {
        type,
        error: error.message,
      });
      return defaultValue || null;
    }
  }

  /**
   * 删除配置
   */
  async deleteConfig(type: ConfigType): Promise<void> {
    try {
      await prisma.config.delete({
        where: { key: type },
      });

      await logger.info('配置管理', `删除配置: ${type}`);
    } catch (error: any) {
      await logger.error('配置管理', '删除配置失败', {
        type,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 获取所有配置
   */
  async getAllConfigs(): Promise<Record<string, any>> {
    try {
      const configs = await prisma.config.findMany();
      const result: Record<string, any> = {};

      for (const config of configs) {
        try {
          result[config.key] = JSON.parse(config.value);
        } catch {
          result[config.key] = config.value;
        }
      }

      return result;
    } catch (error: any) {
      await logger.error('配置管理', '获取所有配置失败', { error: error.message });
      return {};
    }
  }

  /**
   * 导出配置到文件
   */
  async exportConfig(filePath?: string): Promise<string> {
    try {
      const configs = await this.getAllConfigs();

      // 移除敏感信息（密码已加密，但仍不建议导出）
      const safeConfigs = { ...configs };
      if (safeConfigs.email?.auth?.pass) {
        safeConfigs.email = {
          ...safeConfigs.email,
          auth: {
            ...safeConfigs.email.auth,
            pass: '***已加密，不导出***',
          },
        };
      }

      const exportData = {
        version: '1.0.2',
        exportTime: new Date().toISOString(),
        configs: safeConfigs,
        warning: '此文件包含敏感配置信息，请妥善保管',
      };

      const defaultPath = path.join(app.getPath('userData'), `config-export-${Date.now()}.json`);
      const targetPath = filePath || defaultPath;

      await fs.writeFile(targetPath, JSON.stringify(exportData, null, 2), 'utf-8');

      await logger.success('配置管理', '配置导出成功（敏感信息已移除）', { path: targetPath });
      return targetPath;
    } catch (error: any) {
      await logger.error('配置管理', '配置导出失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 从文件导入配置
   */
  async importConfig(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const importData = JSON.parse(content);

      if (!importData.configs) {
        throw new Error('无效的配置文件格式');
      }

      // 导入所有配置
      for (const [key, value] of Object.entries(importData.configs)) {
        await this.saveConfig(key as ConfigType, value);
      }

      await logger.success('配置管理', '配置导入成功', {
        count: Object.keys(importData.configs).length,
      });
    } catch (error: any) {
      await logger.error('配置管理', '配置导入失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 重置所有配置
   */
  async resetAllConfigs(): Promise<void> {
    try {
      await prisma.config.deleteMany({});
      await logger.warning('配置管理', '已重置所有配置');
    } catch (error: any) {
      await logger.error('配置管理', '重置配置失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 获取配置统计
   */
  async getConfigStats(): Promise<{
    total: number;
    types: string[];
    lastUpdated: Date | null;
  }> {
    try {
      const configs = await prisma.config.findMany({
        orderBy: { updatedAt: 'desc' },
      });

      return {
        total: configs.length,
        types: configs.map((c) => c.key),
        lastUpdated: configs[0]?.updatedAt || null,
      };
    } catch (error: any) {
      await logger.error('配置管理', '获取配置统计失败', { error: error.message });
      return {
        total: 0,
        types: [],
        lastUpdated: null,
      };
    }
  }
}

// 导出单例
export const configService = new ConfigService();
