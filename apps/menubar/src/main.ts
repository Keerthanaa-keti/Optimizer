import { app, ipcMain, shell, nativeTheme, nativeImage, Tray } from 'electron';
import { menubar } from 'menubar';
import path from 'node:path';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { getUsageData, getNightModeStatus, getMorningReport, getIntelligenceData, getSessionBudgetPlan, getSubscriptionView, toggleNightModeConfig, getAllQueuedTasks } from './data.js';
import { getAlerts } from './alerts.js';
import { startServer } from '@creditforge/dashboard';
import { checkAndNotify, type NotificationState } from './notifications.js';

const WINDOW_WIDTH = 400;
const WINDOW_HEIGHT = 580;
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

/** Find system Node.js (not Electron's embedded one) */
function findSystemNode(): string {
  const candidates = [
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return 'node'; // fallback to PATH
}

const SYSTEM_NODE = findSystemNode();

/** Spawn a CLI subcommand and return { stdout, stderr, exitCode } */
function spawnCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn(SYSTEM_NODE, [CLI_ENTRY, ...args], {
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
  ipcMain.handle('get-subscription-view', () => getSubscriptionView());

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

  // ─── Task Management IPC Handlers ─────────────────────
  ipcMain.handle('toggle-nightmode', () => {
    const newState = toggleNightModeConfig();
    return { enabled: newState };
  });

  ipcMain.handle('skip-task', (_event, taskId: number) => {
    const dbPath = path.join(process.env.HOME ?? '~', '.creditforge', 'creditforge.db');
    if (!fs.existsSync(dbPath)) return { success: false, error: 'DB not found' };
    try {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath);
      db.prepare("UPDATE tasks SET status = 'skipped', updated_at = datetime('now') WHERE id = ?").run(taskId);
      db.close();
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('delete-task', (_event, taskId: number) => {
    const dbPath = path.join(process.env.HOME ?? '~', '.creditforge', 'creditforge.db');
    if (!fs.existsSync(dbPath)) return { success: false, error: 'DB not found' };
    try {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath);
      // Delete child rows first to avoid FK constraint violations
      db.prepare('DELETE FROM executions WHERE task_id = ?').run(taskId);
      db.prepare('UPDATE ledger SET task_id = NULL WHERE task_id = ?').run(taskId);
      db.prepare('UPDATE pool_transactions SET task_id = NULL WHERE task_id = ?').run(taskId);
      db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
      db.close();
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('get-all-tasks', () => {
    return getAllQueuedTasks();
  });

  // --- Exclude Paths IPC Handlers ---
  ipcMain.handle('get-exclude-paths', () => {
    const configPath = path.join(OPTIMIZER_ROOT, 'creditforge.toml');
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const match = content.match(/exclude_paths\s*=\s*\[([\s\S]*?)\]/);
      if (!match) return [];
      return match[1].split(',')
        .map(s => s.trim().replace(/^"|"$/g, ''))
        .filter(s => s.length > 0);
    } catch {
      return [];
    }
  });

  ipcMain.handle('set-exclude-paths', (_event, paths: string[]) => {
    const configPath = path.join(OPTIMIZER_ROOT, 'creditforge.toml');
    try {
      let content = fs.readFileSync(configPath, 'utf-8');
      const arrayStr = paths.length > 0
        ? `[${paths.map(p => `"${p}"`).join(', ')}]`
        : '[]';

      if (content.includes('exclude_paths')) {
        // Replace existing (handle multi-line arrays too)
        content = content.replace(/exclude_paths\s*=\s*\[[\s\S]*?\]/, `exclude_paths = ${arrayStr}`);
      } else {
        // Add under [night_mode] section
        content = content.replace(
          /(\[night_mode\][^\[]*)/,
          `$1exclude_paths = ${arrayStr}\n`,
        );
      }
      fs.writeFileSync(configPath, content, 'utf-8');
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
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
        if (tray.isDestroyed()) return;
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
      if (mb.window && !mb.window.isDestroyed()) {
        mb.window.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
      }
    });
  });

  mb.on('after-show', () => {
    if (mb.window && !mb.window.isDestroyed()) {
      mb.window.webContents.send('refresh');
    }

    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      if (mb.window && !mb.window.isDestroyed()) {
        mb.window.webContents.send('refresh');
      }
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
