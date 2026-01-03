import { PrismaClient } from '@prisma/client';
import { app } from 'electron';
import path from 'path';

/**
 * 数据库初始化服务
 * 负责在打包后的应用中初始化数据库
 */
class DatabaseService {
  private prisma: PrismaClient | null = null;

  /**
   * 初始化数据库
   * 如果数据库不存在，则创建数据库文件并初始化表结构
   */
  async initialize(): Promise<void> {
    try {
      // 获取数据库路径
      const userDataPath = app.getPath('userData');
      const _dbPath = path.join(userDataPath, 'usg-nat.db'); // 预留，后续可能需要

      // 创建 Prisma 客户端
      this.prisma = new PrismaClient();

      // 检查数据库是否已初始化（通过查询一个表）
      try {
        await this.prisma.$queryRaw`SELECT 1 FROM configs LIMIT 1`;
        // 数据库已初始化，运行迁移
        await this.runMigrations();
      } catch {
        // 数据库未初始化，需要创建表结构
        await this.createTables();
      }
    } catch (error: any) {
      throw new Error(`数据库初始化失败: ${error.message}`);
    }
  }

  /**
   * 创建数据库表结构
   * 根据 Prisma schema 手动创建表
   */
  private async createTables(): Promise<void> {
    if (!this.prisma) {
      throw new Error('Prisma 客户端未初始化');
    }

    // 创建设备表
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "devices" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "host" TEXT NOT NULL,
        "port" INTEGER NOT NULL DEFAULT 22,
        "connectionType" TEXT NOT NULL DEFAULT 'SSH',
        "description" TEXT,
        "enabled" INTEGER NOT NULL DEFAULT 1,
        "online" INTEGER NOT NULL DEFAULT 0,
        "lastConnected" DATETIME,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建 NAT 规则表
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "nat_rules" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "deviceId" TEXT NOT NULL,
        "ruleName" TEXT NOT NULL,
        "protocol" TEXT NOT NULL,
        "globalIp" TEXT NOT NULL,
        "globalPort" TEXT NOT NULL,
        "insideIp" TEXT NOT NULL,
        "insidePort" TEXT NOT NULL,
        "enabled" INTEGER NOT NULL DEFAULT 1,
        "description" TEXT,
        "noReverse" INTEGER NOT NULL DEFAULT 0,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE,
        UNIQUE("deviceId", "ruleName")
      )
    `);

    // 创建日志表
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "logs" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "level" TEXT NOT NULL,
        "operation" TEXT NOT NULL,
        "message" TEXT NOT NULL,
        "details" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建配置表
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "configs" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "key" TEXT NOT NULL UNIQUE,
        "value" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建凭据引用表
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "credential_refs" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "deviceId" TEXT NOT NULL UNIQUE,
        "authType" TEXT NOT NULL,
        "username" TEXT,
        "secretRef" TEXT,
        "privateKey" TEXT,
        "certificate" TEXT,
        "mfaType" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建索引
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_nat_rules_deviceId" ON "nat_rules"("deviceId")
    `);

    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_logs_createdAt" ON "logs"("createdAt")
    `);

    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_logs_level" ON "logs"("level")
    `);
  }

  /**
   * 运行数据库迁移
   * 为现有数据库添加新字段
   */
  private async runMigrations(): Promise<void> {
    if (!this.prisma) {
      throw new Error('Prisma 客户端未初始化');
    }

    try {
      // 检查 nat_rules 表是否有 noReverse 字段
      const tableInfo: any[] = await this.prisma.$queryRawUnsafe('PRAGMA table_info(nat_rules)');

      const hasNoReverse = tableInfo.some((col: any) => col.name === 'noReverse');
      const hasUnrRoute = tableInfo.some((col: any) => col.name === 'unrRoute');

      // 添加 noReverse 字段
      if (!hasNoReverse) {
        await this.prisma.$executeRawUnsafe(
          'ALTER TABLE "nat_rules" ADD COLUMN "noReverse" INTEGER NOT NULL DEFAULT 0'
        );
      }

      // 删除 unrRoute 字段（如果存在）
      if (hasUnrRoute) {
        // SQLite 不支持直接删除列，需要重建表
        await this.prisma.$executeRawUnsafe(`
          CREATE TABLE "nat_rules_new" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "deviceId" TEXT NOT NULL,
            "ruleName" TEXT NOT NULL,
            "protocol" TEXT NOT NULL,
            "globalIp" TEXT NOT NULL,
            "globalPort" TEXT NOT NULL,
            "insideIp" TEXT NOT NULL,
            "insidePort" TEXT NOT NULL,
            "enabled" INTEGER NOT NULL DEFAULT 1,
            "description" TEXT,
            "noReverse" INTEGER NOT NULL DEFAULT 0,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE,
            UNIQUE("deviceId", "ruleName")
          )
        `);

        await this.prisma.$executeRawUnsafe(`
          INSERT INTO "nat_rules_new"
          SELECT id, deviceId, ruleName, protocol, globalIp, globalPort, insideIp, insidePort,
                 enabled, description, noReverse, createdAt, updatedAt
          FROM "nat_rules"
        `);

        await this.prisma.$executeRawUnsafe('DROP TABLE "nat_rules"');
        await this.prisma.$executeRawUnsafe('ALTER TABLE "nat_rules_new" RENAME TO "nat_rules"');
      }
    } catch (error: any) {
      // 不抛出错误，允许应用继续运行
    }
  }

  /**
   * 获取 Prisma 客户端
   */
  getPrismaClient(): PrismaClient {
    if (!this.prisma) {
      this.prisma = new PrismaClient();
    }
    return this.prisma;
  }

  /**
   * 关闭数据库连接
   */
  async disconnect(): Promise<void> {
    if (this.prisma) {
      await this.prisma.$disconnect();
      this.prisma = null;
    }
  }
}

// 导出单例
export const databaseService = new DatabaseService();
