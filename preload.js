const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = ['config', 'status', 'stats'];

contextBridge.exposeInMainWorld('panel', {
  getConfig: () => ipcRenderer.invoke('config'),
  press: (id) => ipcRenderer.invoke('press', id),
  on: (channel, fn) => {
    if (CHANNELS.includes(channel)) ipcRenderer.on(channel, (_e, data) => fn(data));
  },
});
