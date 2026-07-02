import { app } from 'electron';
import path from 'path';

import {
  buildNatRuleMigrationStatements,
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
        await this.runMigrations();
      } catch {
        await this.createTables();
      }
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
      // Allow the app to continue even if a best-effort migration fails.
    }
  }
}

export const databaseService = new DatabaseService();
