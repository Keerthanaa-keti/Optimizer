import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('creditforge', {
  getUsageData: () => ipcRenderer.invoke('get-usage-data'),
  getAlerts: (usageJson: string) => ipcRenderer.invoke('get-alerts', usageJson),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  openDashboard: () => ipcRenderer.invoke('open-dashboard'),
  onRefresh: (callback: () => void) => ipcRenderer.on('refresh', callback),
  onThemeChanged: (callback: (theme: string) => void) => {
    ipcRenderer.on('theme-changed', (_event, theme) => callback(theme));
  },
});
