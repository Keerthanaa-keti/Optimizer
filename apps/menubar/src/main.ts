import { app, ipcMain, shell, nativeTheme, nativeImage, Tray } from 'electron';
import { menubar } from 'menubar';
import path from 'node:path';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { getUsageData, getNightModeStatus, getMorningReport, getIntelligenceData, getSessionBudgetPlan } from './data.js';
import { getAlerts } from './alerts.js';
import { startServer } from '@creditforge/dashboard';
import { checkAndNotify, type NotificationState } from './notifications.js';

const WINDOW_WIDTH = 400;
const WINDOW_HEIGHT = 720;
const REFRESH_INTERVAL_MS = 30_000;
const DASHBOARD_PORT = 3141;
const OPTIMIZER_ROOT = path.join(process.env.HOME ?? '~', 'Documents', 'ClaudeExperiments', 'optimizer');
const CLI_ENTRY = path.join(OPTIMIZER_ROOT, 'apps', 'cli', 'dist', 'index.js');

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let dashboardServer: ReturnType<typeof startServer> | null = null;
const notificationState: NotificationState = {
  lastSessionThreshold: 0,
  lastReportDate: null,
  lastIdleNotifyDate: null,
};

/** Spawn a CLI subcommand and return { stdout, stderr, exitCode } */
function spawnCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn(process.execPath, [CLI_ENTRY, ...args], {
      cwd: OPTIMIZER_ROOT,
      env: { ...process.env, CI: 'true' },
      timeout: 120_000,
    });
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
    proc.on('error', (err) => resolve({ stdout: '', stderr: err.message, exitCode: 127 }));
  });
}

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
  ipcMain.handle('get-budget-plan', () => getSessionBudgetPlan());

  // ─── Action IPC Handlers ─────────────────────────────────

  ipcMain.handle('check-launchd-status', async () => {
    return new Promise<boolean>((resolve) => {
      const proc = spawn('launchctl', ['list'], { timeout: 5000 });
      let stdout = '';
      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.on('close', () => resolve(stdout.includes('com.creditforge')));
      proc.on('error', () => resolve(false));
    });
  });

  ipcMain.handle('install-launchd', async () => {
    const launchdSrc = path.join(OPTIMIZER_ROOT, 'launchd');
    const launchdDest = path.join(process.env.HOME ?? '~', 'Library', 'LaunchAgents');
    const logsDir = path.join(process.env.HOME ?? '~', '.creditforge', 'logs');
    const reportsDir = path.join(process.env.HOME ?? '~', '.creditforge', 'reports');

    // Ensure dirs exist
    fs.mkdirSync(logsDir, { recursive: true });
    fs.mkdirSync(reportsDir, { recursive: true });
    fs.mkdirSync(launchdDest, { recursive: true });

    const plists = ['com.creditforge.nightmode.plist', 'com.creditforge.scanner.plist'];
    const results: string[] = [];

    for (const plist of plists) {
      const src = path.join(launchdSrc, plist);
      const dest = path.join(launchdDest, plist);
      if (!fs.existsSync(src)) {
        results.push(`SKIP: ${plist} not found in source`);
        continue;
      }
      fs.copyFileSync(src, dest);
      // Load the agent
      await new Promise<void>((resolve) => {
        const proc = spawn('launchctl', ['load', dest], { timeout: 5000 });
        proc.on('close', () => resolve());
        proc.on('error', () => resolve());
      });
      results.push(`OK: ${plist} installed and loaded`);
    }
    return { success: true, results };
  });

  ipcMain.handle('run-scan', async () => {
    return spawnCli(['scan']);
  });

  ipcMain.handle('run-task', async (_event, taskId: number) => {
    return spawnCli(['run', '--task', String(taskId)]);
  });

  ipcMain.handle('run-night-dry-run', async () => {
    return spawnCli(['run', '--mode', 'night', '--dry-run']);
  });

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

    // Update tray title periodically + check notifications
    setInterval(() => {
      try {
        const data = getUsageData();
        const nmStatus = getNightModeStatus();
        const queueLabel = nmStatus.queuedTasks > 0 ? ` [${nmStatus.queuedTasks}]` : '';
        tray.setTitle(` CF ${data.sessionPct}%${queueLabel}`);

        // Fire notifications on threshold crossings
        checkAndNotify(data, nmStatus, notificationState);
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
