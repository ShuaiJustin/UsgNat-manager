import winston from 'winston';
import path from 'path';
import { app } from 'electron';
import { prisma } from './prisma-client';

/**
 * 日志级别
 */
export type LogLevel = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';

/**
 * 日志条目
 */
export interface LogEntry {
  level: LogLevel;
  operation: string;
  message: string;
  details?: any;
  timestamp?: Date;
}

/**
 * 日志管理器
 * 负责记录应用日志到文件和数据库
 */
class Logger {
  private winstonLogger: winston.Logger;
  private logDir: string;

  constructor() {
    // 设置日志目录
    this.logDir = path.join(app.getPath('userData'), 'logs');

    // 创建Winston日志器
    this.winstonLogger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
      ),
      transports: [
        // 错误日志文件
        new winston.transports.File({
          filename: path.join(this.logDir, 'error.log'),
          level: 'error',
          maxsize: 5242880, // 5MB
          maxFiles: 5,
        }),
        // 所有日志文件
        new winston.transports.File({
          filename: path.join(this.logDir, 'combined.log'),
          maxsize: 5242880, // 5MB
          maxFiles: 10,
        }),
      ],
    });

    // 开发环境下同时输出到控制台
    if (process.env.NODE_ENV === 'development') {
      this.winstonLogger.add(
        new winston.transports.Console({
          format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
        })
      );
    }
  }

  /**
   * 记录信息日志
   */
  async info(operation: string, message: string, details?: any): Promise<void> {
    await this.log({
      level: 'INFO',
      operation,
      message,
      details,
    });
  }

  /**
   * 记录成功日志
   */
  async success(operation: string, message: string, details?: any): Promise<void> {
    await this.log({
      level: 'SUCCESS',
      operation,
      message,
      details,
    });
  }

  /**
   * 记录警告日志
   */
  async warning(operation: string, message: string, details?: any): Promise<void> {
    await this.log({
      level: 'WARNING',
      operation,
      message,
      details,
    });
  }

  /**
   * 记录错误日志
   */
  async error(operation: string, message: string, details?: any): Promise<void> {
    await this.log({
      level: 'ERROR',
      operation,
      message,
      details,
    });
  }

  /**
   * 记录日志（核心方法）
   */
  private async log(entry: LogEntry): Promise<void> {
    const timestamp = new Date();

    // 记录到Winston（文件）
    const winstonLevel = this.mapLogLevel(entry.level);
    this.winstonLogger.log(winstonLevel, entry.message, {
      operation: entry.operation,
      details: entry.details,
      timestamp,
    });

    // 记录到数据库
    try {
      await prisma.log.create({
        data: {
          level: entry.level,
          operation: entry.operation,
          message: entry.message,
          details: entry.details ? JSON.stringify(entry.details) : null,
          createdAt: timestamp,
        },
      });
    } catch (error) {
      console.error('记录日志到数据库失败:', error);
    }
  }

  /**
   * 映射日志级别到Winston级别
   */
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

  /**
   * 查询日志
   */
  async query(filter?: {
    level?: LogLevel;
    operation?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<any[]> {
    const where: any = {};

    if (filter?.level) {
      where.level = filter.level;
    }

    if (filter?.operation) {
      where.operation = {
        contains: filter.operation,
      };
    }

    if (filter?.startDate || filter?.endDate) {
      where.createdAt = {};
      if (filter.startDate) {
        where.createdAt.gte = filter.startDate;
      }
      if (filter.endDate) {
        where.createdAt.lte = filter.endDate;
      }
    }

    return await prisma.log.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filter?.limit || 100,
    });
  }

  /**
   * 清理旧日志
   */
  async cleanup(daysToKeep: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await prisma.log.deleteMany({
      where: {
        createdAt: {
          lt: cutoffDate,
        },
      },
    });

    await this.info('日志清理', `清理了 ${result.count} 条旧日志`, {
      daysToKeep,
      cutoffDate,
    });

    return result.count;
  }

  /**
   * 导出日志
   */
  async export(filter?: { level?: LogLevel; startDate?: Date; endDate?: Date }): Promise<string> {
    const logs = await this.query({ ...filter, limit: 10000 });

    // 转换为CSV格式
    const headers = ['时间', '级别', '操作', '消息', '详情'];
    const rows = logs.map((log) => [
      new Date(log.createdAt).toLocaleString('zh-CN'),
      log.level,
      log.operation,
      log.message,
      log.details || '',
    ]);

    const csv = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    return csv;
  }

  /**
   * 获取日志统计
   */
  async getStats(days: number = 7): Promise<{
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
      // 按级别统计
      stats.byLevel[log.level as LogLevel]++;

      // 按操作统计
      stats.byOperation[log.operation] = (stats.byOperation[log.operation] || 0) + 1;
    }

    return stats;
  }
}

// 导出单例
export const logger = new Logger();
