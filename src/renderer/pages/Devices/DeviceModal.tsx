import React, { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
} from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { Credential, Device } from '@/types';
import {
  buildCredentialPayload,
  getDeviceAccessValidationError,
  getFieldsToValidate,
  shouldSaveCredential,
} from './deviceModalHelpers';

interface DeviceModalProps {
  open: boolean;
  device: Device | null;
  onClose: () => void;
  onSuccess: () => void;
}

type SupportedAuthType = NonNullable<Credential['authType']>;

type DeviceFormValues = Partial<Device> & {
  authType?: SupportedAuthType;
  username?: string;
  password?: string;
  privateKeyPath?: string;
  certificatePath?: string;
  passphrase?: string;
  mfaType?: Credential['mfaType'];
  mfaCode?: string;
  caCertPath?: string;
  saveToCredentialManager?: boolean;
};

type DeviceMutationPayload = {
  id: string;
  values: Partial<Device>;
};

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const DeviceModal: React.FC<DeviceModalProps> = ({ open, device, onClose, onSuccess }) => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm<DeviceFormValues>();
  const isEdit = !!device;
  const [authType, setAuthType] = useState<SupportedAuthType>('Password');
  const [storedCredential, setStoredCredential] = useState<Credential | null>(null);
  const selectedConnectionType = Form.useWatch('connectionType', form) || 'SSH';
  const selectedFormAuthType = Form.useWatch('authType', form) || authType;

  useEffect(() => {
    let isActive = true;

    const loadFormData = async () => {
      if (!open) {
        return;
      }

      if (!device) {
        form.resetFields();
        setAuthType('Password');
        setStoredCredential(null);
        return;
      }

      form.setFieldsValue({
        ...device,
        authType: 'Password',
        username: undefined,
        password: undefined,
        privateKeyPath: undefined,
        certificatePath: undefined,
        passphrase: undefined,
        mfaType: undefined,
        mfaCode: undefined,
      });

      const api = window.electronAPI;
      const credential = api?.credential?.get ? await api.credential.get(device.id) : null;
      if (!isActive) {
        return;
      }

      setStoredCredential(credential);

      const nextAuthType = credential?.authType || 'Password';
      setAuthType(nextAuthType);
      form.setFieldsValue({
        authType: nextAuthType,
        username: credential?.username,
        password: credential?.password,
        mfaType: credential?.mfaType,
      });
    };

    void loadFormData().catch(() => {
      if (!isActive) {
        return;
      }

      setStoredCredential(null);
      setAuthType('Password');
      form.setFieldValue('authType', 'Password');
    });

    return () => {
      isActive = false;
    };
  }, [open, device, form]);

  const handleSelectFile = async (
    fieldName: 'privateKeyPath' | 'certificatePath' | 'caCertPath',
    filters: Array<{ name: string; extensions: string[] }>
  ) => {
    try {
      const api = window.electronAPI;
      if (!api?.system?.selectFile) {
        message.error(t('common.error'));
        return;
      }

      const selectedPath = await api.system.selectFile({ filters });
      if (selectedPath) {
        form.setFieldValue(fieldName, selectedPath);
      }
    } catch (error) {
      message.error(getErrorMessage(error, t('common.error')));
    }
  };

  const createMutation = useMutation({
    mutationFn: async (values: Partial<Device>) => {
      const api = window.electronAPI;
      if (!api?.device?.create) {
        throw new Error('electronAPI 未就绪，无法创建设备');
      }
      return api.device.create(values);
    },
    onError: (error: unknown) => {
      message.error(`创建设备失败: ${getErrorMessage(error, t('common.error'))}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: DeviceMutationPayload) => {
      const api = window.electronAPI;
      if (!api?.device?.update) {
        throw new Error('electronAPI 未就绪，无法更新设备');
      }
      return api.device.update(id, values);
    },
    onError: (error: unknown) => {
      message.error(`更新设备失败: ${getErrorMessage(error, t('common.error'))}`);
    },
  });

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const {
        username,
        password,
        privateKeyPath,
        certificatePath,
        passphrase: _passphrase,
        mfaType,
        mfaCode: _mfaCode,
        caCertPath: _caCertPath,
        authType: formAuthType,
        saveToCredentialManager: _saveToCredentialManager,
        ...deviceData
      } = values;

      const selectedConnectionTypeValue = values.connectionType || 'SSH';
      const selectedAuthType = formAuthType || authType;
      const deviceAccessValidationError = getDeviceAccessValidationError(
        selectedConnectionTypeValue,
        selectedAuthType
      );

      if (deviceAccessValidationError === 'unsupported-connection') {
        message.error('当前版本仅支持 SSH 连接');
        return;
      }

      if (deviceAccessValidationError === 'unsupported-auth') {
        message.error('当前版本仅支持密码或私钥认证');
        return;
      }

      let savedDeviceId = device?.id;
      let createdDeviceId: string | null = null;
      let credentialSaveSuccess = true;

      if (isEdit && device) {
        await updateMutation.mutateAsync({ id: device.id, values: deviceData });
        savedDeviceId = device.id;
      } else {
        const newDevice = await createMutation.mutateAsync(deviceData);
        savedDeviceId = newDevice.id;
        createdDeviceId = newDevice.id;
      }

      const credentialPayload = buildCredentialPayload(
        {
          authType: selectedAuthType,
          username,
          password,
          privateKeyPath,
          certificatePath,
          mfaType,
        },
        storedCredential
      );

      const shouldSaveDeviceCredential = shouldSaveCredential(savedDeviceId, credentialPayload);
      if (shouldSaveDeviceCredential) {
        try {
          const api = window.electronAPI;
          if (!api?.credential?.save) {
            throw new Error('credential API 不可用');
          }
          await api.credential.save(savedDeviceId, credentialPayload);
        } catch (error) {
          credentialSaveSuccess = false;
          if (createdDeviceId) {
            try {
              const api = window.electronAPI;
              if (api?.device?.delete) {
                await api.device.delete(createdDeviceId);
              }
            } catch (rollbackError) {
              console.error('回滚新建设备失败:', rollbackError);
            }
          }

          message.error(`凭据保存失败: ${getErrorMessage(error, t('common.error'))}`);
          return;
        }
      }

      onSuccess();
      onClose();

      if (credentialSaveSuccess) {
        message.success(isEdit ? '设备更新成功' : '设备添加成功');
      }

      if (savedDeviceId) {
        window.setTimeout(() => {
          void (async () => {
            try {
              const api = window.electronAPI;
              if (api?.device?.testConnection) {
                const result = await api.device.testConnection(savedDeviceId);
                if (result.success) {
                  message.success(`连接测试成功 - 延迟 ${result.latency}ms`);
                } else {
                  message.warning(`连接测试失败: ${result.message}`);
                }
                onSuccess();
              }
            } catch (error) {
              console.error('自动测试连接失败:', error);
            }
          })();
        }, 600);
      }
    } catch {
      // Form validation already shows inline errors.
    }
  };

  const handleTestConnection = async () => {
    try {
      const values = form.getFieldsValue();
      const api = window.electronAPI;
      const selectedConnectionTypeValue = values.connectionType || 'SSH';
      const selectedAuthType = values.authType || authType;
      const deviceAccessValidationError = getDeviceAccessValidationError(
        selectedConnectionTypeValue,
        selectedAuthType
      );

      if (deviceAccessValidationError === 'unsupported-connection') {
        message.error('当前版本仅支持 SSH 连接');
        return;
      }

      if (deviceAccessValidationError === 'unsupported-auth') {
        message.error('当前版本仅支持密码或私钥认证');
        return;
      }

      const fieldsToValidate = getFieldsToValidate(values, selectedAuthType, storedCredential);
      await form.validateFields(fieldsToValidate);

      if (!api?.device?.testDirectConnection) {
        message.error('API 未就绪');
        return;
      }

      const hideLoading = message.loading(t('common.loading'), 0);

      try {
        const result = await api.device.testDirectConnection({
          connectionType: selectedConnectionTypeValue,
          host: values.host || '',
          port: values.port || 22,
          username: values.username || storedCredential?.username,
          password: values.password || storedCredential?.password,
          privateKeyPath: values.privateKeyPath,
          privateKey: values.privateKeyPath ? undefined : storedCredential?.privateKey,
          certificatePath: values.certificatePath,
          certificate: values.certificatePath ? undefined : storedCredential?.certificate,
          passphrase: values.passphrase,
          mfaType: values.mfaType || storedCredential?.mfaType,
          authType: selectedAuthType,
        });

        hideLoading();

        if (result.success) {
          message.success(`${t('devices.connectionSuccess')}! ${result.latency}ms`);
        } else {
          message.error(`${t('devices.connectionFailed')}: ${result.message}`);
        }
      } catch (error) {
        hideLoading();
        message.error(`${t('common.error')}: ${getErrorMessage(error, t('common.error'))}`);
      }
    } catch {
      message.warning(t('devices.credentials'));
    }
  };

  return (
    <Modal
      title={isEdit ? `${t('common.edit')} ${t('devices.title')}` : t('devices.addDevice')}
      open={open}
      onOk={() => void handleSubmit()}
      onCancel={onClose}
      confirmLoading={createMutation.isPending || updateMutation.isPending}
      width={600}
      centered
      destroyOnHidden
      maskClosable={false}
      getContainer={false}
      styles={{ body: { maxHeight: '65vh', overflowY: 'auto' } }}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
      footer={[
        <Button key="test" onClick={() => void handleTestConnection()}>
          {t('devices.testConnection')}
        </Button>,
        <Button key="cancel" onClick={onClose}>
          {t('common.cancel')}
        </Button>,
        <Button
          key="submit"
          type="primary"
          loading={createMutation.isPending || updateMutation.isPending}
          onClick={() => void handleSubmit()}
        >
          {t('common.save')}
        </Button>,
      ]}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          port: 22,
          connectionType: 'SSH',
          enabled: true,
        }}
      >
        <Form.Item
          label={t('devices.deviceName')}
          name="name"
          rules={[{ required: true, message: t('devices.deviceName') }]}
        >
          <Input placeholder="例如: USG6000-01" />
        </Form.Item>

        <Form.Item
          label={t('devices.host')}
          name="host"
          rules={[
            { required: true, message: t('devices.host') },
            {
              validator: (_, value: string) => {
                if (!value) {
                  return Promise.resolve();
                }

                const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
                const domainPattern =
                  /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
                if (value === 'localhost' || ipPattern.test(value) || domainPattern.test(value)) {
                  if (ipPattern.test(value)) {
                    const parts = value.split('.').map(Number);
                    if (parts.some((part) => part < 0 || part > 255)) {
                      return Promise.reject(new Error('IP 地址段必须在 0-255 之间'));
                    }
                  }
                  return Promise.resolve();
                }

                return Promise.reject(new Error('请输入有效的 IP 地址或域名'));
              },
            },
          ]}
        >
          <Input placeholder="例如: 192.168.1.1 或 firewall.example.com" />
        </Form.Item>

        <Form.Item
          label={t('devices.port')}
          name="port"
          rules={[{ required: true, message: t('devices.port') }]}
        >
          <InputNumber min={1} max={65535} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          label={t('devices.connectionType')}
          name="connectionType"
          rules={[{ required: true, message: t('devices.connectionType') }]}
          extra={
            selectedConnectionType === 'HTTPS'
              ? 'HTTPS is not supported. Use SSH instead.'
              : 'Only SSH is supported in the current version.'
          }
        >
          <Select>
            <Select.Option value="SSH">SSH</Select.Option>
            <Select.Option value="HTTPS" disabled>
              HTTPS (暂不支持)
            </Select.Option>
          </Select>
        </Form.Item>

        {selectedConnectionType !== 'SSH' && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="HTTPS is not supported in the current version. Use SSH instead."
          />
        )}

        <Form.Item label={t('devices.description')} name="description">
          <Input.TextArea rows={3} placeholder={t('devices.description')} />
        </Form.Item>

        <Form.Item label="启用设备" name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>

        <Divider orientation="left">认证信息</Divider>

        <Form.Item label="认证方式" name="authType" initialValue="Password">
          <Select
            onChange={(value: SupportedAuthType) => {
              if (value === 'Certificate' || value === 'MultiFactor') {
                message.warning('Only Password and PrivateKey auth are supported.');
              }
              setAuthType(value);
            }}
          >
            <Select.Option value="Password">密码认证</Select.Option>
            <Select.Option value="PrivateKey">私钥认证</Select.Option>
            <Select.Option value="Certificate" disabled>
              证书认证 (暂不支持)
            </Select.Option>
            <Select.Option value="MultiFactor" disabled>
              多因素认证 (暂不支持)
            </Select.Option>
          </Select>
        </Form.Item>

        {['Certificate', 'MultiFactor'].includes(selectedFormAuthType) && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="Certificate and multi-factor authentication are not implemented."
          />
        )}

        {selectedFormAuthType === 'Password' && (
          <>
            <Form.Item
              label={t('devices.username')}
              name="username"
              rules={[{ required: true, message: t('devices.username') }]}
            >
              <Input placeholder="admin" />
            </Form.Item>
            <Form.Item
              label={t('devices.password')}
              name="password"
              rules={[{ required: true, message: t('devices.password') }]}
            >
              <Input.Password />
            </Form.Item>
            <Form.Item name="saveToCredentialManager" valuePropName="checked">
              <Checkbox>保存到 Windows 凭据管理器</Checkbox>
            </Form.Item>
          </>
        )}

        {selectedFormAuthType === 'PrivateKey' && (
          <>
            <Form.Item
              label={t('devices.username')}
              name="username"
              rules={[{ required: true, message: t('devices.username') }]}
            >
              <Input placeholder="admin" />
            </Form.Item>
            <Form.Item
              label="私钥文件"
              name="privateKeyPath"
              rules={[
                {
                  required: !(
                    storedCredential?.authType === 'PrivateKey' && storedCredential.privateKey
                  ),
                  message: '请选择私钥文件',
                },
              ]}
              extra={
                storedCredential?.authType === 'PrivateKey' && storedCredential.privateKey
                  ? '已保存私钥，留空表示保持不变'
                  : undefined
              }
            >
              <Input
                placeholder="C:\\Users\\admin\\.ssh\\id_rsa"
                addonAfter={
                  <Button
                    size="small"
                    icon={<UploadOutlined />}
                    onClick={() =>
                      void handleSelectFile('privateKeyPath', [
                        { name: 'Private Keys', extensions: ['pem', 'key', 'ppk', 'txt'] },
                      ])
                    }
                  >
                    浏览
                  </Button>
                }
              />
            </Form.Item>
            <Form.Item label="私钥密码(可选)" name="passphrase">
              <Input.Password />
            </Form.Item>
          </>
        )}

        {selectedFormAuthType === 'Certificate' && (
          <>
            <Form.Item
              label={t('devices.username')}
              name="username"
              rules={[{ required: true, message: t('devices.username') }]}
            >
              <Input placeholder="admin" />
            </Form.Item>
            <Form.Item
              label="证书文件"
              name="certificatePath"
              rules={[
                {
                  required: !(
                    storedCredential?.authType === 'Certificate' && storedCredential.certificate
                  ),
                  message: '请选择证书文件',
                },
              ]}
              extra={
                storedCredential?.authType === 'Certificate' && storedCredential.certificate
                  ? '已保存证书，留空表示保持不变'
                  : undefined
              }
            >
              <Input
                placeholder="C:\\Certs\\admin.crt"
                addonAfter={
                  <Button
                    size="small"
                    icon={<UploadOutlined />}
                    onClick={() =>
                      void handleSelectFile('certificatePath', [
                        { name: 'Certificates', extensions: ['crt', 'cer', 'pem'] },
                      ])
                    }
                  >
                    浏览
                  </Button>
                }
              />
            </Form.Item>
            <Form.Item
              label="私钥文件"
              name="privateKeyPath"
              rules={[
                {
                  required: !(
                    storedCredential?.authType === 'Certificate' && storedCredential.privateKey
                  ),
                  message: '请选择私钥文件',
                },
              ]}
              extra={
                storedCredential?.authType === 'Certificate' && storedCredential.privateKey
                  ? '已保存私钥，留空表示保持不变'
                  : undefined
              }
            >
              <Input
                placeholder="C:\\Certs\\admin.key"
                addonAfter={
                  <Button
                    size="small"
                    icon={<UploadOutlined />}
                    onClick={() =>
                      void handleSelectFile('privateKeyPath', [
                        { name: 'Private Keys', extensions: ['pem', 'key', 'ppk', 'txt'] },
                      ])
                    }
                  >
                    浏览
                  </Button>
                }
              />
            </Form.Item>
            <Form.Item label="CA 证书(可选)" name="caCertPath">
              <Input
                placeholder="C:\\Certs\\ca.crt"
                addonAfter={
                  <Button
                    size="small"
                    icon={<UploadOutlined />}
                    onClick={() =>
                      void handleSelectFile('caCertPath', [
                        { name: 'Certificates', extensions: ['crt', 'cer', 'pem'] },
                      ])
                    }
                  >
                    浏览
                  </Button>
                }
              />
            </Form.Item>
          </>
        )}

        {selectedFormAuthType === 'MultiFactor' && (
          <>
            <Form.Item
              label={t('devices.username')}
              name="username"
              rules={[{ required: true, message: t('devices.username') }]}
            >
              <Input placeholder="admin" />
            </Form.Item>
            <Form.Item
              label="密码(第一因素)"
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password />
            </Form.Item>
            <Form.Item label="私钥(第二因素, 可选)" name="privateKeyPath">
              <Input
                placeholder="C:\\Users\\admin\\.ssh\\id_rsa"
                addonAfter={
                  <Button
                    size="small"
                    icon={<UploadOutlined />}
                    onClick={() =>
                      void handleSelectFile('privateKeyPath', [
                        { name: 'Private Keys', extensions: ['pem', 'key', 'ppk', 'txt'] },
                      ])
                    }
                  >
                    浏览
                  </Button>
                }
              />
            </Form.Item>
            <Form.Item
              label="MFA 类型"
              name="mfaType"
              rules={[{ required: true, message: '请选择 MFA 类型' }]}
            >
              <Select>
                <Select.Option value="TOTP">TOTP (Google Authenticator)</Select.Option>
                <Select.Option value="SMS">SMS</Select.Option>
                <Select.Option value="Email">Email</Select.Option>
                <Select.Option value="Hardware">Hardware (YubiKey)</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item
              label="MFA 验证码"
              name="mfaCode"
              rules={[{ required: true, message: '请输入验证码' }]}
            >
              <Input placeholder="123456" maxLength={6} />
            </Form.Item>
          </>
        )}
      </Form>
    </Modal>
  );
};

export default DeviceModal;
