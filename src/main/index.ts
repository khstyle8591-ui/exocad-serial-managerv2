import { app, BrowserWindow, session } from 'electron';
import path from 'path';
import { initDatabase, closeDatabase } from './database';
import { registerIpcHandlers } from './ipc-handlers';
import { startScheduler, stopScheduler } from './scheduler';
import { startPollingScheduler, stopPollingScheduler } from './services/order.service';
import { logger } from './utils/logger';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Exocad Serial Manager',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 개발 모드에서는 Vite dev server, 프로덕션에서는 빌드된 파일
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  logger.init();
  logger.info('앱 시작');

  // ── Content Security Policy 설정 ───────────────────────────────────────────
  // 개발: Vite HMR(WebSocket) + eval 허용 / 프로덕션: strict CSP
  const isDev = process.env.NODE_ENV === 'development';
  const csp = isDev
    ? [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",   // Vite HMR(eval) + React Fast Refresh(inline script)
      "style-src 'self' 'unsafe-inline'",  // CSS-in-JS 대응
      "connect-src 'self' ws://localhost:5173 http://localhost:5173",
      "img-src 'self' data:",
      "font-src 'self' data:",
    ].join('; ')
    : [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
    ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
  // ────────────────────────────────────────────────────────────────────────────

  initDatabase();
  registerIpcHandlers();
  createWindow();
  startScheduler();
  startPollingScheduler(); // URL 폴링 스케줄러 자동 시작

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  stopScheduler();
  stopPollingScheduler(); // URL 폴링 스케줄러 정리
  closeDatabase();
  logger.info('앱 종료');
});
