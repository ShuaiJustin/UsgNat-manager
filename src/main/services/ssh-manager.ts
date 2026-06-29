import { Client, ConnectConfig } from 'ssh2';
import { EventEmitter } from 'events';
import { Buffer } from 'buffer';
import { logger } from './logger';
import { getDeviceCommandError } from './ssh-manager-helpers';

/**
 * SSH连接配置
 */
export interface SSHConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: Buffer | string;
  passphrase?: string;
  timeout?: number;
}

/**
 * SSH连接结果
 */
export interface SSHConnectionResult {
  success: boolean;
  message: string;
  latency?: number;
  error?: Error;
}

/**
 * SSH命令执行结果
 */
export interface SSHCommandResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode?: number;
}

/**
 * SSH连接管理器
 * 负责管理SSH连接、执行命令、连接池等
 */
export class SSHManager extends EventEmitter {
  private connections: Map<string, Client> = new Map();
  private connectionStatus: Map<string, boolean> = new Map();

  constructor() {
    super();
    // 设置默认的error处理器，避免未捕获的错误
    this.on('error', (deviceId: string, err: Error) => {
      logger.error('SSH错误', `设备 ${deviceId}`, { error: err.message }).catch(() => {});
    });

    // 设置最大监听器数量，避免内存泄漏警告
    this.setMaxListeners(50);
  }

  /**
   * 测试SSH连接
   */
  async testConnection(config: SSHConfig): Promise<SSHConnectionResult> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const client = new Client();
      let connected = false;

      // 设置超时
      const timeout = setTimeout(() => {
        if (!connected) {
          client.end();
          resolve({
            success: false,
            message: '连接超时',
          });
        }
      }, config.timeout || 15000); // Server环境需要更长超时时间

      client
        .on('ready', () => {
          connected = true;
          clearTimeout(timeout);
          const latency = Date.now() - startTime;
          client.end();
          resolve({
            success: true,
            message: '连接成功',
            latency,
          });
        })
        .on('error', (err) => {
          connected = true;
          clearTimeout(timeout);
          resolve({
            success: false,
            message: `连接失败: ${err.message}`,
            error: err,
          });
        })
        .connect(this.buildConnectConfig(config));
    });
  }

  /**
   * 创建并保持SSH连接
   */
  async connect(deviceId: string, config: SSHConfig): Promise<SSHConnectionResult> {
    // 如果已存在连接，先断开
    if (this.connections.has(deviceId)) {
      await this.disconnect(deviceId);
    }

    return new Promise((resolve) => {
      const client = new Client();
      const startTime = Date.now();
      let connected = false;

      const timeout = setTimeout(() => {
        if (!connected) {
          client.end();
          resolve({
            success: false,
            message: '连接超时',
          });
        }
      }, config.timeout || 15000); // Server环境需要更长超时时间

      client
        .on('ready', () => {
          connected = true;
          clearTimeout(timeout);
          this.connections.set(deviceId, client);
          this.connectionStatus.set(deviceId, true);

          const latency = Date.now() - startTime;
          this.emit('connected', deviceId);

          resolve({
            success: true,
            message: '连接成功',
            latency,
          });
        })
        .on('error', (err) => {
          if (!connected) {
            // 连接阶段的错误
            connected = true;
            clearTimeout(timeout);
            this.connectionStatus.set(deviceId, false);

            resolve({
              success: false,
              message: `连接失败: ${err.message}`,
              error: err,
            });
          }
          // 无论如何都发出error事件，用于日志记录
          this.emit('error', deviceId, err);
        })
        .on('close', () => {
          this.connections.delete(deviceId);
          this.connectionStatus.set(deviceId, false);
          this.emit('disconnected', deviceId);
        })
        .connect(this.buildConnectConfig(config));
    });
  }

  /**
   * 断开SSH连接
   */
  async disconnect(deviceId: string): Promise<void> {
    const client = this.connections.get(deviceId);
    if (client) {
      client.end();
      this.connections.delete(deviceId);
      this.connectionStatus.set(deviceId, false);
    }
  }

  /**
   * 执行SSH命令（使用shell交互模式，适用于华为USG等设备）
   */
  async executeCommand(
    deviceId: string,
    command: string,
    timeout: number = 30000 // Server环境恢复到30秒超时
  ): Promise<SSHCommandResult> {
    const client = this.connections.get(deviceId);

    if (!client) {
      return {
        success: false,
        output: '',
        error: '设备未连接',
      };
    }

    return new Promise((resolve) => {
      let output = '';
      let commandExecuted = false;

      const timer = setTimeout(() => {
        if (!commandExecuted) {
          commandExecuted = true;
          resolve({
            success: false,
            output,
            error: '命令执行超时',
          });
        }
      }, timeout);

      // 使用shell模式而不是exec模式，适用于需要交互式登录的设备
      client.shell((err, stream) => {
        if (err) {
          clearTimeout(timer);
          commandExecuted = true;
          resolve({
            success: false,
            output: '',
            error: err.message,
          });
          return;
        }

        let waitForPrompt = true;

        stream
          .on('close', () => {
            if (!commandExecuted) {
              clearTimeout(timer);
              commandExecuted = true;
              const commandError = getDeviceCommandError(output);
              resolve({
                success: commandError === null,
                output: this.cleanOutput(output),
                error: commandError || undefined,
                exitCode: commandError === null ? 0 : 1,
              });
            }
          })
          .on('error', (err: Error) => {
            if (!commandExecuted) {
              clearTimeout(timer);
              commandExecuted = true;
              resolve({
                success: false,
                output: output,
                error: `Stream错误: ${err.message}`,
              });
            }
          })
          .on('data', (data: Buffer) => {
            const text = data.toString();
            output += text;

            // 检测到命令提示符后，发送命令
            if (waitForPrompt && this.isPromptReady(text)) {
              waitForPrompt = false;
              output = ''; // 清空之前的欢迎信息
              stream.write(command + '\n');

              // 设置一个延迟，等待命令执行完成
              setTimeout(() => {
                // 发送quit命令退出
                stream.write('quit\n');

                // 再等待一小段时间让输出完成
                setTimeout(() => {
                  if (!commandExecuted) {
                    clearTimeout(timer);
                    commandExecuted = true;
                    stream.end();
                    const commandError = getDeviceCommandError(output);
                    resolve({
                      success: commandError === null,
                      output: this.cleanOutput(output),
                      error: commandError || undefined,
                      exitCode: commandError === null ? 0 : 1,
                    });
                  }
                }, 1000);
              }, 2000);
            }
          })
          .stderr.on('data', (data: Buffer) => {
            output += data.toString();
          });
      });
    });
  }

  /**
   * 检测是否已经显示命令提示符
   */
  private isPromptReady(text: string): boolean {
    // 检测华为USG设备的提示符模式
    // <USG6000> 用户模式
    // [USG6000] 系统视图
    // [USG6000-zone] 等其他视图
    const patterns = [
      /<[^>]+>\s*$/, // <hostname>
      /\[[^\]]+\]\s*$/, // [hostname] or [hostname-xxx]
      /[>#$]\s*$/, // 通用提示符
    ];

    return (
      patterns.some((pattern) => pattern.test(text)) || text.includes('User Access Verification')
    );
  }

  /**
   * 清理命令输出，移除提示符和命令回显
   */
  private cleanOutput(output: string): string {
    let cleaned = output;

    // 移除ANSI转义序列
    // eslint-disable-next-line no-control-regex
    cleaned = cleaned.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

    // 移除回车符
    cleaned = cleaned.replace(/\r/g, '');

    // 按行分割
    const lines = cleaned.split('\n');
    const resultLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // 跳过空行、提示符行、命令回显行、quit命令
      if (
        line === '' ||
        /^[<[].*[>\]]#?\s*$/.test(line) ||
        line.startsWith('display current-configuration') ||
        line === 'quit' ||
        line.includes('return') ||
        /^[>#$]/.test(line)
      ) {
        continue;
      }

      resultLines.push(line);
    }

    return resultLines.join('\n').trim();
  }

  /**
   * 执行多条命令（串行）
   */
  async executeCommands(
    deviceId: string,
    commands: string[],
    timeout: number = 30000 // Server环境恢复到30秒超时
  ): Promise<SSHCommandResult[]> {
    const results: SSHCommandResult[] = [];

    for (const command of commands) {
      const result = await this.executeCommand(deviceId, command, timeout);
      results.push(result);

      // 如果某条命令失败，停止执行后续命令
      if (!result.success) {
        break;
      }
    }

    return results;
  }

  /**
   * 在同一个shell会话中执行批量命令（适用于配置同步等场景）
   */
  async executeBatchCommands(
    deviceId: string,
    commands: string[],
    timeout: number = 90000 // 批量命令需要更长超时（90秒）
  ): Promise<SSHCommandResult> {
    const client = this.connections.get(deviceId);

    if (!client) {
      return {
        success: false,
        output: '',
        error: '设备未连接',
      };
    }

    return new Promise((resolve) => {
      let output = '';
      let commandExecuted = false;
      let currentCommandIndex = 0;
      let waitForPrompt = true;
      let lastDataTime = Date.now();

      const timer = setTimeout(() => {
        if (!commandExecuted) {
          commandExecuted = true;
          resolve({
            success: false,
            output,
            error: `批量命令执行超时，已执行 ${currentCommandIndex}/${commands.length} 条命令`,
          });
        }
      }, timeout);

      // 每5秒检查一次是否有数据更新
      const dataCheckInterval = setInterval(() => {
        const now = Date.now();
        if (now - lastDataTime > 30000 && !commandExecuted) {
          // 30秒内没有收到数据，可能设备无响应
          clearTimeout(timer);
          clearInterval(dataCheckInterval);
          commandExecuted = true;
          resolve({
            success: false,
            output,
            error: `设备无响应，已执行 ${currentCommandIndex}/${commands.length} 条命令`,
          });
        }
      }, 5000);

      client.shell((err, stream) => {
        if (err) {
          clearTimeout(timer);
          clearInterval(dataCheckInterval);
          commandExecuted = true;
          resolve({
            success: false,
            output: '',
            error: `创建shell失败: ${err.message}`,
          });
          return;
        }

        stream
          .on('close', () => {
            if (!commandExecuted) {
              clearTimeout(timer);
              clearInterval(dataCheckInterval);
              commandExecuted = true;
              const commandError = getDeviceCommandError(output);
              resolve({
                success: currentCommandIndex === commands.length && commandError === null,
                output: this.cleanOutput(output),
                error: commandError || undefined,
                exitCode: commandError === null ? 0 : 1,
              });
            }
          })
          .on('error', (err: Error) => {
            if (!commandExecuted) {
              clearTimeout(timer);
              clearInterval(dataCheckInterval);
              commandExecuted = true;
              resolve({
                success: false,
                output: output,
                error: `Stream错误: ${err.message}`,
              });
            }
          })
          .on('data', (data: Buffer) => {
            const text = data.toString();
            output += text;
            lastDataTime = Date.now();

            // 首次等待提示符出现
            if (waitForPrompt && this.isPromptReady(text)) {
              waitForPrompt = false;
              output = ''; // 清空欢迎信息

              // 开始发送第一条命令
              if (currentCommandIndex < commands.length) {
                stream.write(commands[currentCommandIndex] + '\n');
                currentCommandIndex++;
              }
            }
            // 后续命令：检测到提示符就发送下一条
            else if (!waitForPrompt && this.isPromptReady(text)) {
              if (currentCommandIndex < commands.length) {
                // 短暂延迟，确保设备准备好接收下一条命令
                setTimeout(() => {
                  if (!commandExecuted && currentCommandIndex < commands.length) {
                    stream.write(commands[currentCommandIndex] + '\n');
                    currentCommandIndex++;
                  }
                }, 200); // 增加到200ms延迟
              } else {
                // 所有命令执行完毕，等待一下再退出
                setTimeout(() => {
                  if (!commandExecuted) {
                    clearTimeout(timer);
                    clearInterval(dataCheckInterval);
                    commandExecuted = true;
                    stream.end();
                    const commandError = getDeviceCommandError(output);
                    resolve({
                      success: commandError === null,
                      output: this.cleanOutput(output),
                      error: commandError || undefined,
                      exitCode: commandError === null ? 0 : 1,
                    });
                  }
                }, 2000); // 增加到2秒等待
              }
            }
          })
          .stderr.on('data', (data: Buffer) => {
            output += data.toString();
            lastDataTime = Date.now();
          });
      });
    });
  }

  /**
   * 检查连接状态
   */
  isConnected(deviceId: string): boolean {
    return this.connectionStatus.get(deviceId) || false;
  }

  /**
   * 获取所有活动连接
   */
  getActiveConnections(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * 断开所有连接
   */
  async disconnectAll(): Promise<void> {
    const deviceIds = Array.from(this.connections.keys());
    await Promise.all(deviceIds.map((id) => this.disconnect(id)));
  }

  /**
   * 构建SSH连接配置
   */
  private buildConnectConfig(config: SSHConfig): ConnectConfig {
    const connectConfig: ConnectConfig = {
      host: config.host,
      port: config.port,
      username: config.username,
      readyTimeout: config.timeout || 15000, // Server环境增加到15秒
      keepaliveInterval: 10000, // 每10秒发送keepalive保持连接
      keepaliveCountMax: 3, // 最多3次keepalive失败后断开
      // 添加更广泛的算法支持以兼容不同版本的SSH服务器
      algorithms: {
        kex: [
          'curve25519-sha256',
          'curve25519-sha256@libssh.org',
          'ecdh-sha2-nistp256',
          'ecdh-sha2-nistp384',
          'ecdh-sha2-nistp521',
          'diffie-hellman-group-exchange-sha256',
          'diffie-hellman-group14-sha256',
          'diffie-hellman-group14-sha1',
          'diffie-hellman-group1-sha1',
        ],
        cipher: [
          'aes128-ctr',
          'aes192-ctr',
          'aes256-ctr',
          'aes128-gcm',
          'aes128-gcm@openssh.com',
          'aes256-gcm',
          'aes256-gcm@openssh.com',
          'aes256-cbc',
          'aes192-cbc',
          'aes128-cbc',
          '3des-cbc',
        ],
        serverHostKey: [
          'ssh-ed25519',
          'ecdsa-sha2-nistp256',
          'ecdsa-sha2-nistp384',
          'ecdsa-sha2-nistp521',
          'rsa-sha2-512',
          'rsa-sha2-256',
          'ssh-rsa',
          'ssh-dss',
        ],
        hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1'],
      },
    };

    if (config.password) {
      connectConfig.password = config.password;
    }

    if (config.privateKey) {
      connectConfig.privateKey = config.privateKey;
      if (config.passphrase) {
        connectConfig.passphrase = config.passphrase;
      }
    }

    return connectConfig;
  }
}

// 导出单例
export const sshManager = new SSHManager();
