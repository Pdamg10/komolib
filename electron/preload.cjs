const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('KomoDesktop', {
  isDesktop: true,
  platform: process.platform,
  openExternal: (url) => ipcRenderer.invoke('komo:openExternal', url),
  pickWatchFolder: () => ipcRenderer.invoke('komo:pickWatchFolder'),
  scanWatchFolder: (folderPath, knownKeys) =>
    ipcRenderer.invoke('komo:scanWatchFolder', folderPath, knownKeys),
  readWatchFile: (fullPath, rootHint) =>
    ipcRenderer.invoke('komo:readWatchFile', fullPath, rootHint),
});
