import { Client, ConnectConfig } from 'ssh2';
import { EventEmitter } from 'events';
import { Buffer } from 'buffer';
import { logger } from './logger';
import {
  getBatchShellOpenRecoveryAction,
  getBatchShellStartupAction,
  getDeviceCommandError,
  getShellCommandFinishAction,
  formatBatchCommandError,
  hasBatchCommandResponse,
  isBenignSshDisconnectError,
  isCliPromptReady,
} from './ssh-manager-helpers';

const BATCH_PROMPT_NUDGE_DELAY_MS = 300;
const BATCH_COMMAND_START_FALLBACK_MS = 1200;
const BATCH_SHELL_OPEN_RECOVERY_MS = 3000;

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

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
  private connectionConfigs: Map<string, SSHConfig> = new Map();
  private disconnectingDevices: Set<string> = new Set();

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
      }, config.timeout || 15000);

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
      }, config.timeout || 15000);

      client
        .on('ready', () => {
          connected = true;
          clearTimeout(timeout);
          this.connections.set(deviceId, client);
          this.connectionConfigs.set(deviceId, { ...config });
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
          if (!this.shouldSuppressSshError(deviceId, err)) {
            this.emit('error', deviceId, err);
          }
        })
        .on('close', () => {
          const isCurrentConnection = this.connections.get(deviceId) === client;
          if (isCurrentConnection) {
            this.connections.delete(deviceId);
            this.connectionStatus.set(deviceId, false);
          } else if (!this.connections.has(deviceId)) {
            this.connectionStatus.set(deviceId, false);
          }
          this.disconnectingDevices.delete(deviceId);
          if (isCurrentConnection || !this.connections.has(deviceId)) {
            this.emit('disconnected', deviceId);
          }
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
      this.disconnectingDevices.add(deviceId);
      client.end();
      this.connections.delete(deviceId);
      this.connectionConfigs.delete(deviceId);
      this.connectionStatus.set(deviceId, false);
    }
  }

  private shouldSuppressSshError(deviceId: string, err: Error): boolean {
    return this.disconnectingDevices.has(deviceId) && isBenignSshDisconnectError(err);
  }

  /**
   * 执行SSH命令（使用shell交互模式，适用于华为USG等设备）
   */
  async executeCommand(
    deviceId: string,
    command: string,
    timeout: number = 30000
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
      let activeStream: { end: () => void } | null = null;
      let pendingResult: SSHCommandResult | null = null;
      let waitingForStreamClose = false;
      let streamCloseFallbackTimer: ReturnType<typeof setTimeout> | null = null;

      const finish = (result: SSHCommandResult) => {
        clearTimeout(timer);
        const action = getShellCommandFinishAction({
          resolved: commandExecuted,
          waitingForStreamClose,
          hasActiveStream: Boolean(activeStream),
        });

        if (action === 'ignore') {
          return;
        }

        if (action === 'wait-for-stream-close') {
          pendingResult = result;
          waitingForStreamClose = true;
          streamCloseFallbackTimer = setTimeout(() => {
            resolvePendingResult(result);
          }, 1500);
          activeStream?.end();
          return;
        }

        commandExecuted = true;
        resolve(result);
      };

      const resolvePendingResult = (fallback: SSHCommandResult) => {
        if (commandExecuted) {
          return;
        }

        clearTimeout(timer);
        if (streamCloseFallbackTimer) {
          clearTimeout(streamCloseFallbackTimer);
          streamCloseFallbackTimer = null;
        }
        commandExecuted = true;
        activeStream = null;
        waitingForStreamClose = false;
        resolve(pendingResult || fallback);
      };

      const timer = setTimeout(() => {
        finish({
          success: false,
          output,
          error: '命令执行超时',
        });
      }, timeout);

      // 使用shell模式而不是exec模式，适用于需要交互式登录的设备
      client.shell((err, stream) => {
        if (commandExecuted) {
          stream?.end();
          return;
        }

        if (err) {
          finish({
            success: false,
            output: '',
            error: err.message,
          });
          return;
        }

        activeStream = stream;
        let waitForPrompt = true;
        let commandSent = false;

        stream
          .on('close', () => {
            const commandError = getDeviceCommandError(output);
            resolvePendingResult({
              success: commandError === null,
              output: this.cleanOutput(output),
              error: commandError || undefined,
              exitCode: commandError === null ? 0 : 1,
            });
          })
          .on('error', (err: Error) => {
            if (!commandExecuted) {
              finish({
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
              output = '';
              stream.write(command + '\n');
              commandSent = true;
              return;
            }

            if (commandSent && this.isPromptReady(output)) {
              const commandError = getDeviceCommandError(output);
              finish({
                success: commandError === null,
                output: this.cleanOutput(output),
                error: commandError || undefined,
                exitCode: commandError === null ? 0 : 1,
              });
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
    return isCliPromptReady(text);
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
    timeout: number = 30000
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
    timeout: number = 90000
  ): Promise<SSHCommandResult> {
    const client = this.connections.get(deviceId);
    let activeClient = client;
    const reconnectConfig = this.connectionConfigs.get(deviceId);

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
      let startupCheckInterval: ReturnType<typeof setInterval> | null = null;
      let shellOpenCheckInterval: ReturnType<typeof setInterval> | null = null;
      let activeCommand: string | null = null;
      let activeCommandOutput = '';
      let nextCommandTimer: ReturnType<typeof setTimeout> | null = null;
      let completionTimer: ReturnType<typeof setTimeout> | null = null;
      let shellOpened = false;
      let attemptedShellRecovery = false;
      let shellRecoveryInProgress = false;
      let shellOpenStartedAt = Date.now();
      let shellOpenAttempt = 0;
      let activeCommandNumber = 0;

      const timer = setTimeout(() => {
        if (!commandExecuted) {
          clearBatchTimers();
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
          clearBatchTimers();
          commandExecuted = true;
          resolve({
            success: false,
            output,
            error: `设备无响应，已执行 ${currentCommandIndex}/${commands.length} 条命令`,
          });
        }
      }, 5000);

      const clearBatchTimers = () => {
        clearTimeout(timer);
        clearInterval(dataCheckInterval);
        if (startupCheckInterval) {
          clearInterval(startupCheckInterval);
          startupCheckInterval = null;
        }
        if (shellOpenCheckInterval) {
          clearInterval(shellOpenCheckInterval);
          shellOpenCheckInterval = null;
        }
        if (nextCommandTimer) {
          clearTimeout(nextCommandTimer);
          nextCommandTimer = null;
        }
        if (completionTimer) {
          clearTimeout(completionTimer);
          completionTimer = null;
        }
      };

      const openBatchShell = () => {
        shellOpenAttempt++;
        const attempt = shellOpenAttempt;

        activeClient?.shell((err, stream) => {
          if (attempt !== shellOpenAttempt || commandExecuted) {
            stream?.end();
            return;
          }

          shellOpened = true;
          if (shellOpenCheckInterval) {
            clearInterval(shellOpenCheckInterval);
            shellOpenCheckInterval = null;
          }

          if (err) {
            clearBatchTimers();
            commandExecuted = true;
            resolve({
              success: false,
              output: '',
              error: `创建shell失败: ${err.message}`,
            });
            return;
          }

          const sendNextCommand = (): boolean => {
            if (currentCommandIndex >= commands.length) {
              return false;
            }

            activeCommand = commands[currentCommandIndex];
            activeCommandNumber = currentCommandIndex + 1;
            activeCommandOutput = '';
            stream.write(activeCommand + '\n');
            currentCommandIndex++;
            return true;
          };
          const shellPromptWaitStartedAt = Date.now();
          let promptNudged = false;

          startupCheckInterval = setInterval(() => {
            if (commandExecuted || !waitForPrompt) {
              if (startupCheckInterval) {
                clearInterval(startupCheckInterval);
                startupCheckInterval = null;
              }
              return;
            }

            const action = getBatchShellStartupAction({
              waitForPrompt,
              currentCommandIndex,
              commandCount: commands.length,
              elapsedMs: Date.now() - shellPromptWaitStartedAt,
              promptNudged,
              nudgeAfterMs: BATCH_PROMPT_NUDGE_DELAY_MS,
              startAfterMs: BATCH_COMMAND_START_FALLBACK_MS,
            });

            if (action === 'nudge-prompt') {
              stream.write('\n');
              promptNudged = true;
              return;
            }

            if (action === 'start-command') {
              waitForPrompt = false;
              output = '';
              sendNextCommand();
              if (startupCheckInterval) {
                clearInterval(startupCheckInterval);
                startupCheckInterval = null;
              }
            }
          }, 100);

          stream
            .on('close', () => {
              if (!commandExecuted) {
                clearBatchTimers();
                commandExecuted = true;
                const commandError = getDeviceCommandError(output);
                resolve({
                  success: currentCommandIndex === commands.length && commandError === null,
                  output: this.cleanOutput(output),
                  error: commandError
                    ? formatBatchCommandError({
                        error: commandError,
                        commandNumber: activeCommandNumber,
                        commandCount: commands.length,
                        command: activeCommand,
                      })
                    : undefined,
                  exitCode: commandError === null ? 0 : 1,
                });
              }
            })
            .on('error', (err: Error) => {
              if (!commandExecuted) {
                clearBatchTimers();
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
              if (activeCommand) {
                activeCommandOutput += text;
              }
              lastDataTime = Date.now();

              // 首次等待提示符出现
              if (waitForPrompt && this.isPromptReady(text)) {
                waitForPrompt = false;
                output = '';

                // 开始发送第一条命令
                if (currentCommandIndex < commands.length) {
                  sendNextCommand();
                }
              }
              // 后续命令：检测到提示符就发送下一条
              else if (!waitForPrompt && this.isPromptReady(text)) {
                if (activeCommand && !hasBatchCommandResponse(activeCommandOutput, activeCommand)) {
                  return;
                }

                const activeCommandError = getDeviceCommandError(activeCommandOutput);
                if (activeCommandError) {
                  clearBatchTimers();
                  commandExecuted = true;
                  resolve({
                    success: false,
                    output: this.cleanOutput(output),
                    error: formatBatchCommandError({
                      error: activeCommandError,
                      commandNumber: activeCommandNumber,
                      commandCount: commands.length,
                      command: activeCommand,
                    }),
                    exitCode: 1,
                  });
                  return;
                }

                activeCommand = null;
                activeCommandOutput = '';
                activeCommandNumber = 0;

                if (currentCommandIndex < commands.length) {
                  if (nextCommandTimer) {
                    return;
                  }

                  // 短暂延迟，确保设备准备好接收下一条命令
                  nextCommandTimer = setTimeout(() => {
                    nextCommandTimer = null;
                    if (!commandExecuted && currentCommandIndex < commands.length) {
                      sendNextCommand();
                    }
                  }, 200);
                } else {
                  if (completionTimer) {
                    return;
                  }

                  // 所有命令执行完毕，等待一下再退出
                  completionTimer = setTimeout(() => {
                    completionTimer = null;
                    if (!commandExecuted) {
                      clearBatchTimers();
                      commandExecuted = true;
                      stream.end();
                      const commandError = getDeviceCommandError(output);
                      resolve({
                        success: commandError === null,
                        output: this.cleanOutput(output),
                        error: commandError
                          ? formatBatchCommandError({
                              error: commandError,
                              commandNumber: activeCommandNumber,
                              commandCount: commands.length,
                              command: activeCommand,
                            })
                          : undefined,
                        exitCode: commandError === null ? 0 : 1,
                      });
                    }
                  }, 2000);
                }
              }
            })
            .stderr.on('data', (data: Buffer) => {
              output += data.toString();
              lastDataTime = Date.now();
            });
        });
      };

      shellOpenCheckInterval = setInterval(() => {
        if (shellRecoveryInProgress) {
          return;
        }

        const action = getBatchShellOpenRecoveryAction({
          shellOpened,
          commandExecuted,
          attemptedRecovery: attemptedShellRecovery,
          hasReconnectConfig: Boolean(reconnectConfig),
          elapsedMs: Date.now() - shellOpenStartedAt,
          recoverAfterMs: BATCH_SHELL_OPEN_RECOVERY_MS,
        });

        if (action === 'wait') {
          return;
        }

        if (action === 'fail') {
          clearBatchTimers();
          commandExecuted = true;
          resolve({
            success: false,
            output,
            error: `创建shell无响应，已执行 ${currentCommandIndex}/${commands.length} 条命令`,
          });
          return;
        }

        attemptedShellRecovery = true;
        shellRecoveryInProgress = true;
        shellOpened = false;
        shellOpenStartedAt = Date.now();
        shellOpenAttempt++;
        this.disconnect(deviceId)
          .then(() => {
            if (commandExecuted || !reconnectConfig) {
              return undefined;
            }

            return this.connect(deviceId, reconnectConfig);
          })
          .then((connectResult) => {
            shellRecoveryInProgress = false;

            if (commandExecuted || !connectResult) {
              return;
            }

            if (!connectResult.success) {
              clearBatchTimers();
              commandExecuted = true;
              resolve({
                success: false,
                output,
                error: `重新连接失败: ${connectResult.message}`,
              });
              return;
            }

            activeClient = this.connections.get(deviceId);
            if (!activeClient) {
              clearBatchTimers();
              commandExecuted = true;
              resolve({
                success: false,
                output,
                error: '重新连接后设备未连接',
              });
              return;
            }

            shellOpenStartedAt = Date.now();
            openBatchShell();
          })
          .catch((error: unknown) => {
            shellRecoveryInProgress = false;

            if (commandExecuted) {
              return;
            }

            clearBatchTimers();
            commandExecuted = true;
            resolve({
              success: false,
              output,
              error: `重新连接异常: ${getErrorMessage(error)}`,
            });
          });
      }, 250);

      openBatchShell();
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
      readyTimeout: config.timeout || 15000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
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
