const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pageportGateway', {
  open: () => ipcRenderer.invoke('gateway:open'),
  quit: () => ipcRenderer.invoke('gateway:quit'),
});
