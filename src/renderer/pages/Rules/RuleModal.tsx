import React, { useEffect } from 'react';
import { App, Form, Input, Modal, Select, Switch } from 'antd';
import { useMutation } from '@tanstack/react-query';

import type { NatRule } from '@/types';

interface RuleModalProps {
  open: boolean;
  rule: NatRule | null;
  deviceId: string;
  onClose: () => void;
  onSuccess: () => void;
}

type RuleDraft = Partial<NatRule>;

type RuleUpdatePayload = {
  id: string;
  values: RuleDraft;
};

const RuleModal: React.FC<RuleModalProps> = ({ open, rule, deviceId, onClose, onSuccess }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const isEdit = !!rule;

  useEffect(() => {
    if (!open) {
      return;
    }

    if (rule) {
      form.setFieldsValue(rule);
    } else {
      form.resetFields();
    }
  }, [open, rule, form]);

  const createMutation = useMutation({
    mutationFn: (values: RuleDraft) => window.electronAPI.rule.create(deviceId, values),
    onSuccess: () => {
      message.success('规则创建成功');
      onSuccess();
      onClose();
    },
    onError: () => {
      message.error('规则创建失败');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: RuleUpdatePayload) => window.electronAPI.rule.update(id, values),
    onSuccess: () => {
      message.success('规则更新成功');
      onSuccess();
      onClose();
    },
    onError: () => {
      message.error('规则更新失败');
    },
  });

  const handleSubmit = async () => {
    try {
      const values = (await form.validateFields()) as RuleDraft;
      if (isEdit && rule) {
        updateMutation.mutate({ id: rule.id, values });
      } else {
        createMutation.mutate(values);
      }
    } catch (error) {
      console.error('表单验证失败:', error);
    }
  };

  return (
    <Modal
      title={isEdit ? '编辑规则' : '新增规则'}
      open={open}
      onOk={() => void handleSubmit()}
      onCancel={onClose}
      confirmLoading={createMutation.isPending || updateMutation.isPending}
      width={600}
      okText="保存"
      cancelText="取消"
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          protocol: 'TCP',
          enabled: true,
        }}
      >
        <Form.Item
          label="规则名称"
          name="ruleName"
          rules={[{ required: true, message: '请输入规则名称' }]}
        >
          <Input placeholder="例如: WEB_SERVER" />
        </Form.Item>

        <Form.Item label="协议" name="protocol" rules={[{ required: true, message: '请选择协议' }]}>
          <Select>
            <Select.Option value="TCP">TCP</Select.Option>
            <Select.Option value="UDP">UDP</Select.Option>
            <Select.Option value="ALL">ALL</Select.Option>
          </Select>
        </Form.Item>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Form.Item
            label="全局 IP"
            name="globalIp"
            rules={[
              { required: true, message: '请输入全局 IP' },
              {
                validator: (_, value: string) => {
                  if (!value) {
                    return Promise.resolve();
                  }

                  const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
                  if (!ipPattern.test(value)) {
                    return Promise.reject(new Error('请输入有效的 IP 地址'));
                  }

                  const parts = value.split('.').map(Number);
                  if (parts.some((part) => part < 0 || part > 255)) {
                    return Promise.reject(new Error('IP 地址段必须在 0-255 之间'));
                  }

                  return Promise.resolve();
                },
              },
            ]}
          >
            <Input placeholder="1.2.3.4" />
          </Form.Item>

          <Form.Item
            label="全局端口"
            name="globalPort"
            rules={[
              { required: true, message: '请输入全局端口' },
              {
                validator: (_, value: string) => {
                  if (!value) {
                    return Promise.resolve();
                  }

                  const port = Number(value);
                  if (Number.isNaN(port) || port < 1 || port > 65535) {
                    return Promise.reject(new Error('端口必须在 1-65535 之间'));
                  }

                  return Promise.resolve();
                },
              },
            ]}
          >
            <Input placeholder="8080" type="number" />
          </Form.Item>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Form.Item
            label="内部 IP"
            name="insideIp"
            rules={[
              { required: true, message: '请输入内部 IP' },
              {
                validator: (_, value: string) => {
                  if (!value) {
                    return Promise.resolve();
                  }

                  const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
                  if (!ipPattern.test(value)) {
                    return Promise.reject(new Error('请输入有效的 IP 地址'));
                  }

                  const parts = value.split('.').map(Number);
                  if (parts.some((part) => part < 0 || part > 255)) {
                    return Promise.reject(new Error('IP 地址段必须在 0-255 之间'));
                  }

                  return Promise.resolve();
                },
              },
            ]}
          >
            <Input placeholder="192.168.1.100" />
          </Form.Item>

          <Form.Item
            label="内部端口"
            name="insidePort"
            rules={[
              { required: true, message: '请输入内部端口' },
              {
                validator: (_, value: string) => {
                  if (!value) {
                    return Promise.resolve();
                  }

                  const port = Number(value);
                  if (Number.isNaN(port) || port < 1 || port > 65535) {
                    return Promise.reject(new Error('端口必须在 1-65535 之间'));
                  }

                  return Promise.resolve();
                },
              },
            ]}
          >
            <Input placeholder="80" type="number" />
          </Form.Item>
        </div>

        <Form.Item label="描述" name="description">
          <Input.TextArea rows={3} placeholder="规则描述信息，可选" />
        </Form.Item>

        <Form.Item label="启用规则" name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default RuleModal;
