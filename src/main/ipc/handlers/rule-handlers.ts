import { ipcMain } from 'electron';
import { credentialManager } from '../../services/credential-manager';
import { logger } from '../../services/logger';
import { notifier } from '../../services/notifier';
import { prisma } from '../../services/prisma-client';
import { sshManager } from '../../services/ssh-manager';
import { usgParser } from '../../services/usg-parser';
import { assertSupportedDeviceAccess } from './shared';

export function registerRuleHandlers() {
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

      assertSupportedDeviceAccess(device, credential);

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

      assertSupportedDeviceAccess(device, credential);

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

        assertSupportedDeviceAccess(device, credential);

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
}
