export type TrayMenuItem = {
  label?: string;
  type?: 'separator';
  click?: () => void;
};

export type TrayMenuActions = {
  openMainWindow: () => void;
  openUpdate: () => void;
  startMonitor: () => void;
  stopMonitor: () => void;
  quitApp: () => void;
};

export const buildTrayMenuTemplate = (
  isMandatoryUpdateRequired: () => boolean,
  actions: TrayMenuActions
): TrayMenuItem[] => {
  if (isMandatoryUpdateRequired()) {
    return [
      { label: '打开更新', click: actions.openUpdate },
      { type: 'separator' },
      { label: '退出程序', click: actions.quitApp },
    ];
  }

  const runBusinessAction = (action: () => void) => () => {
    if (isMandatoryUpdateRequired()) {
      actions.openUpdate();
      return;
    }
    action();
  };

  return [
    { label: '打开主界面', click: actions.openMainWindow },
    { type: 'separator' },
    { label: '启动监控', click: runBusinessAction(actions.startMonitor) },
    { label: '停止监控', click: runBusinessAction(actions.stopMonitor) },
    { type: 'separator' },
    { label: '退出程序', click: actions.quitApp },
  ];
};
