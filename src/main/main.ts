import { app, BrowserWindow } from 'electron';
import path from 'path';
import { createWindow } from './window';
import { createTray } from './tray';
import { registerIpcHandlers } from './ipc';
import { customUpdater } from './services/custom-updater';
import { databaseService } from './services/database-service';
import { disconnectPrisma } from './services/prisma-client';
import { automationService } from './services/automation-service';
import { ipMonitor } from './services/ip-monitor';
import { configService } from './services/config-service';
import { emailService } from './services/email-service';
import { notifier } from './services/notifier';
import { logger } from './services/logger';

// 设置 Prisma 数据库路径到用户数据目录
// 必须在任何 Prisma 客户端实例化之前设置
const userDataPath = app.getPath('userData');
const dbPath = path.join(userDataPath, 'usg-nat.db');
process.env.DATABASE_URL = `file:${dbPath}`;

let mainWindow: BrowserWindow | null = null;

// 单例锁 - 确保只运行一个实例
const gotTheLock = app.requestSingleInstanceLock();

// Windows 某些显卡/驱动在开启硬件加速时可能出现白屏，禁用以规避
app.disableHardwareAcceleration();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 当运行第二个实例时，聚焦到主窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      // 初始化数据库（必须在任何数据库操作之前）
      await databaseService.initialize();
    } catch {
      // 数据库初始化失败，记录错误但继续启动应用
      // 用户操作时会提示具体错误
    }

    // 设置应用名称与 AppUserModelId（影响任务栏与通知区域显示与跳转）
    app.setName('华为USG防火墙NAT管理软件');
    app.setAppUserModelId('com.crystal.usg-nat-manager');
    // 创建主窗口
    mainWindow = createWindow();

    // 创建系统托盘
    createTray(mainWindow);

    // 注册IPC处理器
    registerIpcHandlers();

    // 设置更新服务的主窗口引用
    customUpdater.setMainWindow(mainWindow);

    // 清理旧的安装包（延迟启动，避免影响应用启动速度）
    setTimeout(() => {
      customUpdater.cleanupOldInstallers().catch(console.error);
    }, 1000);

    // 恢复邮件服务配置（延迟启动，避免影响应用启动速度）
    setTimeout(async () => {
      try {
        const emailConfig = await configService.getConfig('email');
        if (emailConfig) {
          emailService.configure(emailConfig);
          
          // 同步通知器配置
          notifier.updateConfig({
            emailNotifyEnabled: emailConfig.enabled || false,
            notifyTypes: emailConfig.notifyTypes || ['ipChange', 'updateSuccess', 'updateFailed', 'deviceOffline'],
          });
        }
      } catch (error: any) {
        await logger.error('邮件服务', '恢复邮件配置失败', { error: error.message });
        console.error('恢复邮件配置失败:', error);
      }
    }, 1500); // 延迟1.5秒启动

    // 恢复自动化配置（延迟启动，避免影响应用启动速度）
    setTimeout(async () => {
      try {
        const automationConfig = await configService.getConfig('automation');
        if (automationConfig && automationConfig.ipMonitorEnabled) {
          // 更新IP监控配置（包括检测源）
          ipMonitor.updateConfig({
            checkInterval: automationConfig.checkInterval || 5,
            confirmCount: automationConfig.confirmCount || 3,
            sources: automationConfig.checkSources || ['ipify', 'ip.sb', 'icanhazip'],
          });

          // 启动自动化服务（传递完整配置）
          await automationService.start({
            enabled: true,
            autoUpdateEnabled: automationConfig.autoUpdateEnabled || false,
            triggerType: automationConfig.triggerType || 'immediate',
            delayMinutes: automationConfig.delayMinutes || 5,
            scheduledTime: automationConfig.scheduledTime,
            selectedDevices: automationConfig.selectedDevices || [],
            checkInterval: automationConfig.checkInterval || 5,
            confirmCount: automationConfig.confirmCount || 3,
            checkSources: automationConfig.checkSources || ['ipify', 'ip.sb', 'icanhazip'],
            backupOptions: automationConfig.backupOptions || [],
            backupKeepCount: automationConfig.backupKeepCount || 10,
            securityOptions: automationConfig.securityOptions || [],
          });

          await logger.info('自动化服务', '自动化配置已恢复并启动');
        }
      } catch (error: any) {
        await logger.error('自动化服务', '恢复自动化配置失败', { error: error.message });
        console.error('恢复自动化配置失败:', error);
      }
    }, 2000); // 延迟2秒启动

    // 生产环境下启动时静默检查更新（不显示"无更新"消息）
    if (process.env.NODE_ENV !== 'development') {
      setTimeout(() => {
        customUpdater.checkForUpdates(false).catch(console.error);
      }, 3000); // 延迟3秒检查，避免影响启动速度
    }

    // 开发环境打开DevTools
    if (process.env.NODE_ENV === 'development') {
      mainWindow.webContents.openDevTools();
    }
  });

  app.on('window-all-closed', async () => {
    if (process.platform !== 'darwin') {
      // 清理数据库连接
      await disconnectPrisma();
      app.quit();
    }
  });

  app.on('before-quit', async (event) => {
    // 阻止默认行为，先清理资源
    event.preventDefault();
    try {
      // 停止自动化服务
      try {
        await automationService.stop();
        ipMonitor.stop();
        await logger.info('应用退出', '自动化服务已停止');
      } catch (error) {
        console.error('停止自动化服务失败:', error);
      }
      
      // 断开数据库连接
      await disconnectPrisma();
    } catch (error) {
      console.error('清理资源失败:', error);
    } finally {
      app.exit(0);
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
}

// 导出mainWindow供其他模块使用
export { mainWindow };
