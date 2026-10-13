import React, { useEffect, useState } from 'react';
import {
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

type SupportedAuthType = 'Password' | 'PrivateKey';

type DeviceFormValues = Partial<Device> & {
  authType?: SupportedAuthType;
  username?: string;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  saveToCredentialManager?: boolean;
};

type DeviceMutationPayload = {
  id: string;
  values: Partial<Device>;
};

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const getSupportedAuthType = (authType?: Credential['authType']): SupportedAuthType =>
  authType === 'PrivateKey' ? 'PrivateKey' : 'Password';

const DeviceModal: React.FC<DeviceModalProps> = ({ open, device, onClose, onSuccess }) => {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<DeviceFormValues>();
  const isEdit = !!device;
  const [authType, setAuthType] = useState<SupportedAuthType>('Password');
  const [storedCredential, setStoredCredential] = useState<Credential | null>(null);
  const selectedConnectionType = Form.useWatch('connectionType', form) || 'SSH';
  const selectedFormAuthType = Form.useWatch('authType', form) || authType;

  const showFirstTrust = (
    deviceId: string | undefined,
    hostKey?: { fingerprint: string; host: string; port: number; changed: boolean }
  ) => {
    if (!hostKey) return;
    if (hostKey.changed) {
      message.error('SSH主机指纹已变化，连接已拒绝。请管理员核查，禁止直接覆盖信任。');
      return;
    }
    if (!deviceId) {
      message.info('临时连接已拒绝未知主机。请先保存设备，再测试连接并核对首次主机指纹。');
      return;
    }
    modal.confirm({
      title: '首次信任 SSH 主机',
      content: (
        <div>
          <p>连接已拒绝。请通过设备控制台等可信渠道核对以下指纹；确认表示管理员已完成核对。</p>
          <p>
            {hostKey.host}:{hostKey.port}
          </p>
          <code style={{ wordBreak: 'break-all' }}>{hostKey.fingerprint}</code>
        </div>
      ),
      okText: '已核对指纹，信任此设备',
      cancelText: '取消',
      onOk: async () => {
        const trust = await window.electronAPI.device.trustHostKey(deviceId, hostKey.fingerprint);
        if (!trust.success) {
          message.error(trust.message);
          return Promise.reject(new Error(trust.message));
        }
        message.info(trust.message);
        onSuccess();
      },
    });
  };

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
        passphrase: undefined,
      });

      const api = window.electronAPI;
      const credential = api?.credential?.get ? await api.credential.get(device.id) : null;
      if (!isActive) {
        return;
      }

      setStoredCredential(credential);

      const nextAuthType = getSupportedAuthType(credential?.authType);
      setAuthType(nextAuthType);
      form.setFieldsValue({
        authType: nextAuthType,
        username: credential?.username,
        password: credential?.password,
        passphrase: credential?.passphrase,
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
    fieldName: 'privateKeyPath',
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
        passphrase,
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
          passphrase,
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
                  showFirstTrust(savedDeviceId, result.hostKey);
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

      const fieldsToValidate = getFieldsToValidate(values, selectedAuthType, storedCredential);
      await form.validateFields(fieldsToValidate);

      if (!api?.device?.testDirectConnection) {
        message.error('API 未就绪');
        return;
      }

      const hideLoading = message.loading(t('common.loading'), 0);

      try {
        const result = await api.device.testDirectConnection({
          deviceId: device?.id,
          connectionType: selectedConnectionTypeValue,
          host: values.host || '',
          port: values.port || 22,
          username: values.username || storedCredential?.username,
          password: values.password || storedCredential?.password,
          privateKeyPath: values.privateKeyPath,
          privateKey: values.privateKeyPath ? undefined : storedCredential?.privateKey,
          passphrase: values.passphrase ?? storedCredential?.passphrase,
          authType: selectedAuthType,
        });

        hideLoading();

        if (result.success) {
          message.success(`${t('devices.connectionSuccess')}! ${result.latency}ms`);
        } else {
          message.error(`${t('devices.connectionFailed')}: ${result.message}`);
          showFirstTrust(device?.id, result.hostKey);
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

        <Form.Item label={t('devices.description')} name="description">
          <Input.TextArea rows={3} placeholder={t('devices.description')} />
        </Form.Item>

        <Form.Item label="启用设备" name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>

        <Divider orientation="left">认证信息</Divider>

        <Form.Item label="认证方式" name="authType" initialValue="Password">
          <Select onChange={(value: SupportedAuthType) => setAuthType(value)}>
            <Select.Option value="Password">密码认证</Select.Option>
            <Select.Option value="PrivateKey">私钥认证</Select.Option>
          </Select>
        </Form.Item>

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
              <Checkbox disabled checked>
                保存为本机加密凭据
              </Checkbox>
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
      </Form>
    </Modal>
  );
};

export default DeviceModal;
