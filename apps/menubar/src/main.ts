import { app, BrowserWindow, ipcMain, shell, nativeTheme } from 'electron';
import { menubar } from 'menubar';
import path from 'node:path';
import { getUsageData } from './data.js';
import { getAlerts } from './alerts.js';

const WINDOW_WIDTH = 400;
const WINDOW_HEIGHT = 650;
const REFRESH_INTERVAL_MS = 30_000;

let refreshTimer: ReturnType<typeof setInterval> | null = null;

function createMenubar() {
  const iconPath = path.join(__dirname, '..', 'assets', 'iconTemplate.png');
  const indexPath = path.join(__dirname, '..', 'ui', 'index.html');

  const mb = menubar({
    index: `file://${indexPath}`,
    icon: iconPath,
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
    // Set up IPC handlers
    ipcMain.handle('get-usage-data', () => getUsageData());
    ipcMain.handle('get-alerts', (_event, usageJson: string) => {
      return getAlerts(JSON.parse(usageJson));
    });
    ipcMain.handle('get-theme', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    ipcMain.handle('open-dashboard', () => {
      shell.openExternal('http://localhost:3141');
    });

    // Listen for theme changes
    nativeTheme.on('updated', () => {
      mb.window?.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    });
  });

  mb.on('after-show', () => {
    // Refresh immediately on show
    mb.window?.webContents.send('refresh');

    // Start periodic refresh
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
  createMenubar();
});

app.on('window-all-closed', (e: Event) => {
  e.preventDefault(); // Keep running in tray
});
