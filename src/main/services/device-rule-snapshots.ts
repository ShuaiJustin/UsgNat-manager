import type { ParsedNatRule } from './usg-parser';

// Last complete NAT read per device, so the rules page can compare local edits without logging
// in to the firewall each time. Anything that writes to a device or changes how it is reached
// must invalidate its entry; the TTL only bounds changes made outside this application.
export const DEVICE_SNAPSHOT_TTL_MS = 2 * 60 * 1000;

type Snapshot = { identity: string; rules: ParsedNatRule[]; readAt: number };

const snapshots = new Map<string, Snapshot>();

export const deviceRuleSnapshots = {
  set(deviceId: string, identity: string, rules: ParsedNatRule[], now = Date.now()) {
    snapshots.set(deviceId, { identity, rules, readAt: now });
  },
  // Returns a snapshot only if it is fresh and was read from the same host and port.
  getFresh(deviceId: string, identity: string, now = Date.now()): Snapshot | undefined {
    const snapshot = snapshots.get(deviceId);
    return snapshot &&
      snapshot.identity === identity &&
      now - snapshot.readAt < DEVICE_SNAPSHOT_TTL_MS
      ? snapshot
      : undefined;
  },
  invalidate(deviceId: string) {
    snapshots.delete(deviceId);
  },
};
