/** Actual User live E2E. No token/cookie export, fixtures, inference or business writes. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const req = createRequire(path.join(root, 'BE/package.json'));
const report = { fixture: false, frontend: 'http://127.0.0.1:8513', backend: 'http://127.0.0.1:3000', pages: [], errors: [], tokenOrCookieRead: false };
const out = process.env.AIVA_E2E_ARTIFACTS || fs.mkdtempSync(path.join(os.tmpdir(), 'aiva-user-live-'));
fs.mkdirSync(out, { recursive: true });
const save = () => fs.writeFileSync(path.join(out, 'user-live-result.json'), JSON.stringify(report, null, 2));
const progress = value => { save(); console.log(JSON.stringify(value)); };
let db, browser, primary, probe, server, primaryLogged = false, probeLogged = false, stage = 'readiness';
let env, expect;

async function snapshot() {
  await db.query('SET SESSION TRANSACTION READ ONLY');
  await db.beginTransaction();
  try {
    const [users] = await db.execute(`SELECT u.id,u.status,u.email_verified_at,u.last_login_at,COUNT(r.code) AS role_count,MAX(r.code) AS role
      FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id
      WHERE u.email=? GROUP BY u.id,u.status,u.email_verified_at,u.last_login_at`, [env.AIVA_E2E_USER_EMAIL]);
    if (!users[0]) return { eligible: false };
    const user = users[0];
    const [sessions] = await db.execute('SELECT id,user_id,created_at,expires_at,revoked_at FROM auth_sessions WHERE user_id=? ORDER BY id', [user.id]);
    const [counts] = await db.execute(`SELECT
      (SELECT COUNT(*) FROM devices) AS devices,
      (SELECT COUNT(*) FROM conversations WHERE user_id=? AND deleted_at IS NULL) AS conversations,
      (SELECT COUNT(*) FROM api_credentials WHERE owner_user_id=?) AS personalKeys,
      (SELECT COUNT(*) FROM messages) AS messages,
      (SELECT COUNT(*) FROM usage_records) AS usageRecords`, [user.id, user.id]);
    return { eligible: String(user.id) === '2' && user.status === 'active' && !!user.email_verified_at && Number(user.role_count) === 1 && user.role === 'USER', user, sessions, counts: counts[0] };
  } finally { await db.rollback(); }
}
async function ready(url, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    try { if ((await fetch(url + '/_stcore/health', { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw Error('FRONTEND_NOT_READY');
}
async function settle(page) {
  const busy = page.getByTestId('stStatusWidget');
  if (await busy.count()) await busy.waitFor({ state: 'hidden', timeout: 30000 });
  await page.waitForTimeout(500);
  await expect(page.getByTestId('stException')).toHaveCount(0);
  const text = await page.locator('body').innerText();
  if (/Không kết nối được Backend|Backend trả mã HTTP|Internal Server Error|Unauthorized|Unknown column/i.test(text)) throw Error('API_ERROR_VISIBLE');
}
async function login(page, base) {
  await page.goto(base);
  await page.getByLabel('Email', { exact: true }).fill(env.AIVA_E2E_USER_EMAIL);
  await page.locator('input[autocomplete="current-password"]').fill(env.AIVA_E2E_USER_PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  let outcome = 'waiting';
  await expect.poll(async () => {
    if (await page.locator('.st-key-portal_page_header h1').count()) return outcome = 'dashboard';
    const text = await page.locator('body').innerText();
    if (text.includes('Email or password is incorrect')) return outcome = 'USER_CREDENTIAL_REJECTED';
    if (text.includes('This account cannot sign in')) return outcome = 'USER_ACCOUNT_DENIED';
    return 'waiting';
  }, { timeout: 30000 }).not.toBe('waiting');
  if (outcome !== 'dashboard') throw Error(outcome);
  await expect(page.locator('.st-key-portal_page_header h1')).toHaveText('Tổng quan');
  await settle(page);
}
async function logout(page) {
  await page.getByTestId('stSidebar').getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Chào mừng đến AIVA-IoT', exact: true })).toBeVisible();
}
async function navigate(page, label) {
  await page.getByTestId('stSidebar').getByText(label, { exact: true }).click();
  await expect(page.locator('.st-key-portal_page_header h1')).toHaveText(label);
  await settle(page);
}
async function roleProbe() {
  const port = Number(process.env.AIVA_E2E_PORT || 8514), base = 'http://127.0.0.1:' + port;
  try { await fetch(base + '/_stcore/health', { signal: AbortSignal.timeout(1000) }); throw Error('TEST_PORT_OCCUPIED'); }
  catch (error) { if (error.message === 'TEST_PORT_OCCUPIED') throw error; }
  server = spawn(process.env.AIVA_E2E_PYTHON || 'python', ['-B', '-m', 'streamlit', 'run', path.join(__dirname, 'user_live_probe.py'), '--server.address', '127.0.0.1', '--server.port', String(port), '--browser.gatherUsageStats', 'false'], {
    cwd: path.join(root, 'frontend'), windowsHide: true, stdio: 'ignore', env: {
      ...process.env, AIVA_LIVE_USER_E2E: 'true', AIVA_DATA_MODE: 'API', AIVA_BACKEND_URL: report.backend,
      AIVA_BACKEND_BASE_URL: report.backend, PYTHONDONTWRITEBYTECODE: '1'
    }
  });
  server.on('error', () => { report.probeHostError = 'START_FAILED'; });
  await ready(base);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'vi-VN' });
  probe = await context.newPage();
  probe.on('pageerror', () => report.errors.push({ stage: 'role_probe', type: 'JAVASCRIPT_ERROR' }));
  const before = await snapshot();
  await login(probe, base); probeLogged = true;
  await expect(probe.getByText('LIVE USER ROLE PROBE: /users=403,/admin/dashboard=403', { exact: true })).toBeVisible();
  report.roleProbe = { result: 'LIVE_403_PASS', endpoints: ['/users', '/admin/dashboard'], method: 'GET', tokenExported: false, host: base, realApp: true };
  await logout(probe); probeLogged = false;
  const after = await snapshot();
  const existing = new Set(before.sessions.map(x => String(x.id)));
  report.roleProbe.sessions = after.sessions.filter(x => !existing.has(String(x.id))).map(x => ({ id: String(x.id), revoked: !!x.revoked_at }));
  await context.close();
}
(async () => {
  try {
    env = req('dotenv').parse(fs.readFileSync(path.join(root, 'BE/.env')));
    if (!env.AIVA_E2E_USER_EMAIL || !env.AIVA_E2E_USER_PASSWORD) { report.result = 'ACCOUNT_ACTION_REQUIRED_MISSING_USER_CREDENTIAL'; return; }
    db = await req('mysql2/promise').createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, timezone: 'Z', connectTimeout: 5000 });
    report.before = await snapshot();
    if (!report.before.eligible) { report.result = 'ACCOUNT_ACTION_REQUIRED_USER_NOT_VERIFIED_OR_NOT_ID2'; return; }
    const module = require(process.env.AIVA_PLAYWRIGHT_MODULE || '@playwright/test'); expect = module.expect;
    await ready(report.frontend);
    browser = await module.chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'vi-VN' });
    primary = await context.newPage();
    primary.on('pageerror', () => report.errors.push({ stage: 'primary', type: 'JAVASCRIPT_ERROR' }));
    stage = 'user_login_8513';
    await login(primary, report.frontend); primaryLogged = true;
    const loginTime = Date.now();
    report.afterLogin = await snapshot();
    const oldIds = new Set(report.before.sessions.map(x => String(x.id)));
    const sessions = report.afterLogin.sessions.filter(x => !oldIds.has(String(x.id)));
    report.primarySessionId = sessions.length === 1 ? String(sessions[0].id) : null;
    report.login = 'LIVE_PASS'; report.authMe = 'LIVE_USER_PASS_VIA_REAL_FRONTEND_GATE';
    progress({ stage: 'user_login', result: report.login, primarySessionId: report.primarySessionId });
    for (const label of ['Quản lý người dùng', 'Quản lý thiết bị', 'AI Management', 'API Key & Quota', 'OTA Firmware', 'Logs & Monitoring', 'System Settings']) {
      await expect(primary.getByTestId('stSidebar').getByText(label, { exact: true })).toHaveCount(0);
    }
    report.adminPortalHidden = 'LIVE_PASS';
    const pages = ['Tổng quan', 'AI Chat', 'Robot của tôi', 'Trợ lý AI', 'API Key cá nhân', 'Lịch sử hội thoại', 'Quyền riêng tư', 'Tài khoản'];
    for (let i = 0; i < pages.length; i++) {
      stage = 'user_page_' + i;
      const entry = { page: pages[i], methods: ['GET'] };
      try {
        if (i) await navigate(primary, pages[i]); else await settle(primary);
        if (pages[i] === 'Robot của tôi' && Number(report.before.counts.devices) === 0) {
          await expect(primary.getByText('Bạn chưa có robot được duyệt. Gửi mã ghép nối ở bên dưới để bắt đầu.', { exact: true })).toBeVisible();
        }
        await primary.screenshot({ path: path.join(out, 'user-page-' + i + '.png'), fullPage: true });
        entry.result = 'LIVE_PASS';
      } catch (error) { entry.result = 'FAIL'; entry.type = error.name; }
      report.pages.push(entry); progress({ stage: 'user_page', page: entry.page, result: entry.result });
    }
    stage = 'user_admin_denial'; await roleProbe(); progress({ stage: 'role_probe', result: report.roleProbe.result });
    stage = 'natural_access_expiry';
    const deadline = loginTime + (Number(env.ACCESS_TOKEN_TTL_SECONDS || 900) + 6) * 1000;
    while (Date.now() < deadline) {
      progress({ stage, remainingSeconds: Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) });
      await new Promise(resolve => setTimeout(resolve, Math.min(55000, deadline - Date.now())));
    }
    stage = 'refresh'; await navigate(primary, 'Tổng quan');
    report.afterRefresh = await snapshot();
    const initial = report.afterLogin.sessions.find(x => String(x.id) === report.primarySessionId);
    const refreshed = report.afterRefresh.sessions.find(x => String(x.id) === report.primarySessionId);
    report.refreshAfterNaturalAccessExpiry = initial && refreshed && !refreshed.revoked_at && new Date(refreshed.expires_at) > new Date(initial.expires_at) ? 'LIVE_PASS' : 'FAIL_OR_UNVERIFIED';
    progress({ stage, result: report.refreshAfterNaturalAccessExpiry });
    stage = 'logout'; await logout(primary); primaryLogged = false;
    report.logout = 'LIVE_PASS'; report.after = await snapshot();
    const current = report.after.sessions.find(x => String(x.id) === report.primarySessionId);
    report.logoutDatabaseRevocation = current?.revoked_at ? 'LIVE_PASS' : 'FAIL';
    report.result = report.pages.every(x => x.result === 'LIVE_PASS') && !report.errors.length && report.roleProbe?.result === 'LIVE_403_PASS' && report.refreshAfterNaturalAccessExpiry === 'LIVE_PASS' && report.logoutDatabaseRevocation === 'LIVE_PASS' ? 'USER_LIVE_PASS' : 'PARTIAL_OR_FAIL';
  } catch (error) { const accountIssue = ['USER_CREDENTIAL_REJECTED', 'USER_ACCOUNT_DENIED'].includes(error.message); report.result = accountIssue ? 'ACCOUNT_ACTION_REQUIRED_' + error.message : 'FAIL'; report.errors.push({ stage, type: error.name, reason: accountIssue ? error.message : 'TEST_FAILURE' }); }
  finally {
    if (probeLogged && probe) try { await logout(probe); } catch { report.probeCleanupLogout = 'UNCONFIRMED'; }
    if (primaryLogged && primary) try { await logout(primary); } catch { report.cleanupLogout = 'UNCONFIRMED'; }
    if (db) try { report.final = await snapshot(); } catch { report.finalSnapshot = 'UNAVAILABLE'; }
    if (browser) await browser.close();
    if (server?.pid && server.exitCode === null) {
      if (process.platform === 'win32') try { execFileSync('taskkill.exe', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { report.testHostCleanup = 'UNCONFIRMED'; }
      else server.kill();
    }
    if (db) await db.end();
    save();
    console.log(JSON.stringify({ result: report.result, pages: report.pages, login: report.login, roleProbe: report.roleProbe, refresh: report.refreshAfterNaturalAccessExpiry, logout: report.logout, errors: report.errors, artifacts: out }));
    if (['FAIL', 'PARTIAL_OR_FAIL'].includes(report.result)) process.exitCode = 1;
  }
})();
