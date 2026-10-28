const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nenoz', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  onState: cb => ipcRenderer.on('state', (_, s) => cb(s)),
});
