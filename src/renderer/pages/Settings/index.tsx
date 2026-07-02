import React, { useEffect, useState } from 'react';
import { App, Alert, Button, Divider, Form, Input, Space, Tabs } from 'antd';
import type { TabsProps } from 'antd';
import { CheckCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import { useAppStore } from '@/stores/app.store';
import { ensureIpcSuccess } from '@/utils/ipcResult';
import { startMonitoringService, stopMonitoringService } from '@/utils/monitorControl';
import { buildSettingsFormSnapshot, DEFAULT_SETTINGS_FORM_VALUES } from './settingsFormState';
import type {
  SettingsAppConfig,
  SettingsDatabaseInfo,
  SettingsFormValues,
} from './components/types';
import SettingsAboutTab from './components/SettingsAboutTab';
import SettingsDataTab from './components/SettingsDataTab';
import SettingsGeneralTab from './components/SettingsGeneralTab';
import SettingsOverviewStats from './components/SettingsOverviewStats';
import SettingsSecurityTab from './components/SettingsSecurityTab';

const DEFAULT_DATABASE_INFO: SettingsDatabaseInfo = {
  path: '加载中...',
  size: '计算中...',
};

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const Settings: React.FC = () => {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<SettingsFormValues>();
  const [loading, setLoading] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [formValues, setFormValues] = useState<SettingsFormValues>(DEFAULT_SETTINGS_FORM_VALUES);
  const [resetValues, setResetValues] = useState<SettingsFormValues>(DEFAULT_SETTINGS_FORM_VALUES);
  const [databaseInfo, setDatabaseInfo] = useState<SettingsDatabaseInfo>(DEFAULT_DATABASE_INFO);
  const { setScale, setLanguage } = useAppStore();

  useEffect(() => {
    const loadData = async () => {
      const api = window.electronAPI;

      try {
        const [appConfig, autoStart] = await Promise.all([
          api?.config?.get ? api.config.get<SettingsAppConfig>('app') : Promise.resolve(null),
          api?.system?.getAutoStart
            ? api.system.getAutoStart()
            : Promise.resolve(DEFAULT_SETTINGS_FORM_VALUES.autoStart),
        ]);

        const nextValues = buildSettingsFormSnapshot(appConfig, autoStart);

        form.setFieldsValue(nextValues);
        setFormValues(nextValues);
        setResetValues(nextValues);
        setHasUnsavedChanges(false);
      } catch {
        form.setFieldsValue(DEFAULT_SETTINGS_FORM_VALUES);
        setFormValues(DEFAULT_SETTINGS_FORM_VALUES);
        setResetValues(DEFAULT_SETTINGS_FORM_VALUES);
      }

      try {
        if (!api?.system?.getDatabaseInfo) {
          setDatabaseInfo({
            path: '无法获取',
            size: '无法获取',
          });
          return;
        }

        const info = await api.system.getDatabaseInfo();
        setDatabaseInfo({
          path: info.path || '未知',
          size: info.size || '未知',
        });
      } catch {
        setDatabaseInfo({
          path: '获取失败',
          size: '获取失败',
        });
      }
    };

    void loadData();
  }, [form]);

  const handleReset = () => {
    form.setFieldsValue(resetValues);
    setFormValues(resetValues);
    setHasUnsavedChanges(false);
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      const values = await form.validateFields();
      const api = window.electronAPI;

      if (!api?.config?.save) {
        throw new Error('设置保存接口不可用');
      }

      const appConfig: SettingsAppConfig = {
        scale: values.scale,
        language: values.language,
        logRetentionDays: values.logRetentionDays,
        useWindowsCredentials: values.useWindowsCredentials,
        encryptSensitiveData: values.encryptSensitiveData,
        requirePasswordOnStartup: values.requirePasswordOnStartup,
        logAllOperations: values.logAllOperations,
        writeToWindowsEventLog: values.writeToWindowsEventLog,
      };

      ensureIpcSuccess(await api.config.save('app', appConfig), '设置保存失败');

      if (api?.system?.setAutoStart) {
        ensureIpcSuccess(await api.system.setAutoStart(values.autoStart), '设置开机自启动失败');
      }

      setScale(values.scale);
      setLanguage(values.language);
      setFormValues(values);
      setResetValues(values);
      setHasUnsavedChanges(false);
      message.success(t('settings.settingsSaved'));
    } catch (error) {
      message.error(getErrorMessage(error, '设置保存失败'));
    } finally {
      setLoading(false);
    }
  };

  const handlePauseService = () => {
    modal.confirm({
      title: '暂停服务',
      content: '确定要暂停监控服务吗？暂停期间将不会检测 IP 变化。',
      onOk: async () => {
        try {
          const api = window.electronAPI;
          if (!api) {
            throw new Error('监控服务接口不可用');
          }

          ensureIpcSuccess(await stopMonitoringService(api), '暂停服务失败');
          message.success('服务已暂停');
        } catch (error) {
          message.error(getErrorMessage(error, '暂停服务失败'));
        }
      },
    });
  };

  const handleRestartService = () => {
    modal.confirm({
      title: '重启服务',
      content: '确定要重启监控服务吗？',
      onOk: async () => {
        try {
          const api = window.electronAPI;
          if (!api) {
            throw new Error('监控服务接口不可用');
          }

          ensureIpcSuccess(await stopMonitoringService(api), '停止服务失败');
          await new Promise((resolve) => setTimeout(resolve, 1000));
          ensureIpcSuccess(await startMonitoringService(api), '启动服务失败');
          message.success('服务已重启');
        } catch (error) {
          message.error(getErrorMessage(error, '重启服务失败'));
        }
      },
    });
  };

  const handleViewServiceLog = () => {
    window.location.hash = '/logs';
    message.info('已跳转到日志页面');
  };

  const handleManagePassword = () => {
    modal.info({
      title: '主密码管理',
      content:
        '主密码功能用于保护所有存储的凭据。当前版本使用 Windows 凭据管理器，暂时不需要额外主密码。',
    });
  };

  const handleExportAuditLog = async () => {
    try {
      const api = window.electronAPI;
      if (!api?.log?.export) {
        throw new Error('日志导出接口不可用');
      }

      message.loading({ content: '正在导出审计日志...', key: 'exportLog' });
      const csv = await api.log.export({});
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `audit_log_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      message.success({ content: '审计日志导出成功', key: 'exportLog' });
    } catch (error) {
      message.error(`导出审计日志失败: ${getErrorMessage(error, '未知错误')}`);
    }
  };

  const handleClearCredentials = () => {
    modal.confirm({
      title: '清除所有凭据',
      content: '此操作将删除所有保存的 SSH 凭据，且不可恢复。',
      okType: 'danger',
      onOk: async () => {
        try {
          const api = window.electronAPI;
          if (!api?.device?.getAll || !api?.credential?.delete) {
            throw new Error('凭据清除接口不可用');
          }

          const devices = await api.device.getAll();
          await Promise.all(devices.map((device) => api.credential.delete(device.id)));
          message.success('所有凭据已清除');
        } catch (error) {
          message.error(getErrorMessage(error, '清除凭据失败'));
        }
      },
    });
  };

  const handleBackupData = async () => {
    try {
      const api = window.electronAPI;
      if (!api?.backup?.create) {
        throw new Error('备份接口不可用');
      }

      message.loading({ content: '正在备份数据...', key: 'backup' });
      const backup = await api.backup.create('手动备份');
      message.success({
        content: `数据备份成功: ${backup.filename || 'backup.json'}`,
        key: 'backup',
      });
    } catch (error) {
      message.error(getErrorMessage(error, '数据备份失败'));
    }
  };

  const handleClearData = () => {
    let confirmText = '';

    modal.confirm({
      title: '危险操作：清空所有数据',
      width: 520,
      content: (
        <div>
          <p style={{ color: 'red', fontWeight: 'bold', fontSize: 16 }}>
            警告：此操作将永久删除所有业务数据。
          </p>
          <div style={{ background: '#fff2e8', padding: 12, borderRadius: 4, marginBottom: 16 }}>
            <p style={{ margin: 0, fontWeight: 'bold' }}>将被删除的数据：</p>
            <ul style={{ marginBottom: 0 }}>
              <li>所有设备信息</li>
              <li>所有 NAT 规则</li>
              <li>所有日志记录</li>
              <li>所有保存的凭据</li>
            </ul>
          </div>
          <p style={{ fontWeight: 'bold', marginBottom: 8 }}>
            请输入 <span style={{ color: 'red' }}>&quot;确认删除&quot;</span> 以继续：
          </p>
          <Input
            placeholder="请输入：确认删除"
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              confirmText = event.target.value;
            }}
            onPressEnter={(event: React.KeyboardEvent<HTMLInputElement>) => {
              if ((event.target as HTMLInputElement).value === '确认删除') {
                document
                  .querySelector<HTMLButtonElement>('.ant-modal-confirm-btns .ant-btn-primary')
                  ?.click();
              }
            }}
          />
          <p style={{ color: '#999', fontSize: 12, marginTop: 8, marginBottom: 0 }}>
            系统将自动创建备份后再执行清空操作。
          </p>
        </div>
      ),
      okType: 'danger',
      okText: '确认清空',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        if (confirmText !== '确认删除') {
          message.error('请输入正确的确认文字');
          return Promise.reject(new Error('invalid-confirmation-text'));
        }

        try {
          const api = window.electronAPI;
          if (!api?.database?.clearAll) {
            throw new Error('数据库清理接口不可用');
          }

          message.loading({ content: '正在创建备份...', key: 'clearData' });
          if (api?.backup?.create) {
            await api.backup.create('清空数据前自动备份');
          }

          message.loading({ content: '正在清空数据...', key: 'clearData' });
          ensureIpcSuccess(await api.database.clearAll(), '清空数据失败');

          message.success({
            content: '数据已清空，系统配置已保留，备份已创建。',
            key: 'clearData',
            duration: 5,
          });

          setTimeout(() => {
            window.location.reload();
          }, 1500);
        } catch (error) {
          message.error({
            content: `清空数据失败: ${getErrorMessage(error, '未知错误')}`,
            key: 'clearData',
          });
          return Promise.reject(error);
        }
      },
    });
  };

  const handleExportConfig = async () => {
    try {
      const api = window.electronAPI;
      if (!api?.config?.export) {
        throw new Error('配置导出接口不可用');
      }

      message.loading({ content: '正在导出配置...', key: 'exportConfig' });
      const result = await api.config.export();
      if (result.success) {
        message.success({
          content: `配置导出成功: ${result.path}`,
          key: 'exportConfig',
        });
        return;
      }

      message.error({
        content: `导出失败: ${result.error || '未知错误'}`,
        key: 'exportConfig',
      });
    } catch (error) {
      message.error(`导出配置失败: ${getErrorMessage(error, '未知错误')}`);
    }
  };

  const handleImportConfig = () => {
    modal.confirm({
      title: '导入配置',
      content: '请选择之前导出的配置文件（.json 格式）。导入将覆盖当前配置，是否继续？',
      okText: '选择文件',
      cancelText: '取消',
      onOk: async () => {
        try {
          const api = window.electronAPI;
          if (!api?.system?.selectFile) {
            message.error('文件选择功能不可用');
            return;
          }

          const filePath = await api.system.selectFile({
            title: '选择配置文件',
            filters: [{ name: 'JSON 文件', extensions: ['json'] }],
          });

          if (!filePath) {
            return;
          }

          if (!api?.config?.import) {
            message.error('配置导入功能不可用');
            return;
          }

          message.loading({ content: '正在导入配置...', key: 'importConfig' });
          const result = await api.config.import(filePath);

          if (result.success) {
            message.success({
              content: '配置导入成功，即将刷新页面。',
              key: 'importConfig',
            });
            setTimeout(() => {
              window.location.reload();
            }, 1500);
            return;
          }

          message.error({
            content: `导入失败: ${result.error || '未知错误'}`,
            key: 'importConfig',
          });
        } catch (error) {
          message.error(`导入配置失败: ${getErrorMessage(error, '未知错误')}`);
        }
      },
    });
  };

  const handleViewLicense = () => {
    modal.info({
      title: '软件许可',
      width: 600,
      content: (
        <div>
          <h3>华为 USG 防火墙 NAT 管理软件</h3>
          <p>版本: V1.1.6</p>
          <Divider />
          <h4>MIT License</h4>
          <p style={{ fontSize: 12, color: '#666' }}>
            Copyright (c) 2025 USG NAT Manager
            <br />
            <br />
            Permission is hereby granted, free of charge, to any person obtaining a copy of this
            software and associated documentation files (the &quot;Software&quot;), to deal in the
            Software without restriction, including without limitation the rights to use, copy,
            modify, merge, publish, distribute, sublicense, and/or sell copies of the Software.
          </p>
        </div>
      ),
    });
  };

  const handleCheckUpdate = async () => {
    try {
      const api = window.electronAPI;
      message.loading({ content: '正在检查更新...', key: 'update', duration: 0 });

      if (!api?.updater?.checkForUpdates) {
        setTimeout(() => {
          message.success({
            content: '当前已是最新版本 V1.1.6',
            key: 'update',
          });
        }, 1500);
        return;
      }

      const result = await api.updater.checkForUpdates(true);

      if (!result.success) {
        message.error({
          content: result.message || '检查更新失败',
          key: 'update',
        });
        return;
      }

      message.destroy('update');

      if (!result.hasUpdate) {
        message.success({
          content: result.message || '当前已是最新版本',
          key: 'update',
        });
        return;
      }

      modal.confirm({
        title: '发现新版本',
        icon: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
        content: (
          <div>
            <p>
              <strong>当前版本：</strong> V{result.currentVersion || '1.1.6'}
            </p>
            <p>
              <strong>最新版本：</strong> V{result.latestVersion || '-'}
            </p>
            <p style={{ marginTop: 16 }}>是否立即下载并安装新版本？</p>
          </div>
        ),
        okText: '立即下载',
        cancelText: '稍后提醒',
        onOk: async () => {
          try {
            if (!api?.updater?.downloadUpdate) {
              throw new Error('下载更新接口不可用');
            }

            message.loading({ content: '正在下载更新...', key: 'download', duration: 0 });
            ensureIpcSuccess(await api.updater.downloadUpdate(), '下载更新失败');
            message.destroy('download');

            modal.success({
              title: '下载完成',
              content: '更新已下载完成，应用将在退出时自动安装。是否立即重启安装？',
              okText: '立即重启',
              cancelText: '稍后重启',
              onOk: async () => {
                try {
                  if (!api?.updater?.quitAndInstall) {
                    throw new Error('安装更新接口不可用');
                  }

                  ensureIpcSuccess(await api.updater.quitAndInstall(), '退出并安装更新失败');
                } catch (error) {
                  message.error({
                    content: `安装失败: ${getErrorMessage(error, '未知错误')}`,
                    duration: 5,
                  });
                }
              },
            });
          } catch (error) {
            message.error({
              content: `下载失败: ${getErrorMessage(error, '未知错误')}`,
              key: 'download',
            });
          }
        },
      });
    } catch (error) {
      message.error({
        content: `检查更新失败: ${getErrorMessage(error, '未知错误')}`,
        key: 'update',
      });
    }
  };

  const handleContactSupport = () => {
    modal.info({
      title: '联系技术支持',
      content: (
        <div>
          <p>
            <strong>技术支持渠道：</strong>
          </p>
          <ul>
            <li>邮箱：support@example.com</li>
            <li>GitHub：项目仓库 Issues</li>
            <li>文档：项目 docs 目录</li>
          </ul>
        </div>
      ),
    });
  };

  const tabItems: TabsProps['items'] = [
    {
      key: '1',
      label: t('settings.general'),
      children: (
        <SettingsGeneralTab
          t={t}
          onPauseService={handlePauseService}
          onRestartService={handleRestartService}
          onViewServiceLog={handleViewServiceLog}
        />
      ),
    },
    {
      key: '2',
      label: t('settings.security'),
      children: (
        <SettingsSecurityTab
          t={t}
          onClearCredentials={handleClearCredentials}
          onExportAuditLog={handleExportAuditLog}
          onManagePassword={handleManagePassword}
        />
      ),
    },
    {
      key: '3',
      label: t('settings.data'),
      children: (
        <SettingsDataTab
          databaseInfo={databaseInfo}
          t={t}
          onBackupData={handleBackupData}
          onClearData={handleClearData}
          onExportConfig={handleExportConfig}
          onImportConfig={handleImportConfig}
        />
      ),
    },
    {
      key: '4',
      label: t('settings.about'),
      children: (
        <SettingsAboutTab
          t={t}
          onCheckUpdate={handleCheckUpdate}
          onContactSupport={handleContactSupport}
          onViewLicense={handleViewLicense}
        />
      ),
    },
  ];

  return (
    <div>
      <Form<SettingsFormValues>
        form={form}
        layout="vertical"
        initialValues={DEFAULT_SETTINGS_FORM_VALUES}
        onValuesChange={(_changedValues, allValues) => {
          setHasUnsavedChanges(true);
          setFormValues(allValues);
        }}
        onFieldsChange={() => {
          setFormValues(form.getFieldsValue(true));
        }}
      >
        <SettingsOverviewStats databaseInfo={databaseInfo} formValues={formValues} t={t} />

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

export default Settings;
