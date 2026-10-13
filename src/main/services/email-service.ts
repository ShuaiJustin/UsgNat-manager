import { app } from 'electron';
import nodemailer from 'nodemailer';
import {
  createBaseTransportConfig,
  createTestTransportConfig,
  getEmailErrorInfo,
  getSMTPConfigValidationError,
  normalizeNotifyTypes,
} from './email-service-helpers';
import { logger } from './logger';

/**
 * HTML 转义函数，防止 XSS 攻击
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * SMTP配置
 */
export interface SMTPConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean; // true for 465, false for other ports
  requireTLS?: boolean;
  ignoreTLS?: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: {
    name: string;
    address: string;
  };
  to: string[]; // 收件人列表
  notifyTypes?: string[]; // 通知类型: 'ipChange', 'updateSuccess', 'updateFailed', 'deviceOffline', 'dailyReport'
}

/**
 * 邮件选项
 */
export interface EmailOptions {
  subject: string;
  text?: string;
  html?: string;
}

/**
 * 邮件服务
 * 负责发送各种通知邮件
 */
class EmailService {
  private config: SMTPConfig | null = null;
  private transporter: nodemailer.Transporter | null = null;

  /**
   * 配置SMTP
   */
  configure(config: SMTPConfig) {
    this.transporter?.close();
    this.config = {
      ...config,
      notifyTypes: normalizeNotifyTypes(config.notifyTypes),
    };

    if (this.config.enabled) {
      this.transporter = nodemailer.createTransport(createBaseTransportConfig(this.config));
    } else {
      this.transporter = null;
    }
  }

  clearConfiguration(): void {
    this.transporter?.close();
    this.transporter = null;
    this.config = null;
  }

  /**
   * 检查是否应该发送指定类型的通知
   */
  private shouldNotify(notifyType: string): boolean {
    if (!this.config?.enabled) {
      return false;
    }

    // 如果未配置通知类型，默认全部发送
    if (!this.config.notifyTypes || this.config.notifyTypes.length === 0) {
      return true;
    }

    return this.config.notifyTypes.includes(notifyType);
  }

  /**
   * 发送邮件
   */
  async sendEmail(options: EmailOptions): Promise<boolean> {
    if (!this.config?.enabled || !this.transporter) {
      await logger.warning('邮件服务', '邮件服务未启用或未配置');
      return false;
    }

    try {
      const mailOptions = {
        from: `"${this.config.from.name}" <${this.config.from.address}>`,
        to: this.config.to.join(', '),
        subject: options.subject,
        text: options.text,
        html: options.html,
      };

      const info = await this.transporter.sendMail(mailOptions);
      await logger.success('邮件服务', `邮件发送成功: ${options.subject}`, {
        messageId: info.messageId,
      });
      return true;
    } catch (error: unknown) {
      const { message } = getEmailErrorInfo(error);
      await logger.error('邮件服务', '邮件发送失败', {
        error: message,
        subject: options.subject,
      });
      return false;
    }
  }

  /**
   * 发送测试邮件
   */
  async sendTestEmail(): Promise<boolean> {
    return await this.sendEmail({
      subject: '测试邮件 - USG NAT管理系统',
      html: `
        <h2>测试邮件</h2>
        <p>这是一封来自华为USG防火墙NAT管理软件的测试邮件。</p>
        <p>如果您收到这封邮件，说明邮件配置正确。</p>
        <hr>
        <p style="color: #666; font-size: 12px;">
          发送时间: ${new Date().toLocaleString('zh-CN')}<br>
          系统版本: ${app.getVersion()}
        </p>
      `,
    });
  }

  /**
   * 使用临时配置发送测试邮件（不保存配置）
   */
  async sendTestEmailWithConfig(config: SMTPConfig): Promise<boolean> {
    const validationError = getSMTPConfigValidationError(config);
    if (validationError) {
      await logger.warning('邮件服务', validationError);
      throw new Error(validationError);
    }

    let transporter: nodemailer.Transporter | null = null;
    try {
      await logger.info('邮件服务', '开始发送测试邮件', {
        host: config.host,
        port: config.port,
        secure: config.secure,
        from: config.from.address,
        to: config.to.join(', '),
      });

      // 创建临时的邮件传输器
      transporter = nodemailer.createTransport(createTestTransportConfig(config));

      // 验证连接
      await logger.info('邮件服务', '验证 SMTP 连接...');
      try {
        await transporter.verify();
        await logger.success('邮件服务', 'SMTP 连接验证成功');
      } catch (verifyError: unknown) {
        const { message } = getEmailErrorInfo(verifyError);
        await logger.error('邮件服务', 'SMTP 连接验证失败', {
          error: message,
        });
        throw new Error(`SMTP 连接失败: ${message}`);
      }

      // 构建邮件内容
      const mailOptions = {
        from: `"${config.from.name || 'USG NAT管理系统'}" <${config.from.address}>`,
        to: config.to.join(', '),
        subject: '✅ 测试邮件 - USG NAT管理系统',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #1890ff; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
              .content { background: #f5f5f5; padding: 20px; }
              .success { background: #52c41a; color: white; padding: 10px; border-radius: 5px; margin: 15px 0; }
              .footer { background: #fafafa; padding: 15px; border-top: 1px solid #e8e8e8; font-size: 12px; color: #999; }
              .info-box { background: white; padding: 15px; border-left: 4px solid #1890ff; margin: 15px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1 style="margin: 0;">🎉 测试邮件</h1>
              </div>
              <div class="content">
                <div class="success">
                  ✅ 恭喜！邮件配置测试成功
                </div>
                <p>这是一封来自 <strong>华为USG防火墙NAT管理软件</strong> 的测试邮件。</p>
                <p>如果您收到这封邮件，说明您的邮件配置完全正确！</p>
                
                <div class="info-box">
                  <h3 style="margin-top: 0;">配置信息</h3>
                  <ul style="margin: 0; padding-left: 20px;">
                    <li>SMTP 服务器: ${escapeHtml(config.host)}</li>
                    <li>端口: ${config.port} ${config.secure ? '(SSL/TLS)' : '(非加密)'}</li>
                    <li>发件人: ${escapeHtml(config.from.address)}</li>
                    <li>收件人: ${escapeHtml(config.to.join(', '))}</li>
                  </ul>
                </div>

                <div class="info-box">
                  <h3 style="margin-top: 0;">下一步</h3>
                  <ol style="margin: 0; padding-left: 20px;">
                    <li>返回应用程序</li>
                    <li>点击"保存设置"按钮</li>
                    <li>开始使用邮件通知功能</li>
                  </ol>
                </div>
              </div>
              <div class="footer">
                <p style="margin: 0;">
                  发送时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}<br>
                  系统版本: ${app.getVersion()}<br>
                  <strong style="color: #ff4d4f;">⚠️ 注意：此邮件使用未保存的测试配置发送</strong>
                </p>
              </div>
            </div>
          </body>
          </html>
        `,
        text: `
测试邮件 - USG NAT管理系统

✅ 恭喜！邮件配置测试成功

这是一封来自华为USG防火墙NAT管理软件的测试邮件。
如果您收到这封邮件，说明您的邮件配置完全正确！

配置信息:
- SMTP 服务器: ${config.host}
- 端口: ${config.port} ${config.secure ? '(SSL/TLS)' : '(非加密)'}
- 发件人: ${config.from.address}
- 收件人: ${config.to.join(', ')}

发送时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
系统版本: ${app.getVersion()}
        `,
      };

      // 发送邮件
      await logger.info('邮件服务', '正在发送邮件...');
      const info = await transporter.sendMail(mailOptions);

      await logger.success('邮件服务', '测试邮件发送成功', {
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
      });

      return true;
    } catch (error: unknown) {
      const { message: errorMessage, code, command } = getEmailErrorInfo(error);
      const errorDetails = {
        error: errorMessage,
        code,
        command,
        host: config.host,
        port: config.port,
      };

      await logger.error('邮件服务', '测试邮件发送失败', errorDetails);

      // 提供更友好的错误信息
      let friendlyError = errorMessage;
      if (errorMessage.includes('EAUTH') || errorMessage.includes('authentication')) {
        friendlyError =
          '❌ 认证失败\n请检查用户名和密码是否正确\n⚠️ QQ/163邮箱必须使用授权码，不是登录密码！';
      } else if (errorMessage.includes('ECONNECTION') || errorMessage.includes('ETIMEDOUT')) {
        friendlyError =
          '❌ 连接超时\n请检查:\n1. SMTP 服务器地址是否正确\n2. 端口号是否正确\n3. 网络连接是否正常';
      } else if (errorMessage.includes('ENOTFOUND')) {
        friendlyError =
          '❌ SMTP 服务器不存在\n请检查服务器地址是否正确\n⚠️ 不要使用 smtp.example.com，要用真实的邮箱服务器\n✅ 例如: smtp.qq.com, smtp.163.com, smtp.gmail.com';
      } else if (
        errorMessage.includes('certificate') ||
        errorMessage.includes('TLS') ||
        errorMessage.includes('SSL')
      ) {
        friendlyError =
          '❌ SSL/TLS 连接失败\n请检查:\n1. 端口是否正确 (QQ邮箱用465)\n2. 服务器地址是否正确 (不要用smtp.example.com)\n3. 加密方式: 465端口用SSL，587端口用STARTTLS';
      } else if (errorMessage.includes('Greeting never received')) {
        friendlyError =
          '❌ 服务器无响应\n可能原因:\n1. 端口错误\n2. 防火墙阻止了连接\n3. SMTP服务器地址错误';
      } else if (
        errorMessage.includes('socket disconnected') ||
        errorMessage.includes('network socket')
      ) {
        friendlyError =
          '❌ 网络连接断开\n请检查:\n1. SMTP 服务器地址是否正确 (不要用smtp.example.com)\n2. 端口是否正确 (QQ邮箱用465)\n3. 网络是否正常\n✅ QQ邮箱配置: smtp.qq.com:465';
      }

      throw new Error(friendlyError);
    } finally {
      transporter?.close();
    }
  }

  /**
   * 发送IP变化通知
   */
  async notifyIPChange(oldIP: string, newIP: string): Promise<boolean> {
    // 检查是否应该发送此类型的通知
    if (!this.shouldNotify('ipChange')) {
      await logger.info('邮件服务', 'IP变化通知已被配置禁用，跳过发送');
      return false;
    }

    return await this.sendEmail({
      subject: '【重要】公网IP地址已变化',
      html: `
        <h2>公网IP地址变化通知</h2>
        <p>检测到您的公网IP地址发生了变化：</p>
        <table style="border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f5f5f5;">原IP地址:</td>
            <td style="padding: 10px; border: 1px solid #ddd;"><strong>${escapeHtml(oldIP)}</strong></td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f5f5f5;">新IP地址:</td>
            <td style="padding: 10px; border: 1px solid #ddd;"><strong style="color: #4CAF50;">${escapeHtml(newIP)}</strong></td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f5f5f5;">变化时间:</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${new Date().toLocaleString('zh-CN')}</td>
          </tr>
        </table>
        <p>系统将自动更新NAT规则（如已启用自动更新）。</p>
        <hr>
        <p style="color: #666; font-size: 12px;">
          此邮件由华为USG防火墙NAT管理软件自动发送，请勿回复。
        </p>
      `,
    });
  }

  /**
   * 发送更新成功通知
   */
  async notifyUpdateSuccess(
    deviceName: string,
    ruleCount: number,
    newIP: string
  ): Promise<boolean> {
    // 检查是否应该发送此类型的通知
    if (!this.shouldNotify('updateSuccess')) {
      await logger.info('邮件服务', '更新成功通知已被配置禁用，跳过发送');
      return false;
    }

    return await this.sendEmail({
      subject: `【成功】${escapeHtml(deviceName)} NAT规则更新完成`,
      html: `
        <h2>NAT规则更新成功</h2>
        <p>设备 <strong>${escapeHtml(deviceName)}</strong> 的NAT规则已成功更新。</p>
        <table style="border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f5f5f5;">设备名称:</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${escapeHtml(deviceName)}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f5f5f5;">更新规则数:</td>
            <td style="padding: 10px; border: 1px solid #ddd;"><strong>${ruleCount}</strong> 条</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f5f5f5;">新IP地址:</td>
            <td style="padding: 10px; border: 1px solid #ddd;"><strong>${escapeHtml(newIP)}</strong></td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f5f5f5;">更新时间:</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${new Date().toLocaleString('zh-CN')}</td>
          </tr>
        </table>
        <p style="color: #4CAF50;">✓ 所有规则已成功应用到设备</p>
        <hr>
        <p style="color: #666; font-size: 12px;">
          此邮件由华为USG防火墙NAT管理软件自动发送，请勿回复。
        </p>
      `,
    });
  }

  /**
   * 发送更新失败通知
   */
  async notifyUpdateFailed(deviceName: string, error: string): Promise<boolean> {
    // 检查是否应该发送此类型的通知
    if (!this.shouldNotify('updateFailed')) {
      await logger.info('邮件服务', '更新失败通知已被配置禁用，跳过发送');
      return false;
    }

    return await this.sendEmail({
      subject: `【失败】${escapeHtml(deviceName)} NAT规则更新失败`,
      html: `
        <h2 style="color: #f44336;">NAT规则更新失败</h2>
        <p>设备 <strong>${escapeHtml(deviceName)}</strong> 的NAT规则更新失败。</p>
        <table style="border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f5f5f5;">设备名称:</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${escapeHtml(deviceName)}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f5f5f5;">失败时间:</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${new Date().toLocaleString('zh-CN')}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f5f5f5;">错误信息:</td>
            <td style="padding: 10px; border: 1px solid #ddd; color: #f44336;">${escapeHtml(error)}</td>
          </tr>
        </table>
        <p style="color: #f44336;">✗ 请检查设备连接和配置，然后手动重试</p>
        <hr>
        <p style="color: #666; font-size: 12px;">
          此邮件由华为USG防火墙NAT管理软件自动发送，请勿回复。
        </p>
      `,
    });
  }

  /**
   * 发送设备离线通知
   */
  async notifyDeviceOffline(deviceName: string): Promise<boolean> {
    // 检查是否应该发送此类型的通知
    if (!this.shouldNotify('deviceOffline')) {
      await logger.info('邮件服务', '设备离线通知已被配置禁用，跳过发送');
      return false;
    }

    return await this.sendEmail({
      subject: `【警告】设备 ${escapeHtml(deviceName)} 连接失败`,
      html: `
        <h2 style="color: #FF9800;">设备连接失败</h2>
        <p>无法连接到设备 <strong>${escapeHtml(deviceName)}</strong>。</p>
        <table style="border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f5f5f5;">设备名称:</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${escapeHtml(deviceName)}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f5f5f5;">检测时间:</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${new Date().toLocaleString('zh-CN')}</td>
          </tr>
        </table>
        <p style="color: #FF9800;">⚠ 请检查设备网络连接和SSH服务状态</p>
        <hr>
        <p style="color: #666; font-size: 12px;">
          此邮件由华为USG防火墙NAT管理软件自动发送，请勿回复。
        </p>
      `,
    });
  }

  /**
   * 发送每日汇总报告
   */
  async sendDailyReport(data: {
    ipChanges: number;
    successfulUpdates: number;
    failedUpdates: number;
    deviceCount: number;
  }): Promise<boolean> {
    // 检查是否应该发送此类型的通知
    if (!this.shouldNotify('dailyReport')) {
      await logger.info('邮件服务', '每日汇总报告已被配置禁用，跳过发送');
      return false;
    }

    return await this.sendEmail({
      subject: `每日汇总报告 - ${new Date().toLocaleDateString('zh-CN')}`,
      html: `
        <h2>每日运行汇总报告</h2>
        <p>以下是今日系统运行情况汇总：</p>
        <table style="border-collapse: collapse; margin: 20px 0; width: 100%;">
          <tr>
            <td style="padding: 15px; border: 1px solid #ddd; background: #f5f5f5; width: 50%;">
              <div style="font-size: 24px; font-weight: bold; color: #2196F3;">${data.ipChanges}</div>
              <div style="color: #666;">IP变化次数</div>
            </td>
            <td style="padding: 15px; border: 1px solid #ddd; background: #f5f5f5; width: 50%;">
              <div style="font-size: 24px; font-weight: bold; color: #4CAF50;">${data.successfulUpdates}</div>
              <div style="color: #666;">成功更新</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 15px; border: 1px solid #ddd; background: #f5f5f5;">
              <div style="font-size: 24px; font-weight: bold; color: #f44336;">${data.failedUpdates}</div>
              <div style="color: #666;">失败更新</div>
            </td>
            <td style="padding: 15px; border: 1px solid #ddd; background: #f5f5f5;">
              <div style="font-size: 24px; font-weight: bold; color: #9C27B0;">${data.deviceCount}</div>
              <div style="color: #666;">管理设备数</div>
            </td>
          </tr>
        </table>
        <p>报告日期: ${new Date().toLocaleDateString('zh-CN')}</p>
        <hr>
        <p style="color: #666; font-size: 12px;">
          此邮件由华为USG防火墙NAT管理软件自动发送，请勿回复。
        </p>
      `,
    });
  }

  /**
   * 验证配置
   */
  async verifyConfig(config: SMTPConfig): Promise<boolean> {
    let transporter: nodemailer.Transporter | null = null;
    try {
      transporter = nodemailer.createTransport(createBaseTransportConfig(config));

      await transporter.verify();
      return true;
    } catch (error: unknown) {
      const { message } = getEmailErrorInfo(error);
      await logger.error('邮件服务', 'SMTP配置验证失败', { error: message });
      return false;
    } finally {
      transporter?.close();
    }
  }
}

// 导出单例
export const emailService = new EmailService();
