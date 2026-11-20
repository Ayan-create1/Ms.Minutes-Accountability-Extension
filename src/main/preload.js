'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const INBOUND = ['panel:open', 'checkin', 'settings:external', 'login:status', 'voice:event', 'voice:hotkey'];

contextBridge.exposeInMainWorld('minutes', {
  getState: () => ipcRenderer.invoke('state:get'),
  saveState: (data) => ipcRenderer.send('state:save', data),
  setIgnore: (ignore) => ipcRenderer.send('mouse:ignore', !!ignore),
  dragStart: () => ipcRenderer.send('drag:start'),
  dragMove: () => ipcRenderer.send('drag:move'),
  dragEnd: () => ipcRenderer.send('drag:end'),
  focus: () => ipcRenderer.send('window:focus'),
  hide: () => ipcRenderer.send('window:hide'),
  resetPosition: () => ipcRenderer.send('window:reset'),
  quit: () => ipcRenderer.send('app:quit'),
  voiceStart: () => ipcRenderer.invoke('voice:start'),
  voiceStop: () => ipcRenderer.send('voice:stop'),
  voiceCancel: () => ipcRenderer.send('voice:cancel'),
  openPrivacy: (kind) => ipcRenderer.send('voice:privacy', kind),
  on: (channel, fn) => {
    if (!INBOUND.includes(channel)) return;
    ipcRenderer.on(channel, (_e, payload) => fn(payload));
  },
});
