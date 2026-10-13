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
  // unr-route: the device also installs a UNR route for the global address.
  unrRoute?: boolean;
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

// Huawei prepends this standalone header even to filtered configuration reads.
const HUAWEI_TIMESTAMP_HEADER =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\s+(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?\s+[+-](?:0\d|1[0-4]):[0-5]\d$/;

// Trailing options that are parsed, stored and written back unchanged. Anything else stops a
// read, since rewriting such a rule would silently drop the option.
const SUPPORTED_NAT_OPTIONS = new Set(['no-reverse', 'unr-route']);

export const hasDeviceRuleName = (rule: ParsedNatRule): boolean =>
  Boolean(rule.ruleName) &&
  rule.addSyntax !== 'endpoint' &&
  (rule.addSyntax === 'direct-name' ||
    rule.addSyntax === 'name-keyword' ||
    !/^NAT_(?:\d{1,3}\.){3}\d{1,3}_\S+$/.test(rule.ruleName));

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

const endpointsOverlap = (left: ParsedNatRule, right: ParsedNatRule): boolean =>
  left.globalIp === right.globalIp &&
  left.globalPort === right.globalPort &&
  (left.protocol.toUpperCase() === right.protocol.toUpperCase() ||
    left.protocol.toUpperCase() === 'ALL' ||
    right.protocol.toUpperCase() === 'ALL');

// The device rejects a second NAT server on an occupied public endpoint mid-batch, after earlier
// deletes already took effect, so conflicts must be refused before any command is sent.
// With `subjects`, only conflicts involving those rules count; overlaps the device already
// accepts between untouched rules must not block an unrelated change.
export const assertNoNatEndpointConflicts = (
  rules: ParsedNatRule[],
  subjects?: ParsedNatRule[]
): void => {
  const enabled = rules.filter((rule) => rule.enabled);
  const involved = (rule: ParsedNatRule) => !subjects || subjects.includes(rule);
  for (const [index, rule] of enabled.entries()) {
    const other = enabled
      .slice(index + 1)
      .find(
        (candidate) => endpointsOverlap(rule, candidate) && (involved(rule) || involved(candidate))
      );
    if (other)
      throw new Error(
        `规则 ${rule.ruleName} 与 ${other.ruleName} 占用同一公网地址端口 ${rule.globalIp}:${rule.globalPort}，已阻止下发`
      );
  }
};

export class USGParser {
  // Only completed reads can replace local state. Unknown device syntax must remain untouched.
  parseNatServerSnapshot(output: string, complete: boolean): ParsedNatRule[] {
    if (!complete) throw new Error('设备配置读取不完整，已阻止覆盖或下发');
    const rules: ParsedNatRule[] = [];
    const names = new Set<string>();
    for (const line of output
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)) {
      if (line === '#' || line === '!' || HUAWEI_TIMESTAMP_HEADER.test(line)) continue;
      const rule = /^nat\s+server\s/i.test(line) ? this.parseNatServerLine(line) : null;
      const suffix = line.match(/\sinside\s+\S+\s+\S+(.*)$/i)?.[1]?.trim() || '';
      if (
        !rule ||
        !suffix
          .split(/\s+/)
          .every((option) => !option || SUPPORTED_NAT_OPTIONS.has(option.toLowerCase())) ||
        !this.isValidIP(rule.globalIp) ||
        !this.isValidIP(rule.insideIp) ||
        ![rule.globalPort, rule.insidePort].every(
          (port) => /^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535
        ) ||
        names.has(rule.ruleName)
      ) {
        throw new Error(`设备配置含不支持或无法解析的规则，已阻止覆盖或下发: ${line}`);
      }
      names.add(rule.ruleName);
      rules.push(rule);
    }
    return rules;
  }

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
        enabled: !/^\s*undo\s/i.test(line),
        addSyntax: namedMatch[1] ? 'name-keyword' : 'direct-name',
        noReverse: /(^|\s)no-reverse(\s|$)/i.test(additionalParams),
        unrRoute: /(^|\s)unr-route(\s|$)/i.test(additionalParams),
      };
    }

    const endpointPattern =
      /nat\s+server\s+protocol\s+(tcp|udp|all)\s+global\s+(\S+)\s+(\S+)\s+inside\s+(\S+)\s+(\S+)(.*)$/i;
    const endpointMatch = line.match(endpointPattern);

    if (endpointMatch) {
      const additionalParams = endpointMatch[6] || '';
      return {
        ruleName: `NAT_${endpointMatch[2]}_${normalizeNatPort(endpointMatch[3])}_${endpointMatch[1].toUpperCase()}`,
        protocol: endpointMatch[1].toUpperCase() as 'TCP' | 'UDP' | 'ALL',
        globalIp: endpointMatch[2],
        globalPort: normalizeNatPort(endpointMatch[3]),
        insideIp: endpointMatch[4],
        insidePort: normalizeNatPort(endpointMatch[5]),
        enabled: !/^\s*undo\s/i.test(line),
        addSyntax: 'endpoint',
        noReverse: /(^|\s)no-reverse(\s|$)/i.test(additionalParams),
        unrRoute: /(^|\s)unr-route(\s|$)/i.test(additionalParams),
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
    this.assertWritableNatRule(rule);
    const protocol = rule.protocol.toLowerCase();
    let command = '';

    if (hasDeviceRuleName(rule)) {
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

    // Same order as the device prints it: no-reverse before unr-route.
    if (rule.unrRoute) {
      command += ' unr-route';
    }

    return command;
  }

  generateDeleteNatServerCommand(rule: ParsedNatRule): string {
    this.assertWritableNatRule(rule);
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
    const deletes: string[] = [];
    const adds: string[] = [];
    const replaced = new Set<ParsedNatRule>();
    const target: ParsedNatRule[] = [];

    for (const rule of rules) {
      if (!rule.enabled) continue;
      const deviceRule = findMatchingDeviceRule(deviceRules, rule);

      if (deviceRule && !replaced.has(deviceRule)) {
        replaced.add(deviceRule);
        deletes.push(this.generateDeleteNatServerCommand(deviceRule));
      }

      // Only the IP changes; options follow the device so a stale local copy cannot strip
      // no-reverse or unr-route from a live rule.
      const updated = {
        ...rule,
        globalIp: newGlobalIp,
        addSyntax: deviceRule?.addSyntax || rule.addSyntax,
        noReverse: deviceRule ? Boolean(deviceRule.noReverse) : rule.noReverse,
        unrRoute: deviceRule ? Boolean(deviceRule.unrRoute) : rule.unrRoute,
      };
      target.push(updated);
      adds.push(this.generateNatServerCommand(updated));
    }

    if (!adds.length) return [];
    assertNoNatEndpointConflicts(
      [...deviceRules.filter((rule) => !replaced.has(rule)), ...target],
      target
    );
    // All deletes run before any add so a rule moving onto a freed endpoint never collides.
    return ['system-view', ...deletes, ...adds, 'quit', 'save', 'y'];
  }

  generateSyncToDeviceCommands(
    deviceRules: ParsedNatRule[],
    localRules: ParsedNatRule[]
  ): string[] {
    const deletes: string[] = [];
    const adds: string[] = [];
    const deviceRuleMap = new Map<string, ParsedNatRule>();
    const localRuleMap = new Map<string, ParsedNatRule>();

    const ruleKey = (rule: ParsedNatRule) =>
      hasDeviceRuleName(rule)
        ? rule.ruleName
        : `NAT_${rule.globalIp}_${rule.globalPort}_${rule.protocol.toUpperCase()}`;
    deviceRules.forEach((rule) => deviceRuleMap.set(ruleKey(rule), rule));
    // Disabled rules only exist locally; leaving them out means a device rule they shadow is
    // deleted, exactly as the preview and the rules page describe, even when two local rules
    // share a key.
    localRules
      .filter((rule) => rule.enabled)
      .forEach((rule) => localRuleMap.set(ruleKey(rule), rule));
    const added: ParsedNatRule[] = [];

    for (const [ruleName, deviceRule] of deviceRuleMap) {
      if (!localRuleMap.has(ruleName)) {
        deletes.push(this.generateDeleteNatServerCommand(deviceRule));
      }
    }

    for (const [ruleName, localRule] of localRuleMap) {
      const deviceRule = deviceRuleMap.get(ruleName);

      if (!deviceRule) {
        if (localRule.enabled) {
          added.push(localRule);
          adds.push(this.generateNatServerCommand(localRule));
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
        Boolean(deviceRule.noReverse) !== Boolean(localRule.noReverse) ||
        Boolean(deviceRule.unrRoute) !== Boolean(localRule.unrRoute);

      if (hasChanged) {
        deletes.push(this.generateDeleteNatServerCommand(deviceRule));

        if (localRule.enabled) {
          added.push(localRule);
          adds.push(
            this.generateNatServerCommand({
              ...localRule,
              addSyntax: deviceRule.addSyntax || localRule.addSyntax,
            })
          );
        }
      }
    }

    if (!deletes.length && !adds.length) {
      return [];
    }
    assertNoNatEndpointConflicts([...localRuleMap.values()], added);

    // All deletes run before any add so a rule moving onto a freed endpoint never collides.
    return ['system-view', ...deletes, ...adds, 'quit', 'save', 'y'];
  }

  generateAddRuleCommands(rule: ParsedNatRule): string[] {
    return ['system-view', this.generateNatServerCommand(rule), 'quit', 'save', 'y'];
  }

  generateDeleteRuleCommands(rule: ParsedNatRule): string[] {
    return ['system-view', this.generateDeleteNatServerCommand(rule), 'quit', 'save', 'y'];
  }

  // Addresses from `display ip interface brief`; "unassigned" interfaces contribute nothing.
  parseInterfaceAddresses(output: string): string[] {
    return output
      .split(/\r?\n/)
      .flatMap((line) => line.match(/\s(\d{1,3}(?:\.\d{1,3}){3})\/\d{1,2}(?=\s|$)/)?.[1] ?? [])
      .filter((ip) => this.isValidIP(ip));
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

  // Leading zeros are rejected: the device normalizes them, so read-back would never match.
  isValidIP(ip: string): boolean {
    const match = ip.match(
      /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/
    );

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

  assertWritableNatRule(rule: ParsedNatRule): void {
    if (
      !rule.ruleName ||
      !/^[a-zA-Z0-9_.-]+$/.test(rule.ruleName) ||
      !['TCP', 'UDP', 'ALL'].includes(rule.protocol.toUpperCase()) ||
      !this.isValidIP(rule.globalIp) ||
      !this.isValidIP(rule.insideIp) ||
      ![rule.globalPort, rule.insidePort].every(
        (port) => /^[1-9]\d*$/.test(port) && Number(port) <= 65535
      ) ||
      typeof rule.enabled !== 'boolean'
    ) {
      throw new Error(
        `规则 ${rule.ruleName || '(未命名)'} 的名称、协议、IPv4地址或端口无效，已阻止设备命令`
      );
    }
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
