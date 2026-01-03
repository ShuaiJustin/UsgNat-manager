import { PrismaClient } from '@prisma/client';

let prismaInstance: PrismaClient | null = null;

/**
 * 获取 Prisma 客户端单例
 * 确保整个应用只有一个 Prisma 实例，避免创建多个数据库连接
 */
export function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
  }
  return prismaInstance;
}

/**
 * 断开 Prisma 连接
 * 应在应用退出时调用，确保资源正确清理
 */
export async function disconnectPrisma(): Promise<void> {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = null;
  }
}

/**
 * 重置 Prisma 连接
 * 主要用于测试或重新初始化
 */
export async function resetPrismaConnection(): Promise<void> {
  await disconnectPrisma();
  prismaInstance = getPrismaClient();
}

/**
 * 导出 Prisma 客户端实例
 * 推荐直接导入使用这个实例
 */
export const prisma = getPrismaClient();
