export const assertSupportedConnectionType = (
  connectionType?: string | null,
  deviceName?: string
) => {
  if (connectionType && connectionType !== 'SSH') {
    throw new Error(
      `Device${deviceName ? ` ${deviceName}` : ''} uses unsupported connection type ${connectionType}. Only SSH is supported.`
    );
  }
};

export const assertSupportedAuthType = (authType?: string | null) => {
  if (authType && authType !== 'Password' && authType !== 'PrivateKey') {
    throw new Error('Only Password and PrivateKey auth are supported in the current version.');
  }
};

export const assertSupportedDeviceAccess = (
  device: { name?: string; connectionType?: string | null },
  credential: { authType?: string | null }
) => {
  assertSupportedConnectionType(device.connectionType, device.name);
  assertSupportedAuthType(credential.authType);
};

export type IpcSuccessResult = {
  success: true;
  message?: string;
};

export type IpcFailureResult = {
  success: false;
  error: string;
  message?: string;
  details?: string;
};

export type IpcResult = IpcSuccessResult | IpcFailureResult;

export const getErrorMessage = (error: unknown, fallback = 'Unknown error'): string =>
  error instanceof Error ? error.message : fallback;
