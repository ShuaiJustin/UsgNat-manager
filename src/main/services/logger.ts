import { type Log as PrismaLog } from '@prisma/client';
import { app } from 'electron';
import path from 'path';
import winston from 'winston';

import { createLogCleanupPlan } from '../log-cleanup';
import { isDevMode } from '../runtime-mode';
import { prisma } from './prisma-client';
import { buildLogQuery, escapeCsvCell, type LogQueryFilter, type LogLevel } from './log-query';

export type { LogLevel, LogQueryFilter } from './log-query';

export type LogDetails = unknown;

export interface LogEntry {
  level: LogLevel;
  operation: string;
  message: string;
  details?: LogDetails;
  timestamp?: Date;
}

interface LogWriteOptions {
  persistToDatabase?: boolean;
}

class Logger {
  private winstonLogger: winston.Logger;
  private logDir: string;

  constructor() {
    this.logDir = path.join(app.getPath('userData'), 'logs');

    this.winstonLogger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({
          filename: path.join(this.logDir, 'error.log'),
          level: 'error',
          maxsize: 5 * 1024 * 1024,
          maxFiles: 5,
        }),
        new winston.transports.File({
          filename: path.join(this.logDir, 'combined.log'),
          maxsize: 5 * 1024 * 1024,
          maxFiles: 10,
        }),
      ],
    });

    if (isDevMode()) {
      this.winstonLogger.add(
        new winston.transports.Console({
          format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
        })
      );
    }
  }

  async info(
    operation: string,
    message: string,
    details?: LogDetails,
    options?: LogWriteOptions
  ): Promise<void> {
    await this.log({ level: 'INFO', operation, message, details }, options);
  }

  async success(
    operation: string,
    message: string,
    details?: LogDetails,
    options?: LogWriteOptions
  ): Promise<void> {
    await this.log({ level: 'SUCCESS', operation, message, details }, options);
  }

  async warning(
    operation: string,
    message: string,
    details?: LogDetails,
    options?: LogWriteOptions
  ): Promise<void> {
    await this.log({ level: 'WARNING', operation, message, details }, options);
  }

  async error(
    operation: string,
    message: string,
    details?: LogDetails,
    options?: LogWriteOptions
  ): Promise<void> {
    await this.log({ level: 'ERROR', operation, message, details }, options);
  }

  private async log(entry: LogEntry, options?: LogWriteOptions): Promise<void> {
    const timestamp = entry.timestamp ?? new Date();

    this.winstonLogger.log(this.mapLogLevel(entry.level), entry.message, {
      operation: entry.operation,
      details: entry.details,
      timestamp,
    });

    if (options?.persistToDatabase === false) {
      return;
    }

    try {
      await prisma.log.create({
        data: {
          level: entry.level,
          operation: entry.operation,
          message: entry.message,
          details: entry.details === undefined ? null : JSON.stringify(entry.details),
          createdAt: timestamp,
        },
      });
    } catch (error) {
      console.error('记录日志到数据库失败:', error);
    }
  }

  private mapLogLevel(level: LogLevel): string {
    switch (level) {
      case 'ERROR':
        return 'error';
      case 'WARNING':
        return 'warn';
      case 'SUCCESS':
      case 'INFO':
      default:
        return 'info';
    }
  }

  async query(filter?: LogQueryFilter): Promise<PrismaLog[]> {
    return prisma.log.findMany({
      ...buildLogQuery(filter),
      orderBy: [{ createdAt: filter?.orderBy === 'asc' ? 'asc' : 'desc' }, { id: 'desc' }],
    });
  }

  async queryPage(filter?: LogQueryFilter): Promise<{ rows: PrismaLog[]; total: number }> {
    const query = buildLogQuery(filter);
    const [rows, total] = await prisma.$transaction([
      prisma.log.findMany({
        ...query,
        orderBy: [{ createdAt: filter?.orderBy === 'asc' ? 'asc' : 'desc' }, { id: 'desc' }],
      }),
      prisma.log.count({ where: query.where }),
    ]);
    return { rows, total };
  }

  async cleanup(daysToKeep = 30): Promise<number> {
    const cleanupPlan = createLogCleanupPlan(new Date(), daysToKeep);

    const result = cleanupPlan.deleteAll
      ? await prisma.log.deleteMany({})
      : await prisma.log.deleteMany({
          where: {
            createdAt: {
              lt: cleanupPlan.cutoffDate!,
            },
          },
        });

    await this.info(
      '日志清理',
      `清理了 ${result.count} 条旧日志`,
      {
        daysToKeep,
        cutoffDate: cleanupPlan.cutoffDate,
        deleteAll: cleanupPlan.deleteAll,
      },
      {
        persistToDatabase: cleanupPlan.persistAuditToDatabase,
      }
    );

    return result.count;
  }

  async export(filter?: LogQueryFilter): Promise<string> {
    const options = buildLogQuery({ ...filter, offset: 0, limit: 10000 });
    const logs = await prisma.$transaction(async (tx) => {
      const count = await tx.log.count({ where: options.where });
      if (count > 10000)
        throw new Error(
          `筛选结果有 ${count} 条日志，超过单次导出上限 10000 条；请缩小日期或搜索范围`
        );
      return tx.log.findMany({
        ...options,
        orderBy: { createdAt: filter?.orderBy === 'asc' ? 'asc' : 'desc' },
      });
    });

    const headers = ['时间', '级别', '操作', '消息', '详情'];
    const rows = logs.map((log) => [
      new Date(log.createdAt).toLocaleString('zh-CN'),
      log.level,
      log.operation,
      log.message,
      log.details || '',
    ]);

    return [headers.join(','), ...rows.map((row) => row.map(escapeCsvCell).join(','))].join('\n');
  }

  async getStats(days = 7): Promise<{
    total: number;
    byLevel: Record<LogLevel, number>;
    byOperation: Record<string, number>;
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const logs = await prisma.log.findMany({
      where: {
        createdAt: {
          gte: startDate,
        },
      },
    });

    const stats = {
      total: logs.length,
      byLevel: {
        INFO: 0,
        SUCCESS: 0,
        WARNING: 0,
        ERROR: 0,
      } as Record<LogLevel, number>,
      byOperation: {} as Record<string, number>,
    };

    for (const log of logs) {
      stats.byLevel[log.level as LogLevel]++;
      stats.byOperation[log.operation] = (stats.byOperation[log.operation] || 0) + 1;
    }

    return stats;
  }
}

export const logger = new Logger();
