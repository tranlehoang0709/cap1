'use strict';
// Real Nest HTTP + real isolated MySQL + unchanged Next BFF route modules.
// No production DB grants, email, provider clients, mocks or UI changes.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { randomBytes, createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const { JwtService } = require('@nestjs/jwt');
const root = path.resolve(__dirname, '..');
const frontend = path.resolve(root, '../frontend/next-app');
// Next webpack's Windows entry paths require the runtime on the same drive.
const runtimeRoot = path.join(root, '.auth-test-runtime');
const config = dotenv.parse(fs.readFileSync(path.join(root, '.env.test')));
const base = 'http://127.0.0.1:3301';
const bffBase = 'http://127.0.0.1:3302';
const hash = value => createHash('sha256').update(value).digest('hex');
let connection, temporary, stage = 'isolation';
const children = [];
const passed = [];
const createdFirmware = [];
let diagnostics = '';
function pass(name) { passed.push(name); console.log('PASS ' + name + ' [aiva_iot_test]'); }
function childEnv(extra = {}) {
  // Allowlist OS necessities; never inherit production provider/SMTP/DB secrets.
  const result = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC']) if (process.env[key]) result[key] = process.env[key];
  return { ...result, ...config, ...extra, NEXT_TELEMETRY_DISABLED: '1' };
}
async function freePort(port) {
  await new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(port, '127.0.0.1', () => server.close(resolve)); });
}
function start(args, cwd, env) {
  const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const capture = chunk => { diagnostics = (diagnostics + chunk.toString()).slice(-12000); };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  child.on('error', () => {});
  children.push(child); return child;
}
async function ready(url, child) {
  for (let i = 0; i < 90; i++) {
    if (child.exitCode !== null) throw Error('TEST_PROCESS_EXITED');
    try { const r = await fetch(url, { signal: AbortSignal.timeout(3000) }); if (r.status < 500) return; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw Error('TEST_PROCESS_NOT_READY');
}
async function api(url, method = 'GET', body, token, cookie) {
  const r = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...(cookie ? { cookie } : {}), ...(url.startsWith(bffBase) && method !== 'GET' ? { origin: bffBase } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  let data; try { data = await r.json(); } catch { throw Error('NON_JSON_RESPONSE'); }
  return { status: r.status, data, headers: r.headers };
}
async function login(email = config.TEST_USER_EMAIL, password = config.TEST_USER_PASSWORD) {
  const r = await api(base + '/auth/login', 'POST', { email, password }); assert.equal(r.status, 200); return r.data;
}
async function session(token) {
  const [rows] = await connection.execute('SELECT id, expires_at, revoked_at FROM auth_sessions WHERE refresh_token_hash=?', [hash(token)]);
  return rows[0];
}
async function assertDenied(r) { assert.equal(r.status, 401); }
async function main() {
  assert.equal(config.DB_NAME, 'aiva_iot_test'); assert.equal(config.NODE_ENV, 'test'); assert.equal(config.MYSQL_INTEGRATION_TESTS, 'true');
  assert.equal(config.PORT, '3301'); assert.equal(config.ACCESS_TOKEN_TTL_SECONDS, '60');
  for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM']) assert.equal(config[key], '');
  for (const key of Object.keys(config)) assert(!/API_KEY/.test(key));
  await freePort(3301); await freePort(3302);
  connection = await mysql.createConnection({ host: config.DB_HOST, port: Number(config.DB_PORT), user: config.DB_USER, password: config.DB_PASSWORD, database: config.DB_NAME, timezone: 'Z', multipleStatements: false });
  const [[identity]] = await connection.query('SELECT DATABASE() AS db, TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),NOW()) AS offset_seconds');
  assert.equal(identity.db, 'aiva_iot_test');
  let denied = false; try { await connection.query('SELECT id FROM aiva_iot.users LIMIT 0'); } catch(e) { denied = ['ER_TABLEACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR'].includes(e.code); }
  assert(denied); pass('database isolation / no live privileges');
  console.log('MySQL session UTC offset seconds=' + identity.offset_seconds);
  fs.mkdirSync(runtimeRoot, { recursive: true });
  temporary = fs.mkdtempSync(path.join(runtimeRoot, 'aiva-auth-isolated-'));
  const beDir = path.join(temporary, 'backend'); fs.mkdirSync(beDir);
  // Running outside BE prevents ConfigModule's .env lookup from loading live secrets.
  const backend = start([path.join(root, 'dist/main.js')], beDir, childEnv());
  stage = 'backend startup'; await ready(base + '/health', backend);
  assert.equal((await api(base + '/health')).status, 200); pass('Backend health');
  const [[admin]] = await connection.execute('SELECT id FROM users WHERE email=?', [config.ADMIN_EMAIL]); assert(admin);
  const [users] = await connection.execute('SELECT id FROM users WHERE email=?', [config.TEST_USER_EMAIL]);
  if (!users.length) {
    const registered = await api(base + '/auth/register', 'POST', { email: config.TEST_USER_EMAIL, password: config.TEST_USER_PASSWORD, display_name: 'Integration User' });
    assert.equal(registered.status, 201); assert.equal(registered.data.verification_sent, false);
    // Controlled test fixture only: no email delivery or OTP bypass in app code.
    await connection.execute('UPDATE users SET email_verified_at=UTC_TIMESTAMP() WHERE email=?', [config.TEST_USER_EMAIL]);
  }
  pass('test User/Admin fixtures; SMTP disabled');
  stage = 'login and RBAC';
  let tokens = await login(); const user = await api(base + '/auth/me', 'GET', undefined, tokens.access_token);
  assert.equal(user.data.role, 'USER'); assert(await session(tokens.refresh_token)); pass('User login / persisted session');
  const adminTokens = await login(config.ADMIN_EMAIL, config.ADMIN_PASSWORD);
  assert.equal((await api(base + '/auth/me', 'GET', undefined, adminTokens.access_token)).data.role, 'ADMIN'); pass('Admin login');
  assert.equal((await api(base + '/users', 'GET', undefined, tokens.access_token)).status, 403);
  assert.equal((await api(base + '/users', 'GET', undefined, adminTokens.access_token)).status, 200); pass('RBAC USER denied / ADMIN allowed');
  const wrong = await api(base + '/auth/login', 'POST', { email: config.TEST_USER_EMAIL, password: randomBytes(32).toString('hex') });
  assert.equal(wrong.status, 401); assert.equal(wrong.data.code, 'INVALID_CREDENTIALS'); pass('wrong password / live API business code');
  stage = 'refresh rotation';
  const previous = tokens.refresh_token;
  const refreshed = await api(base + '/auth/refresh', 'POST', { refresh_token: previous }); assert.equal(refreshed.status, 200);
  tokens = refreshed.data; assert.notEqual(tokens.refresh_token, previous); assert.equal(await session(previous), undefined); assert(await session(tokens.refresh_token));
  pass('refresh future UTC expiry / real SQL rotation');
  await assertDenied(await api(base + '/auth/refresh', 'POST', { refresh_token: previous })); pass('refresh token reuse rejected');
  const races = await Promise.all([api(base + '/auth/refresh', 'POST', { refresh_token: tokens.refresh_token }), api(base + '/auth/refresh', 'POST', { refresh_token: tokens.refresh_token })]);
  assert.deepEqual(races.map(r => r.status).sort(), [200, 401]); tokens = races.find(r => r.status === 200).data; pass('concurrent refresh has one winner');
  stage = 'logout';
  const loggedOut = await api(base + '/auth/logout', 'POST', { refresh_token: tokens.refresh_token }, tokens.access_token); assert.equal(loggedOut.status, 200);
  assert((await session(tokens.refresh_token)).revoked_at); await assertDenied(await api(base + '/auth/refresh', 'POST', { refresh_token: tokens.refresh_token })); pass('logout / revoked refresh rejected');
  stage = 'expiry and signature';
  // No login-throttle bypass: these use the existing admin test session only.
  await connection.execute('UPDATE auth_sessions SET expires_at=? WHERE refresh_token_hash=?', [new Date(Date.now() - 10000), hash(adminTokens.refresh_token)]);
  await assertDenied(await api(base + '/auth/refresh', 'POST', { refresh_token: adminTokens.refresh_token })); pass('database session expiry rejected');
  const jwt = new JwtService();
  const claims = { sub: user.data.id, typ: 'refresh', jti: randomBytes(16).toString('hex') };
  const expired = await jwt.signAsync(claims, { secret: config.JWT_REFRESH_SECRET, issuer: 'aiva-iot', audience: 'aiva-refresh', expiresIn: -1 });
  await assertDenied(await api(base + '/auth/refresh', 'POST', { refresh_token: expired })); pass('expired signed JWT rejected');
  const badSignature = await jwt.signAsync(claims, { secret: randomBytes(32), issuer: 'aiva-iot', audience: 'aiva-refresh', expiresIn: 60 });
  await assertDenied(await api(base + '/auth/refresh', 'POST', { refresh_token: badSignature })); pass('wrong JWT signature rejected');
  const expiredAccess = await jwt.signAsync({ sub: user.data.id, typ: 'access' }, { secret: config.JWT_ACCESS_SECRET, issuer: 'aiva-iot', audience: 'aiva-api', expiresIn: -1 });
  await assertDenied(await api(base + '/auth/me', 'GET', undefined, expiredAccess)); pass('expired access JWT rejected');
  stage = 'BFF startup';
  const bffDir = path.join(temporary, 'bff'); fs.mkdirSync(bffDir);
  diagnostics = '';
  fs.writeFileSync(path.join(bffDir, 'package.json'), JSON.stringify({ private: true, dependencies: { next: '16.4.6', react: '19.3.1', 'react-dom': '19.3.1' } }));
  fs.writeFileSync(path.join(bffDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'esnext', moduleResolution: 'bundler', jsx: 'preserve', esModuleInterop: true, baseUrl: '.', paths: { '@/*': ['./src/*'] } } }));
  fs.symlinkSync(path.join(frontend, 'node_modules'), path.join(bffDir, 'node_modules'), 'junction');
  fs.cpSync(path.join(frontend, 'src/lib'), path.join(bffDir, 'src/lib'), { recursive: true });
  for (const file of ['src/app/api/auth/[action]/route.ts', 'src/app/api/backend/route.ts', 'src/lib/server/backend.ts', 'src/lib/contracts.ts', 'src/lib/origin.ts']) {
    const destination = path.join(bffDir, file); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(path.join(frontend, file), destination);
    assert.equal(hash(fs.readFileSync(destination)), hash(fs.readFileSync(path.join(frontend, file))));
  }
  const bff = start([path.join(frontend, 'node_modules/next/dist/bin/next'), 'dev', bffDir, '--webpack', '--hostname', '127.0.0.1', '--port', '3302'], bffDir,
    childEnv({ NODE_ENV: 'development', AIVA_BACKEND_URL: base, AIVA_PUBLIC_ORIGIN: bffBase, AIVA_COOKIE_SECURE: 'false' }));
  await ready(bffBase + '/api/auth/me', bff);
  stage = 'BFF login';
  const bffLogin = await api(bffBase + '/api/auth/login', 'POST', { email: config.TEST_USER_EMAIL, password: config.TEST_USER_PASSWORD });
  assert.equal(bffLogin.status, 200); assert.equal(bffLogin.data.success, true);
  const setCookie = bffLogin.headers.get('set-cookie'); assert(setCookie && /HttpOnly/i.test(setCookie) && /SameSite=lax/i.test(setCookie));
  let cookie = setCookie.split(';')[0]; assert(cookie.startsWith('aiva_session='));
  assert(!JSON.stringify(bffLogin.data).includes('access_token')); assert(!JSON.stringify(bffLogin.data).includes('refresh_token'));
  assert.equal((await api(bffBase + '/api/auth/me', 'GET', undefined, undefined, cookie)).data.role, 'USER');
  pass('real Next BFF login / opaque HttpOnly SameSite cookie');
  stage = 'BFF firmware regression';
  const firmwareBody = { hardware_model: 'bff-integration', version: 'test-' + randomBytes(6).toString('hex'), file_uri: 'https://example.invalid/firmware.bin', checksum_sha256: 'b'.repeat(64) };
  const deniedFirmware = await api(bffBase + '/api/backend', 'POST', { operation: 'firmwareCreate', body: firmwareBody }, undefined, cookie);
  assert.equal(deniedFirmware.status, 403);
  const assistant = await api(bffBase + '/api/backend', 'POST', { operation: 'assistant' }, undefined, cookie);
  assert.equal(assistant.status, 403); // Robot profile contract still requires an approved device.
  pass('BFF unpaired User robot-profile gate / firmware Admin-only');
  const bffAdminLogin = await api(bffBase + '/api/auth/login', 'POST', { email: config.ADMIN_EMAIL, password: config.ADMIN_PASSWORD });
  assert.equal(bffAdminLogin.status, 200);
  const adminCookie = bffAdminLogin.headers.get('set-cookie').split(';')[0];
  const firmware = await api(bffBase + '/api/backend', 'POST', { operation: 'firmwareCreate', body: firmwareBody }, undefined, adminCookie);
  assert.equal(firmware.status, 200); const firmwareId = String(firmware.data); assert(/^[1-9]\d*$/.test(firmwareId)); createdFirmware.push(firmwareId);
  const [[storedFirmware]] = await connection.execute('SELECT created_at FROM firmware_versions WHERE id=?', [firmwareId]);
  assert(Math.abs(Date.now() - storedFirmware.created_at.getTime()) < 5000);
  const release = await api(bffBase + '/api/backend', 'POST', { operation: 'firmwareRelease', params: { id: firmwareId }, body: {} }, undefined, adminCookie);
  assert.equal(release.status, 200);
  const [[releasedFirmware]] = await connection.execute('SELECT released_at FROM firmware_versions WHERE id=?', [firmwareId]);
  assert(Math.abs(Date.now() - releasedFirmware.released_at.getTime()) < 5000);
  pass('Next BFF → Nest → MySQL firmware create/release UTC regression');
  const adminLogout = await api(bffBase + '/api/auth/logout', 'POST', {}, undefined, adminCookie); assert.equal(adminLogout.status, 200);
  const [before] = await connection.execute('SELECT id,refresh_token_hash FROM auth_sessions WHERE user_id=? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1', [user.data.id]);
  assert(before[0]);
  console.log('WAIT BFF access token expiry (61 seconds); test services only');
  await new Promise(r => setTimeout(r, 61_000));
  stage = 'BFF automatic refresh';
  const bffMe = await api(bffBase + '/api/auth/me', 'GET', undefined, undefined, cookie);
  assert.equal(bffMe.status, 200); assert.equal(bffMe.data.role, 'USER');
  const [after] = await connection.execute('SELECT refresh_token_hash FROM auth_sessions WHERE id=?', [before[0].id]);
  assert.notEqual(after[0].refresh_token_hash, before[0].refresh_token_hash);
  const replacementCookie = bffMe.headers.get('set-cookie'); if (replacementCookie) cookie = replacementCookie.split(';')[0];
  assert.equal((await api(bffBase + '/api/auth/me', 'GET', undefined, undefined, cookie)).status, 200);
  pass('BFF automatic refresh / updated server tokens / cookie remains valid');
  const bffLogout = await api(bffBase + '/api/auth/logout', 'POST', {}, undefined, cookie);
  assert.equal(bffLogout.status, 200); assert.equal(bffLogout.data.warning, false);
  assert(/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(bffLogout.headers.get('set-cookie') || ''));
  assert.equal((await api(bffBase + '/api/auth/me', 'GET', undefined, undefined, cookie)).status, 401);
  const [[revoked]] = await connection.execute('SELECT revoked_at FROM auth_sessions WHERE id=?', [before[0].id]); assert(revoked.revoked_at);
  pass('BFF logout / cookie cleared / server session invalidated / DB refresh revoked');
  console.log('COMPLETE database=aiva_iot_test; checks=' + passed.length + '; no live data writes or email');
}
main().catch(e => {
  console.error('FAIL stage=' + stage + '; code=' + (e.code || e.name || 'UNKNOWN') + '; sensitive details suppressed');
  if (stage === 'BFF startup') {
    let summary = diagnostics.split(/\r?\n/).filter(line => /Error:|Module not found|Cannot find|root layout|Failed to compile|not supported/i.test(line) && !/^\s+at /.test(line)).slice(0, 3).join(' | ');
    for (const key of ['DB_PASSWORD', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'APP_ENCRYPTION_KEY', 'ADMIN_PASSWORD', 'TEST_USER_PASSWORD']) summary = summary.split(config[key]).join('[REDACTED]');
    console.error('BFF startup diagnostic (no stack): ' + summary.slice(0, 800));
  }
  process.exitCode = 1;
}).finally(async () => {
  for (const child of children.reverse()) if (child.pid && child.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  if (connection) {
    for (const id of createdFirmware) await connection.execute('DELETE FROM firmware_versions WHERE id=?', [id]);
    await connection.end();
  }
  if (temporary && path.dirname(temporary) === runtimeRoot && path.basename(temporary).startsWith('aiva-auth-isolated-')) {
    // Remove only our temp runtime; unlink the junction before recursive cleanup.
    const junction = path.join(temporary, 'bff/node_modules'); if (fs.existsSync(junction)) fs.unlinkSync(junction);
    fs.rmSync(temporary, { recursive: true, force: true });
    if (fs.existsSync(runtimeRoot) && fs.readdirSync(runtimeRoot).length === 0) fs.rmdirSync(runtimeRoot);
  }
});
