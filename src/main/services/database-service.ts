import { app } from 'electron';
import path from 'path';

import {
  buildNatRuleMigrationStatements,
  REQUIRED_NAT_RULE_COLUMNS,
  DATABASE_SETUP_STATEMENTS,
} from './database-service-helpers';
import { prisma } from './prisma-client';

class DatabaseService {
  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }

  async initialize(): Promise<void> {
    try {
      const userDataPath = app.getPath('userData');
      const _dbPath = path.join(userDataPath, 'usg-nat.db');

      try {
        await prisma.$queryRaw`SELECT 1 FROM configs LIMIT 1`;
      } catch {
        await this.createTables();
      }
      // Runs for new and existing databases alike, and fails if a required column is missing.
      await this.runMigrations();
    } catch (error) {
      throw new Error(`Failed to initialize database: ${this.getErrorMessage(error)}`);
    }
  }

  private async createTables(): Promise<void> {
    for (const statement of DATABASE_SETUP_STATEMENTS) {
      await prisma.$executeRawUnsafe(statement);
    }
  }

  private async runMigrations(): Promise<void> {
    try {
      const tableInfo: Array<{ name?: string | null }> = await prisma.$queryRawUnsafe(
        'PRAGMA table_info(nat_rules)'
      );
      const migrationStatements = buildNatRuleMigrationStatements(tableInfo);

      for (const statement of migrationStatements) {
        await prisma.$executeRawUnsafe(statement);
      }
    } catch {
      // Checked below: only a missing column is fatal.
    }
    // Every rule query selects these columns; without them the rules features fail on each use,
    // so report it at startup instead.
    const columns: Array<{ name?: string | null }> = await prisma.$queryRawUnsafe(
      'PRAGMA table_info(nat_rules)'
    );
    const missing = REQUIRED_NAT_RULE_COLUMNS.filter(
      (column) => !columns.some((info) => info.name === column)
    );
    if (missing.length) throw new Error(`数据库升级失败，规则表缺少字段：${missing.join(', ')}`);
  }
}

export const databaseService = new DatabaseService();
