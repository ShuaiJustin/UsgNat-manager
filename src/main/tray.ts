import { Tray, Menu, BrowserWindow, nativeImage, app } from 'electron';
import path from 'path';

let tray: Tray | null = null;

export function createTray(mainWindow: BrowserWindow): Tray {
  // 创建托盘图标 - 开发环境和生产环境分别处理
  const iconPath =
    process.env.NODE_ENV === 'development'
      ? path.join(__dirname, '../../resources/icons/app.ico')
      : path.join(process.resourcesPath, 'icon.ico');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);

  // 创建托盘菜单
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开主界面',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      type: 'separator',
    },
    {
      label: '启动监控',
      click: async () => {
        mainWindow.webContents.send('monitor:start');
      },
    },
    {
      label: '停止监控',
      click: async () => {
        mainWindow.webContents.send('monitor:stop');
      },
    },
    {
      type: 'separator',
    },
    {
      label: '退出程序',
      click: () => {
        (app as any).isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('华为USG防火墙NAT管理软件');
  tray.setContextMenu(contextMenu);

  // 双击托盘图标显示主窗口
  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  return tray;
}
