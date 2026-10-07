const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('appRuntime', {
  appDataDir: process.env.APPDATA || '',
  platform: process.platform,
});
