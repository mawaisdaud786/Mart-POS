const path = require('node:path');

module.exports = {
  appId: 'com.karyana.shop',
  productName: 'Karyana Shop',
  directories: {
    app: __dirname,
    output: path.resolve(__dirname, '../../dist'),
  },
  files: [
    'main.js',
    'preload.js',
    'electron-builder.config.js',
    '../web/dist/**/*',
    '../api/dist/**/*',
    '../api/package.json',
    '../web/package.json',
    '!**/*.map',
  ],
  win: {
    target: ['nsis'],
    icon: path.resolve(__dirname, 'icon.ico'),
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    uninstallDisplayName: 'Karyana Shop',
    deleteAppDataOnUninstall: false,
  },
};
