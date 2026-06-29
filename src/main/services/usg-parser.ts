/**
 * 华为USG防火墙命令解析器
 * 负责解析NAT Server规则和相关配置
 */

export interface ParsedNatRule {
  ruleName: string;
  protocol: 'TCP' | 'UDP' | 'ALL';
  globalIp: string;
  globalPort: string;
  insideIp: string;
  insidePort: string;
  enabled: boolean;
  description?: string;
  noReverse?: boolean; // 不生成反向Server-Map表项
}

export interface ParsedSystemInfo {
  hostname?: string;
  version?: string;
  uptime?: string;
  serialNumber?: string;
}

/**
 * 华为USG命令解析器
 */
export class USGParser {
  /**
   * 解析NAT Server规则列表
   * 示例输出格式：
   * nat server <name> protocol tcp global 1.2.3.4 8080 inside 192.168.1.100 80 [no-reverse] [unr-route]
   */
  parseNatServerList(output: string): ParsedNatRule[] {
    const rules: ParsedNatRule[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      const trimmedLine = line.trim();

      // 跳过空行和注释
      if (!trimmedLine || trimmedLine.startsWith('#') || trimmedLine.startsWith('!')) {
        continue;
      }

      // 解析NAT Server规则
      const rule = this.parseNatServerLine(trimmedLine);
      if (rule) {
        rules.push(rule);
      }
    }

    return rules;
  }

  /**
   * 解析单条NAT Server规则
   * 格式: nat server <name> protocol <tcp|udp|all> global <ip> <port> inside <ip> <port> [no-reverse]
   * 或: nat server protocol <tcp|udp|all> global <ip> <port> inside <ip> <port> [no-reverse]
   */
  private parseNatServerLine(line: string): ParsedNatRule | null {
    // 匹配带名称的规则（支持no-reverse参数）
    const namedPattern =
      /nat\s+server\s+(?:name\s+)?(\S+)\s+protocol\s+(tcp|udp|all)\s+global\s+(\S+)\s+(\d+)\s+inside\s+(\S+)\s+(\d+)(.*)$/i;
    const namedMatch = line.match(namedPattern);

    if (namedMatch) {
      const additionalParams = namedMatch[7] || '';
      return {
        ruleName: namedMatch[1],
        protocol: namedMatch[2].toUpperCase() as 'TCP' | 'UDP' | 'ALL',
        globalIp: namedMatch[3],
        globalPort: namedMatch[4],
        insideIp: namedMatch[5],
        insidePort: namedMatch[6],
        enabled: !line.includes('undo'),
        noReverse: /no-reverse/i.test(additionalParams),
      };
    }

    // 匹配不带名称的规则
    const pattern =
      /nat\s+server\s+protocol\s+(tcp|udp|all)\s+global\s+(\S+)\s+(\d+)\s+inside\s+(\S+)\s+(\d+)(.*)$/i;
    const match = line.match(pattern);

    if (match) {
      const additionalParams = match[6] || '';
      return {
        ruleName: `NAT_${match[2]}_${match[3]}`,
        protocol: match[1].toUpperCase() as 'TCP' | 'UDP' | 'ALL',
        globalIp: match[2],
        globalPort: match[3],
        insideIp: match[4],
        insidePort: match[5],
        enabled: !line.includes('undo'),
        noReverse: /no-reverse/i.test(additionalParams),
      };
    }

    return null;
  }

  /**
   * 解析系统信息
   */
  parseSystemInfo(output: string): ParsedSystemInfo {
    const info: ParsedSystemInfo = {};

    // 解析主机名
    const hostnameMatch = output.match(/sysname\s+(\S+)/i);
    if (hostnameMatch) {
      info.hostname = hostnameMatch[1];
    }

    // 解析版本信息
    const versionMatch = output.match(/Version\s+([^\n]+)/i);
    if (versionMatch) {
      info.version = versionMatch[1].trim();
    }

    // 解析运行时间
    const uptimeMatch = output.match(/uptime\s+is\s+([^\n]+)/i);
    if (uptimeMatch) {
      info.uptime = uptimeMatch[1].trim();
    }

    // 解析序列号
    const serialMatch = output.match(/ESN\s+:\s+(\S+)/i);
    if (serialMatch) {
      info.serialNumber = serialMatch[1];
    }

    return info;
  }

  /**
   * 生成NAT Server配置命令
   */
  generateNatServerCommand(rule: ParsedNatRule): string {
    const protocol = rule.protocol.toLowerCase();
    let command = '';

    if (rule.ruleName && !rule.ruleName.startsWith('NAT_')) {
      command = `nat server name ${rule.ruleName} protocol ${protocol} global ${rule.globalIp} ${rule.globalPort} inside ${rule.insideIp} ${rule.insidePort}`;
    } else {
      command = `nat server protocol ${protocol} global ${rule.globalIp} ${rule.globalPort} inside ${rule.insideIp} ${rule.insidePort}`;
    }

    // 添加可选参数
    if (rule.noReverse) {
      command += ' no-reverse';
    }

    return command;
  }

  /**
   * 生成删除NAT Server命令
   * 华为USG官方删除格式：
   * - 按名称删除：undo nat server name <规则名>
   * - 按ID删除：undo nat server ID <数字>
   */
  generateDeleteNatServerCommand(rule: ParsedNatRule): string {
    // 华为USG官方删除命令格式
    let cmd: string;
    if (rule.ruleName && !rule.ruleName.startsWith('NAT_')) {
      // 带名称的规则：使用官方格式 "undo nat server name <规则名>"
      cmd = `undo nat server name ${rule.ruleName}`;
    } else {
      // 不带名称的规则：使用完整参数格式（兼容旧版本）
      const protocol = rule.protocol.toLowerCase();
      cmd = `undo nat server protocol ${protocol} global ${rule.globalIp} ${rule.globalPort} inside ${rule.insideIp} ${rule.insidePort}`;
    }

    return cmd;
  }

  /**
   * 生成批量更新IP的命令序列
   */
  generateBatchUpdateIPCommands(rules: ParsedNatRule[], newGlobalIp: string): string[] {
    const commands: string[] = [];

    // 进入系统视图
    commands.push('system-view');

    for (const rule of rules) {
      // 删除旧规则
      commands.push(this.generateDeleteNatServerCommand(rule));

      // 添加新规则（使用新IP）
      const updatedRule = { ...rule, globalIp: newGlobalIp };
      commands.push(this.generateNatServerCommand(updatedRule));
    }

    // 保存配置
    commands.push('quit');
    commands.push('save');
    commands.push('y'); // 确认保存

    return commands;
  }

  /**
   * 生成增量同步命令序列
   * 只同步有变化的规则（新增、修改、删除）
   */
  generateSyncToDeviceCommands(
    deviceRules: ParsedNatRule[],
    localRules: ParsedNatRule[]
  ): string[] {
    const commands: string[] = [];

    // 进入系统视图（NAT Server直接在system-view下配置）
    commands.push('system-view');

    // 创建规则映射表（使用规则名称作为键）
    const deviceRuleMap = new Map<string, ParsedNatRule>();
    deviceRules.forEach((rule) => deviceRuleMap.set(rule.ruleName, rule));

    const localRuleMap = new Map<string, ParsedNatRule>();
    localRules.forEach((rule) => localRuleMap.set(rule.ruleName, rule));

    // 1. 删除设备上存在但本地不存在的规则
    for (const [ruleName, deviceRule] of deviceRuleMap) {
      if (!localRuleMap.has(ruleName)) {
        commands.push(this.generateDeleteNatServerCommand(deviceRule));
      }
    }

    // 2. 处理本地规则
    for (const [ruleName, localRule] of localRuleMap) {
      const deviceRule = deviceRuleMap.get(ruleName);

      if (!deviceRule) {
        // 新增规则：设备上不存在
        if (localRule.enabled) {
          commands.push(this.generateNatServerCommand(localRule));
        }
      } else {
        // 检查规则是否有变化
        const hasChanged =
          deviceRule.protocol !== localRule.protocol ||
          deviceRule.globalIp !== localRule.globalIp ||
          deviceRule.globalPort !== localRule.globalPort ||
          deviceRule.insideIp !== localRule.insideIp ||
          deviceRule.insidePort !== localRule.insidePort ||
          deviceRule.enabled !== localRule.enabled ||
          deviceRule.noReverse !== localRule.noReverse;

        if (hasChanged) {
          // 先删除旧规则
          commands.push(this.generateDeleteNatServerCommand(deviceRule));
          // 如果本地规则是启用的，添加新规则
          if (localRule.enabled) {
            commands.push(this.generateNatServerCommand(localRule));
          }
        }
      }
    }

    // 如果没有任何变化，不需要保存
    if (commands.length === 1) {
      // 只有system-view
      return [];
    }

    // 保存配置
    commands.push('save');
    commands.push('y'); // 确认保存

    return commands;
  }

  /**
   * 生成添加单条规则的命令序列
   */
  generateAddRuleCommands(rule: ParsedNatRule): string[] {
    const commands: string[] = [];
    commands.push('system-view');
    commands.push(this.generateNatServerCommand(rule));
    commands.push('quit');
    commands.push('save');
    commands.push('y');
    return commands;
  }

  /**
   * 生成删除单条规则的命令序列
   */
  generateDeleteRuleCommands(rule: ParsedNatRule): string[] {
    const commands: string[] = [];
    commands.push('system-view');
    commands.push(this.generateDeleteNatServerCommand(rule));
    commands.push('quit');
    commands.push('save');
    commands.push('y');
    return commands;
  }

  /**
   * 解析接口IP地址
   */
  parseInterfaceIP(output: string): string | null {
    // 匹配 IP address 行
    const ipMatch = output.match(/IP\s+[Aa]ddress\s*:\s*(\d+\.\d+\.\d+\.\d+)/);
    if (ipMatch) {
      return ipMatch[1];
    }

    // 匹配 ip address 配置行
    const configMatch = output.match(/ip\s+address\s+(\d+\.\d+\.\d+\.\d+)/i);
    if (configMatch) {
      return configMatch[1];
    }

    return null;
  }

  /**
   * 验证IP地址格式
   */
  isValidIP(ip: string): boolean {
    const ipPattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = ip.match(ipPattern);

    if (!match) {
      return false;
    }

    // 检查每个数字是否在0-255范围内
    for (let i = 1; i <= 4; i++) {
      const num = parseInt(match[i], 10);
      if (num < 0 || num > 255) {
        return false;
      }
    }

    return true;
  }

  /**
   * 清理命令输出（移除提示符和控制字符）
   */
  cleanOutput(output: string): string {
    return output
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\[.*?\]/g, '') // 移除ANSI控制字符
      .replace(/<.*?>/g, '') // 移除设备提示符
      .replace(/^[\s\n]+|[\s\n]+$/g, '') // 移除首尾空白
      .trim();
  }
}

// 导出单例
export const usgParser = new USGParser();
