import { app, ipcMain, shell, nativeTheme, nativeImage, Tray } from 'electron';
import { menubar } from 'menubar';
import path from 'node:path';
import { getUsageData, getNightModeStatus, getMorningReport, getIntelligenceData } from './data.js';
import { getAlerts } from './alerts.js';
import { startServer } from '@creditforge/dashboard';

const WINDOW_WIDTH = 400;
const WINDOW_HEIGHT = 720;
const REFRESH_INTERVAL_MS = 30_000;
const DASHBOARD_PORT = 3141;

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let dashboardServer: ReturnType<typeof startServer> | null = null;

function createMenubar() {
  const indexPath = path.join(__dirname, '..', 'ui', 'index.html');

  // Create menubar icon: 22x22 gauge/meter as nativeImage
  const size = 22;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - 11, dy = y - 11;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const i = (y * size + x) * 4;
      if (dist >= 7.5 && dist <= 9.5) {
        buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = 255;
      } else if (dist <= 2) {
        buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = 255;
      }
    }
  }
  const icon = nativeImage.createFromBuffer(buf, { width: size, height: size });
  icon.setTemplateImage(true);

  // Register IPC handlers BEFORE creating menubar (preloadWindow triggers early loads)
  ipcMain.handle('get-usage-data', () => getUsageData());
  ipcMain.handle('get-alerts', (_event, usageJson: string, burnRateJson?: string) => {
    const burnRate = burnRateJson ? JSON.parse(burnRateJson) : undefined;
    return getAlerts(JSON.parse(usageJson), burnRate);
  });
  ipcMain.handle('get-theme', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
  ipcMain.handle('open-dashboard', () => {
    shell.openExternal('http://localhost:3141');
  });
  ipcMain.handle('get-nightmode-status', () => getNightModeStatus());
  ipcMain.handle('get-morning-report', () => getMorningReport());
  ipcMain.handle('get-intelligence', () => getIntelligenceData());

  const tray = new Tray(icon);
  tray.setToolTip('CreditForge');

  // Show text label in menubar
  try {
    const data = getUsageData();
    tray.setTitle(` CF ${data.sessionPct}%`);
  } catch {
    tray.setTitle(' CF');
  }

  const mb = menubar({
    tray,
    index: `file://${indexPath}`,
    preloadWindow: true,
    browserWindow: {
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    },
    showDockIcon: false,
    showOnAllWorkspaces: false,
  });

  mb.on('ready', () => {
    console.log('[CreditForge] Menubar ready');

    // Update tray title periodically (even when popup is hidden)
    setInterval(() => {
      try {
        const data = getUsageData();
        const nmStatus = getNightModeStatus();
        const queueLabel = nmStatus.queuedTasks > 0 ? ` [${nmStatus.queuedTasks}]` : '';
        tray.setTitle(` CF ${data.sessionPct}%${queueLabel}`);
      } catch { /* ignore */ }
    }, REFRESH_INTERVAL_MS);

    // Listen for theme changes
    nativeTheme.on('updated', () => {
      mb.window?.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    });
  });

  mb.on('after-show', () => {
    mb.window?.webContents.send('refresh');

    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      mb.window?.webContents.send('refresh');
    }, REFRESH_INTERVAL_MS);
  });

  mb.on('after-hide', () => {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  });

  return mb;
}

app.on('ready', () => {
  console.log('[CreditForge] App ready, starting dashboard server...');
  try {
    dashboardServer = startServer(DASHBOARD_PORT);
  } catch (err) {
    console.log('[CreditForge] Dashboard server failed (port may be in use):', err);
  }
  console.log('[CreditForge] Creating menubar...');
  createMenubar();
});

app.on('window-all-closed', () => {
  // Don't quit — keep running in tray
});
