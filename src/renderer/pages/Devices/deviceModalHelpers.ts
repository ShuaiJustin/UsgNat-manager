type SupportedConnectionType = 'SSH' | 'HTTPS';
type SupportedAuthType = 'Password' | 'PrivateKey';

type StoredCredential = {
  authType?: string;
  username?: string;
  password?: string;
  privateKey?: string;
} | null;

type DeviceFormValues = {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  privateKeyPath?: string;
  authType?: SupportedAuthType;
};

export type CredentialPayload = {
  authType: SupportedAuthType;
  username?: string;
  password?: string;
  privateKeyPath?: string;
  privateKey?: string;
};

export const getDeviceAccessValidationError = (
  connectionType: SupportedConnectionType,
  authType: SupportedAuthType
): 'unsupported-connection' | null => {
  void authType;

  if (connectionType !== 'SSH') {
    return 'unsupported-connection';
  }

  return null;
};

export const buildCredentialPayload = (
  values: DeviceFormValues,
  storedCredential: StoredCredential
): CredentialPayload => {
  const selectedAuthType = values.authType || 'Password';

  return {
    authType: selectedAuthType,
    username: values.username || storedCredential?.username,
    password:
      selectedAuthType === 'Password' ? values.password || storedCredential?.password : undefined,
    privateKeyPath: values.privateKeyPath || undefined,
    privateKey: values.privateKeyPath ? undefined : storedCredential?.privateKey,
  };
};

export const shouldSaveCredential = (
  deviceId: string | null | undefined,
  credentialPayload: CredentialPayload
): boolean => {
  if (!deviceId || !credentialPayload.username) {
    return false;
  }

  if (credentialPayload.authType === 'Password') {
    return !!credentialPayload.password;
  }

  if (credentialPayload.authType === 'PrivateKey') {
    return !!(credentialPayload.privateKeyPath || credentialPayload.privateKey);
  }

  return false;
};

export const getFieldsToValidate = (
  values: DeviceFormValues,
  authType: SupportedAuthType,
  storedCredential: StoredCredential
): string[] => {
  const fieldsToValidate = ['host', 'port', 'username'];

  if (authType === 'Password') {
    fieldsToValidate.push('password');
  }

  if (
    authType === 'PrivateKey' &&
    !values.privateKeyPath &&
    !(storedCredential?.authType === 'PrivateKey' && storedCredential.privateKey)
  ) {
    fieldsToValidate.push('privateKeyPath');
  }

  return fieldsToValidate;
};
