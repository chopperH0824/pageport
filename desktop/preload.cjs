const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pageportDesktop', {
  platform: process.platform,
  openDocument: () => ipcRenderer.invoke('pageport:open-document'),
  readDocument: token => ipcRenderer.invoke('pageport:read-document', token),
  saveDocument: payload => ipcRenderer.invoke('pageport:save-document', payload),
  updates: {
    state: () => ipcRenderer.invoke('pageport:update-state'),
    check: () => ipcRenderer.invoke('pageport:update-check'),
    download: () => ipcRenderer.invoke('pageport:update-download'),
    reveal: () => ipcRenderer.invoke('pageport:update-reveal'),
    release: () => ipcRenderer.invoke('pageport:update-release'),
    configure: automatic => ipcRenderer.invoke('pageport:update-configure', automatic),
    subscribe: callback => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('pageport:update-state', listener);
      return () => ipcRenderer.removeListener('pageport:update-state', listener);
    },
  },
});
