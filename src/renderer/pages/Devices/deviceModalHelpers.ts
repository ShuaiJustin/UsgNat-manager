type SupportedConnectionType = 'SSH' | 'HTTPS';
type SupportedAuthType = 'Password' | 'PrivateKey' | 'Certificate' | 'MultiFactor';

type StoredCredential = {
  authType?: SupportedAuthType;
  username?: string;
  password?: string;
  privateKey?: string;
  certificate?: string;
  mfaType?: 'TOTP' | 'SMS' | 'Email' | 'Hardware';
} | null;

type DeviceFormValues = {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  privateKeyPath?: string;
  certificatePath?: string;
  mfaType?: 'TOTP' | 'SMS' | 'Email' | 'Hardware';
  authType?: SupportedAuthType;
};

export type CredentialPayload = {
  authType: SupportedAuthType;
  username?: string;
  password?: string;
  privateKeyPath?: string;
  privateKey?: string;
  certificatePath?: string;
  certificate?: string;
  mfaType?: 'TOTP' | 'SMS' | 'Email' | 'Hardware';
};

export const getDeviceAccessValidationError = (
  connectionType: SupportedConnectionType,
  authType: SupportedAuthType
): 'unsupported-connection' | 'unsupported-auth' | null => {
  if (connectionType !== 'SSH') {
    return 'unsupported-connection';
  }

  if (!['Password', 'PrivateKey'].includes(authType)) {
    return 'unsupported-auth';
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
      selectedAuthType === 'Password' || selectedAuthType === 'MultiFactor'
        ? values.password || storedCredential?.password
        : undefined,
    privateKeyPath: values.privateKeyPath || undefined,
    privateKey: values.privateKeyPath ? undefined : storedCredential?.privateKey,
    certificatePath: values.certificatePath || undefined,
    certificate: values.certificatePath ? undefined : storedCredential?.certificate,
    mfaType: values.mfaType || storedCredential?.mfaType,
  };
};

export const shouldSaveCredential = (
  deviceId: string | null | undefined,
  credentialPayload: CredentialPayload
): boolean => {
  if (!deviceId || !credentialPayload.username) {
    return false;
  }

  if (credentialPayload.authType === 'Password' || credentialPayload.authType === 'MultiFactor') {
    return !!credentialPayload.password;
  }

  if (credentialPayload.authType === 'PrivateKey') {
    return !!(credentialPayload.privateKeyPath || credentialPayload.privateKey);
  }

  if (credentialPayload.authType === 'Certificate') {
    return !!(
      (credentialPayload.privateKeyPath || credentialPayload.privateKey) &&
      (credentialPayload.certificatePath || credentialPayload.certificate)
    );
  }

  return false;
};

export const getFieldsToValidate = (
  values: DeviceFormValues,
  authType: SupportedAuthType,
  storedCredential: StoredCredential
): string[] => {
  const fieldsToValidate = ['host', 'port', 'username'];

  if (authType === 'Password' || authType === 'MultiFactor') {
    fieldsToValidate.push('password');
  }

  if (
    authType === 'PrivateKey' &&
    !values.privateKeyPath &&
    !(storedCredential?.authType === 'PrivateKey' && storedCredential.privateKey)
  ) {
    fieldsToValidate.push('privateKeyPath');
  }

  if (authType === 'Certificate') {
    if (
      !values.certificatePath &&
      !(storedCredential?.authType === 'Certificate' && storedCredential.certificate)
    ) {
      fieldsToValidate.push('certificatePath');
    }

    if (
      !values.privateKeyPath &&
      !(storedCredential?.authType === 'Certificate' && storedCredential.privateKey)
    ) {
      fieldsToValidate.push('privateKeyPath');
    }
  }

  if (authType === 'MultiFactor') {
    fieldsToValidate.push('mfaType');
  }

  return fieldsToValidate;
};
