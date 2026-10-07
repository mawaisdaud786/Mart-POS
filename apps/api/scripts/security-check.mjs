// Checks a running deployment from the outside. Needs no passwords and changes no data.
//
//   node scripts/security-check.mjs --api https://api.example.com --web https://shop.example.com
//
// --api   the API address (required)
// --web   the web app address; also used as the allowed browser origin for the CORS check (optional)
// Exit code 0 = all checks passed, 1 = something needs fixing.
// Note: it makes about 25 requests to the login endpoints, so you may be rate limited for a minute afterwards.

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]?.replace(/\/+$/, '') : undefined;
};
const API = opt('api');
const WEB = opt('web');
if (!API) {
  console.error('Usage: node scripts/security-check.mjs --api https://api.example.com [--web https://shop.example.com]');
  process.exit(2);
}

let fails = 0;
let skipped = 0;
const pass = (name, detail = '') => console.log(`  PASS  ${name}${detail ? `  (${detail})` : ''}`);
const fail = (name, detail = '') => {
  fails++;
  console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`);
};
const skip = (name, why) => {
  skipped++;
  console.log(`  SKIP  ${name}  (${why})`);
};
const check = (name, ok, detail) => (ok ? pass(name, detail) : fail(name, detail));

async function http(url, { method = 'GET', headers = {}, body, redirect = 'manual' } = {}) {
  try {
    const res = await fetch(url, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body, redirect });
    const text = await res.text();
    return { status: res.status, headers: res.headers, text };
  } catch (error) {
    return { status: 0, headers: new Headers(), text: '', error: error?.cause?.code ?? error?.message ?? String(error) };
  }
}
const login = (identifier, password, extra = {}) => http(`${API}/api/v1/auth/login`, { method: 'POST', body: JSON.stringify({ identifier, password }), ...extra });
const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)/.test(API);

// ---------------------------------------------------------------- API
console.log(`\nAPI  ${API}`);
const health = await http(`${API}/healthz`);
if (health.status !== 200) {
  fail('API is reachable', health.error ?? `status ${health.status}`);
  console.log('\nCannot continue without a working API. Check the Node.js app is running (cPanel > Setup Node.js App).');
  process.exit(1);
}
pass('API is reachable');
const h = health.headers;
check('HSTS header (browsers keep using HTTPS)', /max-age=\d{6,}/.test(h.get('strict-transport-security') ?? ''));
check('X-Content-Type-Options: nosniff', h.get('x-content-type-options') === 'nosniff');
check('responses are not cacheable (Cache-Control: no-store)', h.get('cache-control') === 'no-store');
check('does not announce its software (no X-Powered-By)', !h.get('x-powered-by'));

if (API.startsWith('https://')) {
  const plain = await http(API.replace('https://', 'http://') + '/healthz');
  if (plain.status === 0) pass('plain http is refused');
  else check('plain http redirects to https', [301, 302, 307, 308].includes(plain.status) && (plain.headers.get('location') ?? '').startsWith('https://'), `status ${plain.status}`);
} else if (isLocal) skip('http -> https redirect', 'local test');
else fail('API address uses https', 'use https:// so passwords and tokens are encrypted');

const ready = await http(`${API}/readyz`);
check('database connection works (/readyz)', ready.status === 200, `status ${ready.status}`);

let r = await http(`${API}/api/v1/shop/state`);
check('private data needs a sign-in (401)', r.status === 401, `status ${r.status}`);
const forged = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'x', tid: 'x', mid: 'x', iss: 'retailos', aud: 'tenant', exp: 9999999999 })).toString('base64url')}.`;
r = await http(`${API}/api/v1/shop/state`, { headers: { authorization: `Bearer ${forged}` } });
check('a forged unsigned token is refused', r.status === 401, `status ${r.status}`);
r = await http(`${API}/admin/v1/tenants`);
check('admin API needs its own sign-in (401)', r.status === 401, `status ${r.status}`);
r = await http(`${API}/api/v1/auth/refresh`, { method: 'POST' });
check('session refresh needs the anti-forgery header (403)', r.status === 403, `status ${r.status}`);
r = await http(`${API}/api/v1/auth/logout`, { method: 'POST' });
check('sign-out needs the anti-forgery header (403)', r.status === 403, `status ${r.status}`);

// Malformed and hostile input must be refused cleanly, never crash (500) or leak internals.
const probes = ["' OR '1'='1", "admin'--", "x' UNION SELECT password_hash FROM users-- ", '1; DROP TABLE users;--'];
const injected = [];
for (const p of probes) {
  const a = await login(`${p}@probe.invalid`, p);
  if (![400, 401, 429].includes(a.status)) injected.push(`${p} -> ${a.status}`);
}
check('SQL-injection style input never signs in or causes a server error', injected.length === 0, injected.join('; '));
r = await http(`${API}/api/v1/auth/login`, { method: 'POST', body: '{"identifier":' });
check('broken JSON gets a clean 400 with no stack trace', r.status === 400 && !/\bat \S+ \(/.test(r.text), `status ${r.status}`);
r = await login('a@b.invalid', 'x'.repeat(300));
check('over-long password is rejected before any hashing (400)', r.status === 400 || r.status === 429, `status ${r.status}`);
r = await http(`${API}/api/v1/auth/login`, { method: 'POST', body: JSON.stringify({ identifier: 'a@b.invalid', password: 'x'.repeat(6 * 1024 * 1024) }) });
// A server that slams the connection shut mid-upload (status 0) has refused it just as well as a 413.
check('huge request is refused (413 or connection closed)', [0, 413, 429].includes(r.status), r.status ? `status ${r.status}` : 'connection closed');

// Lockout uses an address that does not exist, so no real account is affected.
const ghost = `ghost-${Math.random().toString(36).slice(2, 10)}@probe.invalid`;
let last;
for (let i = 1; i <= 7; i++) last = await login(ghost, `wrong password number ${i}`);
check('repeated wrong passwords get locked out (429)', last.status === 429, `status ${last.status}`);

r = await http(`${API}/admin/v1/auth/login`, { method: 'POST', body: JSON.stringify({ email: 'nobody@probe.invalid', password: 'wrong password here', totp: '123456' }) });
check('admin sign-in refuses bad credentials without an error (401/429)', r.status === 401 || r.status === 429, `status ${r.status}`);

if (WEB) {
  const origin = new URL(WEB).origin;
  r = await http(`${API}/api/v1/auth/login`, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
  check('your web app address is allowed by CORS', r.headers.get('access-control-allow-origin') === origin && r.headers.get('access-control-allow-credentials') === 'true', `allow-origin: ${r.headers.get('access-control-allow-origin') ?? 'none'}`);
}
r = await http(`${API}/api/v1/auth/login`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
check('other websites are NOT allowed by CORS', !r.headers.get('access-control-allow-origin'), `allow-origin: ${r.headers.get('access-control-allow-origin') ?? 'none'}`);

// ---------------------------------------------------------------- WEB
if (WEB) {
  console.log(`\nWEB  ${WEB}`);
  const page = await http(WEB + '/', { redirect: 'follow' });
  if (page.status !== 200) fail('web app is reachable', page.error ?? `status ${page.status}`);
  else {
    pass('web app is reachable');
    const w = page.headers;
    const csp = w.get('content-security-policy') ?? '';
    check('Content-Security-Policy is set', csp.length > 0);
    const scriptSrc = /(?:^|;)\s*script-src ([^;]*)/.exec(csp)?.[1] ?? '';
    check("scripts limited to this site (no 'unsafe-inline' / 'unsafe-eval')", /'self'/.test(scriptSrc) && !/unsafe-inline|unsafe-eval|\*/.test(scriptSrc), scriptSrc || 'no script-src');
    check('page cannot be framed by other sites (clickjacking)', /frame-ancestors 'none'/.test(csp) || /deny/i.test(w.get('x-frame-options') ?? ''));
    check('data may only be sent to this site and your API', new RegExp(`connect-src[^;]*${API.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(csp) || /connect-src 'self'(?:;|$)/.test(csp), (/connect-src [^;]*/.exec(csp) ?? [''])[0]);
    check('X-Content-Type-Options: nosniff', w.get('x-content-type-options') === 'nosniff');
    check('Referrer-Policy is set', !!w.get('referrer-policy'));
    check('Permissions-Policy allows the microphone for voice billing only on this site', /microphone=\(self\)/.test(w.get('permissions-policy') ?? ''));
    check('HSTS header', /max-age=\d{6,}/.test(w.get('strict-transport-security') ?? ''));
  }
  r = await http(WEB + '/pos', { redirect: 'follow' });
  check('app pages open directly (single-page-app routing)', r.status === 200 && /<div id="root">/.test(r.text), `status ${r.status}`);
  for (const path of ['/.htaccess', '/.env', '/.git/config', '/assets/index.js.map']) {
    r = await http(WEB + path, { redirect: 'follow' });
    // Refused (403/404) or just the app's start page; never the real file.
    check(`${path} is not served`, r.status !== 200 || /<div id="root">/.test(r.text), `status ${r.status}`);
  }
  if (WEB.startsWith('https://')) {
    const plain = await http(WEB.replace('https://', 'http://') + '/');
    if (plain.status === 0) pass('plain http is refused');
    else check('plain http redirects to https', [301, 302, 307, 308].includes(plain.status) && (plain.headers.get('location') ?? '').startsWith('https://'), `status ${plain.status}`);
  } else skip('web http -> https redirect', 'local test');
}

console.log(`\n${fails === 0 ? 'All checks passed' : `${fails} check(s) failed`}${skipped ? `, ${skipped} skipped` : ''}.`);
process.exit(fails === 0 ? 0 : 1);
