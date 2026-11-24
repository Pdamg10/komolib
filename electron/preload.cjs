const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('KomoDesktop', {
  isDesktop: true,
  platform: process.platform,
  openExternal: (url) => ipcRenderer.invoke('komo:openExternal', url),
});
