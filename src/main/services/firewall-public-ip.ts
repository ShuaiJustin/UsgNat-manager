import { isGlobalUnicastIPv4 } from './ip-monitor-utils.ts';

// Read the interface table, not NAT rules: NAT addresses may still contain the previous WAN IP.
export const FIREWALL_INTERFACE_ADDRESS_COMMAND = 'display ip interface brief | include /';
export const FIREWALL_DEFAULT_ROUTE_COMMAND = 'display ip routing-table 0.0.0.0';

export const selectFirewallWANIP = (output: string, routingOutput?: string): string => {
  const interfaces = new Map<string, string>();
  const addresses = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const match = line
      .trim()
      .match(/^\S+\s+(\d+(?:\.\d+){3})\/(\d{1,2})\s+up(?:\([^)]*\))?\s+up(?:\([^)]*\))?(?:\s|$)/i);
    if (match && Number(match[2]) <= 32 && isGlobalUnicastIPv4(match[1])) {
      addresses.add(match[1]);
      interfaces.set(line.trim().split(/\s+/)[0].toLowerCase(), match[1]);
    }
  }
  if (!addresses.size) throw new Error('设备没有在线的公网IPv4接口，无法确定WAN地址');
  if (routingOutput !== undefined) {
    const route = routingOutput
      .split(/\r?\n/)
      .map((line) =>
        line.trim().match(/^0\.0\.0\.0\/0\s+\S+\s+\d+\s+\d+\s+([A-Z]+)\s+\d+(?:\.\d+){3}\s+(\S+)$/i)
      )
      .filter((match) => match && match[1].toUpperCase().includes('D'));
    // A unique installed default route identifies the real WAN; templates/loopbacks may also
    // carry globally shaped addresses but must never win over the device's forwarding table.
    if (
      /Routing Table\s*:\s*Public/i.test(routingOutput) &&
      /Summary Count\s*:\s*1(?:\s|$)/i.test(routingOutput) &&
      route.length === 1
    ) {
      const address = interfaces.get(route[0]![2].toLowerCase());
      if (address) return address;
    }
    throw new Error('无法从唯一生效的默认路由确定在线WAN公网IPv4，请检查多出口路由或接口状态');
  }
  if (addresses.size > 1) throw new Error('设备存在多个在线公网IPv4地址，无法自动确定WAN出口');
  return [...addresses][0];
};

type FirewallPublicIPDependencies = {
  getDevices: () => Promise<Array<{ id: string; name: string; enabled: boolean }>>;
  getSelectedDeviceIds: () => Promise<readonly string[]>;
  enter: () => (() => void) | null;
  readInterfaces: (
    id: string
  ) => Promise<{ success: boolean; complete?: boolean; output: string; routingOutput?: string }>;
};

// O(devices + interface lines), with one shared in-flight read for simultaneous UI/monitor polls.
export const createFirewallPublicIPReader = (
  deps: FirewallPublicIPDependencies
): (() => Promise<string>) & { invalidate: () => void } => {
  let pending: Promise<string> | null = null;
  let generation = 0;
  let pendingGeneration = 0;
  const read = (): Promise<string> => {
    if (pending) {
      if (pendingGeneration === generation) return pending;
      // Drain the invalidated SSH operation before another scope/startup read takes its lock.
      return pending.catch(() => {}).then(() => read());
    }
    const release = deps.enter();
    if (!release) return Promise.reject(new Error('业务操作已暂停，暂不读取设备WAN地址'));
    const observedGeneration = generation;
    const task = (async () => {
      const [devices, selected] = await Promise.all([
        deps.getDevices(),
        deps.getSelectedDeviceIds(),
      ]);
      if (!Array.isArray(selected) || selected.some((id) => typeof id !== 'string' || !id))
        throw new Error('监控设备选择无效');
      const enabled = new Map(
        devices.filter((device) => device.enabled).map((device) => [device.id, device])
      );
      const ids = selected.length ? [...new Set(selected)] : [...enabled.keys()];
      if (!ids.length) throw new Error('没有可读取WAN地址的已启用设备');
      if (ids.some((id) => !enabled.has(id))) throw new Error('所选监控设备不存在或已禁用');
      const addresses = new Set<string>();
      for (const id of ids) {
        const result = await deps.readInterfaces(id);
        if (!result.success || result.complete !== true)
          throw new Error(`设备 ${enabled.get(id)!.name} 接口地址读取失败或不完整`);
        addresses.add(selectFirewallWANIP(result.output, result.routingOutput));
      }
      if (addresses.size !== 1)
        throw new Error('所选设备的WAN公网IP不一致，请只选择同一出口的监控设备');
      if (observedGeneration !== generation) throw new Error('监控设备或读取状态已变化');
      return [...addresses][0];
    })().finally(() => {
      if (pending === task) pending = null;
      release();
    });
    pendingGeneration = observedGeneration;
    pending = task;
    return pending;
  };
  return Object.assign(read, {
    invalidate: () => {
      generation++;
    },
  });
};
