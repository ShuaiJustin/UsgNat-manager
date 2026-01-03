import { BrowserWindow, screen, app } from 'electron';
import path from 'path';

export function createWindow(): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  // 图标路径 - 开发环境和生产环境分别处理
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
    frame: false, // 无边框窗口，使用自定义标题栏
    titleBarStyle: 'hidden',
    backgroundColor: '#ffffff',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // 开发环境允许 unsafe-eval 以支持 HMR，生产环境禁用
      devTools: process.env.NODE_ENV === 'development',
    },
  });

  // 完全移除菜单栏
  mainWindow.setMenu(null);

  // 加载应用
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5174');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // 设置内容安全策略
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        // 开发环境需要 unsafe-eval 支持 Vite HMR，生产环境禁用
        'Content-Security-Policy': process.env.NODE_ENV === 'development'
          ? ["script-src 'self' 'unsafe-inline' 'unsafe-eval'; object-src 'none'"]
          : ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"]
      }
    });
  });

  // 等页面准备好再显示，避免出现瞬时白屏
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 仅在开发环境打开开发者工具
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // 窗口关闭时隐藏到托盘
  mainWindow.on('close', (event) => {
    const isQuitting = (app as any).isQuitting;
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  return mainWindow;
}
