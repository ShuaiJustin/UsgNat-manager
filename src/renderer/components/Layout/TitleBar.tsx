import React, { useEffect, useState } from 'react';
import { AppstoreOutlined, BorderOutlined, CloseOutlined, MinusOutlined } from '@ant-design/icons';

const TitleBar: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const checkMaximized = async () => {
      const api = window.electronAPI;
      if (api?.window?.isMaximized) {
        setIsMaximized(await api.window.isMaximized());
      }
    };

    void checkMaximized();
  }, []);

  const handleMinimize = () => {
    void window.electronAPI.window?.minimize();
  };

  const handleMaximize = async () => {
    const api = window.electronAPI;
    if (api?.window?.maximize && api.window.isMaximized) {
      await api.window.maximize();
      setIsMaximized(await api.window.isMaximized());
    }
  };

  const handleClose = () => {
    void window.electronAPI.window?.close();
  };

  return (
    <div className="title-bar">
      <div className="title-bar-drag-region">
        <div className="title-bar-icon">
          <AppstoreOutlined style={{ fontSize: 15, color: '#fff' }} />
        </div>
        <div className="title-bar-title">华为USG防火墙NAT管理软件</div>
      </div>
      <div className="title-bar-controls">
        <button className="title-bar-button" onClick={handleMinimize} title="最小化">
          <MinusOutlined style={{ fontSize: 13 }} />
        </button>
        <button
          className="title-bar-button"
          onClick={() => void handleMaximize()}
          title={isMaximized ? '还原' : '最大化'}
        >
          <BorderOutlined style={{ fontSize: 12 }} />
        </button>
        <button className="title-bar-button title-bar-close" onClick={handleClose} title="关闭">
          <CloseOutlined style={{ fontSize: 13 }} />
        </button>
      </div>
    </div>
  );
};

export default TitleBar;
