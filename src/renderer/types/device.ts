export interface Device {
  id: string;
  name: string;
  host: string;
  port: number;
  connectionType: 'SSH' | 'HTTPS';
  description?: string;
  enabled: boolean;
  online: boolean;
  lastConnected?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Credential {
  id: string;
  deviceId: string;
  authType: 'Password' | 'PrivateKey' | 'Certificate' | 'MultiFactor';
  username?: string;
  password?: string;
  secretRef?: string;
  privateKey?: string;
  passphrase?: string;
  certificate?: string;
  mfaType?: 'TOTP' | 'SMS' | 'Email' | 'Hardware';
  createdAt: Date;
  updatedAt: Date;
}

export interface ConnectionTestResult {
  success: boolean;
  latency: number;
  message: string;
  hostKey?: {
    fingerprint: string;
    host: string;
    port: number;
    changed: boolean;
  };
}
