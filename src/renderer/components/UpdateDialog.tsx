import React, { useEffect } from 'react';
import {
  CalendarOutlined,
  CheckCircleOutlined,
  DownloadOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { List, message, Modal, Tag, Typography } from 'antd';

const { Text } = Typography;

type UpdateChangelogItem = {
  type?: string;
  description?: string;
};

type UpdateDialogPayload = {
  type?: 'no-update' | 'update-available' | 'update-downloaded' | 'update-error' | 'download-error';
  version?: string;
  currentVersion?: string;
  changelog?: Array<UpdateChangelogItem | string>;
  releaseDate?: string;
  message?: string;
};

type UpdaterMessage = {
  event?: 'show-update-dialog' | 'download-progress' | string;
  data?: UpdateDialogPayload;
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : '未知错误';

const UpdateDialog: React.FC = () => {
  const [modal, contextHolder] = Modal.useModal();

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.on) {
      return;
    }

    const handleUpdaterMessage = (payload: unknown) => {
      if (!isUpdaterMessage(payload)) {
        return;
      }

      if (payload.event === 'download-progress') {
        return;
      }

      if (payload.event !== 'show-update-dialog' || !payload.data) {
        return;
      }

      const {
        changelog,
        currentVersion,
        message: errorMessage,
        releaseDate,
        type,
        version,
      } = payload.data;

      switch (type) {
        case 'no-update':
          modal.info({
            title: '无可用更新',
            icon: <InfoCircleOutlined style={{ color: '#1890ff' }} />,
            content: (
              <div>
                <p>当前已是最新版本。</p>
                <p style={{ color: '#666', fontSize: 14 }}>当前版本: v{version}</p>
              </div>
            ),
            okText: '确定',
            centered: true,
          });
          return;
        case 'update-available':
          modal.confirm({
            title: (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <DownloadOutlined style={{ color: '#1890ff' }} />
                <span>发现新版本</span>
              </div>
            ),
            icon: null,
            width: 600,
            content: (
              <div style={{ padding: '16px 0' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 16,
                    padding: 12,
                    background: '#f5f5f5',
                    borderRadius: 6,
                  }}
                >
                  <div>
                    <Text type="secondary">当前版本</Text>
                    <div style={{ fontSize: 18, fontWeight: 'bold', marginTop: 4 }}>
                      v{currentVersion}
                    </div>
                  </div>
                  <div style={{ textAlign: 'center', padding: '0 16px' }}>
                    <Text type="secondary">→</Text>
                  </div>
                  <div>
                    <Text type="secondary">最新版本</Text>
                    <div
                      style={{
                        fontSize: 18,
                        fontWeight: 'bold',
                        color: '#52c41a',
                        marginTop: 4,
                      }}
                    >
                      v{version}
                    </div>
                  </div>
                </div>

                {releaseDate && (
                  <div style={{ marginBottom: 12 }}>
                    <CalendarOutlined style={{ marginRight: 6 }} />
                    <Text type="secondary">发布日期: {releaseDate}</Text>
                  </div>
                )}

                {changelog && changelog.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ marginBottom: 8, fontWeight: 'bold' }}>更新内容</div>
                    <List
                      size="small"
                      bordered
                      dataSource={changelog}
                      style={{ background: '#fff' }}
                      renderItem={(item) => {
                        const normalizedItem =
                          typeof item === 'string' ? { description: item } : item;
                        const normalizedType = normalizedItem.type || 'default';

                        return (
                          <List.Item style={{ padding: '8px 16px' }}>
                            <div style={{ width: '100%' }}>
                              <Tag
                                color={
                                  normalizedType === 'feature'
                                    ? 'green'
                                    : normalizedType === 'fix'
                                      ? 'orange'
                                      : normalizedType === 'improve'
                                        ? 'blue'
                                        : 'default'
                                }
                                style={{ marginRight: 8 }}
                              >
                                {normalizedType === 'feature'
                                  ? '新功能'
                                  : normalizedType === 'fix'
                                    ? 'Bug 修复'
                                    : normalizedType === 'improve'
                                      ? '优化'
                                      : normalizedType}
                              </Tag>
                              <Text>{normalizedItem.description || ''}</Text>
                            </div>
                          </List.Item>
                        );
                      }}
                    />
                  </div>
                )}

                <div
                  style={{
                    marginTop: 16,
                    padding: 12,
                    background: '#e6f7ff',
                    border: '1px solid #91d5ff',
                    borderRadius: 4,
                  }}
                >
                  <div style={{ marginBottom: 4 }}>
                    <SafetyCertificateOutlined style={{ marginRight: 6, color: '#1890ff' }} />
                    <Text strong>更新说明</Text>
                  </div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    下载完成后将自动校验文件完整性（SHA256）。
                    <br />
                    安装前会自动创建数据备份，确保更新安全。
                    <br />
                    如果下载失败，将自动重试最多 3 次。
                  </Text>
                </div>
              </div>
            ),
            okText: '立即下载',
            cancelText: '稍后提醒',
            centered: true,
            onOk: () => {
              modal.info({
                title: '正在后台下载更新',
                content: (
                  <div>
                    <p>更新正在后台下载，您可以继续使用应用。</p>
                    <p style={{ color: '#999', fontSize: 12, marginTop: 8 }}>
                      下载完成后会自动提示安装。
                    </p>
                  </div>
                ),
                okText: '最小化',
                centered: true,
                closable: true,
                maskClosable: true,
              });

              if (api?.updater?.downloadUpdate) {
                void api.updater
                  .downloadUpdate()
                  .then((result) => {
                    if (!result?.success) {
                      message.error({
                        content: `下载失败: ${result?.message || '未知错误'}`,
                        duration: 5,
                      });
                    }
                  })
                  .catch((error) => {
                    message.error({
                      content: `下载失败: ${getErrorMessage(error)}`,
                      duration: 5,
                    });
                  });
              }
            },
          });
          return;
        case 'update-downloaded':
          modal.confirm({
            title: (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircleOutlined style={{ color: '#52c41a' }} />
                <span>更新已下载</span>
              </div>
            ),
            icon: null,
            width: 500,
            content: (
              <div style={{ padding: '16px 0' }}>
                <div style={{ marginBottom: 16, textAlign: 'center' }}>
                  <div
                    style={{
                      display: 'inline-block',
                      padding: '12px 24px',
                      background: '#f6ffed',
                      border: '1px solid #b7eb8f',
                      borderRadius: 6,
                    }}
                  >
                    <Text strong style={{ fontSize: 16, color: '#52c41a' }}>
                      v{version}
                    </Text>
                    <div style={{ marginTop: 4 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        下载完成，校验通过
                      </Text>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 16,
                    padding: 12,
                    background: '#fffbe6',
                    border: '1px solid #ffe58f',
                    borderRadius: 4,
                  }}
                >
                  <div style={{ marginBottom: 4 }}>
                    <SafetyCertificateOutlined style={{ marginRight: 6, color: '#faad14' }} />
                    <Text strong>安装提示</Text>
                  </div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    安装前会自动创建数据备份。
                    <br />
                    应用将关闭并启动安装程序。
                    <br />
                    安装完成后请重新启动应用。
                  </Text>
                </div>
              </div>
            ),
            okText: '立即安装',
            cancelText: '稍后安装',
            centered: true,
            onOk: async () => {
              try {
                if (api?.updater?.quitAndInstall) {
                  const result = await api.updater.quitAndInstall();
                  if (!result?.success) {
                    throw new Error(result?.message || '未知错误');
                  }
                }
              } catch (error) {
                message.error({
                  content: `安装失败: ${getErrorMessage(error)}`,
                  duration: 5,
                });
              }
            },
          });
          return;
        case 'update-error':
          modal.error({
            title: '检查更新失败',
            icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
            content: (
              <div>
                <p>无法连接到更新服务器。</p>
                <p style={{ color: '#666', fontSize: 14 }}>{errorMessage}</p>
              </div>
            ),
            okText: '确定',
            centered: true,
          });
          return;
        case 'download-error':
          modal.error({
            title: '下载失败',
            icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
            content: (
              <div>
                <p>更新下载失败。</p>
                <p style={{ color: '#666', fontSize: 14 }}>{errorMessage}</p>
              </div>
            ),
            okText: '确定',
            centered: true,
          });
          return;
        default:
          return;
      }
    };

    api.on('updater-message', handleUpdaterMessage);

    return () => {
      api.off?.('updater-message', handleUpdaterMessage);
    };
  }, [modal]);

  return <>{contextHolder}</>;
};

const isUpdaterMessage = (value: unknown): value is UpdaterMessage =>
  typeof value === 'object' && value !== null;

export default UpdateDialog;
