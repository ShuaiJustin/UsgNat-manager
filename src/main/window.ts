import { app, BrowserWindow, screen } from 'electron';
import path from 'path';

type AppWithQuitState = typeof app & {
  isQuitting?: boolean;
};

export function createWindow(): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const iconPath =
    process.env.NODE_ENV === 'development'
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
      preload: path.join(__dirname, 'preload.js'),
      devTools: process.env.NODE_ENV === 'development',
    },
  });

  mainWindow.setMenu(null);

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5174');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy':
          process.env.NODE_ENV === 'development'
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

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('close', (event) => {
    if (!(app as AppWithQuitState).isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  return mainWindow;
}
