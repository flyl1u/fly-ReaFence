'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  total: (price, count) => ipcRenderer.invoke('calculate-total', price, count),
});
