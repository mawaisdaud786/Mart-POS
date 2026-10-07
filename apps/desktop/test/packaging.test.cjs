const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..');
const packageJson = require(path.join(appRoot, 'package.json'));
const builderConfig = require(path.join(appRoot, 'electron-builder.config.js'));
const mainSource = fs.readFileSync(path.join(appRoot, 'main.js'), 'utf8');

test('desktop build configures the local API base before compiling the renderer', () => {
  assert.match(packageJson.scripts.build, /VITE_API_BASE_URL=http:\/\/127\.0\.0\.1:4000\/api\/v1/);
  assert.match(packageJson.scripts.build, /--dir \.\.\/web build/);
  assert.match(packageJson.scripts.build, /--dir \.\.\/api build/);
});

test('installer includes the built renderer and API server', () => {
  assert.ok(builderConfig.files.includes('../web/dist/**/*'));
  assert.ok(builderConfig.files.includes('../api/dist/**/*'));
  assert.ok(builderConfig.files.includes('../api/package.json'));
});

test('desktop runtime binds its renderer locally and keeps Electron security enabled', () => {
  assert.match(mainSource, /rendererServer\.listen\(5173, '127\.0\.0\.1'/);
  assert.match(mainSource, /CORS_ORIGINS: rendererOrigin/);
  assert.match(mainSource, /DESKTOP_MODE: 'true'/);
  assert.match(mainSource, /sandbox: true/);
  assert.match(mainSource, /webSecurity: true/);
  assert.doesNotMatch(mainSource, /sandbox: false|webSecurity: false/);
});
