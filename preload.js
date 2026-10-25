const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = ['config', 'status', 'stats', 'discord', 'games'];

contextBridge.exposeInMainWorld('panel', {
  getConfig: () => ipcRenderer.invoke('config'),
  press: (id) => ipcRenderer.invoke('press', id),
  discord: (action) => ipcRenderer.invoke('discord', action),
  launchGame: (key) => ipcRenderer.invoke('game-launch', key),
  on: (channel, fn) => {
    if (CHANNELS.includes(channel)) ipcRenderer.on(channel, (_e, data) => fn(data));
  },
});
