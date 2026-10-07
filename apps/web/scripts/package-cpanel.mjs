// Builds the folder you upload to cPanel public_html (or your subdomain's folder):
//   pnpm --filter @retailos/web package:cpanel -- --api https://api.example.com
// Leave out --api when the API is served from the same address as the app (it is then reached at /api/v1).
// Output: apps/web/cpanel/  (the built app plus a ready .htaccess)
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');
const out = join(web, 'cpanel');

const argv = process.argv.slice(2).filter((a) => a !== '--');
const apiFlag = argv.indexOf('--api');
const api = apiFlag >= 0 ? argv[apiFlag + 1]?.replace(/\/+$/, '') : undefined;

if (apiFlag >= 0) {
  // https in production. Plain http is accepted only for a machine-local test build.
  const ok = api && (/^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d+)?$/i.test(api) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(api));
  if (!ok) {
    console.error('--api must be the API origin only, like https://api.example.com (https, no path, no trailing slash)');
    process.exit(1);
  }
}

const vite = join(dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin', 'vite.js');
const env = { ...process.env, ...(api ? { VITE_API_BASE_URL: `${api}/api/v1` } : {}) };
const build = spawnSync(process.execPath, [vite, 'build'], { cwd: web, env, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

rmSync(out, { recursive: true, force: true });
cpSync(join(web, 'dist'), out, { recursive: true });

const html = readFileSync(join(out, 'index.html'), 'utf8');
if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html) || /\son\w+\s*=/i.test(html)) {
  console.error('index.html contains an inline script or event handler, which the Content-Security-Policy would block.');
  process.exit(1);
}

const template = readFileSync(join(web, 'deploy', 'htaccess.template'), 'utf8');
writeFileSync(
  join(out, '.htaccess'),
  template.replace('__API_LABEL__', api ?? 'same address as the app (/api/v1)').replace('__API_CONNECT__', api ? ` ${api}` : ''),
);
if (!existsSync(join(out, '.htaccess'))) throw new Error('.htaccess was not written');

console.log(`\ncPanel web bundle ready: ${out}\nUpload everything inside it (including the hidden .htaccess file) to your site folder.`);
