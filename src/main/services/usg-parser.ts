export interface ParsedNatRule {
  ruleName: string;
  protocol: 'TCP' | 'UDP' | 'ALL';
  globalIp: string;
  globalPort: string;
  insideIp: string;
  insidePort: string;
  enabled: boolean;
  description?: string;
  addSyntax?: 'direct-name' | 'name-keyword' | 'endpoint';
  noReverse?: boolean;
}

export interface ParsedSystemInfo {
  hostname?: string;
  version?: string;
  uptime?: string;
  serialNumber?: string;
}

const NAT_SERVICE_PORTS: Record<string, string> = {
  ftp: '21',
  ssh: '22',
  telnet: '23',
  smtp: '25',
  domain: '53',
  dns: '53',
  www: '80',
  http: '80',
  pop3: '110',
  imap: '143',
  https: '443',
  ldap: '389',
  ldaps: '636',
  rdp: '3389',
};

const normalizeNatPort = (value: string): string => NAT_SERVICE_PORTS[value.toLowerCase()] ?? value;

const hasDeviceRuleName = (rule: ParsedNatRule): boolean =>
  Boolean(rule.ruleName) && !rule.ruleName.startsWith('NAT_');

const hasSameNatEndpoint = (left: ParsedNatRule, right: ParsedNatRule): boolean =>
  left.protocol.toUpperCase() === right.protocol.toUpperCase() &&
  left.globalIp === right.globalIp &&
  left.globalPort === right.globalPort &&
  left.insideIp === right.insideIp &&
  left.insidePort === right.insidePort;

const findMatchingDeviceRule = (
  deviceRules: ParsedNatRule[],
  rule: ParsedNatRule
): ParsedNatRule | undefined =>
  deviceRules.find((candidate) => hasSameNatEndpoint(candidate, rule)) ||
  deviceRules.find((candidate) => candidate.ruleName === rule.ruleName);

export class USGParser {
  parseNatServerList(output: string): ParsedNatRule[] {
    const rules: ParsedNatRule[] = [];

    for (const line of output.split('\n')) {
      const trimmedLine = line.trim();

      if (!trimmedLine || trimmedLine.startsWith('#') || trimmedLine.startsWith('!')) {
        continue;
      }

      const rule = this.parseNatServerLine(trimmedLine);
      if (rule) {
        rules.push(rule);
      }
    }

    return rules;
  }

  private parseNatServerLine(line: string): ParsedNatRule | null {
    const namedPattern =
      /nat\s+server\s+(?:(name)\s+)?(\S+)\s+protocol\s+(tcp|udp|all)\s+global\s+(\S+)\s+(\S+)\s+inside\s+(\S+)\s+(\S+)(.*)$/i;
    const namedMatch = line.match(namedPattern);

    if (namedMatch) {
      const additionalParams = namedMatch[8] || '';
      return {
        ruleName: namedMatch[2],
        protocol: namedMatch[3].toUpperCase() as 'TCP' | 'UDP' | 'ALL',
        globalIp: namedMatch[4],
        globalPort: normalizeNatPort(namedMatch[5]),
        insideIp: namedMatch[6],
        insidePort: normalizeNatPort(namedMatch[7]),
        enabled: !line.includes('undo'),
        addSyntax: namedMatch[1] ? 'name-keyword' : 'direct-name',
        noReverse: /no-reverse/i.test(additionalParams),
      };
    }

    const endpointPattern =
      /nat\s+server\s+protocol\s+(tcp|udp|all)\s+global\s+(\S+)\s+(\S+)\s+inside\s+(\S+)\s+(\S+)(.*)$/i;
    const endpointMatch = line.match(endpointPattern);

    if (endpointMatch) {
      const additionalParams = endpointMatch[6] || '';
      return {
        ruleName: `NAT_${endpointMatch[2]}_${endpointMatch[3]}`,
        protocol: endpointMatch[1].toUpperCase() as 'TCP' | 'UDP' | 'ALL',
        globalIp: endpointMatch[2],
        globalPort: normalizeNatPort(endpointMatch[3]),
        insideIp: endpointMatch[4],
        insidePort: normalizeNatPort(endpointMatch[5]),
        enabled: !line.includes('undo'),
        addSyntax: 'endpoint',
        noReverse: /no-reverse/i.test(additionalParams),
      };
    }

    return null;
  }

  parseSystemInfo(output: string): ParsedSystemInfo {
    const info: ParsedSystemInfo = {};

    const hostnameMatch = output.match(/sysname\s+(\S+)/i);
    if (hostnameMatch) {
      info.hostname = hostnameMatch[1];
    }

    const versionMatch = output.match(/Version\s+([^\n]+)/i);
    if (versionMatch) {
      info.version = versionMatch[1].trim();
    }

    const uptimeMatch = output.match(/uptime\s+is\s+([^\n]+)/i);
    if (uptimeMatch) {
      info.uptime = uptimeMatch[1].trim();
    }

    const serialMatch = output.match(/ESN\s+:\s+(\S+)/i);
    if (serialMatch) {
      info.serialNumber = serialMatch[1];
    }

    return info;
  }

  generateNatServerCommand(rule: ParsedNatRule): string {
    const protocol = rule.protocol.toLowerCase();
    let command = '';

    if (rule.ruleName && !rule.ruleName.startsWith('NAT_')) {
      if (rule.addSyntax === 'name-keyword') {
        command = `nat server name ${rule.ruleName} protocol ${protocol} global ${rule.globalIp} ${rule.globalPort} inside ${rule.insideIp} ${rule.insidePort}`;
      } else {
        command = `nat server ${rule.ruleName} protocol ${protocol} global ${rule.globalIp} ${rule.globalPort} inside ${rule.insideIp} ${rule.insidePort}`;
      }
    } else if (rule.addSyntax === 'name-keyword' && rule.ruleName) {
      command = `nat server name ${rule.ruleName} protocol ${protocol} global ${rule.globalIp} ${rule.globalPort} inside ${rule.insideIp} ${rule.insidePort}`;
    } else {
      command = `nat server protocol ${protocol} global ${rule.globalIp} ${rule.globalPort} inside ${rule.insideIp} ${rule.insidePort}`;
    }

    if (rule.noReverse) {
      command += ' no-reverse';
    }

    return command;
  }

  generateDeleteNatServerCommand(rule: ParsedNatRule): string {
    if (hasDeviceRuleName(rule)) {
      return `undo nat server name ${rule.ruleName}`;
    }

    return this.generateDeleteNatServerByEndpointCommand(rule);
  }

  private generateDeleteNatServerByEndpointCommand(rule: ParsedNatRule): string {
    const protocol = rule.protocol.toLowerCase();
    return `undo nat server protocol ${protocol} global ${rule.globalIp} ${rule.globalPort} inside ${rule.insideIp} ${rule.insidePort}`;
  }

  generateBatchUpdateIPCommands(
    rules: ParsedNatRule[],
    newGlobalIp: string,
    deviceRules: ParsedNatRule[] = []
  ): string[] {
    const commands: string[] = ['system-view'];

    for (const rule of rules) {
      const deviceRule = findMatchingDeviceRule(deviceRules, rule);

      if (deviceRule) {
        commands.push(this.generateDeleteNatServerCommand(deviceRule));
      }

      commands.push(
        this.generateNatServerCommand({
          ...rule,
          globalIp: newGlobalIp,
          addSyntax: deviceRule?.addSyntax || rule.addSyntax,
        })
      );
    }

    commands.push('quit');
    commands.push('save');
    commands.push('y');

    return commands;
  }

  generateSyncToDeviceCommands(
    deviceRules: ParsedNatRule[],
    localRules: ParsedNatRule[]
  ): string[] {
    const commands: string[] = ['system-view'];
    const deviceRuleMap = new Map<string, ParsedNatRule>();
    const localRuleMap = new Map<string, ParsedNatRule>();

    deviceRules.forEach((rule) => deviceRuleMap.set(rule.ruleName, rule));
    localRules.forEach((rule) => localRuleMap.set(rule.ruleName, rule));

    for (const [ruleName, deviceRule] of deviceRuleMap) {
      if (!localRuleMap.has(ruleName)) {
        commands.push(this.generateDeleteNatServerCommand(deviceRule));
      }
    }

    for (const [ruleName, localRule] of localRuleMap) {
      const deviceRule = deviceRuleMap.get(ruleName);

      if (!deviceRule) {
        if (localRule.enabled) {
          commands.push(this.generateNatServerCommand(localRule));
        }
        continue;
      }

      const hasChanged =
        deviceRule.protocol.toUpperCase() !== localRule.protocol.toUpperCase() ||
        deviceRule.globalIp !== localRule.globalIp ||
        deviceRule.globalPort !== localRule.globalPort ||
        deviceRule.insideIp !== localRule.insideIp ||
        deviceRule.insidePort !== localRule.insidePort ||
        deviceRule.enabled !== localRule.enabled ||
        deviceRule.noReverse !== localRule.noReverse;

      if (hasChanged) {
        commands.push(this.generateDeleteNatServerCommand(deviceRule));

        if (localRule.enabled) {
          commands.push(
            this.generateNatServerCommand({
              ...localRule,
              addSyntax: deviceRule.addSyntax || localRule.addSyntax,
            })
          );
        }
      }
    }

    if (commands.length === 1) {
      return [];
    }

    commands.push('quit');
    commands.push('save');
    commands.push('y');

    return commands;
  }

  generateAddRuleCommands(rule: ParsedNatRule): string[] {
    return ['system-view', this.generateNatServerCommand(rule), 'quit', 'save', 'y'];
  }

  generateDeleteRuleCommands(rule: ParsedNatRule): string[] {
    return ['system-view', this.generateDeleteNatServerCommand(rule), 'quit', 'save', 'y'];
  }

  parseInterfaceIP(output: string): string | null {
    const ipMatch = output.match(/IP\s+[Aa]ddress\s*:\s*(\d+\.\d+\.\d+\.\d+)/);
    if (ipMatch) {
      return ipMatch[1];
    }

    const configMatch = output.match(/ip\s+address\s+(\d+\.\d+\.\d+\.\d+)/i);
    if (configMatch) {
      return configMatch[1];
    }

    return null;
  }

  isValidIP(ip: string): boolean {
    const match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);

    if (!match) {
      return false;
    }

    for (let i = 1; i <= 4; i++) {
      const num = parseInt(match[i], 10);
      if (num < 0 || num > 255) {
        return false;
      }
    }

    return true;
  }

  cleanOutput(output: string): string {
    return output
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\[.*?\]/g, '')
      .replace(/<.*?>/g, '')
      .replace(/^[\s\n]+|[\s\n]+$/g, '')
      .trim();
  }
}

export const usgParser = new USGParser();
