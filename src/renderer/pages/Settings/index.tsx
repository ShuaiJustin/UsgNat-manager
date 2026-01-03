import React from 'react';
import {
  Card,
  Form,
  Select,
  Switch,
  Button,
  Space,
  Divider,
  Badge,
  Checkbox,
  InputNumber,
  Alert,
  Row,
  Col,
  Statistic,
  Tabs,
  Input,
  App,
} from 'antd';
import {
  CheckCircleOutlined,
  DatabaseOutlined,
  SafetyOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useAppStore } from '../../stores/app.store';
import { useTranslation } from 'react-i18next';

const Settings: React.FC = () => {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = React.useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = React.useState(false);
  const [formValues, setFormValues] = React.useState<any>({
    scale: '100',
    language: 'zh-CN',
    autoStart: true,
    logRetentionDays: 30,
    useWindowsCredentials: true,
    encryptSensitiveData: true,
    requirePasswordOnStartup: false,
    logAllOperations: true,
    writeToWindowsEventLog: true,
  });
  const [databaseInfo, setDatabaseInfo] = React.useState<{
    path: string;
    size: string;
  }>({
    path: '加载中...',
    size: '计算中...',
  });
  const { setScale, setLanguage } = useAppStore();

  // 加载配置和数据库信息
  React.useEffect(() => {
    const loadConfig = async () => {
      try {
        const api = (window as any).electronAPI;

        // 加载应用配置
        let appConfig = null;
        let autoStart = false;

        if (api?.config?.get) {
          appConfig = await api.config.get('app');
        }

        if (api?.system?.getAutoStart) {
          autoStart = await api.system.getAutoStart();
        }

        form.setFieldsValue({
          scale: appConfig?.scale || '100',
          language: appConfig?.language || 'zh-CN',
          autoStart: autoStart,
          logRetentionDays: appConfig?.logRetentionDays || 30,
          useWindowsCredentials: appConfig?.useWindowsCredentials ?? true,
          encryptSensitiveData: appConfig?.encryptSensitiveData ?? true,
          requirePasswordOnStartup: appConfig?.requirePasswordOnStartup ?? false,
          logAllOperations: appConfig?.logAllOperations ?? true,
          writeToWindowsEventLog: appConfig?.writeToWindowsEventLog ?? true,
        });
      } catch (error) {
        // 配置加载失败，使用默认值
      }

      // 单独加载数据库信息
      try {
        const api = (window as any).electronAPI;
        if (api?.system?.getDatabaseInfo) {
          const dbInfo = await api.system.getDatabaseInfo();
          setDatabaseInfo({
            path: dbInfo?.path || '未知',
            size: dbInfo?.size || '未知',
          });
        } else {
          setDatabaseInfo({
            path: '无法获取',
            size: '无法获取',
          });
        }
      } catch {
        setDatabaseInfo({
          path: '获取失败',
          size: '获取失败',
        });
      }
    };
    loadConfig();
  }, [form]);

  const handleSave = async () => {
    try {
      setLoading(true);
      const values = await form.validateFields();
      const api = (window as any).electronAPI;

      // 保存应用配置（必须保存）
      if (api?.config?.save) {
        await api.config.save('app', {
          scale: values.scale,
          language: values.language,
          logRetentionDays: values.logRetentionDays,
          useWindowsCredentials: values.useWindowsCredentials,
          encryptSensitiveData: values.encryptSensitiveData,
          requirePasswordOnStartup: values.requirePasswordOnStartup,
          logAllOperations: values.logAllOperations,
          writeToWindowsEventLog: values.writeToWindowsEventLog,
        });
      }

      // 设置开机自启动
      if (api?.system?.setAutoStart) {
        await api.system.setAutoStart(values.autoStart);
      }

      // ✨ 立即应用设置到UI
      setScale(values.scale);
      setLanguage(values.language);

      message.success(t('settings.settingsSaved'));
      // 保存成功后清除未保存标记
      setHasUnsavedChanges(false);
    } catch (error) {
      message.error('设置保存失败');
    } finally {
      setLoading(false);
    }
  };

  // 服务管理
  const handlePauseService = () => {
    modal.confirm({
      title: '暂停服务',
      content: '确定要暂停监控服务吗？暂停期间将不会检测IP变化。',
      onOk: async () => {
        try {
          const api = (window as any).electronAPI;
          if (api?.monitor?.stop) {
            await api.monitor.stop();
            message.success('服务已暂停');
          } else {
            message.info('服务暂停功能演示');
          }
        } catch {
          message.error('暂停服务失败');
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
          const api = (window as any).electronAPI;
          if (api?.monitor?.stop && api?.monitor?.start) {
            await api.monitor.stop();
            await new Promise((resolve) => setTimeout(resolve, 1000));
            await api.monitor.start();
            message.success('服务已重启');
          } else {
            message.info('服务重启功能演示');
          }
        } catch {
          message.error('重启服务失败');
        }
      },
    });
  };

  const handleInstallService = () => {
    message.info('Windows服务安装功能需要管理员权限，当前版本暂不支持。建议使用开机自启动功能。');
  };

  const handleUninstallService = () => {
    modal.confirm({
      title: '卸载服务',
      content: '确定要卸载Windows服务吗？这将移除服务但保留所有数据。',
      okType: 'danger',
      onOk: () => {
        message.info('Windows服务卸载功能需要管理员权限，当前版本暂不支持。');
      },
    });
  };

  const handleViewServiceLog = () => {
    window.location.hash = '/logs';
    message.info('已跳转到日志页面');
  };

  // 安全设置
  const handleManagePassword = () => {
    modal.info({
      title: '主密码管理',
      content: '主密码功能用于保护所有存储的凭据。当前版本使用Windows凭据管理器，暂不需要主密码。',
    });
  };

  const handleExportAuditLog = async () => {
    try {
      const api = (window as any).electronAPI;
      if (api?.log?.export) {
        message.loading({ content: '正在导出审计日志...', key: 'exportLog' });
        // 导出所有日志，前端不需要category参数
        const csv = await api.log.export({});
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `audit_log_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        URL.revokeObjectURL(url);
        message.success({ content: '审计日志导出成功', key: 'exportLog' });
      } else {
        message.info('审计日志导出功能演示');
      }
    } catch (error: any) {
      message.error(`导出审计日志失败: ${error.message}`);
    }
  };

  const handleClearCredentials = () => {
    modal.confirm({
      title: '清除所有凭据',
      content: '此操作将删除所有保存的SSH凭据，操作不可恢复！',
      okType: 'danger',
      onOk: async () => {
        try {
          const api = (window as any).electronAPI;
          if (api?.device?.getAll) {
            const devices = await api.device.getAll();
            for (const device of devices) {
              if (api?.credential?.delete) {
                await api.credential.delete(device.id);
              }
            }
            message.success('所有凭据已清除');
          } else {
            message.info('清除凭据功能演示');
          }
        } catch {
          message.error('清除凭据失败');
        }
      },
    });
  };

  // 数据管理
  const handleBackupData = async () => {
    try {
      const api = (window as any).electronAPI;
      if (api?.backup?.create) {
        message.loading({ content: '正在备份数据...', key: 'backup' });
        const backup = await api.backup.create('手动备份');
        message.success({ content: `数据备份成功: ${backup.filename}`, key: 'backup' });
      } else {
        message.info('数据备份功能演示');
      }
    } catch {
      message.error('数据备份失败');
    }
  };

  const handleRestoreData = () => {
    modal.info({
      title: '恢复数据',
      content: '请从备份列表中选择要恢复的备份文件。建议先创建当前数据的备份。',
      onOk: () => {
        // 可以跳转到备份页面或打开文件选择器
        message.info('数据恢复功能演示');
      },
    });
  };

  const handleClearData = () => {
    let confirmText = '';

    modal.confirm({
      title: '⚠️ 危险操作：清空所有数据',
      width: 520,
      content: (
        <div>
          <p style={{ color: 'red', fontWeight: 'bold', fontSize: 16 }}>
            警告：此操作将永久删除所有数据！
          </p>
          <div style={{ background: '#fff2e8', padding: 12, borderRadius: 4, marginBottom: 16 }}>
            <p style={{ margin: 0, fontWeight: 'bold' }}>将被删除的数据：</p>
            <ul style={{ marginBottom: 0 }}>
              <li>所有设备信息</li>
              <li>所有NAT规则</li>
              <li>所有日志记录</li>
              <li>所有配置信息</li>
            </ul>
          </div>
          <p style={{ fontWeight: 'bold', marginBottom: 8 }}>
            请输入 <span style={{ color: 'red' }}>&quot;确认删除&quot;</span> 以继续：
          </p>
          <Input
            placeholder="请输入：确认删除"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              confirmText = e.target.value;
            }}
            onPressEnter={(e: React.KeyboardEvent<HTMLInputElement>) => {
              if ((e.target as HTMLInputElement).value === '确认删除') {
                document
                  .querySelector<HTMLButtonElement>('.ant-modal-confirm-btns .ant-btn-primary')
                  ?.click();
              }
            }}
          />
          <p style={{ color: '#999', fontSize: 12, marginTop: 8, marginBottom: 0 }}>
            系统将自动创建备份后再执行清空操作
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
          return Promise.reject();
        }

        try {
          const api = (window as any).electronAPI;

          // 先创建备份
          message.loading({ content: '正在创建备份...', key: 'clearData' });
          if (api?.backup?.create) {
            await api.backup.create('清空数据前自动备份');
          }

          // 清空数据
          message.loading({ content: '正在清空数据...', key: 'clearData' });

          // 清空所有表的数据
          if (api?.database?.clearAll) {
            await api.database.clearAll();
          } else {
            // 如果没有统一的清空接口，逐个清空
            const devices = await api?.device?.getAll();
            if (devices && api?.device?.delete) {
              for (const device of devices) {
                await api.device.delete(device.id);
              }
            }

            // 清空日志
            if (api?.log?.clear) {
              await api.log.clear();
            }

            // 清空配置（保留关键配置）
            const configKeys = ['automation', 'app', 'email'];
            if (api?.config?.delete) {
              for (const key of configKeys) {
                try {
                  await api.config.delete(key);
                } catch {
                  // 忽略不存在的配置
                }
              }
            }
          }

          message.success({
            content: '数据已清空，备份已保存',
            key: 'clearData',
            duration: 5,
          });

          // 刷新页面
          setTimeout(() => {
            window.location.reload();
          }, 1500);
        } catch (error: any) {
          message.error({
            content: '清空数据失败: ' + (error.message || '未知错误'),
            key: 'clearData',
          });
          return Promise.reject(error);
        }
      },
    });
  };

  const handleExportConfig = async () => {
    try {
      const api = (window as any).electronAPI;
      if (api?.config?.export) {
        message.loading({ content: '正在导出配置...', key: 'exportConfig' });
        const result = await api.config.export();
        if (result.success) {
          message.success({ content: `配置导出成功: ${result.path}`, key: 'exportConfig' });
        } else {
          message.error({ content: `导出失败: ${result.error}`, key: 'exportConfig' });
        }
      } else {
        message.info('配置导出功能演示');
      }
    } catch (error: any) {
      message.error(`导出配置失败: ${error.message}`);
    }
  };

  const handleImportConfig = async () => {
    modal.confirm({
      title: '导入配置',
      content: '请选择之前导出的配置文件（.json格式）。导入将覆盖当前配置，是否继续？',
      okText: '选择文件',
      cancelText: '取消',
      onOk: async () => {
        try {
          const api = (window as any).electronAPI;

          if (!api?.system?.selectFile) {
            message.error('文件选择功能不可用');
            return;
          }

          const filePath = await api.system.selectFile({
            title: '选择配置文件',
            filters: [{ name: 'JSON文件', extensions: ['json'] }],
          });

          if (!filePath) {
            return; // 用户取消选择
          }

          if (!api?.config?.import) {
            message.error('配置导入功能不可用');
            return;
          }

          message.loading({ content: '正在导入配置...', key: 'importConfig' });
          const result = await api.config.import(filePath);

          if (result.success) {
            message.success({ content: '配置导入成功，即将刷新页面', key: 'importConfig' });
            setTimeout(() => {
              window.location.reload();
            }, 1500);
          } else {
            message.error({ content: `导入失败: ${result.error}`, key: 'importConfig' });
          }
        } catch (error: any) {
          message.error(`导入配置失败: ${error.message}`);
        }
      },
    });
  };

  // 关于功能
  const handleViewLicense = () => {
    modal.info({
      title: '软件许可证',
      width: 600,
      content: (
        <div>
          <h3>华为USG防火墙NAT管理软件</h3>
          <p>版本: V1.1.5</p>
          <Divider />
          <h4>MIT License</h4>
          <p style={{ fontSize: 12, color: '#666' }}>
            Copyright (c) 2025 USG NAT Manager
            <br />
            <br />
            Permission is hereby granted, free of charge, to any person obtaining a copy of this
            software and associated documentation files (the &quot;Software&quot;), to deal in the
            Software without restriction, including without limitation the rights to use, copy,
            modify, merge, publish, distribute, sublicense, and/or sell copies of the Software...
          </p>
        </div>
      ),
    });
  };

  const handleCheckUpdate = async () => {
    try {
      message.loading({ content: '正在检查更新...', key: 'update', duration: 0 });

      const api = (window as any).electronAPI;
      if (api?.updater?.checkForUpdates) {
        const result = await api.updater.checkForUpdates(true);

        if (result.success) {
          message.destroy('update');

          // 如果有新版本，弹出确认框
          if (result.hasUpdate) {
            modal.confirm({
              title: '发现新版本',
              icon: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
              content: (
                <div>
                  <p>
                    <strong>当前版本：</strong> V{result.currentVersion || '1.0.6'}
                  </p>
                  <p>
                    <strong>最新版本：</strong> V{result.latestVersion}
                  </p>
                  <p style={{ marginTop: 16 }}>是否立即下载并安装新版本？</p>
                </div>
              ),
              okText: '立即下载',
              cancelText: '稍后提醒',
              onOk: async () => {
                try {
                  message.loading({ content: '正在下载更新...', key: 'download', duration: 0 });

                  if (api?.updater?.downloadUpdate) {
                    await api.updater.downloadUpdate();

                    message.destroy('download');
                    modal.success({
                      title: '下载完成',
                      content: '更新已下载完成，应用将在退出时自动安装。是否立即重启安装？',
                      okText: '立即重启',
                      cancelText: '稍后重启',
                      onOk: async () => {
                        try {
                          if (api?.updater?.quitAndInstall) {
                            await api.updater.quitAndInstall();
                          }
                        } catch (error: any) {
                          message.error({
                            content: `安装失败: ${error.message || '未知错误'}`,
                            duration: 5,
                          });
                        }
                      },
                    });
                  }
                } catch (error: any) {
                  message.error({
                    content: `下载失败: ${error.message}`,
                    key: 'download',
                  });
                }
              },
            });
          } else {
            // 没有新版本
            message.success({
              content: result.message || '当前已是最新版本',
              key: 'update',
            });
          }
        } else {
          message.error({
            content: result.message || '检查更新失败',
            key: 'update',
          });
        }
      } else {
        // 演示模式
        setTimeout(() => {
          message.success({
            content: '当前已是最新版本 V1.0.6',
            key: 'update',
          });
        }, 1500);
      }
    } catch (error: any) {
      message.error({
        content: `检查更新失败: ${error.message}`,
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
            <li>邮箱: </li>
            <li>GitHub: </li>
            <li>文档: </li>
          </ul>
          <p style={{ marginTop: 16 }}></p>
        </div>
      ),
    });
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
          theme: 'auto',
          scale: '100',
          language: 'zh-CN',
          autoStart: true,
          logRetentionDays: 30,
          useWindowsCredentials: true,
          encryptSensitiveData: true,
          requirePasswordOnStartup: false,
          logAllOperations: true,
          writeToWindowsEventLog: true,
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
                title={t('settings.serviceStatus')}
                value={t('settings.running')}
                prefix={<CheckCircleOutlined />}
                valueStyle={{ fontSize: 16, color: '#52c41a' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title={t('settings.interfaceScale')}
                value={formValues.scale || '100'}
                suffix="%"
                prefix={<SettingOutlined />}
                valueStyle={{ fontSize: 16 }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title={t('settings.databaseSize')}
                value={databaseInfo.size}
                prefix={<DatabaseOutlined />}
                valueStyle={{ fontSize: 16 }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title={t('settings.logRetention')}
                value={formValues.logRetentionDays || 30}
                suffix={t('settings.days')}
                prefix={<SafetyOutlined />}
                valueStyle={{ fontSize: 16 }}
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
              label: t('settings.general'),
              children: (
                <>
                  {/* Windows服务 */}
                  <Card title={t('settings.windowsService')} style={{ marginBottom: 24 }}>
                    <Form.Item label={t('settings.serviceStatus')}>
                      <Badge status="processing" text={t('settings.running')} />
                    </Form.Item>

                    <Space style={{ marginBottom: 15 }}>
                      <Button onClick={handlePauseService}>{t('settings.pauseService')}</Button>
                      <Button onClick={handleRestartService}>{t('settings.restartService')}</Button>
                    </Space>

                    <Form.Item
                      label={t('settings.autoStart')}
                      name="autoStart"
                      valuePropName="checked"
                    >
                      <Switch />
                    </Form.Item>

                    <Space>
                      <Button onClick={handleInstallService}>{t('settings.installService')}</Button>
                      <Button danger onClick={handleUninstallService}>
                        {t('settings.uninstallService')}
                      </Button>
                      <Button onClick={handleViewServiceLog}>{t('settings.viewServiceLog')}</Button>
                    </Space>
                  </Card>

                  {/* 外观设置 */}
                  <Card title={t('settings.appearance')}>
                    <Form.Item label={t('settings.scale')} name="scale">
                      <Select style={{ width: 200 }}>
                        <Select.Option value="75">75%</Select.Option>
                        <Select.Option value="90">90%</Select.Option>
                        <Select.Option value="100">
                          100% ({t('common.recommend', { defaultValue: '推荐' })})
                        </Select.Option>
                        <Select.Option value="125">125%</Select.Option>
                        <Select.Option value="150">150%</Select.Option>
                      </Select>
                    </Form.Item>

                    <Form.Item label={t('settings.language')} name="language">
                      <Select style={{ width: 200 }}>
                        <Select.Option value="zh-CN">简体中文</Select.Option>
                        <Select.Option value="en-US">English</Select.Option>
                      </Select>
                    </Form.Item>
                  </Card>
                </>
              ),
            },
            {
              key: '2',
              label: t('settings.security'),
              children: (
                <>
                  {/* 安全设置 */}
                  <Card title={t('settings.securitySettings')} style={{ marginBottom: 24 }}>
                    <Form.Item label={t('settings.credentialManagement')}>
                      <Space direction="vertical">
                        <Form.Item name="useWindowsCredentials" valuePropName="checked" noStyle>
                          <Checkbox>{t('settings.useWindowsCredentials')}</Checkbox>
                        </Form.Item>
                        <Form.Item name="encryptSensitiveData" valuePropName="checked" noStyle>
                          <Checkbox>{t('settings.encryptSensitiveData')}</Checkbox>
                        </Form.Item>
                        <Form.Item name="requirePasswordOnStartup" valuePropName="checked" noStyle>
                          <Checkbox>{t('settings.requirePasswordOnStartup')}</Checkbox>
                        </Form.Item>
                      </Space>
                    </Form.Item>

                    <Form.Item label={t('settings.auditLog')}>
                      <Space direction="vertical">
                        <Form.Item name="logAllOperations" valuePropName="checked" noStyle>
                          <Checkbox>{t('settings.logAllOperations')}</Checkbox>
                        </Form.Item>
                        <Form.Item name="writeToWindowsEventLog" valuePropName="checked" noStyle>
                          <Checkbox>{t('settings.writeToWindowsEventLog')}</Checkbox>
                        </Form.Item>
                      </Space>
                    </Form.Item>

                    <Form.Item label={t('settings.logRetentionDays')} name="logRetentionDays">
                      <InputNumber min={7} max={365} style={{ width: 100 }} />
                    </Form.Item>

                    <Space>
                      <Button onClick={handleManagePassword}>{t('settings.managePassword')}</Button>
                      <Button onClick={handleExportAuditLog}>{t('settings.exportAuditLog')}</Button>
                      <Button danger onClick={handleClearCredentials}>
                        {t('settings.clearCredentials')}
                      </Button>
                    </Space>
                  </Card>
                </>
              ),
            },
            {
              key: '3',
              label: t('settings.data'),
              children: (
                <>
                  {/* 数据管理 */}
                  <Card title={t('settings.dataManagement')}>
                    <p>
                      <strong>{t('settings.databasePath')}:</strong> {databaseInfo.path}
                    </p>
                    <p>
                      <strong>{t('settings.databaseSize')}:</strong> {databaseInfo.size}
                    </p>

                    <Space style={{ marginTop: 15 }}>
                      <Button onClick={handleBackupData}>{t('settings.backupData')}</Button>
                      <Button onClick={handleRestoreData}>{t('settings.restoreData')}</Button>
                      <Button danger onClick={handleClearData}>
                        {t('settings.clearData')}
                      </Button>
                    </Space>

                    <Divider />

                    <div>
                      <div style={{ marginBottom: 8, fontWeight: 500 }}>
                        {t('settings.configImportExport')}
                      </div>
                      <Space>
                        <Button onClick={handleExportConfig}>{t('settings.exportConfig')}</Button>
                        <Button onClick={handleImportConfig}>{t('settings.importConfig')}</Button>
                      </Space>
                    </div>
                  </Card>
                </>
              ),
            },
            {
              key: '4',
              label: t('settings.about'),
              children: (
                <>
                  {/* 关于 */}
                  <Card title={t('settings.about')}>
                    <p>
                      <strong>{t('settings.aboutTitle')}</strong>
                    </p>
                    <p>{t('settings.version')}: V1.1.5</p>
                    <p>{t('settings.electronVersion')}: 28.1.0</p>
                    <p>{t('settings.reactVersion')}: 18.2.0</p>
                    <Divider />
                    <Space>
                      <Button onClick={handleViewLicense}>{t('settings.viewLicense')}</Button>
                      <Button onClick={handleCheckUpdate}>{t('settings.checkUpdate')}</Button>
                      <Button onClick={handleContactSupport}>{t('settings.contactSupport')}</Button>
                    </Space>
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

export default Settings;
