import 'dotenv/config';
import { app, BrowserWindow, powerMonitor, powerSaveBlocker, session } from 'electron';
import path from 'path';
import { initDatabase, closeDatabase } from './database';
import { registerIpcHandlers } from './ipc-handlers';
import { startScheduler, stopScheduler } from './scheduler';
import { startPollingScheduler, stopPollingScheduler } from './services/order.service';
import { seedBuiltinTemplates } from './services/mail/template.service';
import { logger } from './utils/logger';
import { stopWebhookServer } from './webhook-server';
import { startApiServer, stopApiServer } from './api-server';
import { cancelService } from './services/cancel.service';

let mainWindow: BrowserWindow | null = null;
let powerSaveBlockerId: number | null = null;

app.setName('Exocad Serial Manager');

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

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logger.error(`Renderer process gone: reason=${details.reason}, exitCode=${details.exitCode}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.reload();
    }
  });

  mainWindow.webContents.on('unresponsive', () => {
    logger.warn('Renderer unresponsive detected');
  });

  mainWindow.webContents.on('responsive', () => {
    logger.info('Renderer responsive again');
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logger.error(`Renderer load failed: ${errorCode} ${errorDescription} ${validatedURL}`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startPowerProtection(): void {
  if (powerSaveBlockerId === null) {
    powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    logger.info(`Power save blocker started: id=${powerSaveBlockerId}`);
  }

  powerMonitor.on('suspend', () => {
    logger.warn('System suspend detected');
  });

  powerMonitor.on('resume', () => {
    logger.info('System resume detected');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reloadIgnoringCache();
    }
  });

  powerMonitor.on('lock-screen', () => {
    logger.info('Windows lock-screen detected');
  });

  powerMonitor.on('unlock-screen', () => {
    logger.info('Windows unlock-screen detected');
  });
}

function stopPowerProtection(): void {
  if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    powerSaveBlocker.stop(powerSaveBlockerId);
    logger.info(`Power save blocker stopped: id=${powerSaveBlockerId}`);
  }
  powerSaveBlockerId = null;
}

app.whenReady().then(() => {
  logger.init();
  logger.info('App started');

  // ── Content Security Policy 설정 ───────────────────────────────────────────
  // 개발: Vite HMR(WebSocket) + eval 허용 / 프로덕션: strict CSP
  const isDev = process.env.NODE_ENV === 'development';
  const csp = isDev
    ? [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",   // Vite HMR(eval) + React Fast Refresh(inline script)
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",  // CSS-in-JS + Google Fonts
      "connect-src 'self' ws://localhost:5173 http://localhost:5173",
      "img-src 'self' data:",
      "font-src 'self' data: https://fonts.gstatic.com",
    ].join('; ')
    : [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data:",
      "font-src 'self' data: https://fonts.gstatic.com",
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
  seedBuiltinTemplates();
  registerIpcHandlers();
  startApiServer();
  createWindow();
  startPowerProtection();
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
  await stopApiServer();
  await stopWebhookServer();
  stopPowerProtection();
  stopScheduler();
  stopPollingScheduler(); // URL 폴링 스케줄러 정리
  await cancelService.cleanup();
  closeDatabase();
  logger.info('App exiting');
});
