const { contextBridge, ipcRenderer } = require('electron');
const inv = (c, ...a) => ipcRenderer.invoke(c, ...a);
contextBridge.exposeInMainWorld('claude', {
  ask: p => inv('claude:ask', p),
  setKey: k => inv('claude:setKey', k),
  clearKey: () => inv('claude:clearKey'),
  newChat: () => inv('claude:new'),
  stop: () => inv('claude:stop'),
  onState: cb => ipcRenderer.on('panel-state', (_, s) => cb(s)),
  onDelta: cb => ipcRenderer.on('panel-delta', (_, t) => cb(t)),
  onCtx: cb => ipcRenderer.on('panel-ctx', (_, c) => cb(c)),
});
