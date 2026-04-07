import React, { useEffect, useState } from 'react';
import { Alert, App, Button, Form, Space, Tabs } from 'antd';
import { useTranslation } from 'react-i18next';

import type { Device } from '@/types';
import {
  hasSelectedAutomationCheckSources,
  hasSelectedAutomationDevices,
  normalizeAutomationCheckSources,
} from '@/utils/automationConfig';
import { ensureIpcSuccess } from '@/utils/ipcResult';
import { DEFAULT_AUTOMATION_FORM_VALUES } from './automationDefaults';
import {
  buildAutomationFormSnapshot,
  createAutomationFormSnapshot,
  type AutomationFormSnapshot,
  type AutomationFormValues,
  type StoredAutomationConfig,
  type StoredEmailConfig,
} from './automationFormState';
import {
  buildAutomationEmailConfig,
  buildAutomationTestEmailConfig,
} from './automationNotification';
import { formatScheduledTime } from './automationTime';
import AutomationMonitorSection from './components/AutomationMonitorSection';
import AutomationNotifySection from './components/AutomationNotifySection';
import AutomationSummaryStats from './components/AutomationSummaryStats';
import AutomationUpdateSection from './components/AutomationUpdateSection';

type AutomationStatus = {
  isMonitoring?: boolean;
};

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const Automation: React.FC = () => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm<AutomationFormValues>();
  const [emailNotifyEnabled, setEmailNotifyEnabled] = useState(false);
  const [wechatNotifyEnabled, setWechatNotifyEnabled] = useState(false);
  const [wechatType, setWechatType] = useState('work');
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [smtpPasswordVisible, setSmtpPasswordVisible] = useState(true);
  const [formValues, setFormValues] = useState<AutomationFormValues>({
    ...DEFAULT_AUTOMATION_FORM_VALUES,
  });
  const [resetSnapshot, setResetSnapshot] = useState<AutomationFormSnapshot>(() =>
    buildAutomationFormSnapshot({})
  );

  useEffect(() => {
    const loadData = async () => {
      try {
        const api = window.electronAPI;

        if (api?.device?.getAll) {
          const deviceList = await api.device.getAll();
          setDevices(deviceList.filter((device) => device.enabled));
        }

        if (!api?.config?.get) {
          return;
        }

        const [automationConfig, emailConfig] = await Promise.all([
          api.config.get<StoredAutomationConfig>('automation'),
          api.config.get<StoredEmailConfig>('email'),
        ]);

        const snapshot = buildAutomationFormSnapshot({
          automationConfig,
          emailConfig,
        });

        form.setFieldsValue(snapshot.formValues);
        setFormValues(snapshot.formValues);
        setResetSnapshot(snapshot);
        setEmailNotifyEnabled(snapshot.emailNotifyEnabled);
        setWechatNotifyEnabled(snapshot.wechatNotifyEnabled);
        setWechatType(snapshot.wechatType);
        setSmtpPasswordVisible(!snapshot.formValues.smtpPassword);
        setHasUnsavedChanges(false);
      } catch {
        // Ignore load failures and keep defaults.
      }
    };

    void loadData();
  }, [form]);

  const handleReset = () => {
    form.setFieldsValue(resetSnapshot.formValues);
    setFormValues(resetSnapshot.formValues);
    setEmailNotifyEnabled(resetSnapshot.emailNotifyEnabled);
    setWechatNotifyEnabled(resetSnapshot.wechatNotifyEnabled);
    setWechatType(resetSnapshot.wechatType);
    setSmtpPasswordVisible(!resetSnapshot.formValues.smtpPassword);
    setHasUnsavedChanges(false);
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      const values = await form.validateFields();
      const api = window.electronAPI;

      if (!api?.config?.save) {
        throw new Error('config API 未就绪');
      }

      const scheduledTime = formatScheduledTime(values.scheduledTime);
      const ipMonitorEnabled = values.ipMonitorEnabled !== false;
      const normalizedCheckSources = normalizeAutomationCheckSources(values.checkSources);

      if (
        ipMonitorEnabled &&
        !hasSelectedAutomationCheckSources(ipMonitorEnabled, values.checkSources)
      ) {
        message.warning(t('automation.selectCheckSources'));
        return;
      }

      if (
        ipMonitorEnabled &&
        !hasSelectedAutomationDevices(!!values.autoUpdateEnabled, values.selectedDevices)
      ) {
        message.warning(t('automation.selectDevices'));
        return;
      }

      const automationConfig: StoredAutomationConfig = {
        ...values,
        scheduledTime,
        checkSources: normalizedCheckSources,
        emailNotifyEnabled,
        wechatNotifyEnabled,
        wechatType,
      };

      ensureIpcSuccess(await api.config.save('automation', automationConfig), '保存自动化配置失败');

      const emailConfig = buildAutomationEmailConfig(values, emailNotifyEnabled);
      if (api?.email?.configure) {
        ensureIpcSuccess(await api.email.configure(emailConfig), '保存邮件配置失败');
      } else {
        ensureIpcSuccess(await api.config.save('email', emailConfig), '保存邮件配置失败');
      }

      const status = api.automation?.getStatus
        ? await api.automation.getStatus<AutomationStatus>()
        : null;
      if (ipMonitorEnabled) {
        if (
          values.autoUpdateEnabled &&
          (!values.selectedDevices || values.selectedDevices.length === 0)
        ) {
          message.warning(t('automation.selectDevices'));
          return;
        }

        const automationServiceConfig = {
          enabled: true,
          autoUpdateEnabled: values.autoUpdateEnabled,
          triggerType: values.triggerType,
          delayMinutes: values.delayMinutes || 5,
          scheduledTime,
          selectedDevices: values.selectedDevices || [],
          checkInterval: values.checkInterval || 5,
          confirmCount: values.confirmCount || 3,
          checkSources: normalizedCheckSources,
          backupOptions: values.backupOptions || [],
          backupKeepCount: values.backupKeepCount || 10,
          securityOptions: values.securityOptions || [],
        };

        if (status?.isMonitoring) {
          if (api.automation?.updateConfig) {
            ensureIpcSuccess(
              await api.automation.updateConfig(automationServiceConfig),
              '更新自动化服务配置失败'
            );
          }
        } else if (api.automation?.start) {
          ensureIpcSuccess(
            await api.automation.start(automationServiceConfig),
            '启动自动化服务失败'
          );
        }

        message.success(t('common.success'));
      } else {
        if (status?.isMonitoring && api.automation?.stop) {
          ensureIpcSuccess(await api.automation.stop(), '停止自动化服务失败');
        }
        message.success(t('common.success'));
      }

      const nextSnapshot = createAutomationFormSnapshot(
        form.getFieldsValue(true) as AutomationFormValues,
        {
          emailNotifyEnabled,
          wechatNotifyEnabled,
          wechatType,
        }
      );

      setResetSnapshot(nextSnapshot);
      setFormValues(nextSnapshot.formValues);
      setHasUnsavedChanges(false);
      setSmtpPasswordVisible(!nextSnapshot.formValues.smtpPassword);
    } catch (error) {
      message.error(`${t('common.error')}: ${getErrorMessage(error, t('common.error'))}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSendTestEmail = async () => {
    try {
      if (!emailNotifyEnabled) {
        message.warning(t('common.warning'));
        return;
      }

      const values = form.getFieldsValue();
      const testConfig = buildAutomationTestEmailConfig(values);
      if (!testConfig) {
        message.error(t('common.error'));
        return;
      }

      const api = window.electronAPI;
      if (!api?.email?.sendTestWithConfig) {
        message.error(t('common.error'));
        return;
      }

      message.loading({
        content: t('common.loading'),
        key: 'testEmail',
        duration: 0,
      });

      const result = await api.email.sendTestWithConfig(testConfig);
      if (result.success) {
        message.success({
          content: `${t('common.success')}! ${testConfig.to.join(', ')}`,
          key: 'testEmail',
          duration: 5,
        });
        return;
      }

      message.error({
        content: (
          <div>
            <div>{t('common.error')}</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>{result.error || t('common.error')}</div>
          </div>
        ),
        key: 'testEmail',
        duration: 8,
      });
    } catch (error) {
      message.error({
        content: `${t('common.error')}: ${getErrorMessage(error, t('common.error'))}`,
        key: 'testEmail',
        duration: 6,
      });
    }
  };

  const tabItems = [
    {
      key: '1',
      label: t('automation.ipMonitoring'),
      children: <AutomationMonitorSection t={t} />,
    },
    {
      key: '2',
      label: t('automation.autoUpdate'),
      children: <AutomationUpdateSection devices={devices} t={t} />,
    },
    {
      key: '3',
      label: t('automation.notificationManagement'),
      children: (
        <AutomationNotifySection
          emailNotifyEnabled={emailNotifyEnabled}
          form={form}
          onEmailNotifyEnabledChange={setEmailNotifyEnabled}
          onSendTestEmail={handleSendTestEmail}
          onSendTestWechat={() => message.info(t('common.info'))}
          onSmtpPasswordVisibleChange={setSmtpPasswordVisible}
          onWechatNotifyEnabledChange={setWechatNotifyEnabled}
          onWechatTypeChange={setWechatType}
          smtpPasswordVisible={smtpPasswordVisible}
          t={t}
          wechatNotifyEnabled={wechatNotifyEnabled}
          wechatType={wechatType}
        />
      ),
    },
  ];

  return (
    <div>
      <Form
        form={form}
        layout="vertical"
        onValuesChange={(_changedValues, allValues) => {
          setHasUnsavedChanges(true);
          setFormValues(allValues);
        }}
        initialValues={DEFAULT_AUTOMATION_FORM_VALUES}
        onFieldsChange={() => {
          setFormValues(form.getFieldsValue());
        }}
      >
        <AutomationSummaryStats
          emailNotifyEnabled={emailNotifyEnabled}
          formValues={formValues}
          t={t}
        />

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
                <Button onClick={handleReset} disabled={loading}>
                  {t('common.reset')}
                </Button>
                <Button type="primary" onClick={() => void handleSave()} loading={loading}>
                  {t('settings.saveSettings')}
                </Button>
              </Space>
            </Space>
          }
          items={tabItems}
        />
      </Form>
    </div>
  );
};

export default Automation;
