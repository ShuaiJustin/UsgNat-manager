import { BrowserWindow, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron';
import path from 'path';

import { isDevMode } from './runtime-mode';
import { buildTrayMenuTemplate } from './tray-menu';
import { revealMainWindow } from './window-visibility';

type UpdateGate = {
  isMandatoryUpdateRequired: () => boolean;
  replayCurrentState: () => void;
  quitApp: () => void;
};

let tray: Tray | null = null;
let trayMainWindow: BrowserWindow | null = null;
let trayUpdateGate: UpdateGate | null = null;

export function refreshTrayMenu(): void {
  if (!tray || !trayMainWindow || !trayUpdateGate) {
    return;
  }

  const mainWindow = trayMainWindow;
  const updateGate = trayUpdateGate;
  const openUpdate = () => {
    revealMainWindow(mainWindow);
    updateGate.replayCurrentState();
  };
  const template = buildTrayMenuTemplate(() => updateGate.isMandatoryUpdateRequired(), {
    openMainWindow: () => revealMainWindow(mainWindow),
    openUpdate,
    startMonitor: () => mainWindow.webContents.send('monitor:start'),
    stopMonitor: () => mainWindow.webContents.send('monitor:stop'),
    quitApp: () => updateGate.quitApp(),
  });

  tray.setContextMenu(Menu.buildFromTemplate(template as MenuItemConstructorOptions[]));
}

export function createTray(mainWindow: BrowserWindow, updateGate: UpdateGate): Tray {
  const iconPath = isDevMode()
    ? path.join(__dirname, '../../resources/icons/app.ico')
    : path.join(process.resourcesPath, 'icon.ico');

  tray = new Tray(nativeImage.createFromPath(iconPath));
  trayMainWindow = mainWindow;
  trayUpdateGate = updateGate;

  tray.setToolTip('华为USG防火墙NAT管理软件');
  refreshTrayMenu();
  tray.on('double-click', () => {
    revealMainWindow(mainWindow);
  });

  return tray;
}
