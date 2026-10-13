import type { Prisma } from '@prisma/client';

export type LogLevel = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
export interface LogQueryFilter {
  level?: LogLevel;
  operation?: string;
  search?: string;
  startDate?: Date | string;
  endDate?: Date | string;
  limit?: number;
  offset?: number;
  orderBy?: 'asc' | 'desc';
}

export function buildLogQuery(filter: LogQueryFilter = {}): {
  where: Prisma.LogWhereInput;
  take: number;
  skip: number;
} {
  if (!filter || typeof filter !== 'object') throw new Error('无效日志筛选');
  const take = filter.limit ?? 100;
  const skip = filter.offset ?? 0;
  if (!Number.isInteger(take) || take < 1 || take > 10000 || !Number.isInteger(skip) || skip < 0)
    throw new Error('无效日志分页参数');
  const where: Prisma.LogWhereInput = {};
  if (filter.level) {
    if (!['INFO', 'SUCCESS', 'WARNING', 'ERROR'].includes(filter.level))
      throw new Error('无效日志级别');
    where.level = filter.level;
  }
  if (filter.operation) {
    if (typeof filter.operation !== 'string') throw new Error('无效日志操作筛选');
    where.operation = { contains: filter.operation };
  }
  if (filter.search) {
    if (typeof filter.search !== 'string' || filter.search.length > 1000)
      throw new Error('无效日志搜索');
    where.OR = [
      { operation: { contains: filter.search } },
      { message: { contains: filter.search } },
    ];
  }
  const start = filter.startDate === undefined ? undefined : new Date(filter.startDate);
  const end = filter.endDate === undefined ? undefined : new Date(filter.endDate);
  if (
    (start && Number.isNaN(start.getTime())) ||
    (end && Number.isNaN(end.getTime())) ||
    (start && end && start > end)
  )
    throw new Error('无效日志日期范围');
  if (start || end) where.createdAt = { gte: start, lte: end };
  return { where, take, skip };
}

/** CSV 单元格转义；以公式触发字符开头时前置单引号，防止表格软件执行公式注入。 */
export const escapeCsvCell = (value: unknown): string => {
  const text = String(value ?? '');
  const safeText = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
};
