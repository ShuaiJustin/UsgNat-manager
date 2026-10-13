import React, { useEffect, useRef } from 'react';
import {
  CalendarOutlined,
  CheckCircleOutlined,
  DownloadOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { List, message, Modal, Tag, Typography } from 'antd';
import {
  assertUpdaterActionSucceeded,
  clearActiveUpdaterModal,
  isClearUpdateDialogMessage,
  replaceActiveUpdaterModal,
  type DestroyableUpdaterModal,
} from './update-dialog-state';

const { Text } = Typography;

type UpdateChangelogItem = {
  type?: string;
  description?: string;
};

type UpdateDialogPayload = {
  type?:
    | 'no-update'
    | 'update-available'
    | 'update-downloading'
    | 'update-downloaded'
    | 'update-installed'
    | 'update-error'
    | 'download-error';
  version?: string;
  currentVersion?: string;
  changelog?: Array<UpdateChangelogItem | string>;
  releaseDate?: string;
  message?: string;
  isMandatory?: boolean;
  policySignature?: string;
};

type UpdaterMessage = {
  event?: 'show-update-dialog' | 'download-progress' | string;
  data?: UpdateDialogPayload & { percent?: number };
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : '未知错误';

const UpdateDialog: React.FC = () => {
  const [modal, contextHolder] = Modal.useModal();
  const activeModalRef = useRef<DestroyableUpdaterModal | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.on) {
      return;
    }

    const showModal = (createModal: () => DestroyableUpdaterModal) => {
      replaceActiveUpdaterModal(activeModalRef, createModal);
    };

    const handleUpdaterMessage = (payload: unknown) => {
      if (!isUpdaterMessage(payload)) {
        return;
      }

      if (isClearUpdateDialogMessage(payload)) {
        message.destroy('update-download');
        clearActiveUpdaterModal(activeModalRef);
        return;
      }

      if (payload.event === 'download-progress') {
        const percent = payload.data?.percent;
        if (typeof percent === 'number' && Number.isFinite(percent)) {
          message.loading({
            content: `正在下载更新 ${Math.min(100, Math.max(0, percent)).toFixed(0)}%`,
            key: 'update-download',
            duration: 0,
          });
        }
        return;
      }

      if (payload.event !== 'show-update-dialog' || !payload.data) {
        return;
      }

      const {
        changelog,
        currentVersion,
        isMandatory,
        message: errorMessage,
        policySignature,
        releaseDate,
        type,
        version,
      } = payload.data;

      switch (type) {
        case 'no-update':
          showModal(() =>
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
            })
          );
          return;
        case 'update-available':
          showModal(() =>
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

                  {isMandatory && <Tag color="red">强制更新</Tag>}

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
                      下载完成后将校验文件大小、SHA-256 和 Ed25519 数字签名。
                      <br />
                      安装前会自动创建数据备份，确保更新安全。
                      <br />
                      如果下载失败，将自动重试最多 3 次。
                    </Text>
                  </div>
                </div>
              ),
              okText: '立即下载',
              cancelText: isMandatory ? '退出应用' : '稍后提醒',
              keyboard: !isMandatory,
              maskClosable: !isMandatory,
              closable: !isMandatory,
              centered: true,
              onCancel: isMandatory ? () => api.updater.quitApp() : undefined,
              onOk: async () => {
                const download = async () => {
                  if (!api?.updater?.downloadUpdate) {
                    throw new Error('更新下载接口不可用');
                  }
                  return api.updater.downloadUpdate(version || '', policySignature || '');
                };

                if (isMandatory) {
                  try {
                    const result = await download();
                    assertUpdaterActionSucceeded(result, '下载失败');
                  } catch (error) {
                    message.error({
                      content: `下载失败: ${getErrorMessage(error)}`,
                      duration: 5,
                    });
                    throw error;
                  }
                  return;
                }

                showModal(() =>
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
                    okText: '知道了',
                    centered: true,
                    closable: true,
                    maskClosable: true,
                  })
                );

                void download()
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
              },
            })
          );
          return;
        case 'update-downloading':
          showModal(() =>
            modal.confirm({
              title: '正在下载强制更新',
              icon: <DownloadOutlined style={{ color: '#1890ff' }} />,
              content: `正在下载 v${version}，完成校验后即可安装。`,
              okButtonProps: { style: { display: 'none' } },
              cancelText: '退出应用',
              keyboard: false,
              maskClosable: false,
              closable: false,
              centered: true,
              onCancel: () => api.updater.quitApp(),
            })
          );
          return;
        case 'update-downloaded':
          message.destroy('update-download');
          showModal(() =>
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
                      {isMandatory && <Tag color="red">强制更新</Tag>}
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
                      应用将关闭，自动安装更新并重启。
                      <br />
                      请保存正在编辑的内容后再继续。
                    </Text>
                  </div>
                </div>
              ),
              okText: '立即安装',
              cancelText: isMandatory ? '退出应用' : '关闭',
              keyboard: !isMandatory,
              maskClosable: !isMandatory,
              closable: !isMandatory,
              centered: true,
              onCancel: isMandatory ? () => api.updater.quitApp() : undefined,
              onOk: async () => {
                try {
                  if (api?.updater?.quitAndInstall) {
                    const result = await api.updater.quitAndInstall(
                      version || '',
                      policySignature || ''
                    );
                    if (!result?.success) {
                      throw new Error(result?.message || '未知错误');
                    }
                  }
                } catch (error) {
                  message.error({
                    content: `安装失败: ${getErrorMessage(error)}`,
                    duration: 5,
                  });
                  throw error;
                }
              },
            })
          );
          return;
        case 'update-installed':
          showModal(() =>
            modal.success({
              title: '更新完成',
              content: `已成功更新到 v${version}。`,
              okText: '确定',
              centered: true,
            })
          );
          return;
        case 'update-error':
          showModal(() =>
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
            })
          );
          return;
        case 'download-error':
          message.destroy('update-download');
          if (isMandatory) {
            showModal(() =>
              modal.confirm({
                title: '下载失败',
                icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
                content: (
                  <div>
                    <p>强制更新下载失败，必须重试或退出应用。</p>
                    <p style={{ color: '#666', fontSize: 14 }}>{errorMessage}</p>
                  </div>
                ),
                okText: '重试下载',
                cancelText: '退出应用',
                keyboard: false,
                maskClosable: false,
                closable: false,
                centered: true,
                onCancel: () => api.updater.quitApp(),
                onOk: async () => {
                  try {
                    const result = await api.updater.downloadUpdate(
                      version || '',
                      policySignature || ''
                    );
                    assertUpdaterActionSucceeded(result, '下载失败');
                  } catch (error) {
                    message.error(`下载失败: ${getErrorMessage(error)}`);
                    throw error;
                  }
                },
              })
            );
            return;
          }

          showModal(() =>
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
            })
          );
          return;
        default:
          return;
      }
    };

    api.on('updater-message', handleUpdaterMessage);
    void api.updater.getState().then((state) => {
      if (state) {
        handleUpdaterMessage(state);
      }
    });

    return () => {
      api.off?.('updater-message', handleUpdaterMessage);
      clearActiveUpdaterModal(activeModalRef);
    };
  }, [modal]);

  return <>{contextHolder}</>;
};

const isUpdaterMessage = (value: unknown): value is UpdaterMessage =>
  typeof value === 'object' && value !== null;

export default UpdateDialog;
