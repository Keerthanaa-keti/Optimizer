import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('creditforge', {
  getUsageData: () => ipcRenderer.invoke('get-usage-data'),
  getAlerts: (usageJson: string) => ipcRenderer.invoke('get-alerts', usageJson),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  openDashboard: () => ipcRenderer.invoke('open-dashboard'),
  getNightModeStatus: () => ipcRenderer.invoke('get-nightmode-status'),
  getMorningReport: () => ipcRenderer.invoke('get-morning-report'),
  getIntelligence: () => ipcRenderer.invoke('get-intelligence'),
  onRefresh: (callback: () => void) => ipcRenderer.on('refresh', callback),
  onThemeChanged: (callback: (theme: string) => void) => {
    ipcRenderer.on('theme-changed', (_event, theme) => callback(theme));
  },
});
