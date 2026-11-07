'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('twitch', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  getChannels: () => ipcRenderer.invoke('channels:get'),
  addChannel: (channel) => ipcRenderer.invoke('channels:add', channel),
  removeChannel: (channel) => ipcRenderer.invoke('channels:remove', channel),
  channelFromUrl: (url) => ipcRenderer.invoke('url:channel', url),
  openWindow: (name) => ipcRenderer.send('window:open', name),
  toggleWindow: (name) => ipcRenderer.send('window:toggle', name),
  getWindowState: () => ipcRenderer.invoke('windows:get'),
  onWindowState: (cb) => ipcRenderer.on('windows:state', (_e, st) => cb(st)),
  onChannels: (cb) => ipcRenderer.on('channels:changed', (_e, channels) => cb(channels)),
  onToast: (cb) => ipcRenderer.on('toast', (_e, msg) => cb(msg)),
  onViewReload: (cb) => ipcRenderer.on('view:reload', () => cb()),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key, value) => ipcRenderer.send('settings:set', key, value),
  setAutoLevel: (cfg) => ipcRenderer.invoke('autolevel:set', cfg),
  onAutoLevel: (cb) => ipcRenderer.on('autolevel:changed', (_e, cfg) => cb(cfg)),
  onAutoLevelStats: (cb) => ipcRenderer.on('autolevel:stats', (_e, stats) => cb(stats)),
  onSettings: (cb) => ipcRenderer.on('settings:changed', (_e, st) => cb(st)),
  onReconnect: (cb) => ipcRenderer.on('streams:reconnect', () => cb()),
  onTileReload: (cb) => ipcRenderer.on('tile:reload', (_e, channel) => cb(channel)),
  onViewLoad: (cb) => ipcRenderer.on('view:load', (_e, url) => cb(url)),

  // Anmeldung (für die ganze App)
  getAuth: () => ipcRenderer.invoke('auth:get'),
  login: () => ipcRenderer.send('auth:login'),
  logout: () => ipcRenderer.send('auth:logout'),
  continueAsGuest: (remember) => ipcRenderer.send('auth:guest', remember),
  onAuth: (cb) => ipcRenderer.on('auth:changed', (_e, auth) => cb(auth)),
});
