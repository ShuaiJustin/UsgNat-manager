import React, { useEffect } from 'react';
import { Modal, Tag, List, Typography, message } from 'antd';
import {
  InfoCircleOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  DownloadOutlined,
  SafetyCertificateOutlined,
  CalendarOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

/**
 * 更新对话框组件
 * 监听主进程的更新消息并显示 Ant Design 风格的对话框
 * 
 * 功能：
 * - 显示更新日志
 * - 实时下载进度
 * - 完整性校验提示
 * - 自动备份提示
 */
const UpdateDialog: React.FC = () => {
  const [modal, contextHolder] = Modal.useModal();

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.on) return;

    // 先清理可能存在的旧监听器
    if (api?.off) {
      api.off('updater-message', null);
    }

    // 监听更新消息（包括下载进度）
    const handleUpdaterMessage = (_event: any, payload: any) => {
      // 安全检查：确保 payload 存在且有 event 属性
      if (!payload || typeof payload !== 'object' || !payload.event) {
        // 静默忽略无效消息，避免控制台错误
        return;
      }

      const { event: eventType, data } = payload;

      // 忽略下载进度消息（后台下载）
      if (eventType === 'download-progress') {
        return;
      }

      // 忽略其他非对话框消息
      if (eventType !== 'show-update-dialog') {
        return;
      }

      // 安全检查：确保 data 存在
      if (!data || typeof data !== 'object') {
        console.warn('UpdateDialog: show-update-dialog 缺少 data', payload);
        return;
      }

      const {
        type,
        version,
        currentVersion,
        changelog,
        releaseDate,
        message: errorMessage,
      } = data;

      switch (type) {
        case 'no-update':
          // 无可用更新
          modal.info({
            title: '无可用更新',
            icon: <InfoCircleOutlined style={{ color: '#1890ff' }} />,
            content: (
              <div>
                <p>当前已是最新版本</p>
                <p style={{ color: '#666', fontSize: '14px' }}>当前版本: v{version}</p>
              </div>
            ),
            okText: '确定',
            centered: true,
          });
          break;

        case 'update-available':
          // 发现新版本 - 显示详细的更新信息
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
                {/* 版本信息 */}
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

                {/* 发布日期 */}
                {releaseDate && (
                  <div style={{ marginBottom: 12 }}>
                    <CalendarOutlined style={{ marginRight: 6 }} />
                    <Text type="secondary">发布日期: {releaseDate}</Text>
                  </div>
                )}

                {/* 更新日志 */}
                {changelog && changelog.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ marginBottom: 8, fontWeight: 'bold' }}>
                      更新内容
                    </div>
                    <List
                      size="small"
                      bordered
                      dataSource={changelog}
                      style={{ background: '#fff' }}
                      renderItem={(item: any) => (
                        <List.Item style={{ padding: '8px 16px' }}>
                          <div style={{ width: '100%' }}>
                            {item.type && (
                              <Tag
                                color={
                                  item.type === 'feature'
                                    ? 'green'
                                    : item.type === 'fix'
                                      ? 'orange'
                                      : item.type === 'improve'
                                        ? 'blue'
                                        : 'default'
                                }
                                style={{ marginRight: 8 }}
                              >
                                {item.type === 'feature'
                                  ? '新功能'
                                  : item.type === 'fix'
                                    ? 'Bug修复'
                                    : item.type === 'improve'
                                      ? '优化'
                                      : item.type}
                              </Tag>
                            )}
                            <Text>{item.description || item}</Text>
                          </div>
                        </List.Item>
                      )}
                    />
                  </div>
                )}

                {/* 提示信息 */}
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
                    下载完成后将自动校验文件完整性（SHA256）
                    <br />
                    安装前会自动创建数据备份，确保安全
                    <br />
                    如下载失败，将自动重试最多3次
                  </Text>
                </div>
              </div>
            ),
            okText: '立即下载',
            cancelText: '稍后提醒',
            centered: true,
            onOk: () => {
              // 显示可最小化的下载提示
              modal.info({
                title: '正在后台下载更新',
                content: (
                  <div>
                    <p>更新正在后台下载，您可以继续使用应用</p>
                    <p style={{ color: '#999', fontSize: 12, marginTop: 8 }}>
                      下载完成后会自动提示安装
                    </p>
                  </div>
                ),
                okText: '最小化',
                centered: true,
                closable: true,
                maskClosable: true,
              });

              // 调用下载更新（异步，不等待）
              if (api?.updater?.downloadUpdate) {
                api.updater.downloadUpdate();
              }
            },
          });
          break;

        case 'update-downloaded':
          // 更新下载完成
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
                    安装前将自动创建数据备份
                    <br />
                    应用将关闭并启动安装程序
                    <br />
                    安装完成后请重新启动应用
                  </Text>
                </div>

                <div style={{ marginTop: 16, textAlign: 'center' }}>
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    是否立即安装更新？
                  </Text>
                </div>
              </div>
            ),
            okText: '立即安装',
            cancelText: '稍后安装',
            centered: true,
            okButtonProps: { type: 'primary', danger: false },
            onOk: async () => {
              // 退出并安装
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
          break;

        case 'update-error':
          // 检查更新失败
          modal.error({
            title: '检查更新失败',
            icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
            content: (
              <div>
                <p>无法连接到更新服务器</p>
                <p style={{ color: '#666', fontSize: '14px' }}>{errorMessage}</p>
              </div>
            ),
            okText: '确定',
            centered: true,
          });
          break;

        case 'download-error':
          // 下载失败
          modal.error({
            title: '下载失败',
            icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
            content: (
              <div>
                <p>更新下载失败</p>
                <p style={{ color: '#666', fontSize: '14px' }}>{errorMessage}</p>
              </div>
            ),
            okText: '确定',
            centered: true,
          });
          break;

        default:
          break;
      }
    };

    // 注册监听器
    api.on('updater-message', handleUpdaterMessage);

    // 清理监听器
    return () => {
      if (api?.off) {
        api.off('updater-message', handleUpdaterMessage);
      }
    };
  }, [modal]); // 移除 downloadProgress 依赖，避免重复注册监听器

  return <>{contextHolder}</>;
};

export default UpdateDialog;
