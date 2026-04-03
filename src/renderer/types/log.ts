export interface Log {
  id: string;
  level: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  operation: string;
  message: string;
  details?: string;
  createdAt: Date;
}

export interface MonitorStatus {
  isRunning: boolean;
  currentIP: string;
  lastCheck: Date;
}
