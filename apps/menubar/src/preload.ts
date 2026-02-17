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
  getSubscriptionView: () => ipcRenderer.invoke('get-subscription-view'),

  // Action channels
  checkLaunchdStatus: () => ipcRenderer.invoke('check-launchd-status'),
  installLaunchd: () => ipcRenderer.invoke('install-launchd'),
  runScan: () => ipcRenderer.invoke('run-scan'),
  runTask: (taskId: number) => ipcRenderer.invoke('run-task', taskId),
  runNightDryRun: () => ipcRenderer.invoke('run-night-dry-run'),

  // Task management channels
  toggleNightMode: () => ipcRenderer.invoke('toggle-nightmode'),
  skipTask: (taskId: number) => ipcRenderer.invoke('skip-task', taskId),
  deleteTask: (taskId: number) => ipcRenderer.invoke('delete-task', taskId),
  getAllTasks: () => ipcRenderer.invoke('get-all-tasks'),

  // Exclude paths channels
  getExcludePaths: () => ipcRenderer.invoke('get-exclude-paths'),
  setExcludePaths: (paths: string[]) => ipcRenderer.invoke('set-exclude-paths', paths),

  onRefresh: (callback: () => void) => ipcRenderer.on('refresh', callback),
  onThemeChanged: (callback: (theme: string) => void) => {
    ipcRenderer.on('theme-changed', (_event, theme) => callback(theme));
  },
});
