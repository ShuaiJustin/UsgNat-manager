// Canonical storage/UI format: one port or an inclusive start-end range.
export const parseNatPort = (value: unknown): [number, number] | null => {
  if (typeof value !== 'string') return null;
  const match = /^([1-9]\d{0,4})(?:-([1-9]\d{0,4}))?$/.exec(value);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : start;
  if (end > 65535 || (match[2] && end <= start)) return null;
  return [start, end];
};

export const natPortsOverlap = (left: string, right: string): boolean => {
  const a = parseNatPort(left);
  const b = parseNatPort(right);
  return !!a && !!b && a[0] <= b[1] && b[0] <= a[1];
};

export const natPortCommand = (value: string): string => value.replace('-', ' ');
