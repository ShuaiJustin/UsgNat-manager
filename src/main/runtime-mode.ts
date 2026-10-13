import { app } from 'electron';

// 打包版忽略 NODE_ENV，避免运行时环境变量把发布版切进开发模式。
export const isDevMode = (): boolean => !app.isPackaged && process.env.NODE_ENV === 'development';
