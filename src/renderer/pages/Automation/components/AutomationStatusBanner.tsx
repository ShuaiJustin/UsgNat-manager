import React, { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button } from 'antd';

type LiveStatus = {
  isRunning?: boolean;
  isUpdating?: boolean;
  currentIP?: string | null;
  lastAppliedIP?: string | null;
  needsAttention?: boolean;
  attentionReason?: string | null;
  config?: { autoUpdateEnabled?: boolean; managedRuleIds?: string[] };
};

const POLL_MS = 10000;

// Live state of the automation service, so the page answers "is it working?" at a glance.
// refreshKey lets a parent request an immediate refresh after it changed the configuration.
const AutomationStatusBanner: React.FC<{ refreshKey?: number }> = ({ refreshKey }) => {
  const { message } = App.useApp();
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [retrying, setRetrying] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus((await window.electronAPI?.automation?.getStatus<LiveStatus>()) ?? null);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh, refreshKey]);

  const retry = async () => {
    setRetrying(true);
    try {
      const result = await window.electronAPI.automation.manualUpdate();
      if (result.success) message.success('已重新核对并更新');
      else message.error(result.error || '更新失败');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '更新失败');
    } finally {
      setRetrying(false);
      void refresh();
    }
  };

  if (!status) return null;
  const ip = status.currentIP || '尚未检测到';

  if (status.needsAttention)
    return (
      <Alert
        type="error"
        showIcon
        style={{ marginBottom: 16 }}
        message="自动更新已暂停：连续多次失败"
        description={status.attentionReason || '请检查设备连接和凭据后重试。'}
        action={
          <Button size="small" danger loading={retrying} onClick={() => void retry()}>
            重试
          </Button>
        }
      />
    );

  if (!status.isRunning)
    return (
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="IP 监控未运行"
        description="在仪表板或系统设置中启动监控后，这里的策略才会生效。"
      />
    );

  // Reflects the running (saved) configuration, not unsaved edits on this page.
  if (!status.config?.autoUpdateEnabled)
    return (
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={`正在监控公网 IP：${ip}`}
        description="自动更新未开启，IP 变化时只会通知，不会修改规则。"
      />
    );

  const synced = status.lastAppliedIP && status.lastAppliedIP === status.currentIP;
  return (
    <Alert
      type={synced ? 'success' : 'info'}
      showIcon
      style={{ marginBottom: 16 }}
      message={
        status.isUpdating
          ? `正在更新规则到 ${ip}…`
          : synced
            ? `自动更新运行中：${status.config.managedRuleIds?.length ?? 0} 条规则已指向 ${ip}`
            : `自动更新运行中：当前公网 IP ${ip}`
      }
    />
  );
};

export default AutomationStatusBanner;
