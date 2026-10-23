'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { total } = require('./calc.cjs');

if (process.env.REAFENCE_ELECTRON_DATA) app.setPath('userData', process.env.REAFENCE_ELECTRON_DATA);
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  ipcMain.handle('calculate-total', (_event, price, count) => total(price, count));
  const window = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  try {
    await window.loadFile('index.html');
    const value = await window.webContents.executeJavaScript('window.api.total(3, 5)');
    if (value !== 22) throw new Error('IPC result mismatch');
    process.stdout.write('REAFENCE_ELECTRON_OK:22\n');
    window.destroy();
    app.quit();
  } catch (error) {
    process.stderr.write(String(error));
    app.exit(1);
  }
});
