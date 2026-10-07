const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('node:child_process');
const { generateKeyPairSync, randomBytes } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

let mainWindow;
let apiProcess;
let rendererServer;
const rendererOrigin = 'http://127.0.0.1:5173';
const rendererRoot = path.resolve(__dirname, '../web/dist');

function makeAppDirs() {
  const appDataRoot = path.join(app.getPath('appData'), 'KaryanaShop');
  const dirs = [
    appDataRoot,
    path.join(appDataRoot, 'data'),
    path.join(appDataRoot, 'backups'),
    path.join(appDataRoot, 'logs'),
    path.join(appDataRoot, 'config'),
  ];

  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return { appDataRoot, dataDir: path.join(appDataRoot, 'data') };
}

function startBackend() {
  const { appDataRoot, dataDir } = makeAppDirs();
  const apiRoot = path.resolve(__dirname, '../api');
  const builtEntry = path.join(apiRoot, 'dist', 'server.js');
  const sourceEntry = path.join(apiRoot, 'src', 'server.ts');
  const keysDir = path.join(appDataRoot, 'keys');
  fs.mkdirSync(keysDir, { recursive: true });

  const jwtFile = path.join(keysDir, 'jwt-ed25519.pem');
  if (!fs.existsSync(jwtFile)) {
    const { privateKey } = generateKeyPairSync('ed25519');
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    fs.writeFileSync(jwtFile, pem, { mode: 0o600 });
  }

  const encryptionFile = path.join(keysDir, 'app-encryption.key');
  if (!fs.existsSync(encryptionFile)) {
    fs.writeFileSync(encryptionFile, randomBytes(32).toString('base64'), { mode: 0o600 });
  }

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: '4000',
    KEYS_DIR: keysDir,
    DATABASE_URL: process.env.DATABASE_URL || `mysql://retailos_app:CHANGE_ME@127.0.0.1:3307/retailos`,
    CORS_ORIGINS: rendererOrigin,
    DESKTOP_MODE: 'true',
    JWT_PRIVATE_KEY: fs.readFileSync(jwtFile, 'utf8').replace(/\r/g, ''),
    APP_ENCRYPTION_KEY: fs.readFileSync(encryptionFile, 'utf8').trim(),
    APPDATA_DIR: appDataRoot,
    DATA_DIR: dataDir,
  };

  const spawnOptions = {
    cwd: apiRoot,
    env,
    stdio: 'inherit',
    windowsHide: true,
  };

  if (fs.existsSync(builtEntry)) {
    apiProcess = spawn(process.execPath, [builtEntry], spawnOptions);
    apiProcess.on('exit', (code, signal) => {
      if (code !== null && code !== 0) {
        console.error(`API exited with code ${code} signal ${signal}`);
      }
    });
    return;
  }

  if (fs.existsSync(sourceEntry)) {
    const tsxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    apiProcess = spawn(tsxCommand, ['tsx', 'src/server.ts'], spawnOptions);
    apiProcess.on('exit', (code, signal) => {
      if (code !== null && code !== 0) {
        console.error(`API exited with code ${code} signal ${signal}`);
      }
    });
    return;
  }

  console.error('No API entrypoint found. Expected either:', builtEntry, 'or', sourceEntry);
}

function startRendererServer() {
  rendererServer = http.createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405);
      response.end();
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url || '/', rendererOrigin).pathname);
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }

    const candidate = path.resolve(rendererRoot, `.${pathname}`);
    if (candidate !== rendererRoot && !candidate.startsWith(rendererRoot + path.sep)) {
      response.writeHead(403);
      response.end();
      return;
    }
    const filePath = fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(rendererRoot, 'index.html');
    if (!fs.existsSync(filePath)) {
      response.writeHead(404);
      response.end();
      return;
    }

    const contentTypes = {
      '.css': 'text/css; charset=utf-8',
      '.html': 'text/html; charset=utf-8',
      '.ico': 'image/x-icon',
      '.jpeg': 'image/jpeg',
      '.jpg': 'image/jpeg',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
    };
    response.setHeader('Content-Type', contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'HEAD') {
      response.writeHead(200);
      response.end();
      return;
    }
    fs.createReadStream(filePath)
      .on('error', () => {
        if (!response.headersSent) response.writeHead(404);
        response.end();
      })
      .pipe(response);
  });

  return new Promise((resolve, reject) => {
    rendererServer.once('error', reject);
    rendererServer.listen(5173, '127.0.0.1', resolve);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
    icon: path.join(__dirname, 'icon.ico'),
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
    console.error('Failed to load app:', code, description);
    console.error('Renderer URL attempted:', rendererOrigin);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url === rendererOrigin || url.startsWith(`${rendererOrigin}/`)) return;
    event.preventDefault();
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
  });

  mainWindow.loadURL(rendererOrigin);
}

app.whenReady().then(() => {
  startBackend();
  startRendererServer()
    .then(createWindow)
    .catch((error) => {
      console.error('Could not start the local renderer:', error);
      app.quit();
    });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (rendererServer) rendererServer.close();
  if (apiProcess && !apiProcess.killed) {
    apiProcess.kill('SIGTERM');
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
