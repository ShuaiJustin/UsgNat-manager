import { Prisma } from '@prisma/client';
import { ipcMain } from 'electron';
import fs from 'fs';

import { credentialManager } from '../../services/credential-manager';
import { logger } from '../../services/logger';
import { prisma } from '../../services/prisma-client';
import { sshManager } from '../../services/ssh-manager';
import {
  assertSupportedAuthType,
  assertSupportedConnectionType,
  assertSupportedDeviceAccess,
  getErrorMessage,
} from './shared';

type DeviceCreatePayload = Prisma.DeviceUncheckedCreateInput;
type DeviceUpdatePayload = Prisma.DeviceUncheckedUpdateInput;

type DirectConnectionPayload = {
  host: string;
  port: number;
  connectionType?: string;
  authType?: string;
  username?: string;
  password?: string;
  privateKey?: string;
  privateKeyPath?: string;
  passphrase?: string;
};

export function registerDeviceHandlers() {
  ipcMain.handle('device:getAll', async () => {
    return prisma.device.findMany({
      orderBy: { createdAt: 'desc' },
    });
  });

  ipcMain.handle('device:getById', async (_event, id: string) => {
    return prisma.device.findUnique({
      where: { id },
    });
  });

  ipcMain.handle('device:create', async (_event, device: DeviceCreatePayload) => {
    try {
      const newDevice = await prisma.device.create({
        data: device,
      });
      await logger.success('设备管理', `设备创建成功: ${device.name}`);
      return newDevice;
    } catch (error) {
      const errorMessage = getErrorMessage(error, '设备创建失败');
      await logger.error('设备管理', '设备创建失败', {
        error: errorMessage,
        device: device.name,
      });
      throw new Error(`设备创建失败: ${errorMessage}`);
    }
  });

  ipcMain.handle('device:update', async (_event, id: string, device: DeviceUpdatePayload) => {
    try {
      const existingDevice = await prisma.device.findUnique({ where: { id } });
      if (!existingDevice) {
        throw new Error('设备不存在');
      }

      const updatedDevice = await prisma.device.update({
        where: { id },
        data: device,
      });

      const deviceName =
        typeof device.name === 'string' && device.name.trim() ? device.name : existingDevice.name;

      await logger.success('设备管理', `设备更新成功: ${deviceName}`);
      return updatedDevice;
    } catch (error) {
      const errorMessage = getErrorMessage(error, '设备更新失败');
      await logger.error('设备管理', '设备更新失败', {
        error: errorMessage,
        deviceId: id,
      });
      throw new Error(`设备更新失败: ${errorMessage}`);
    }
  });

  ipcMain.handle('device:delete', async (_event, id: string) => {
    try {
      const device = await prisma.device.findUnique({ where: { id } });
      if (!device) {
        throw new Error('设备不存在');
      }

      await prisma.$transaction([
        prisma.natRule.deleteMany({ where: { deviceId: id } }),
        prisma.credentialRef.deleteMany({ where: { deviceId: id } }),
        prisma.device.delete({ where: { id } }),
      ]);

      await logger.success('设备管理', `设备删除成功: ${device.name}`);
    } catch (error) {
      const errorMessage = getErrorMessage(error, '设备删除失败');
      await logger.error('设备管理', '设备删除失败', {
        error: errorMessage,
        deviceId: id,
      });
      throw new Error(`设备删除失败: ${errorMessage}`);
    }
  });

  ipcMain.handle('device:testConnection', async (_event, id: string) => {
    try {
      const device = await prisma.device.findUnique({ where: { id } });
      if (!device) {
        return { success: false, message: '设备不存在' };
      }

      const credential = await credentialManager.getCredential(id);
      if (!credential) {
        return { success: false, message: '未配置凭据' };
      }

      assertSupportedDeviceAccess(device, credential);

      await logger.info('设备测试', `开始测试设备连接: ${device.name}`);

      const result = await sshManager.testConnection({
        host: device.host,
        port: device.port,
        username: credential.username || 'admin',
        password: credential.password,
        privateKey: credential.privateKey,
        timeout: 20000,
      });

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
    } catch (error) {
      const errorMessage = getErrorMessage(error, '测试连接失败');
      await logger.error('设备测试', '测试连接失败', { error: errorMessage });
      return { success: false, message: errorMessage };
    }
  });

  ipcMain.handle('device:testDirectConnection', async (_event, config: DirectConnectionPayload) => {
    try {
      await logger.info('设备测试', `测试临时连接: ${config.host}:${config.port}`);

      assertSupportedConnectionType(config.connectionType);
      assertSupportedAuthType(config.authType);

      let privateKey = config.privateKey;
      if (!privateKey && config.privateKeyPath) {
        privateKey = fs.readFileSync(config.privateKeyPath, 'utf-8');
      }

      const result = await sshManager.testConnection({
        host: config.host,
        port: config.port,
        username: config.username || 'admin',
        password: config.password,
        privateKey,
        passphrase: config.passphrase,
        timeout: 20000,
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
    } catch (error) {
      const errorMessage = getErrorMessage(error, '临时连接测试失败');
      await logger.error('设备测试', '临时连接测试失败', { error: errorMessage });
      return { success: false, message: errorMessage };
    }
  });
}
