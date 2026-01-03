import { ipcMain, Notification, app, BrowserWindow, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import { sshManager } from '../services/ssh-manager';
import { usgParser } from '../services/usg-parser';
import { ipMonitor } from '../services/ip-monitor';
import { logger } from '../services/logger';
import { notifier } from '../services/notifier';
import { credentialManager } from '../services/credential-manager';
import { automationService } from '../services/automation-service';
import { emailService } from '../services/email-service';
import { configService } from '../services/config-service';
import { backupService } from '../services/backup-service';
import { customUpdater } from '../services/custom-updater';
import { prisma } from '../services/prisma-client';

export function registerIpcHandlers() {
  // 设备管理
  ipcMain.handle('device:getAll', async () => {
    return await prisma.device.findMany({
      orderBy: { createdAt: 'desc' },
    });
  });

  ipcMain.handle('device:getById', async (event, id: string) => {
    return await prisma.device.findUnique({
      where: { id },
    });
  });

  ipcMain.handle('device:create', async (event, device: any) => {
    try {
      const newDevice = await prisma.device.create({
        data: device,
      });
      await logger.success('设备管理', `设备创建成功: ${device.name}`);
      return newDevice;
    } catch (error: any) {
      await logger.error('设备管理', '设备创建失败', {
        error: error.message,
        device: device.name,
      });
      throw new Error(`设备创建失败: ${error.message}`);
    }
  });

  ipcMain.handle('device:update', async (event, id: string, device: any) => {
    try {
      const existingDevice = await prisma.device.findUnique({ where: { id } });
      if (!existingDevice) {
        throw new Error('设备不存在');
      }

      const updatedDevice = await prisma.device.update({
        where: { id },
        data: device,
      });

      await logger.success('设备管理', `设备更新成功: ${device.name || existingDevice.name}`);
      return updatedDevice;
    } catch (error: any) {
      await logger.error('设备管理', '设备更新失败', {
        error: error.message,
        deviceId: id,
      });
      throw new Error(`设备更新失败: ${error.message}`);
    }
  });

  ipcMain.handle('device:delete', async (event, id: string) => {
    try {
      const device = await prisma.device.findUnique({ where: { id } });
      if (!device) {
        throw new Error('设备不存在');
      }

      // 删除设备及其关联数据
      await prisma.$transaction([
        prisma.natRule.deleteMany({ where: { deviceId: id } }),
        prisma.credentialRef.deleteMany({ where: { deviceId: id } }),
        prisma.device.delete({ where: { id } }),
      ]);

      await logger.success('设备管理', `设备删除成功: ${device.name}`);
    } catch (error: any) {
      await logger.error('设备管理', '设备删除失败', {
        error: error.message,
        deviceId: id,
      });
      throw new Error(`设备删除失败: ${error.message}`);
    }
  });

  ipcMain.handle('device:testConnection', async (event, id: string) => {
    try {
      const device = await prisma.device.findUnique({ where: { id } });
      if (!device) {
        return { success: false, message: '设备不存在' };
      }

      const credential = await credentialManager.getCredential(id);
      if (!credential) {
        return { success: false, message: '未配置凭据' };
      }

      await logger.info('设备测试', `开始测试设备连接: ${device.name}`);

      const result = await sshManager.testConnection({
        host: device.host,
        port: device.port,
        username: credential.username || 'admin',
        password: credential.password,
        privateKey: credential.privateKey,
        timeout: 20000, // Server环境增加到20秒超时
      });

      // 更新设备状态
      await prisma.device.update({
        where: { id },
        data: {
          online: result.success,
          lastConnected: result.success ? new Date() : undefined,
        },
      });

      if (result.success) {
        await logger.success('设备测试', `设备 ${device.name} 连接成功`, {
          latency: result.latency,
        });
      } else {
        await logger.warning('设备测试', `设备 ${device.name} 连接失败`, {
          message: result.message,
        });
      }

      return result;
    } catch (error: any) {
      await logger.error('设备测试', '测试连接失败', { error: error.message });
      return { success: false, message: error.message };
    }
  });

  // 测试临时连接配置（不保存设备）
  ipcMain.handle('device:testDirectConnection', async (event, config: any) => {
    try {
      await logger.info('设备测试', `测试临时连接: ${config.host}:${config.port}`);

      const result = await sshManager.testConnection({
        host: config.host,
        port: config.port,
        username: config.username || 'admin',
        password: config.password,
        privateKey: config.privateKey,
        timeout: 20000, // Server环境增加到20秒超时
      });

      if (result.success) {
        await logger.success('设备测试', `临时连接测试成功: ${config.host}`, {
          latency: result.latency,
        });
      } else {
        await logger.warning('设备测试', `临时连接测试失败: ${config.host}`, {
          message: result.message,
        });
      }

      return result;
    } catch (error: any) {
      await logger.error('设备测试', '临时连接测试失败', { error: error.message });
      return { success: false, message: error.message };
    }
  });

  // 规则管理
  ipcMain.handle('rule:getAll', async (event, deviceId: string) => {
    return await prisma.natRule.findMany({
      where: { deviceId },
      orderBy: { createdAt: 'desc' },
    });
  });

  ipcMain.handle('rule:getTotalCount', async () => {
    try {
      const count = await prisma.natRule.count();
      return count;
    } catch (error: any) {
      await logger.error('规则管理', '获取规则总数失败', { error: error.message });
      return 0;
    }
  });

  ipcMain.handle('rule:syncFromDevice', async (event, deviceId: string) => {
    let device: any = null;
    try {
      device = await prisma.device.findUnique({ where: { id: deviceId } });
      if (!device) {
        throw new Error('设备不存在');
      }

      const credential = await credentialManager.getCredential(deviceId);
      if (!credential) {
        throw new Error('未配置凭据');
      }

      // 连接设备
      const connectResult = await sshManager.connect(deviceId, {
        host: device.host,
        port: device.port,
        username: credential.username || 'admin',
        password: credential.password,
        privateKey: credential.privateKey,
      });

      if (!connectResult.success) {
        throw new Error(`连接失败: ${connectResult.message}`);
      }

      // 执行命令获取NAT规则
      const command = 'display current-configuration | include nat server';
      await logger.info('获取规则', `执行命令: ${command}`, { deviceName: device.name });

      const result = await sshManager.executeCommand(deviceId, command);

      if (!result.success) {
        await sshManager.disconnect(deviceId);
        await logger.error('获取规则', '命令执行失败', {
          deviceName: device.name,
          command,
          exitCode: result.exitCode,
          error: result.error,
          output: result.output?.substring(0, 200), // 记录前200个字符
        });
        throw new Error(`命令执行失败: ${result.error || '未知错误'}`);
      }

      if (!result.output || result.output.trim() === '') {
        await sshManager.disconnect(deviceId);
        await logger.warning('获取规则', `设备 ${device.name} 未找到NAT规则`);
        return [];
      }

      await logger.info('获取规则', '命令执行成功，开始解析规则', {
        deviceName: device.name,
        outputLength: result.output.length,
      });

      // 解析规则
      const parsedRules = usgParser.parseNatServerList(result.output);

      // 保存到数据库
      const savedRules: any[] = [];
      for (const rule of parsedRules) {
        // 先查找是否存在
        const existing = await prisma.natRule.findFirst({
          where: {
            deviceId,
            ruleName: rule.ruleName,
          },
        });

        let saved;
        if (existing) {
          // 更新现有规则
          saved = await prisma.natRule.update({
            where: { id: existing.id },
            data: {
              protocol: rule.protocol,
              globalIp: rule.globalIp,
              globalPort: rule.globalPort,
              insideIp: rule.insideIp,
              insidePort: rule.insidePort,
              enabled: rule.enabled,
              description: rule.description,
              noReverse: rule.noReverse || false,
            },
          });
        } else {
          // 创建新规则
          saved = await prisma.natRule.create({
            data: {
              deviceId,
              ruleName: rule.ruleName,
              protocol: rule.protocol,
              globalIp: rule.globalIp,
              globalPort: rule.globalPort,
              insideIp: rule.insideIp,
              insidePort: rule.insidePort,
              enabled: rule.enabled,
              description: rule.description,
              noReverse: rule.noReverse || false,
            },
          });
        }
        savedRules.push(saved);
      }

      await sshManager.disconnect(deviceId);
      await logger.success('获取规则', `从设备 ${device.name} 获取了 ${savedRules.length} 条规则`);
      return savedRules;
    } catch (error: any) {
      // 确保断开连接
      try {
        await sshManager.disconnect(deviceId);
      } catch {
        // 忽略断开连接的错误
      }

      const errorDetails = {
        error: error.message,
        deviceId,
        deviceName: device?.name || 'unknown',
        timestamp: new Date().toISOString(),
      };

      await logger.error('获取规则', '获取失败', errorDetails);

      // 抛出更具体的错误
      throw new Error(`获取规则失败: ${error.message}`);
    }
  });

  ipcMain.handle('rule:syncToDevice', async (event, deviceId: string) => {
    let device: any = null;
    try {
      device = await prisma.device.findUnique({ where: { id: deviceId } });
      if (!device) {
        throw new Error('设备不存在');
      }

      const credential = await credentialManager.getCredential(deviceId);
      if (!credential) {
        throw new Error('未配置凭据');
      }

      // 获取本地规则
      const localRules = await prisma.natRule.findMany({
        where: { deviceId },
      });

      if (localRules.length === 0) {
        throw new Error('没有可同步的规则');
      }

      // 连接设备（只连接一次）
      const connectResult = await sshManager.connect(deviceId, {
        host: device.host,
        port: device.port,
        username: credential.username || 'admin',
        password: credential.password,
        privateKey: credential.privateKey,
      });

      if (!connectResult.success) {
        await logger.error('同步规则', '初次连接失败', {
          deviceName: device.name,
          error: connectResult.message,
        });
        throw new Error(`连接失败: ${connectResult.message}`);
      }

      // 先获取设备上的现有规则（使用 executeCommand，会自动断开）
      const queryCommand = 'display current-configuration | include nat server';
      await logger.info('同步规则', `获取设备现有规则: ${queryCommand}`, {
        deviceName: device.name,
      });

      const queryResult = await sshManager.executeCommand(deviceId, queryCommand);

      let deviceRules: any[] = [];
      if (queryResult.success && queryResult.output && queryResult.output.trim() !== '') {
        // 记录原始输出，用于调试
        await logger.info('同步规则', '设备原始配置输出', {
          deviceName: device.name,
          rawOutput: queryResult.output,
        });

        deviceRules = usgParser.parseNatServerList(queryResult.output);
        await logger.info('同步规则', `解析到 ${deviceRules.length} 条设备规则`, {
          deviceName: device.name,
          rules: deviceRules.map((r) => ({
            name: r.ruleName,
            global: `${r.globalIp}:${r.globalPort}`,
          })),
        });
      }

      // executeCommand 会自动断开连接，等待完全关闭
      await logger.info('同步规则', '等待连接完全关闭', { deviceName: device.name });
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // 重新连接执行同步
      await logger.info('同步规则', '重新连接设备', { deviceName: device.name });
      const reconnectResult = await sshManager.connect(deviceId, {
        host: device.host,
        port: device.port,
        username: credential.username || 'admin',
        password: credential.password,
        privateKey: credential.privateKey,
      });

      if (!reconnectResult.success) {
        await logger.error('同步规则', '重新连接失败', {
          deviceName: device.name,
          error: reconnectResult.message,
        });
        throw new Error(`重新连接失败: ${reconnectResult.message}`);
      }

      // 生成同步命令
      const parsedLocalRules = localRules.map((r) => ({
        ruleName: r.ruleName,
        protocol: r.protocol as any,
        globalIp: r.globalIp,
        globalPort: r.globalPort,
        insideIp: r.insideIp,
        insidePort: r.insidePort,
        enabled: r.enabled,
        description: r.description || undefined,
        noReverse: r.noReverse || false,
      }));

      const commands = usgParser.generateSyncToDeviceCommands(deviceRules, parsedLocalRules);

      // 如果没有变化，直接返回
      if (commands.length === 0) {
        await sshManager.disconnect(deviceId);
        await logger.info('同步规则', `设备 ${device.name} 的规则已是最新，无需同步`);
        return {
          success: true,
          syncedCount: 0,
          message: '规则已是最新，无需同步',
        };
      }

      await logger.info('同步规则', `开始增量同步规则到设备`, {
        deviceName: device.name,
        commandCount: commands.length,
        totalLocalRules: localRules.length,
      });

      // 使用批量命令执行方法
      const syncResult = await sshManager.executeBatchCommands(deviceId, commands);

      await sshManager.disconnect(deviceId);

      if (!syncResult.success) {
        await logger.error('同步规则', '命令执行失败', {
          deviceName: device.name,
          error: syncResult.error,
          output: syncResult.output?.substring(0, 500),
        });
        throw new Error(`命令执行失败: ${syncResult.error || '未知错误'}`);
      }

      await logger.success('同步规则', `成功增量同步规则到设备 ${device.name}`, {
        output: syncResult.output?.substring(0, 200),
        commandCount: commands.length,
      });

      return {
        success: true,
        syncedCount: localRules.length,
        message: '增量同步成功',
      };
    } catch (error: any) {
      // 确保断开连接
      try {
        await sshManager.disconnect(deviceId);
      } catch {
        // 忽略断开连接的错误
      }

      const errorDetails = {
        error: error.message,
        deviceId,
        deviceName: device?.name || 'unknown',
        timestamp: new Date().toISOString(),
      };

      await logger.error('同步规则', '同步到设备失败', errorDetails);

      throw new Error(`同步到设备失败: ${error.message}`);
    }
  });

  ipcMain.handle(
    'rule:batchUpdateIP',
    async (event, deviceId: string, ruleIds: string[], newIP: string) => {
      let device: any = null;
      try {
        device = await prisma.device.findUnique({ where: { id: deviceId } });
        if (!device) {
          throw new Error('设备不存在');
        }

        const rules = await prisma.natRule.findMany({
          where: { id: { in: ruleIds } },
        });

        if (rules.length === 0) {
          throw new Error('没有找到要更新的规则');
        }

        const credential = await credentialManager.getCredential(deviceId);
        if (!credential) {
          throw new Error('未配置凭据');
        }

        // 连接设备
        const connectResult = await sshManager.connect(deviceId, {
          host: device.host,
          port: device.port,
          username: credential.username || 'admin',
          password: credential.password,
          privateKey: credential.privateKey,
        });

        if (!connectResult.success) {
          throw new Error(`连接失败: ${connectResult.message}`);
        }

        // 生成更新命令
        const parsedRules = rules.map((r) => ({
          ruleName: r.ruleName,
          protocol: r.protocol as any,
          globalIp: r.globalIp,
          globalPort: r.globalPort,
          insideIp: r.insideIp,
          insidePort: r.insidePort,
          enabled: r.enabled,
          noReverse: r.noReverse || false,
        }));

        const commands = usgParser.generateBatchUpdateIPCommands(parsedRules, newIP);

        // 使用批量命令执行方法
        const updateResult = await sshManager.executeBatchCommands(deviceId, commands);

        if (!updateResult.success) {
          await logger.error('批量更新', '命令执行失败', {
            deviceName: device.name,
            error: updateResult.error,
          });
          throw new Error(`命令执行失败: ${updateResult.error || '未知错误'}`);
        }

        // 更新数据库
        await prisma.natRule.updateMany({
          where: { id: { in: ruleIds } },
          data: { globalIp: newIP },
        });

        await logger.success('批量更新', `更新了设备 ${device.name} 的 ${ruleIds.length} 条规则`);
        await notifier.notifyUpdateSuccess(device.name, ruleIds.length);

        return {
          success: true,
          updated: ruleIds.length,
        };
      } catch (error: any) {
        await logger.error('批量更新', '更新失败', {
          error: error.message,
          deviceId,
          deviceName: device?.name || 'unknown',
        });
        throw error;
      } finally {
        // 确保断开连接
        try {
          await sshManager.disconnect(deviceId);
        } catch {
          // 忽略断开连接的错误
        }
      }
    }
  );

  ipcMain.handle('rule:create', async (event, deviceId: string, rule: any) => {
    try {
      const newRule = await prisma.natRule.create({
        data: {
          ...rule,
          deviceId,
        },
      });
      await logger.success('规则管理', `规则创建成功: ${rule.ruleName}`, {
        deviceId,
        protocol: rule.protocol,
        globalIp: rule.globalIp,
        globalPort: rule.globalPort,
      });
      return newRule;
    } catch (error: any) {
      await logger.error('规则管理', '规则创建失败', {
        deviceId,
        ruleName: rule.ruleName,
        error: error.message,
      });
      throw error;
    }
  });

  ipcMain.handle('rule:update', async (event, id: string, rule: any) => {
    try {
      const updatedRule = await prisma.natRule.update({
        where: { id },
        data: rule,
      });
      await logger.success('规则管理', `规则更新成功: ${rule.ruleName || ''}`, {
        ruleId: id,
        updates: rule,
      });
      return updatedRule;
    } catch (error: any) {
      await logger.error('规则管理', '规则更新失败', {
        ruleId: id,
        error: error.message,
      });
      throw error;
    }
  });

  ipcMain.handle('rule:delete', async (event, id: string) => {
    try {
      await prisma.natRule.delete({
        where: { id },
      });
      await logger.info('规则管理', '规则删除成功', { ruleId: id });
    } catch (error: any) {
      await logger.error('规则管理', '规则删除失败', { ruleId: id, error: error.message });
      throw error;
    }
  });

  ipcMain.handle('rule:batchUpdate', async (event, ruleIds: string[], updates: any) => {
    try {
      await prisma.natRule.updateMany({
        where: { id: { in: ruleIds } },
        data: updates,
      });
      await logger.success('规则管理', `批量更新 ${ruleIds.length} 条规则`, updates);
      return { success: true, count: ruleIds.length };
    } catch (error: any) {
      await logger.error('规则管理', '批量更新失败', { error: error.message });
      throw error;
    }
  });

  // 监控管理
  ipcMain.handle('monitor:start', async () => {
    try {
      // 检查是否已经在运行
      if (ipMonitor.isMonitoring()) {
        await logger.warning('监控服务', 'IP监控已在运行');
        return { success: true, message: '监控服务已在运行' };
      }

      await ipMonitor.start();
      await logger.info('监控服务', 'IP监控已启动');

      return { success: true, message: 'IP监控已启动' };
    } catch (error: any) {
      const errorMessage = error.message || '未知错误';
      await logger.error('监控服务', '启动失败', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
        details: '请检查网络连接或稍后重试',
      };
    }
  });

  ipcMain.handle('monitor:stop', async () => {
    try {
      ipMonitor.stop();
      await logger.info('监控服务', 'IP监控已停止');
      return { success: true };
    } catch (error: any) {
      await logger.error('监控服务', '停止失败', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('monitor:getStatus', async () => {
    return {
      isRunning: ipMonitor.isMonitoring(),
      currentIP: ipMonitor.getCurrentIPSync(),
      lastCheck: new Date(),
    };
  });

  ipcMain.handle('monitor:getCurrentIP', async () => {
    try {
      return await ipMonitor.checkIP();
    } catch {
      return '0.0.0.0';
    }
  });

  // 凭据管理
  ipcMain.handle('credential:save', async (event, deviceId: string, credential: any) => {
    try {
      await credentialManager.saveCredential({ deviceId, ...credential });
      await logger.info('凭据管理', `保存设备凭据: ${deviceId}`);
    } catch (error: any) {
      await logger.error('凭据管理', '保存失败', { error: error.message });
      throw error;
    }
  });

  ipcMain.handle('credential:get', async (event, deviceId: string) => {
    try {
      return await credentialManager.getCredential(deviceId);
    } catch (error: any) {
      await logger.error('凭据管理', '获取失败', { error: error.message });
      return null;
    }
  });

  ipcMain.handle('credential:delete', async (event, deviceId: string) => {
    try {
      await credentialManager.deleteCredential(deviceId);
      await logger.info('凭据管理', `删除设备凭据: ${deviceId}`);
    } catch (error: any) {
      await logger.error('凭据管理', '删除失败', { error: error.message });
      throw error;
    }
  });

  // 日志管理
  ipcMain.handle('log:query', async (event, filter: any) => {
    return await logger.query(filter);
  });

  ipcMain.handle('log:export', async (event, filter: any) => {
    try {
      const csv = await logger.export(filter);
      await logger.info('日志导出', '导出日志成功');
      return csv;
    } catch (error: any) {
      await logger.error('日志导出', '导出失败', { error: error.message });
      throw error;
    }
  });

  ipcMain.handle('log:cleanup', async (event, daysToKeep: number) => {
    try {
      const count = await logger.cleanup(daysToKeep);
      await logger.info('日志清理', `清理完成，删除了 ${count} 条日志`, { daysToKeep });
      return { success: true, count };
    } catch (error: any) {
      await logger.error('日志清理', '清理失败', { error: error.message });
      throw error;
    }
  });

  // 自动化服务
  ipcMain.handle('automation:start', async (event, config: any) => {
    try {
      await automationService.start(config);
      await logger.info('自动化', '自动化服务已启动');
      return { success: true };
    } catch (error: any) {
      await logger.error('自动化', '启动失败', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('automation:stop', async () => {
    try {
      await automationService.stop();
      await logger.info('自动化', '自动化服务已停止');
      return { success: true };
    } catch (error: any) {
      await logger.error('自动化', '停止失败', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('automation:getStatus', async () => {
    return automationService.getStatus();
  });

  ipcMain.handle('automation:getConfig', async () => {
    return automationService.getConfig();
  });

  ipcMain.handle('automation:manualUpdate', async (event, newIP?: string) => {
    try {
      await automationService.manualUpdate(newIP);
      return { success: true };
    } catch (error: any) {
      await logger.error('自动化', '手动更新失败', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('automation:updateConfig', async (event, config: any) => {
    try {
      automationService.updateConfig(config);
      await logger.info('自动化', '配置已更新');
      return { success: true };
    } catch (error: any) {
      await logger.error('自动化', '更新配置失败', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  // 手动确认相关
  let pendingConfirmCallback: ((confirmed: boolean) => void) | null = null;
  let pendingConfirmInfo: { newIP: string; deviceCount: number } | null = null;

  // 监听自动化服务的确认请求
  automationService.on('manual-confirm-request', (data: { newIP: string; deviceCount: number; callback: (confirmed: boolean) => void }) => {
    pendingConfirmInfo = { newIP: data.newIP, deviceCount: data.deviceCount };
    pendingConfirmCallback = data.callback;

    // 发送到渲染进程
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      win.webContents.send('automation:confirm-request', {
        newIP: data.newIP,
        deviceCount: data.deviceCount,
      });
    });
  });

  // 处理确认结果
  ipcMain.handle('automation:confirm-response', async (event, confirmed: boolean) => {
    if (pendingConfirmCallback) {
      pendingConfirmCallback(confirmed);
      pendingConfirmCallback = null;
      pendingConfirmInfo = null;
    }
    return { success: true };
  });

  // 获取待确认信息（用于前端查询）
  ipcMain.handle('automation:getPendingConfirm', async () => {
    return pendingConfirmInfo;
  });

  // 邮件服务
  ipcMain.handle('email:configure', async (event, config: any) => {
    try {
      emailService.configure(config);
      await configService.saveConfig('email', config);
      
      // 同步通知器配置
      notifier.updateConfig({
        emailNotifyEnabled: config.enabled || false,
        notifyTypes: config.notifyTypes || ['ipChange', 'updateSuccess', 'updateFailed', 'deviceOffline'],
      });
      
      await logger.info('邮件服务', '邮件配置已保存');
      return { success: true };
    } catch (error: any) {
      await logger.error('邮件服务', '配置失败', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('email:sendTest', async () => {
    try {
      const result = await emailService.sendTestEmail();
      return { success: result };
    } catch (error: any) {
      await logger.error('邮件服务', '发送测试邮件失败', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  // 使用临时配置发送测试邮件（不保存配置）
  ipcMain.handle('email:sendTestWithConfig', async (event, config: any) => {
    try {
      const result = await emailService.sendTestEmailWithConfig(config);
      return { success: result };
    } catch (error: any) {
      await logger.error('邮件服务', '使用临时配置发送测试邮件失败', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('email:verifyConfig', async (event, config: any) => {
    try {
      const result = await emailService.verifyConfig(config);
      return { success: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // 配置服务
  ipcMain.handle('config:save', async (event, type: string, data: any) => {
    try {
      await configService.saveConfig(type as any, data);
      
      // 如果保存的是更新配置，重新启动定期检查
      if (type === 'update') {
        await customUpdater.startPeriodicCheck();
      }
      
      return { success: true };
    } catch (error: any) {
      await logger.error('配置服务', '保存配置失败', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('config:get', async (event, type: string) => {
    try {
      return await configService.getConfig(type as any);
    } catch (error: any) {
      await logger.error('配置服务', '获取配置失败', { error: error.message });
      return null;
    }
  });

  ipcMain.handle('config:getAll', async () => {
    try {
      return await configService.getAllConfigs();
    } catch (error: any) {
      await logger.error('配置服务', '获取所有配置失败', { error: error.message });
      return {};
    }
  });

  ipcMain.handle('config:export', async (event, filePath?: string) => {
    try {
      const path = await configService.exportConfig(filePath);
      return { success: true, path };
    } catch (error: any) {
      await logger.error('配置服务', '导出配置失败', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('config:import', async (event, filePath: string) => {
    try {
      await configService.importConfig(filePath);
      return { success: true };
    } catch (error: any) {
      await logger.error('配置服务', '导入配置失败', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('config:reset', async () => {
    try {
      await configService.resetAllConfigs();
      return { success: true };
    } catch (error: any) {
      await logger.error('配置服务', '重置配置失败', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  // 备份服务
  ipcMain.handle('backup:create', async (event, description?: string) => {
    try {
      const backup = await backupService.createBackup(description);
      return backup;
    } catch (error: any) {
      await logger.error('备份服务', '创建备份失败', { error: error.message });
      throw error;
    }
  });

  ipcMain.handle('backup:restore', async (event, filePath: string) => {
    try {
      await backupService.restoreBackup(filePath);
      return { success: true };
    } catch (error: any) {
      await logger.error('备份服务', '恢复备份失败', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('backup:list', async () => {
    try {
      return await backupService.listBackups();
    } catch (error: any) {
      await logger.error('备份服务', '获取备份列表失败', { error: error.message });
      return [];
    }
  });

  ipcMain.handle('backup:delete', async (event, filename: string) => {
    try {
      await backupService.deleteBackup(filename);
      return { success: true };
    } catch (error: any) {
      await logger.error('备份服务', '删除备份失败', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('backup:cleanup', async (event, keepCount?: number) => {
    try {
      const deleted = await backupService.cleanupOldBackups(keepCount);
      return { success: true, deleted };
    } catch (error: any) {
      await logger.error('备份服务', '清理备份失败', { error: error.message });
      return { success: false, deleted: 0, error: error.message };
    }
  });

  ipcMain.handle('backup:stats', async () => {
    try {
      return await backupService.getBackupStats();
    } catch (error: any) {
      await logger.error('备份服务', '获取备份统计失败', { error: error.message });
      return {
        totalBackups: 0,
        totalSize: 0,
        oldestBackup: null,
        newestBackup: null,
      };
    }
  });

  // 系统功能
  ipcMain.handle('system:showNotification', async (event, title: string, body: string) => {
    new Notification({
      title,
      body,
    }).show();
  });

  ipcMain.handle('system:getTheme', async () => {
    try {
      const config = await configService.getConfig('app');
      return config?.theme || 'auto';
    } catch {
      return 'auto';
    }
  });

  ipcMain.handle('system:setTheme', async (event, theme: string) => {
    try {
      const config = await configService.getConfig('app');
      await configService.saveConfig('app', { ...config, theme });
      await logger.info('系统设置', `主题已更改为: ${theme}`);
      return { success: true };
    } catch (error: any) {
      await logger.error('系统设置', '设置主题失败', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  // 开机自启动
  ipcMain.handle('system:setAutoStart', async (event, enabled: boolean) => {
    try {
      // 设置开机自启动
      app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: false, // 启动时不隐藏窗口
        path: app.getPath('exe'),
        args: [],
      });

      // 保存配置
      const config = await configService.getConfig('app');
      await configService.saveConfig('app', { ...config, autoStart: enabled });
      await logger.info('系统设置', `开机自启动已${enabled ? '启用' : '禁用'}`);

      return { success: true };
    } catch (error: any) {
      await logger.error('系统设置', '设置开机自启动失败', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('system:getAutoStart', async () => {
    try {
      const settings = app.getLoginItemSettings();
      return settings.openAtLogin;
    } catch {
      return false;
    }
  });

  // 获取数据库信息
  ipcMain.handle('system:getDatabaseInfo', async () => {
    try {
      const userDataPath = app.getPath('userData');
      const dbPath = path.join(userDataPath, 'usg-nat.db');

      let size = '未知';
      if (fs.existsSync(dbPath)) {
        const stats = fs.statSync(dbPath);
        const sizeInBytes = stats.size;
        if (sizeInBytes < 1024) {
          size = `${sizeInBytes} B`;
        } else if (sizeInBytes < 1024 * 1024) {
          size = `${(sizeInBytes / 1024).toFixed(2)} KB`;
        } else {
          size = `${(sizeInBytes / 1024 / 1024).toFixed(2)} MB`;
        }
      }

      return {
        path: dbPath,
        size: size,
      };
    } catch {
      return {
        path: '获取失败',
        size: '未知',
      };
    }
  });

  // 数据库管理
  ipcMain.handle('database:clearAll', async () => {
    try {
      // 使用事务清空所有表
      await prisma.$transaction([
        prisma.natRule.deleteMany({}),
        prisma.device.deleteMany({}),
        prisma.credentialRef.deleteMany({}),
        prisma.log.deleteMany({}),
        // 保留配置，不清空
      ]);

      await logger.warning('数据库管理', '已清空所有数据（设备、规则、凭据、日志）');
      return { success: true };
    } catch (error: any) {
      await logger.error('数据库管理', '清空数据失败', { error: error.message });
      throw error;
    }
  });

  // 更新功能
  ipcMain.handle('updater:checkForUpdates', async (event, showNoUpdateMessage = true) => {
    try {
      return await customUpdater.checkForUpdates(showNoUpdateMessage);
    } catch (error: any) {
      await logger.error('自动更新', '检查更新失败', { error: error.message });
      return {
        success: false,
        message: error.message,
      };
    }
  });

  ipcMain.handle('updater:downloadUpdate', async () => {
    try {
      await customUpdater.downloadUpdate();
      return { success: true };
    } catch (error: any) {
      await logger.error('自动更新', '下载更新失败', { error: error.message });
      return {
        success: false,
        message: error.message,
      };
    }
  });

  ipcMain.handle('updater:quitAndInstall', async () => {
    try {
      await customUpdater.quitAndInstall();
      return { success: true };
    } catch (error: any) {
      await logger.error('自动更新', '退出并安装失败', { error: error.message });
      return {
        success: false,
        message: error.message,
      };
    }
  });

  ipcMain.handle('updater:getCurrentVersion', async () => {
    try {
      return customUpdater.getCurrentVersion();
    } catch {
      return '1.0.2'; // 默认返回当前版本
    }
  });

  // 窗口控制
  ipcMain.handle('window:minimize', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      window.minimize();
    }
  });

  ipcMain.handle('window:maximize', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
    }
  });

  ipcMain.handle('window:close', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      window.close();
    }
  });

  ipcMain.handle('window:isMaximized', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window ? window.isMaximized() : false;
  });

  // 文件选择对话框
  ipcMain.handle('system:selectFile', async (event, options: any) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;

    const result = await dialog.showOpenDialog(window, {
      title: options?.title || '选择文件',
      filters: options?.filters || [],
      properties: ['openFile'],
    });

    return result.canceled ? null : result.filePaths[0];
  });
}
