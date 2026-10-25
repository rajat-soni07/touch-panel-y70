const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = ['config', 'status', 'stats', 'discord', 'steam'];

contextBridge.exposeInMainWorld('panel', {
  getConfig: () => ipcRenderer.invoke('config'),
  press: (id) => ipcRenderer.invoke('press', id),
  discord: (action) => ipcRenderer.invoke('discord', action),
  launchGame: (appId) => ipcRenderer.invoke('steam-launch', appId),
  on: (channel, fn) => {
    if (CHANNELS.includes(channel)) ipcRenderer.on(channel, (_e, data) => fn(data));
  },
});
