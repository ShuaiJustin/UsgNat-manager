import React, { useEffect, useState } from 'react';
import {
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  Switch,
  App,
  Divider,
  Checkbox,
  Button,
} from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Device } from '@/types';

interface DeviceModalProps {
  open: boolean;
  device: Device | null;
  onClose: () => void;
  onSuccess: () => void;
}

const DeviceModal: React.FC<DeviceModalProps> = ({ open, device, onClose, onSuccess }) => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const isEdit = !!device;
  const [authType, setAuthType] = useState<string>('Password');

  useEffect(() => {
    if (open) {
      if (device) {
        form.setFieldsValue(device);
      } else {
        form.resetFields();
        setAuthType('Password');
      }
    }
  }, [open, device, form]);

  // 创建设备
  const createMutation = useMutation({
    mutationFn: async (values: any) => {
      const api = (window as any).electronAPI;
      if (!api?.device?.create) {
        throw new Error('electronAPI 未就绪，无法创建设备');
      }
      return await api.device.create(values);
    },
    onError: (error: any) => {
      const errorMsg = error?.message || t('common.error');
      message.error(`创建设备失败: ${errorMsg}`);
    },
  });

  // 更新设备
  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: any }) => {
      const api = (window as any).electronAPI;
      if (!api?.device?.update) {
        throw new Error('electronAPI 未就绪，无法更新设备');
      }
      return await api.device.update(id, values);
    },
    onError: (error: any) => {
      const errorMsg = error?.message || t('common.error');
      message.error(`更新设备失败: ${errorMsg}`);
    },
  });

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();

      // 分离设备信息和凭据信息
      const {
        username,
        password,
        privateKeyPath,
        certificatePath,
        passphrase: _passphrase,
        mfaType,
        mfaCode: _mfaCode,
        caCertPath: _caCertPath,
        authType: _formAuthType,
        saveToCredentialManager: _saveToCredentialManager,
        ...deviceData
      } = values;

      let savedDeviceId = device?.id;
      let credentialSaveSuccess = true;

      if (isEdit && device) {
        await updateMutation.mutateAsync({ id: device.id, values: deviceData });
        savedDeviceId = device.id;
      } else {
        // 先创建设备
        const newDevice = await createMutation.mutateAsync(deviceData);
        savedDeviceId = newDevice.id;
      }

      // 保存凭据信息（如果有username和password）
      if (savedDeviceId && username && password) {
        try {
          const api = (window as any).electronAPI;
          if (!api?.credential?.save) {
            throw new Error('credential API 不可用');
          }
          await api.credential.save(savedDeviceId, {
            authType: authType as 'Password' | 'PrivateKey' | 'Certificate' | 'MultiFactor',
            username,
            password,
            privateKey: privateKeyPath,
            certificate: certificatePath,
            mfaType,
          });
        } catch (error: any) {
          credentialSaveSuccess = false;
          message.error(`凭据保存失败: ${error.message}`);
          // 凭据保存失败，不关闭对话框，让用户重试
          return;
        }
      }

      // 所有操作成功，刷新列表并关闭对话框
      onSuccess();
      onClose();

      // 显示最终成功消息
      if (credentialSaveSuccess) {
        message.success(isEdit ? '设备更新成功' : '设备添加成功');
      }

      // 自动测试连接并更新在线状态（延迟600ms确保凭据已保存）
      if (savedDeviceId) {
        setTimeout(async () => {
          try {
            const api = (window as any).electronAPI;
            if (api?.device?.testConnection) {
              // 静默测试（不显示loading，避免干扰用户）
              const result = await api.device.testConnection(savedDeviceId);

              if (result.success) {
                message.success(
                  `连接测试成功 - 延迟 ${result.latency}ms`
                );
              } else {
                message.warning(
                  `连接测试失败: ${result.message}`
                );
              }

              // 刷新设备列表以显示最新状态
              onSuccess();
            }
          } catch (error) {
            // 静默失败，不影响用户体验
            console.error('自动测试连接失败:', error);
          }
        }, 600);
      }
    } catch {
      // 表单验证失败，不需要额外处理
    }
  };

  const handleTestConnection = async () => {
    try {
      // 验证必填字段
      await form.validateFields(['host', 'port', 'username', 'password']);

      const values = form.getFieldsValue();
      const api = (window as any).electronAPI;

      if (!api?.device?.testDirectConnection) {
        message.error('API 未就绪');
        return;
      }

      const hideLoading = message.loading(t('common.loading'), 0);

      try {
        // 调用直接测试连接（不需要保存设备）
        const result = await api.device.testDirectConnection({
          host: values.host,
          port: values.port,
          username: values.username,
          password: values.password,
          privateKey: values.privateKeyPath,
          authType: authType,
        });

        hideLoading();

        if (result.success) {
          message.success(`${t('devices.connectionSuccess')}! ${result.latency}ms`);
        } else {
          message.error(`${t('devices.connectionFailed')}: ${result.message}`);
        }
      } catch (error: any) {
        hideLoading();
        message.error(`${t('common.error')}: ${error.message || t('common.error')}`);
      }
    } catch {
      message.warning(t('devices.credentials'));
    }
  };

  return (
    <Modal
      title={isEdit ? t('common.edit') + ' ' + t('devices.title') : t('devices.addDevice')}
      open={open}
      onOk={handleSubmit}
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
        <Button key="test" onClick={handleTestConnection}>
          {t('devices.testConnection')}
        </Button>,
        <Button key="cancel" onClick={onClose}>
          {t('common.cancel')}
        </Button>,
        <Button
          key="submit"
          type="primary"
          loading={createMutation.isPending || updateMutation.isPending}
          onClick={handleSubmit}
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
              validator: (_, value) => {
                if (!value) return Promise.resolve();
                // 支持IP地址
                const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
                // 支持域名
                const domainPattern = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
                // 支持localhost
                if (value === 'localhost' || ipPattern.test(value) || domainPattern.test(value)) {
                  // 对IP地址进行范围验证
                  if (ipPattern.test(value)) {
                    const parts = value.split('.').map(Number);
                    if (parts.some((part: number) => part < 0 || part > 255)) {
                      return Promise.reject(new Error('IP地址段必须在0-255之间'));
                    }
                  }
                  return Promise.resolve();
                }
                return Promise.reject(new Error('请输入有效的IP地址或域名'));
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
        >
          <Select>
            <Select.Option value="SSH">SSH</Select.Option>
            <Select.Option value="HTTPS">HTTPS</Select.Option>
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
          <Select onChange={(value) => setAuthType(value)}>
            <Select.Option value="Password">密码认证</Select.Option>
            <Select.Option value="PrivateKey">私钥认证</Select.Option>
            <Select.Option value="Certificate">证书认证</Select.Option>
            <Select.Option value="MultiFactor">多因子认证</Select.Option>
          </Select>
        </Form.Item>

        {/* 密码认证 */}
        {authType === 'Password' && (
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
              <Input.Password placeholder="••••••••" />
            </Form.Item>
            <Form.Item name="saveToCredentialManager" valuePropName="checked">
              <Checkbox>保存到Windows凭据管理器</Checkbox>
            </Form.Item>
          </>
        )}

        {/* 私钥认证 */}
        {authType === 'PrivateKey' && (
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
              rules={[{ required: true, message: '请选择私钥文件' }]}
            >
              <Input
                placeholder="C:\Users\admin\.ssh\id_rsa"
                addonAfter={
                  <Button size="small" icon={<UploadOutlined />}>
                    浏览
                  </Button>
                }
              />
            </Form.Item>
            <Form.Item label="私钥密码(可选)" name="passphrase">
              <Input.Password placeholder="••••••••" />
            </Form.Item>
          </>
        )}

        {/* 证书认证 */}
        {authType === 'Certificate' && (
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
              rules={[{ required: true, message: '请选择证书文件' }]}
            >
              <Input
                placeholder="C:\Certs\admin.crt"
                addonAfter={
                  <Button size="small" icon={<UploadOutlined />}>
                    浏览
                  </Button>
                }
              />
            </Form.Item>
            <Form.Item
              label="私钥文件"
              name="privateKeyPath"
              rules={[{ required: true, message: '请选择私钥文件' }]}
            >
              <Input
                placeholder="C:\Certs\admin.key"
                addonAfter={
                  <Button size="small" icon={<UploadOutlined />}>
                    浏览
                  </Button>
                }
              />
            </Form.Item>
            <Form.Item label="CA证书(可选)" name="caCertPath">
              <Input
                placeholder="C:\Certs\ca.crt"
                addonAfter={
                  <Button size="small" icon={<UploadOutlined />}>
                    浏览
                  </Button>
                }
              />
            </Form.Item>
          </>
        )}

        {/* 多因子认证 */}
        {authType === 'MultiFactor' && (
          <>
            <Form.Item
              label={t('devices.username')}
              name="username"
              rules={[{ required: true, message: t('devices.username') }]}
            >
              <Input placeholder="admin" />
            </Form.Item>
            <Form.Item
              label="密码(第一因子)"
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password placeholder="••••••••" />
            </Form.Item>
            <Form.Item label="私钥(第二因子,可选)" name="privateKeyPath">
              <Input
                placeholder="C:\Users\admin\.ssh\id_rsa"
                addonAfter={
                  <Button size="small" icon={<UploadOutlined />}>
                    浏览
                  </Button>
                }
              />
            </Form.Item>
            <Form.Item
              label="MFA类型"
              name="mfaType"
              rules={[{ required: true, message: '请选择MFA类型' }]}
            >
              <Select>
                <Select.Option value="TOTP">TOTP (Google Authenticator)</Select.Option>
                <Select.Option value="SMS">SMS</Select.Option>
                <Select.Option value="Email">Email</Select.Option>
                <Select.Option value="Hardware">Hardware (YubiKey)</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item
              label="MFA验证码"
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
