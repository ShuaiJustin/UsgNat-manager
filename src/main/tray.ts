import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron';
import path from 'path';

import { revealMainWindow } from './window-visibility';

type AppWithQuitState = typeof app & {
  isQuitting?: boolean;
};

let tray: Tray | null = null;

export function createTray(mainWindow: BrowserWindow): Tray {
  const iconPath =
    process.env.NODE_ENV === 'development'
      ? path.join(__dirname, '../../resources/icons/app.ico')
      : path.join(process.resourcesPath, 'icon.ico');

  tray = new Tray(nativeImage.createFromPath(iconPath));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开主界面',
      click: () => {
        revealMainWindow(mainWindow);
      },
    },
    { type: 'separator' },
    {
      label: '启动监控',
      click: () => {
        mainWindow.webContents.send('monitor:start');
      },
    },
    {
      label: '停止监控',
      click: () => {
        mainWindow.webContents.send('monitor:stop');
      },
    },
    { type: 'separator' },
    {
      label: '退出程序',
      click: () => {
        (app as AppWithQuitState).isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('华为USG防火墙NAT管理软件');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    revealMainWindow(mainWindow);
  });

  return tray;
}
