// Builds the folder you upload to cPanel:  pnpm --filter @retailos/api package:cpanel
// Output: apps/api/cpanel/  (server.js, cli.js, app.cjs, package.json, migrations/, env.production.example)
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const api = join(here, '..');
const out = join(api, 'cpanel');
const migrations = join(api, '..', '..', 'packages', 'db', 'migrations');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const banner = { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" };
for (const [entry, file] of [['src/server.ts', 'server.js'], ['src/cli.ts', 'cli.js']]) {
  await build({
    entryPoints: [join(api, entry)],
    outfile: join(out, file),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    // Native module: installed on the server by "Run NPM Install" so it matches the server's CPU/OS.
    external: ['@node-rs/argon2'],
    banner,
    minify: false,
    sourcemap: false,
    legalComments: 'none',
  });
}

const apiPkg = JSON.parse(readFileSync(join(api, 'package.json'), 'utf8'));
writeFileSync(
  join(out, 'package.json'),
  JSON.stringify(
    {
      name: 'retailos-api',
      version: '1.0.0',
      private: true,
      type: 'module',
      main: 'app.cjs',
      engines: { node: '>=20' },
      scripts: { start: 'node app.cjs', doctor: 'node cli.js doctor' },
      dependencies: { '@node-rs/argon2': apiPkg.dependencies['@node-rs/argon2'] },
    },
    null,
    2,
  ) + '\n',
);

cpSync(join(here, '..', 'deploy', 'app.cjs'), join(out, 'app.cjs'));
cpSync(join(here, '..', 'deploy', 'env.production.example'), join(out, 'env.production.example'));
if (!existsSync(join(migrations, 'meta', '_journal.json'))) throw new Error('Migrations not found at ' + migrations);
cpSync(migrations, join(out, 'migrations'), { recursive: true });

console.log(`cPanel bundle ready: ${out}\nUpload its contents to your Node.js app folder, then follow docs/deployment-cpanel.md`);
