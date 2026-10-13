import React, { useEffect, useState } from 'react';
import { Alert, App, Button, Form, Space, Tabs, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import type { Device, NatRule } from '@/types';
import {
  hasSelectedAutomationCheckSources,
  hasSelectedAutomationDevices,
  normalizeAutomationCheckSources,
} from '@/utils/automationConfig';
import { ensureIpcSuccess } from '@/utils/ipcResult';
import { DEFAULT_AUTOMATION_FORM_VALUES } from './automationDefaults';
import {
  buildAutomationFormSnapshot,
  buildStoredAutomationSettings,
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
import { getAutomationFieldTab, getDevicesWithoutManagedRules } from './automationSelection';
import { formatScheduledTime } from './automationTime';
import AutomationMonitorSection from './components/AutomationMonitorSection';
import AutomationNotifySection from './components/AutomationNotifySection';
import AutomationStatusBanner from './components/AutomationStatusBanner';
import AutomationUpdateSection from './components/AutomationUpdateSection';

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const Automation: React.FC = () => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm<AutomationFormValues>();
  const [emailNotifyEnabled, setEmailNotifyEnabled] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [managedRules, setManagedRules] = useState<NatRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  // Saving over a configuration that failed to load would replace it with defaults.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusRefreshKey, setStatusRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState('update');
  const [initialLoading, setInitialLoading] = useState(true);
  // Set when saved devices/rules were dropped because they are now disabled.
  const [prunedNotice, setPrunedNotice] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<AutomationFormValues>({
    ...DEFAULT_AUTOMATION_FORM_VALUES,
  });
  const [resetSnapshot, setResetSnapshot] = useState<AutomationFormSnapshot>(() =>
    buildAutomationFormSnapshot({})
  );

  useEffect(() => {
    const loadData = async () => {
      const api = window.electronAPI;
      let enabledDevices: Device[] = [];
      let enabledRules: NatRule[] = [];
      // Only a complete device and rule read may prune the saved selection.
      let scopeComplete = false;
      try {
        if (api?.device?.getAll) {
          enabledDevices = (await api.device.getAll()).filter((device) => device.enabled);
          // One unreachable device must not hide the rules of the others.
          const rulesByDevice = await Promise.allSettled(
            enabledDevices.map((device) => api.rule.getAll(device.id))
          );
          enabledRules = rulesByDevice
            .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
            .filter((rule) => rule.enabled);
          scopeComplete = rulesByDevice.every((result) => result.status === 'fulfilled');
          setDevices(enabledDevices);
          setManagedRules(enabledRules);
        }
      } catch {
        // Device list unavailable: the picker shows its empty state; saved config still loads.
      }

      try {
        if (!api?.config?.get) throw new Error('config API 未就绪');

        const [automationConfig, emailConfig] = await Promise.all([
          api.config.get<StoredAutomationConfig>('automation'),
          api.config.get<StoredEmailConfig>('email'),
        ]);

        const snapshot = buildAutomationFormSnapshot({
          automationConfig,
          emailConfig,
        });
        const savedDevices = snapshot.formValues.selectedDevices ?? [];
        const savedRules = snapshot.formValues.managedRuleIds ?? [];
        // Disabled devices and rules are not shown and could never be unselected, and the
        // service refuses a batch that names them, so they are dropped and the user asked to save.
        const keptDevices = scopeComplete
          ? savedDevices.filter((id) => enabledDevices.some((device) => device.id === id))
          : savedDevices;
        const keptRules = scopeComplete
          ? savedRules.filter((id) => enabledRules.some((rule) => rule.id === id))
          : savedRules;
        const droppedDevices = savedDevices.length - keptDevices.length;
        const droppedRules = savedRules.length - keptRules.length;

        form.resetFields();
        form.setFieldsValue(snapshot.formValues);
        setResetSnapshot(snapshot);
        setEmailNotifyEnabled(snapshot.emailNotifyEnabled);
        form.setFieldsValue({ selectedDevices: keptDevices, managedRuleIds: keptRules });
        setFormValues(form.getFieldsValue(true) as AutomationFormValues);
        const pruned = droppedDevices > 0 || droppedRules > 0;
        setHasUnsavedChanges(pruned);
        setPrunedNotice(
          pruned
            ? `已移除 ${droppedDevices} 台已禁用的设备、${droppedRules} 条已禁用或已删除的规则，保存后生效。`
            : null
        );
        setLoadError(null);
      } catch (error) {
        setLoadError(getErrorMessage(error, '读取配置失败'));
      } finally {
        setInitialLoading(false);
      }
    };

    void loadData();
  }, [form]);

  const handleSelectionChange = (selectedDevices: string[], managedRuleIds: string[]) => {
    form.setFieldsValue({ selectedDevices, managedRuleIds });
    setFormValues(form.getFieldsValue(true) as AutomationFormValues);
    setHasUnsavedChanges(true);
  };

  const handleReset = () => {
    form.resetFields();
    form.setFieldsValue(resetSnapshot.formValues);
    setFormValues(resetSnapshot.formValues);
    setEmailNotifyEnabled(resetSnapshot.emailNotifyEnabled);
    setHasUnsavedChanges(false);
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      await form.validateFields();
      // validateFields() only returns mounted fields; the store holds every tab's values.
      const values = form.getFieldsValue(true) as AutomationFormValues;
      const api = window.electronAPI;

      if (!api?.config?.save) {
        throw new Error('config API 未就绪');
      }

      const scheduledTime = formatScheduledTime(values.scheduledTime);
      const ipMonitorEnabled = values.ipMonitorEnabled !== false;
      const normalizedCheckSources = normalizeAutomationCheckSources(values.checkSources);

      if (values.autoUpdateEnabled) {
        const selection = {
          selectedDevices: values.selectedDevices ?? [],
          managedRuleIds: values.managedRuleIds ?? [],
        };
        if (!selection.selectedDevices.length)
          throw new Error('请在“自动更新策略”中勾选至少一台设备。');
        const empty = getDevicesWithoutManagedRules(selection, managedRules);
        if (empty.length)
          throw new Error(
            `设备 ${empty
              .map((id) => devices.find((device) => device.id === id)?.name || id)
              .join('、')} 没有勾选任何规则，请勾选规则或取消该设备。`
          );
      }

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
        ...buildStoredAutomationSettings(values),
        scheduledTime,
        checkSources: normalizedCheckSources,
        emailNotifyEnabled,
        wechatNotifyEnabled: false,
      };

      const emailConfig = buildAutomationEmailConfig(values, emailNotifyEnabled);
      if (api?.email?.configure) {
        ensureIpcSuccess(await api.email.configure(emailConfig), '保存邮件配置失败');
      } else {
        ensureIpcSuccess(await api.config.save('email', emailConfig), '保存邮件配置失败');
      }

      ensureIpcSuccess(await api.config.save('automation', automationConfig), '保存自动化配置失败');
      message.success('已保存');
      setPrunedNotice(null);
      setStatusRefreshKey((key) => key + 1);

      const nextSnapshot = createAutomationFormSnapshot(
        form.getFieldsValue(true) as AutomationFormValues,
        {
          emailNotifyEnabled,
          wechatNotifyEnabled: false,
          wechatType: 'work',
        }
      );

      setResetSnapshot(nextSnapshot);
      setFormValues(nextSnapshot.formValues);
      setHasUnsavedChanges(false);
    } catch (error) {
      const firstField = (error as { errorFields?: { name: (string | number)[] }[] })
        .errorFields?.[0]?.name?.[0];
      if (firstField !== undefined) {
        // The invalid field may sit on a tab the user is not looking at.
        setActiveTab(getAutomationFieldTab(String(firstField)));
        message.error('请检查标红的必填项');
        return;
      }
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

  // Auto-update is what users come here for, so it leads; detection tuning comes second.
  const tabItems = [
    {
      key: 'update',
      forceRender: true,
      label: t('automation.autoUpdate'),
      children: (
        <AutomationUpdateSection
          devices={devices}
          rules={managedRules}
          selectedDeviceIds={formValues.selectedDevices || []}
          managedRuleIds={formValues.managedRuleIds || []}
          onSelectionChange={handleSelectionChange}
          t={t}
        />
      ),
    },
    {
      key: 'monitor',
      forceRender: true,
      label: t('automation.ipMonitoring'),
      children: <AutomationMonitorSection t={t} />,
    },
    {
      key: 'notify',
      forceRender: true,
      label: t('automation.notificationManagement'),
      children: (
        <AutomationNotifySection
          emailNotifyEnabled={emailNotifyEnabled}
          onEmailNotifyEnabledChange={(enabled) => {
            setEmailNotifyEnabled(enabled);
            setHasUnsavedChanges(true);
          }}
          onSendTestEmail={handleSendTestEmail}
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
      >
        <AutomationStatusBanner refreshKey={statusRefreshKey} />
        {prunedNotice && (
          <Alert
            type="warning"
            showIcon
            closable
            style={{ marginBottom: 16 }}
            message={prunedNotice}
            onClose={() => setPrunedNotice(null)}
          />
        )}
        {loadError && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="读取已保存的配置失败，为避免覆盖已有配置，暂时无法保存"
            description={loadError}
          />
        )}

        <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />

        {/* Always reachable save bar; it only asks for attention when something changed. */}
        <div
          style={{
            position: 'sticky',
            bottom: -24,
            margin: '16px -24px -24px',
            padding: '12px 24px',
            background: '#fff',
            borderTop: '1px solid #f0f0f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 12,
            zIndex: 10,
          }}
        >
          <Typography.Text type={hasUnsavedChanges ? 'warning' : 'secondary'}>
            {hasUnsavedChanges ? '有未保存的修改' : '所有修改已保存'}
          </Typography.Text>
          <Space>
            <Button onClick={handleReset} disabled={loading || !hasUnsavedChanges}>
              放弃修改
            </Button>
            <Button
              type="primary"
              onClick={() => void handleSave()}
              loading={loading}
              disabled={!hasUnsavedChanges || Boolean(loadError) || initialLoading}
            >
              {t('settings.saveSettings')}
            </Button>
          </Space>
        </div>
      </Form>
    </div>
  );
};

export default Automation;
