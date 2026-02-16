import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('creditforge', {
  getUsageData: () => ipcRenderer.invoke('get-usage-data'),
  getAlerts: (usageJson: string) => ipcRenderer.invoke('get-alerts', usageJson),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  openDashboard: () => ipcRenderer.invoke('open-dashboard'),
  getNightModeStatus: () => ipcRenderer.invoke('get-nightmode-status'),
  getMorningReport: () => ipcRenderer.invoke('get-morning-report'),
  getIntelligence: () => ipcRenderer.invoke('get-intelligence'),
  getBudgetPlan: () => ipcRenderer.invoke('get-budget-plan'),

  // Action channels
  checkLaunchdStatus: () => ipcRenderer.invoke('check-launchd-status'),
  installLaunchd: () => ipcRenderer.invoke('install-launchd'),
  runScan: () => ipcRenderer.invoke('run-scan'),
  runTask: (taskId: number) => ipcRenderer.invoke('run-task', taskId),
  runNightDryRun: () => ipcRenderer.invoke('run-night-dry-run'),

  onRefresh: (callback: () => void) => ipcRenderer.on('refresh', callback),
  onThemeChanged: (callback: (theme: string) => void) => {
    ipcRenderer.on('theme-changed', (_event, theme) => callback(theme));
  },
});
