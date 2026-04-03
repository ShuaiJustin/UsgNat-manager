export interface NatRule {
  id: string;
  deviceId: string;
  ruleName: string;
  protocol: 'TCP' | 'UDP' | 'ALL';
  globalIp: string;
  globalPort: string;
  insideIp: string;
  insidePort: string;
  enabled: boolean;
  description?: string;
  noReverse: boolean;
  createdAt: Date;
  updatedAt: Date;
}
