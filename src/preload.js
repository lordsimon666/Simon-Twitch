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
  onViewReload: (cb) => ipcRenderer.on('view:reload', () => cb()),

  // Anmeldung (für die ganze App)
  getAuth: () => ipcRenderer.invoke('auth:get'),
  login: () => ipcRenderer.send('auth:login'),
  logout: () => ipcRenderer.send('auth:logout'),
  continueAsGuest: (remember) => ipcRenderer.send('auth:guest', remember),
  onAuth: (cb) => ipcRenderer.on('auth:changed', (_e, auth) => cb(auth)),
});
