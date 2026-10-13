import React, { useCallback, useEffect, useRef } from 'react';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { App } from 'antd';

import type { AutomationConfirmRequest } from '@/types';

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : '确认请求已失效或不存在';

const AutomationConfirmDialog: React.FC = () => {
  const { modal, message } = App.useApp();
  const activeRequestIdRef = useRef<string | null>(null);
  const activeDialogRef = useRef<{ destroy: () => void } | null>(null);
  const expiryTimerRef = useRef<number | null>(null);

  const clearActiveDialog = useCallback(() => {
    if (expiryTimerRef.current !== null) {
      window.clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }

    activeDialogRef.current?.destroy();
    activeDialogRef.current = null;
    activeRequestIdRef.current = null;
  }, []);

  const respondToRequest = useCallback(
    async (requestId: string, confirmed: boolean) => {
      const api = window.electronAPI;
      if (!api?.automation?.confirmResponse) {
        throw new Error('自动化确认接口不可用');
      }

      const result = await api.automation.confirmResponse(requestId, confirmed);
      if (!result?.success) {
        throw new Error(result?.error || '确认请求已失效或不存在');
      }

      clearActiveDialog();
      return result;
    },
    [clearActiveDialog]
  );

  const openConfirmDialog = useCallback(
    (request: AutomationConfirmRequest) => {
      if (activeRequestIdRef.current === request.requestId) {
        return;
      }

      clearActiveDialog();

      const remainingMs = Math.max(request.expiresAt - Date.now(), 0);
      if (remainingMs === 0) {
        message.info('自动更新确认已超时，已取消本次更新');
        return;
      }

      activeRequestIdRef.current = request.requestId;
      expiryTimerRef.current = window.setTimeout(() => {
        if (activeRequestIdRef.current !== request.requestId) {
          return;
        }

        activeDialogRef.current?.destroy();
        activeDialogRef.current = null;
        activeRequestIdRef.current = null;
        expiryTimerRef.current = null;
        message.info('自动更新确认已超时，已取消本次更新');
      }, remainingMs);

      activeDialogRef.current = modal.confirm({
        title: '确认自动更新 NAT 规则',
        icon: <ExclamationCircleOutlined style={{ color: '#1890ff' }} />,
        width: 520,
        content: (
          <div>
            <p style={{ marginBottom: 16 }}>检测到 IP 地址变化，系统准备自动更新 NAT 规则。</p>
            <div style={{ background: '#f0f7ff', padding: 12, borderRadius: 4, marginBottom: 16 }}>
              <p style={{ margin: 0, fontWeight: 'bold' }}>更新信息：</p>
              <ul style={{ marginBottom: 0, marginTop: 8 }}>
                <li>
                  新 IP 地址: <strong style={{ color: '#1890ff' }}>{request.newIP}</strong>
                </li>
                <li>
                  更新设备数量: <strong>{request.deviceCount}</strong> 台
                </li>
              </ul>
            </div>
            <p style={{ color: '#666', fontSize: 12, marginBottom: 0 }}>
              点击“确认”继续更新，或点击“取消”跳过本次更新。
            </p>
          </div>
        ),
        okText: '确认更新',
        cancelText: '取消',
        okType: 'primary',
        onOk: async () => {
          try {
            await respondToRequest(request.requestId, true);
            message.success('已确认，开始更新...');
          } catch (error) {
            message.warning(getErrorMessage(error));
          }
        },
        onCancel: async () => {
          try {
            await respondToRequest(request.requestId, false);
            message.info('已取消更新');
          } catch (error) {
            message.warning(getErrorMessage(error));
          }
        },
      });
    },
    [clearActiveDialog, message, modal, respondToRequest]
  );

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.automation?.onConfirmRequest) {
      return;
    }

    const handleConfirmRequest = (request: AutomationConfirmRequest) => {
      openConfirmDialog(request);
    };
    const handleConfirmCancelled = () => {
      clearActiveDialog();
    };

    api.automation.onConfirmRequest(handleConfirmRequest);
    api.automation.onConfirmCancelled?.(handleConfirmCancelled);

    if (api.automation.getPendingConfirm) {
      void api.automation.getPendingConfirm().then((request) => {
        if (request) {
          openConfirmDialog(request);
        }
      });
    }

    return () => {
      api.automation.removeConfirmRequestListener?.(handleConfirmRequest);
      api.automation.removeConfirmCancelledListener?.(handleConfirmCancelled);
      clearActiveDialog();
    };
  }, [clearActiveDialog, openConfirmDialog]);

  return null;
};

export default AutomationConfirmDialog;
