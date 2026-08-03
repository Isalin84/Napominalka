const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  getState: () => ipcRenderer.invoke('app:get-state'),
  saveState: (state) => ipcRenderer.invoke('app:save-state', state),
  testReminder: (key) => ipcRenderer.invoke('app:test-reminder', key),
  completePopup: (payload) => ipcRenderer.send('popup:complete', payload),
  snoozePopup: (payload) => ipcRenderer.send('popup:snooze', payload),
  openSettings: () => ipcRenderer.send('popup:open-settings'),
  openDeveloperSite: () => ipcRenderer.send('app:open-developer-site'),
  windowAction: (action) => ipcRenderer.send('window:action', action),
  onStateUpdated: (callback) => {
    const listener = (_event, nextState) => callback(nextState);
    ipcRenderer.on('app:state-updated', listener);
    return () => ipcRenderer.removeListener('app:state-updated', listener);
  },
  onReminderShown: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:reminder-shown', listener);
    return () => ipcRenderer.removeListener('app:reminder-shown', listener);
  },
  onNavigate: (callback) => {
    const listener = (_event, view) => callback(view);
    ipcRenderer.on('app:navigate', listener);
    return () => ipcRenderer.removeListener('app:navigate', listener);
  },
  onPopupReminder: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('popup:reminder', listener);
    return () => ipcRenderer.removeListener('popup:reminder', listener);
  }
});
