'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('twitch', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  getChannels: () => ipcRenderer.invoke('channels:get'),
  addChannel: (channel) => ipcRenderer.invoke('channels:add', channel),
  removeChannel: (channel) => ipcRenderer.invoke('channels:remove', channel),
  channelFromUrl: (url) => ipcRenderer.invoke('url:channel', url),
  openWindow: (name) => ipcRenderer.send('window:open', name),
  onChannels: (cb) => ipcRenderer.on('channels:changed', (_e, channels) => cb(channels)),
  onToast: (cb) => ipcRenderer.on('toast', (_e, msg) => cb(msg)),
});
