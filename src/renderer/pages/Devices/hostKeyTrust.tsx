import React from 'react';
import type { App } from 'antd';

type HookApi = ReturnType<typeof App.useApp>;

export type ObservedHostKey = {
  fingerprint: string;
  algorithm?: string;
  host: string;
  port: number;
  changed: boolean;
  trustedFingerprint?: string;
};

const fingerprintStyle: React.CSSProperties = { wordBreak: 'break-all', display: 'block' };

// One place for both host-key decisions after a rejected test connection: trusting a device the
// first time, or replacing a key that changed. Both require the administrator to verify the
// fingerprint through a trusted channel before confirming.
export const promptHostKeyTrust = ({
  modal,
  message,
  deviceId,
  hostKey,
  onTrusted,
}: {
  modal: HookApi['modal'];
  message: HookApi['message'];
  deviceId: string;
  hostKey: ObservedHostKey;
  onTrusted: () => void;
}) => {
  const decide = async () => {
    const api = window.electronAPI.device;
    const result = hostKey.changed
      ? await api.replaceHostKey(deviceId, hostKey.fingerprint)
      : await api.trustHostKey(deviceId, hostKey.fingerprint);
    if (!result.success) {
      message.error(result.message || result.error || '操作失败');
      throw new Error(result.message);
    }
    message.success(result.message || '已保存');
    onTrusted();
  };

  if (hostKey.changed) {
    modal.confirm({
      title: 'SSH 主机指纹已变化',
      width: 560,
      content: (
        <div>
          <p>
            {hostKey.host}:{hostKey.port} 返回的指纹和之前信任的不一样，连接已被拒绝。
            常见原因是设备重新生成或更换了 SSH
            主机密钥（含升级后改用另一种密钥算法）、双机热备切换到了另一台，
            或者这个地址后面换了设备；也可能是有人在冒充设备。
          </p>
          <p>
            核对方法：在可信网络中执行
            <code>
              ssh-keyscan -p {hostKey.port} {hostKey.host} | ssh-keygen -lf -
            </code>
            ，或在设备上用 <code>display rsa local-key-pair public</code> /
            <code>display ecc local-key-pair public</code>{' '}
            查看公钥，确认与下面的新指纹一致后再替换。
          </p>
          <p style={{ marginBottom: 4 }}>之前信任的指纹：</p>
          <code style={fingerprintStyle}>{hostKey.trustedFingerprint ?? '未知'}</code>
          <p style={{ margin: '8px 0 4px' }}>
            设备当前的指纹{hostKey.algorithm ? `（${hostKey.algorithm}）` : ''}：
          </p>
          <code style={fingerprintStyle}>{hostKey.fingerprint}</code>
        </div>
      ),
      okText: '已核实，替换为新指纹',
      okType: 'danger',
      cancelText: '取消',
      onOk: decide,
    });
    return;
  }

  modal.confirm({
    title: '首次信任 SSH 主机',
    content: (
      <div>
        <p>连接已拒绝。请通过设备控制台等可信渠道核对以下指纹；确认表示管理员已完成核对。</p>
        <p>
          {hostKey.host}:{hostKey.port}
          {hostKey.algorithm ? `（${hostKey.algorithm}）` : ''}
        </p>
        <code style={fingerprintStyle}>{hostKey.fingerprint}</code>
      </div>
    ),
    okText: '已核对指纹，信任此设备',
    cancelText: '取消',
    onOk: decide,
  });
};
