export interface AutomationConfirmRequest {
  requestId: string;
  newIP: string;
  deviceCount: number;
  expiresAt: number;
}
