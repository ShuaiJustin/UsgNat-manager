import { app, BrowserWindow, screen } from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';
import { isDevMode } from './runtime-mode';
import { customUpdater } from './services/custom-updater';
import { shouldBlockWindowClose } from './services/custom-updater-helpers';
import { DEV_SERVER_ORIGIN, isAllowedAppNavigation } from './window-navigation';

type AppWithQuitState = typeof app & {
  isQuitting?: boolean;
};

export function createWindow(): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const devMode = isDevMode();
  const rendererIndexPath = path.join(__dirname, '../renderer/index.html');

  const iconPath = devMode
    ? path.join(__dirname, '../../resources/icons/app.ico')
    : path.join(process.resourcesPath, 'icon.ico');

  const mainWindow = new BrowserWindow({
    width: Math.min(1280, width),
    height: Math.min(800, height),
    minWidth: 1024,
    minHeight: 768,
    title: '华为USG防火墙NAT管理软件',
    icon: iconPath,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#ffffff',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      devTools: devMode,
    },
  });

  mainWindow.setMenu(null);

  const appIndexUrl = pathToFileURL(rendererIndexPath).href;
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedAppNavigation(url, devMode, appIndexUrl)) {
      event.preventDefault();
    }
  });

  if (devMode) {
    mainWindow.loadURL(DEV_SERVER_ORIGIN);
  } else {
    mainWindow.loadFile(rendererIndexPath);
  }

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': devMode
          ? ["script-src 'self' 'unsafe-inline' 'unsafe-eval'; object-src 'none'"]
          : [
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
            ],
      },
    });
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (devMode) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('close', (event) => {
    const isQuitting = (app as AppWithQuitState).isQuitting === true;
    if (shouldBlockWindowClose(isQuitting, customUpdater.isMandatoryUpdateRequired())) {
      event.preventDefault();
      mainWindow.show();
      mainWindow.focus();
      if (!mainWindow.isVisible()) {
        customUpdater.replayCurrentState();
      }
      return;
    }

    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  return mainWindow;
}
