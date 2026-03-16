import React, { useState } from 'react';
import {
  Card,
  Form,
  Switch,
  InputNumber,
  Checkbox,
  Radio,
  TimePicker,
  Button,
  Space,
  Input,
  Select,
  Divider,
  Alert,
  Row,
  Col,
  Statistic,
  Tabs,
  App,
  Modal,
} from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  BellOutlined,
  ThunderboltOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs, { type Dayjs } from 'dayjs';

const parseScheduledTime = (value: unknown): Dayjs | null => {
  if (!value) {
    return null;
  }

  if (dayjs.isDayjs(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    const matchedTime = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(trimmedValue);

    if (matchedTime) {
      const [, hour, minute] = matchedTime;
      return dayjs().hour(Number(hour)).minute(Number(minute)).second(0).millisecond(0);
    }

    const parsedValue = dayjs(trimmedValue);
    return parsedValue.isValid() ? parsedValue : null;
  }

  return null;
};

const formatScheduledTime = (value: unknown): string | undefined => {
  const parsedValue = parseScheduledTime(value);
  return parsedValue ? parsedValue.format('HH:mm') : undefined;
};

const ensureIpcSuccess = (result: any, fallbackMessage: string) => {
  if (result && typeof result === 'object' && 'success' in result && result.success === false) {
    throw new Error(result.error || result.message || fallbackMessage);
  }

  return result;
};

const Automation: React.FC = () => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [emailNotifyEnabled, setEmailNotifyEnabled] = useState(false);
  const [wechatNotifyEnabled, setWechatNotifyEnabled] = useState(false);
  const [wechatType, setWechatType] = useState('work');
  const [devices, setDevices] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [smtpPasswordVisible, setSmtpPasswordVisible] = useState(true);
  const [formValues, setFormValues] = useState<any>({
    ipMonitorEnabled: true,
    checkInterval: 5,
    confirmCount: 3,
    autoUpdateEnabled: false,
    triggerType: 'immediate',
    windowsNotifyEnabled: true,
    notifyTypes: ['ipChange', 'updateSuccess', 'updateFailed'],
    smtpPort: '465',
  });

  // 监听手动确认请求
  React.useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.automation?.onConfirmRequest) return;

    const handleConfirmRequest = (data: { newIP: string; deviceCount: number }) => {
      Modal.confirm({
        title: '确认自动更新NAT规则',
        icon: <ExclamationCircleOutlined style={{ color: '#1890ff' }} />,
        width: 520,
        content: (
          <div>
            <p style={{ marginBottom: 16 }}>
              检测到IP地址变化，系统准备自动更新NAT规则。
            </p>
            <div style={{ background: '#f0f7ff', padding: 12, borderRadius: 4, marginBottom: 16 }}>
              <p style={{ margin: 0, fontWeight: 'bold' }}>更新信息：</p>
              <ul style={{ marginBottom: 0, marginTop: 8 }}>
                <li>新IP地址: <strong style={{ color: '#1890ff' }}>{data.newIP}</strong></li>
                <li>更新设备数量: <strong>{data.deviceCount}</strong> 个</li>
              </ul>
            </div>
            <p style={{ color: '#666', fontSize: 12, marginBottom: 0 }}>
              点击"确认"继续更新，或点击"取消"跳过本次更新
            </p>
          </div>
        ),
        okText: '确认更新',
        cancelText: '取消',
        okType: 'primary',
        onOk: async () => {
          if (api?.automation?.confirmResponse) {
            ensureIpcSuccess(await api.automation.confirmResponse(true), '确认自动更新失败');
            message.success('已确认，开始更新...');
          }
        },
        onCancel: async () => {
          if (api?.automation?.confirmResponse) {
            ensureIpcSuccess(await api.automation.confirmResponse(false), '取消自动更新失败');
            message.info('已取消更新');
          }
        },
      });
    };

    api.automation.onConfirmRequest(handleConfirmRequest);

    return () => {
      if (api?.automation?.removeConfirmRequestListener) {
        api.automation.removeConfirmRequestListener(handleConfirmRequest);
      }
    };
  }, []);

  // 加载设备列表和配置
  React.useEffect(() => {
    const loadData = async () => {
      try {
        const api = (window as any).electronAPI;
        if (!api) return;

        // 加载设备列表
        if (api.device?.getAll) {
          const deviceList = await api.device.getAll();
          setDevices(deviceList.filter((d: any) => d.enabled));
        }

        if (!api.config?.get) return;

        // 加载自动化配置
        const automationConfig = await api.config.get('automation');
        if (automationConfig) {
          // 从 automation 配置加载邮件通知状态
          if (automationConfig.emailNotifyEnabled !== undefined) {
            setEmailNotifyEnabled(automationConfig.emailNotifyEnabled);
          }
          // 加载微信通知状态
          if (automationConfig.wechatNotifyEnabled !== undefined) {
            setWechatNotifyEnabled(automationConfig.wechatNotifyEnabled);
          }
          if (automationConfig.wechatType) {
            setWechatType(automationConfig.wechatType);
          }

          form.setFieldsValue({
            // IP监控设置
            ipMonitorEnabled: automationConfig.ipMonitorEnabled,
            checkInterval: automationConfig.checkInterval,
            confirmCount: automationConfig.confirmCount,
            checkSources: automationConfig.checkSources,
            // 自动更新策略
            autoUpdateEnabled: automationConfig.autoUpdateEnabled !== undefined ? automationConfig.autoUpdateEnabled : false,
            triggerType: automationConfig.triggerType,
            delayMinutes: automationConfig.delayMinutes,
            scheduledTime: parseScheduledTime(automationConfig.scheduledTime),
            selectedDevices: automationConfig.selectedDevices,
            backupOptions: automationConfig.backupOptions,
            backupKeepCount: automationConfig.backupKeepCount,
            securityOptions: automationConfig.securityOptions,
            // 通知设置
            windowsNotifyEnabled: automationConfig.windowsNotifyEnabled,
            notifyTypes: automationConfig.notifyTypes || [
              'ipChange',
              'updateSuccess',
              'updateFailed',
            ],
            // 邮件配置字段
            smtpServer: automationConfig.smtpServer,
            smtpPort: automationConfig.smtpPort,
            smtpEncryption: automationConfig.smtpEncryption,
            smtpUsername: automationConfig.smtpUsername,
            smtpPassword: automationConfig.smtpPassword,
            senderEmail: automationConfig.senderEmail,
            senderName: automationConfig.senderName,
            recipientEmails: automationConfig.recipientEmails,
            emailNotifyTypes: automationConfig.emailNotifyTypes,
            // 微信通知配置
            wechatType: automationConfig.wechatType,
            corpId: automationConfig.corpId,
            corpSecret: automationConfig.corpSecret,
            agentId: automationConfig.agentId,
            webhookUrl: automationConfig.webhookUrl,
            appId: automationConfig.appId,
            appSecret: automationConfig.appSecret,
            templateId: automationConfig.templateId,
          });
        }

        // 加载邮件配置（email配置优先，如果不存在则使用上面从automation加载的值）
        const emailConfig = await api.config.get('email');
        if (emailConfig) {
          // email 配置中的 enabled 状态优先
          setEmailNotifyEnabled(emailConfig.enabled || false);
          // 只有当 email 配置存在且有 host 时才覆盖表单值
          if (emailConfig.host) {
            form.setFieldsValue({
              smtpServer: emailConfig.host,
              smtpPort: String(emailConfig.port || 465),
              smtpUsername: emailConfig.auth?.user || '',
              smtpPassword: emailConfig.auth?.pass || '',
              senderEmail: emailConfig.from?.address || '',
              senderName: emailConfig.from?.name || '',
              recipientEmails: emailConfig.to?.join(', ') || '',
              emailNotifyTypes: emailConfig.notifyTypes || [],
            });
          }
        }
      } catch {
        // 加载数据失败，静默失败
      }
    };
    loadData();
  }, [form]);

  const handleSave = async () => {
    try {
      setLoading(true);
      const values = await form.validateFields();
      const api = (window as any).electronAPI;

      if (!api?.config?.save) {
        throw new Error('config API 未就绪');
      }

      // 准备完整的自动化配置，包含所有字段和状态
      const scheduledTime = formatScheduledTime(values.scheduledTime);
      const automationConfig = {
        ...values,
        scheduledTime,
        // 确保所有开关状态被保存
        emailNotifyEnabled: emailNotifyEnabled,
        wechatNotifyEnabled: wechatNotifyEnabled,
        wechatType: wechatType,
      };

      // 保存自动化配置（包含所有表单字段）
      ensureIpcSuccess(await api.config.save('automation', automationConfig), '保存自动化配置失败');

      // 同时保存邮件配置到独立的 email 配置项
      // 无论开关状态都保存，方便用户下次启用时使用
      const emailConfig = {
        enabled: emailNotifyEnabled,
        host: values.smtpServer || '',
        port: parseInt(values.smtpPort) || 465,
        secure: values.smtpPort === '465',
        auth: {
          user: values.smtpUsername || '',
          pass: values.smtpPassword || '',
        },
        from: {
          name: values.senderName || 'USG NAT管理系统',
          address: values.senderEmail || '',
        },
        to:
          values.recipientEmails
            ?.split(',')
            .map((e: string) => e.trim())
            .filter((e: string) => e) || [],
        notifyTypes: values.emailNotifyTypes || [],
      };

      // 保存邮件配置（必须保存，否则重启后丢失）
      if (api?.email?.configure) {
        ensureIpcSuccess(await api.email.configure(emailConfig), '保存邮件配置失败');
      } else if (api?.config?.save) {
        // 如果 email.configure 不可用，直接保存到配置
        ensureIpcSuccess(await api.config.save('email', emailConfig), '保存邮件配置失败');
      }

      // 获取服务状态
      const status = api.automation?.getStatus ? await api.automation.getStatus() : null;

      if (values.ipMonitorEnabled) {
        // 验证是否选择了设备
        if (
          values.autoUpdateEnabled &&
          (!values.selectedDevices || values.selectedDevices.length === 0)
        ) {
          message.warning(t('automation.selectDevices'));
          return;
        }

        // 完整的自动化服务配置（包含IP监控配置）
        const scheduledTimeStr = scheduledTime;

        const automationServiceConfig = {
          enabled: true,
          autoUpdateEnabled: values.autoUpdateEnabled,
          triggerType: values.triggerType,
          delayMinutes: values.delayMinutes || 5,
          scheduledTime: scheduledTimeStr,
          selectedDevices: values.selectedDevices || [],
          // IP监控配置
          checkInterval: values.checkInterval || 5,
          confirmCount: values.confirmCount || 3,
          checkSources: values.checkSources || ['cip', 'ipip', 'ip138', 'ip.sb'],
          // 备份策略
          backupOptions: values.backupOptions || [],
          backupKeepCount: values.backupKeepCount || 10,
          // 安全选项
          securityOptions: values.securityOptions || [],
        };

        if (status?.isMonitoring) {
          // 服务已运行，只更新配置（如果有 updateConfig 接口）
          if (api.automation?.updateConfig) {
            ensureIpcSuccess(
              await api.automation.updateConfig(automationServiceConfig),
              '更新自动化服务配置失败'
            );
            message.success(t('common.success'));
          } else {
            // 没有 updateConfig 接口，提示用户需要重启服务
            message.success(t('common.success'));
          }
        } else {
          // 服务未运行，启动服务
          if (api.automation?.start) {
            ensureIpcSuccess(
              await api.automation.start(automationServiceConfig),
              '启动自动化服务失败'
            );
            message.success(t('common.success'));
          }
        }
      } else {
        // 禁用监控，停止服务
        if (status?.isMonitoring && api.automation?.stop) {
          ensureIpcSuccess(await api.automation.stop(), '停止自动化服务失败');
          message.success(t('common.success'));
        } else {
          message.success(t('common.success'));
        }
      }
      // 保存成功后清除未保存标记并隐藏密码
      setHasUnsavedChanges(false);
      setSmtpPasswordVisible(false);
    } catch (error: any) {
      message.error(t('common.error') + ': ' + (error.message || t('common.error')));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Form
        form={form}
        layout="vertical"
        onValuesChange={(_changedValues, allValues) => {
          setHasUnsavedChanges(true);
          setFormValues(allValues);
        }}
        initialValues={{
          ipMonitorEnabled: true,
          checkInterval: 5,
          confirmCount: 3,
          checkSources: ['cip', 'ipip', 'ip138', 'ip.sb'], // IP检测源默认值（与后端一致）
          autoUpdateEnabled: false,
          triggerType: 'immediate',
          selectedDevices: [],
          backupOptions: [],
          backupKeepCount: 10,
          securityOptions: [],
          windowsNotifyEnabled: true,
          notifyTypes: ['ipChange', 'updateSuccess', 'updateFailed'], // 通知类型默认值
          smtpPort: '465', // 邮件默认端口
        }}
        onFieldsChange={() => {
          // 同步更新 formValues
          setFormValues(form.getFieldsValue());
        }}
      >
        {/* 区域1: 顶部状态卡片 */}
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title={t('automation.ipMonitoring')}
                value={
                  formValues.ipMonitorEnabled !== false
                    ? t('automation.running')
                    : t('automation.stopped')
                }
                prefix={<CheckCircleOutlined />}
                valueStyle={{
                  fontSize: 16,
                  color: formValues.ipMonitorEnabled !== false ? '#52c41a' : '#999',
                }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title={t('automation.checkInterval')}
                value={formValues.checkInterval || 5}
                suffix={t('automation.checkIntervalUnit')}
                prefix={<ClockCircleOutlined />}
                valueStyle={{ fontSize: 16 }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title={t('automation.autoUpdate')}
                value={
                  formValues.autoUpdateEnabled === true
                    ? t('automation.running')
                    : t('automation.stopped')
                }
                prefix={<ThunderboltOutlined />}
                valueStyle={{
                  fontSize: 16,
                  color: formValues.autoUpdateEnabled === true ? '#1890ff' : '#999',
                }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title={t('automation.serviceStatus')}
                value={
                  formValues.windowsNotifyEnabled || emailNotifyEnabled
                    ? t('automation.running')
                    : t('automation.stopped')
                }
                prefix={<BellOutlined />}
                valueStyle={{
                  fontSize: 16,
                  color: formValues.windowsNotifyEnabled || emailNotifyEnabled ? '#faad14' : '#999',
                }}
              />
            </Card>
          </Col>
        </Row>

        {/* 标签页内容区域 */}
        <Tabs
          defaultActiveKey="1"
          size="large"
          tabBarExtraContent={
            <Space direction="vertical" align="end" style={{ gap: 8 }}>
              {hasUnsavedChanges && (
                <Alert
                  message={t('settings.unsavedChanges')}
                  type="warning"
                  showIcon
                  closable
                  onClose={() => setHasUnsavedChanges(false)}
                  style={{ marginBottom: 0 }}
                />
              )}
              <Space>
                <Button onClick={() => form.resetFields()} disabled={loading}>
                  {t('common.reset')}
                </Button>
                <Button type="primary" onClick={handleSave} loading={loading}>
                  {t('settings.saveSettings')}
                </Button>
              </Space>
            </Space>
          }
          items={[
            {
              key: '1',
              label: t('automation.ipMonitoring'),
              children: (
                <>
                  {/* IP监控设置 */}
                  <Card title={t('automation.ipMonitoring')} style={{ marginBottom: 24 }}>
                    <Form.Item
                      label={t('automation.enableMonitoring')}
                      name="ipMonitorEnabled"
                      valuePropName="checked"
                    >
                      <Switch />
                    </Form.Item>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <Form.Item
                        label={t('automation.checkInterval')}
                        name="checkInterval"
                        rules={[{ required: true }]}
                        extra="建议: 5-30分钟"
                      >
                        <InputNumber min={1} max={60} style={{ width: '100%' }} />
                      </Form.Item>

                      <Form.Item
                        label={t('automation.confirmCount')}
                        name="confirmCount"
                        rules={[{ required: true }]}
                        extra="连续检测到相同IP后确认变更"
                      >
                        <InputNumber min={1} max={10} style={{ width: '100%' }} />
                      </Form.Item>
                    </div>

                    <Form.Item label={t('automation.checkSources')} name="checkSources" extra="选择用于检测公网IP的数据源（建议保持默认）">
                      <Checkbox.Group
                        options={[
                          { label: 'cip.cc', value: 'cip' },
                          { label: 'ipip.net', value: 'ipip' },
                          { label: 'ip138.com', value: 'ip138' },
                          { label: 'ip.sb', value: 'ip.sb' },
                          { label: 'icanhazip.com', value: 'icanhazip' },
                        ]}
                      />
                    </Form.Item>
                  </Card>
                </>
              ),
            },
            {
              key: '2',
              label: t('automation.autoUpdate'),
              children: (
                <>
                  {/* 自动更新策略 */}
                  <Card title={t('automation.autoUpdate')}>
                    <Form.Item
                      label={t('automation.enableAutoUpdate')}
                      name="autoUpdateEnabled"
                      valuePropName="checked"
                    >
                      <Switch />
                    </Form.Item>

                    <Form.Item
                      label={t('automation.selectDevices')}
                      name="selectedDevices"
                      extra="勾选需要自动更新NAT规则的设备"
                    >
                      <Checkbox.Group style={{ width: '100%' }}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          {devices.length === 0 ? (
                            <div style={{ color: '#999' }}>{t('common.loading')}</div>
                          ) : (
                            devices.map((device) => (
                              <Checkbox key={device.id} value={device.id}>
                                <span style={{ fontWeight: 500 }}>{device.name}</span>
                                <span style={{ marginLeft: 8, color: '#666' }}>
                                  ({device.host})
                                </span>
                                {device.online && (
                                  <span style={{ marginLeft: 8, color: '#52c41a' }}>
                                    ● {t('devices.online')}
                                  </span>
                                )}
                              </Checkbox>
                            ))
                          )}
                        </Space>
                      </Checkbox.Group>
                    </Form.Item>

                    <Form.Item label={t('automation.triggerType')} name="triggerType">
                      <Radio.Group>
                        <Space direction="vertical">
                          <Radio value="immediate">{t('automation.immediate')}</Radio>
                          <Radio value="delayed">{t('automation.delayed')}</Radio>
                          <Radio value="scheduled">{t('automation.scheduled')}</Radio>
                        </Space>
                      </Radio.Group>
                    </Form.Item>

                    <Form.Item
                      noStyle
                      shouldUpdate={(prev, curr) => prev.triggerType !== curr.triggerType}
                    >
                      {({ getFieldValue }) =>
                        getFieldValue('triggerType') === 'delayed' ? (
                          <Form.Item
                            label={t('automation.delayTime')}
                            name="delayMinutes"
                            rules={[{ required: true, message: '请输入延迟时间' }]}
                            extra="建议: 1-60分钟"
                          >
                            <InputNumber min={1} max={60} placeholder="5" style={{ width: 200 }} />
                          </Form.Item>
                        ) : null
                      }
                    </Form.Item>

                    <Form.Item
                      noStyle
                      shouldUpdate={(prev, curr) => prev.triggerType !== curr.triggerType}
                    >
                      {({ getFieldValue }) =>
                        getFieldValue('triggerType') === 'scheduled' ? (
                          <Form.Item
                            label={t('automation.scheduledTime')}
                            name="scheduledTime"
                            rules={[{ required: true, message: '请选择更新时间' }]}
                          >
                            <TimePicker format="HH:mm" style={{ width: 200 }} />
                          </Form.Item>
                        ) : null
                      }
                    </Form.Item>

                    <Form.Item label="备份策略" name="backupOptions">
                      <Checkbox.Group>
                        <Space direction="vertical">
                          <Checkbox value="autoBackup">更新前自动备份配置</Checkbox>
                          <Checkbox value="keepBackups">保留最近N个备份</Checkbox>
                          <Checkbox value="autoRollback">更新失败时自动回滚</Checkbox>
                        </Space>
                      </Checkbox.Group>
                    </Form.Item>

                    <Form.Item
                      noStyle
                      shouldUpdate={(prev, curr) => prev.backupOptions !== curr.backupOptions}
                    >
                      {({ getFieldValue }) =>
                        getFieldValue('backupOptions')?.includes('keepBackups') ? (
                          <Form.Item
                            label="保留备份数量"
                            name="backupKeepCount"
                            extra="保留最近N个设备配置备份"
                            initialValue={10}
                          >
                            <InputNumber min={1} max={50} style={{ width: 200 }} />
                          </Form.Item>
                        ) : null
                      }
                    </Form.Item>

                    <Form.Item label="安全选项" name="securityOptions">
                      <Checkbox.Group>
                        <Space direction="vertical">
                          <Checkbox value="verifyRules">更新后验证规则生效</Checkbox>
                          <Checkbox value="integrityCheck">执行完整性检查</Checkbox>
                          <Checkbox value="manualConfirm">更新前需要手动确认</Checkbox>
                        </Space>
                      </Checkbox.Group>
                    </Form.Item>
                  </Card>
                </>
              ),
            },
            {
              key: '3',
              label: t('automation.notificationManagement'),
              children: (
                <>
                  <Card title={t('automation.notificationManagement')}>
                    {/* Windows通知 */}
                    <Form.Item
                      label="Windows通知"
                      name="windowsNotifyEnabled"
                      valuePropName="checked"
                    >
                      <Switch />
                    </Form.Item>

                    <Form.Item label="通知类型" name="notifyTypes">
                      <Checkbox.Group
                        options={[
                          { label: 'IP变化通知', value: 'ipChange' },
                          { label: '更新成功通知', value: 'updateSuccess' },
                          { label: '更新失败通知', value: 'updateFailed' },
                          { label: '设备离线通知', value: 'deviceOffline' },
                        ]}
                      />
                    </Form.Item>

                    <Divider />

                    {/* 邮件通知 */}
                    <Form.Item label="邮件通知">
                      <Switch checked={emailNotifyEnabled} onChange={setEmailNotifyEnabled} />
                    </Form.Item>

                    {emailNotifyEnabled && (
                      <div
                        style={{
                          marginTop: 15,
                          padding: 15,
                          background: '#f5f5f5',
                          borderRadius: 6,
                        }}
                      >
                        <h4 style={{ marginBottom: 15, fontSize: 14 }}>SMTP服务器配置</h4>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                          <Form.Item
                            label="SMTP服务器"
                            name="smtpServer"
                            rules={[{ required: emailNotifyEnabled }]}
                          >
                            <Input placeholder="smtp.example.com" />
                          </Form.Item>
                          <Form.Item
                            label="端口"
                            name="smtpPort"
                            rules={[{ required: emailNotifyEnabled }]}
                          >
                            <Select>
                              <Select.Option value="25">25 (SMTP)</Select.Option>
                              <Select.Option value="465">465 (SSL)</Select.Option>
                              <Select.Option value="587">587 (TLS)</Select.Option>
                            </Select>
                          </Form.Item>
                        </div>

                        <Form.Item label="加密方式" name="smtpEncryption">
                          <Radio.Group>
                            <Radio value="none">无加密</Radio>
                            <Radio value="ssl">SSL/TLS</Radio>
                            <Radio value="starttls">STARTTLS</Radio>
                          </Radio.Group>
                        </Form.Item>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                          <Form.Item
                            label="发件人邮箱"
                            name="senderEmail"
                            rules={[{ required: emailNotifyEnabled, type: 'email' }]}
                          >
                            <Input placeholder="sender@example.com" />
                          </Form.Item>
                          <Form.Item label="发件人名称" name="senderName">
                            <Input placeholder="USG NAT管理系统" />
                          </Form.Item>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                          <Form.Item
                            label="SMTP用户名"
                            name="smtpUsername"
                            rules={[{ required: emailNotifyEnabled }]}
                          >
                            <Input placeholder="username@example.com" />
                          </Form.Item>
                          <Form.Item
                            label="SMTP密码"
                            name="smtpPassword"
                            rules={[{ required: emailNotifyEnabled }]}
                          >
                            <div style={{ position: 'relative' }}>
                              <Input
                                type={smtpPasswordVisible ? 'text' : 'password'}
                                placeholder="请输入SMTP密码"
                                autoComplete="off"
                                onFocus={() => setSmtpPasswordVisible(true)}
                                onChange={() => {
                                  if (!smtpPasswordVisible) {
                                    setSmtpPasswordVisible(true);
                                  }
                                }}
                              />
                              {!smtpPasswordVisible && form.getFieldValue('smtpPassword') && (
                                <div
                                  onClick={() => setSmtpPasswordVisible(true)}
                                  style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    bottom: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    paddingLeft: 11,
                                    backgroundColor: 'white',
                                    cursor: 'pointer',
                                    color: '#999',
                                    border: '1px solid #d9d9d9',
                                    borderRadius: 6,
                                    fontSize: 14,
                                  }}
                                >
                                  ••••••••
                                </div>
                              )}
                            </div>
                          </Form.Item>
                        </div>

                        <Form.Item
                          label="收件人邮箱"
                          name="recipientEmails"
                          rules={[{ required: emailNotifyEnabled }]}
                          extra="支持多个收件人,用逗号分隔"
                        >
                          <Input placeholder="admin@example.com (多个邮箱用逗号分隔)" />
                        </Form.Item>

                        <Form.Item label="通知类型" name="emailNotifyTypes">
                          <Checkbox.Group
                            options={[
                              { label: 'IP变化通知', value: 'ipChange' },
                              { label: '更新成功通知', value: 'updateSuccess' },
                              { label: '更新失败通知', value: 'updateFailed' },
                              { label: '设备离线通知', value: 'deviceOffline' },
                              { label: '每日汇总报告', value: 'dailyReport' },
                            ]}
                          />
                        </Form.Item>

                        <Button
                          onClick={async () => {
                            try {
                              // 检查开关
                              if (!emailNotifyEnabled) {
                                message.warning(t('common.warning'));
                                return;
                              }

                              // 获取表单值（不验证，让后端报具体错误）
                              const values = form.getFieldsValue();

                              // 基本字段检查
                              if (!values.smtpServer) {
                                message.error(t('common.error'));
                                return;
                              }
                              if (!values.smtpUsername) {
                                message.error(t('common.error'));
                                return;
                              }
                              if (!values.smtpPassword) {
                                message.error(t('common.error'));
                                return;
                              }
                              if (!values.senderEmail) {
                                message.error(t('common.error'));
                                return;
                              }
                              if (!values.recipientEmails) {
                                message.error(t('common.error'));
                                return;
                              }

                              const api = (window as any).electronAPI;
                              if (!api?.email?.sendTestWithConfig) {
                                message.error(t('common.error'));
                                return;
                              }

                              // 构建测试配置
                              const testConfig = {
                                enabled: true,
                                host: values.smtpServer.trim(),
                                port: parseInt(values.smtpPort || '465'),
                                secure: (values.smtpPort || '465') === '465',
                                auth: {
                                  user: values.smtpUsername.trim(),
                                  pass: values.smtpPassword,
                                },
                                from: {
                                  name: values.senderName?.trim() || 'USG NAT管理系统',
                                  address: values.senderEmail.trim(),
                                },
                                to: values.recipientEmails
                                  .split(',')
                                  .map((e: string) => e.trim())
                                  .filter((e: string) => e && e.includes('@')),
                              };

                              // 验证收件人
                              if (testConfig.to.length === 0) {
                                message.error(t('common.error'));
                                return;
                              }

                              console.log('发送测试邮件，配置:', {
                                host: testConfig.host,
                                port: testConfig.port,
                                secure: testConfig.secure,
                                from: testConfig.from,
                                to: testConfig.to,
                              });

                              message.loading({
                                content: t('common.loading'),
                                key: 'testEmail',
                                duration: 0,
                              });

                              const result = await api.email.sendTestWithConfig(testConfig);

                              console.log('测试邮件结果:', result);

                              if (result.success) {
                                message.success({
                                  content: `${t('common.success')}! ${testConfig.to.join(', ')}`,
                                  key: 'testEmail',
                                  duration: 5,
                                });
                              } else {
                                const errorMsg = result.error || '未知错误';
                                message.error({
                                  content: (
                                    <div>
                                      <div>{t('common.error')}</div>
                                      <div style={{ fontSize: 12, marginTop: 4 }}>{errorMsg}</div>
                                    </div>
                                  ),
                                  key: 'testEmail',
                                  duration: 8,
                                });
                                console.error('邮件发送失败:', errorMsg);
                              }
                            } catch (error: any) {
                              console.error('测试邮件异常:', error);
                              message.error({
                                content: `${t('common.error')}: ${error.message || t('common.error')}`,
                                key: 'testEmail',
                                duration: 6,
                              });
                            }
                          }}
                        >
                          发送测试邮件
                        </Button>
                      </div>
                    )}

                    <Divider />

                    {/* 微信通知 */}
                    <Form.Item label="微信通知" extra="需要配置企业微信或微信公众号">
                      <Switch checked={wechatNotifyEnabled} onChange={setWechatNotifyEnabled} />
                    </Form.Item>

                    {wechatNotifyEnabled && (
                      <div
                        style={{
                          marginTop: 15,
                          padding: 15,
                          background: '#f5f5f5',
                          borderRadius: 6,
                        }}
                      >
                        <h4 style={{ marginBottom: 15, fontSize: 14 }}>微信通知配置</h4>

                        <Form.Item label="通知方式" name="wechatType">
                          <Select value={wechatType} onChange={setWechatType}>
                            <Select.Option value="work">企业微信</Select.Option>
                            <Select.Option value="webhook">企业微信机器人(Webhook)</Select.Option>
                            <Select.Option value="official">微信公众号</Select.Option>
                          </Select>
                        </Form.Item>

                        {wechatType === 'work' && (
                          <>
                            <Form.Item
                              label="企业ID"
                              name="corpId"
                              rules={[{ required: wechatNotifyEnabled }]}
                            >
                              <Input placeholder="ww1234567890abcdef" />
                            </Form.Item>
                            <Form.Item
                              label="应用Secret"
                              name="corpSecret"
                              rules={[{ required: wechatNotifyEnabled }]}
                            >
                              <Input.Password placeholder="••••••••" />
                            </Form.Item>
                            <Form.Item
                              label="应用AgentId"
                              name="agentId"
                              rules={[{ required: wechatNotifyEnabled }]}
                            >
                              <Input placeholder="1000002" />
                            </Form.Item>
                          </>
                        )}

                        {wechatType === 'webhook' && (
                          <Form.Item
                            label="Webhook URL"
                            name="webhookUrl"
                            rules={[{ required: wechatNotifyEnabled, type: 'url' }]}
                            extra="在企业微信群聊中添加机器人获取"
                          >
                            <Input placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." />
                          </Form.Item>
                        )}

                        {wechatType === 'official' && (
                          <>
                            <Form.Item
                              label="AppID"
                              name="appId"
                              rules={[{ required: wechatNotifyEnabled }]}
                            >
                              <Input placeholder="wx1234567890abcdef" />
                            </Form.Item>
                            <Form.Item
                              label="AppSecret"
                              name="appSecret"
                              rules={[{ required: wechatNotifyEnabled }]}
                            >
                              <Input.Password placeholder="••••••••" />
                            </Form.Item>
                            <Form.Item
                              label="模板ID"
                              name="templateId"
                              rules={[{ required: wechatNotifyEnabled }]}
                            >
                              <Input placeholder="template_id_xxxxx" />
                            </Form.Item>
                          </>
                        )}

                        <Button
                          onClick={() => {
                            message.info(t('common.info'));
                          }}
                        >
                          发送测试消息
                        </Button>
                      </div>
                    )}
                  </Card>
                </>
              ),
            },
          ]}
        />
      </Form>
    </div>
  );
};

export default Automation;
