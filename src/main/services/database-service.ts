import { PrismaClient } from '@prisma/client';
import { app } from 'electron';
import path from 'path';

import {
  buildNatRuleMigrationStatements,
  DATABASE_SETUP_STATEMENTS,
} from './database-service-helpers';

class DatabaseService {
  private prisma: PrismaClient | null = null;

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }

  async initialize(): Promise<void> {
    try {
      const userDataPath = app.getPath('userData');
      const _dbPath = path.join(userDataPath, 'usg-nat.db');
      this.prisma = new PrismaClient();

      try {
        await this.prisma.$queryRaw`SELECT 1 FROM configs LIMIT 1`;
        await this.runMigrations();
      } catch {
        await this.createTables();
      }
    } catch (error) {
      throw new Error(`Failed to initialize database: ${this.getErrorMessage(error)}`);
    }
  }

  private async createTables(): Promise<void> {
    if (!this.prisma) {
      throw new Error('Prisma client is not initialized');
    }

    for (const statement of DATABASE_SETUP_STATEMENTS) {
      await this.prisma.$executeRawUnsafe(statement);
    }
  }

  private async runMigrations(): Promise<void> {
    if (!this.prisma) {
      throw new Error('Prisma client is not initialized');
    }

    try {
      const tableInfo: Array<{ name?: string | null }> = await this.prisma.$queryRawUnsafe(
        'PRAGMA table_info(nat_rules)'
      );
      const migrationStatements = buildNatRuleMigrationStatements(tableInfo);

      for (const statement of migrationStatements) {
        await this.prisma.$executeRawUnsafe(statement);
      }
    } catch {
      // Allow the app to continue even if a best-effort migration fails.
    }
  }

  getPrismaClient(): PrismaClient {
    if (!this.prisma) {
      this.prisma = new PrismaClient();
    }

    return this.prisma;
  }

  async disconnect(): Promise<void> {
    if (this.prisma) {
      await this.prisma.$disconnect();
      this.prisma = null;
    }
  }
}

export const databaseService = new DatabaseService();
