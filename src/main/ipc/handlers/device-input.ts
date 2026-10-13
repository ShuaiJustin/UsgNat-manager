import { isIPv4 } from 'node:net';

export interface DeviceInput {
  name?: string;
  host?: string;
  port?: number;
  connectionType?: 'SSH';
  description?: string | null;
  enabled?: boolean;
}

const HOSTNAME_LABEL = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

export const isValidDeviceHost = (host: string): boolean => {
  if (isIPv4(host)) return true;
  if (host.length > 253) return false;
  const labels = host.split('.');
  // 末段全数字的不是主机名（避免 999.1.1.1 这类非法 IPv4 被当作主机名放行）。
  return (
    labels.every((label) => HOSTNAME_LABEL.test(label)) && !/^\d+$/.test(labels[labels.length - 1])
  );
};

export const assertValidDeviceHost = (host: unknown): string => {
  if (typeof host !== 'string' || !isValidDeviceHost(host)) {
    throw new Error('设备地址必须是有效的 IPv4 地址或主机名');
  }
  return host;
};

export const assertValidDevicePort = (port: unknown): number => {
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('端口必须是 1-65535 的整数');
  }
  return port;
};

/**
 * 只取白名单字段，拒绝渲染进程传入的其他字段（如 id、online、lastConnected）。
 * partial=true 用于更新：未提供的字段保持不变；创建时 name/host/port 必填。
 */
export const parseDeviceInput = (input: unknown, partial: boolean): DeviceInput => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('设备数据格式无效');
  }
  const source = input as Record<string, unknown>;
  const has = (key: string) => source[key] !== undefined;
  const result: DeviceInput = {};

  if (!partial || has('name')) {
    const { name } = source;
    if (typeof name !== 'string' || !name.trim() || name.length > 100) {
      throw new Error('设备名称必须为 1-100 个字符');
    }
    result.name = name;
  }
  if (!partial || has('host')) result.host = assertValidDeviceHost(source.host);
  if (!partial || has('port')) result.port = assertValidDevicePort(source.port);
  if (has('connectionType')) {
    if (source.connectionType !== 'SSH') throw new Error('当前版本仅支持 SSH 连接');
    result.connectionType = 'SSH';
  }
  if (has('description')) {
    const { description } = source;
    if (description !== null && (typeof description !== 'string' || description.length > 500)) {
      throw new Error('设备描述必须为不超过 500 个字符的文本');
    }
    result.description = description;
  }
  if (has('enabled')) {
    if (typeof source.enabled !== 'boolean') throw new Error('设备启用状态必须为布尔值');
    result.enabled = source.enabled;
  }
  return result;
};
