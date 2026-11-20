const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setWatch: (v) => ipcRenderer.invoke('set-watch', v),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  showFile: (f) => ipcRenderer.invoke('show-file', f),
  parseUrl: (t) => ipcRenderer.invoke('parse-url', t),
  getInfo: (url) => ipcRenderer.invoke('get-info', url),
  download: (item) => ipcRenderer.invoke('download', item),
  cancel: () => ipcRenderer.invoke('cancel'),
  notify: (body) => ipcRenderer.invoke('notify', body),
  onLink: (cb) => ipcRenderer.on('link-detected', (_e, d) => cb(d)),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, d) => cb(d)),
  onEngineStatus: (cb) => ipcRenderer.on('engine-status', (_e, d) => cb(d)),
});
