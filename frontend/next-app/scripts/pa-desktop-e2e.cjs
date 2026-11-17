// Desktop-only headed E2E. One temporary context, manual login, no CDP or saved profile.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { chromium, expect } = require('@playwright/test');
const requireBE = createRequire(path.resolve(__dirname, '../../../BE/package.json'));
const mysql = requireBE('mysql2/promise');
const dotenv = requireBE('dotenv');
const BASE = 'http://127.0.0.1:3100';
const output = path.resolve(__dirname, '../../../artifacts/pa-desktop-e2e');
fs.mkdirSync(output, { recursive: true });
const reportFile = path.join(output, 'report.json');
const report = { started: new Date().toISOString(), authentication: 'BLOCKED', cases: [], created: { memories: [], plans: [] }, cleanup: 'NOT VERIFIED' };
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function main() {
  if (/^CodexSandbox/i.test(os.userInfo().username)) {
    report.reason = 'Runner must be launched from the desktop Windows account.';
    save(); console.log('BLOCKED: run this script in desktop PowerShell.'); return;
  }
  const env = dotenv.parse(fs.readFileSync(path.resolve(__dirname, '../../../BE/.env')));
  const pool = mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, supportBigNumbers: true, bigNumberStrings: true, timezone: 'Z' });
  const browserPath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(file => fs.existsSync(file));
  if (!browserPath) throw new Error('BROWSER_NOT_INSTALLED');
  const browser = await chromium.launch({ executablePath: browserPath, headless: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const state = { page, context, pool, report, save, expect, hash, base: BASE, output, run: 0 };
  const [originalPlan] = await pool.execute('SELECT * FROM personal_plans WHERE id=1 AND user_id=2');
  const [originalTasks] = await pool.execute('SELECT * FROM personal_tasks WHERE plan_id=1 AND user_id=2 ORDER BY id');
  state.baseline = hash({ originalPlan, originalTasks });
  state.baselineTaskIds = new Set(originalTasks.map(row => String(row.id)));
  save();
  // Listen on the context so a manual login in another tab is still observed.
  let queue = Promise.resolve();
  let finish;
  const closed = new Promise(resolve => { finish = resolve; });
  const input = readline.createInterface({ input: process.stdin });
  async function inspectSession() {
    report.tabs = context.pages().map(tab => {
      const url = new URL(tab.url());
      return { origin: url.origin, path: url.pathname };
    });
    report.cookieMetadata = (await context.cookies(BASE))
      .filter(item => item.name === 'aiva_session')
      .map(({ name, domain, path, httpOnly, secure, sameSite }) => ({ name, domain, path, httpOnly, secure, sameSite }));
    const response = await context.request.get(BASE + '/api/auth/me');
    const identity = await response.json();
    report.meStatus = response.status();
    state.sessionVerified = response.status() === 200 && String(identity.id) === '2' && identity.role === 'USER';
    report.authentication = state.sessionVerified ? (report.loginStatus === 200 ? 'PASS' : 'NOT VERIFIED') : 'BLOCKED';
    if (state.sessionVerified) {
      state.page = context.pages().find(tab => tab.url().startsWith(BASE + '/user/')) || page;
    }
    save();
    console.log(JSON.stringify({ authentication: report.authentication, loginStatus: report.loginStatus ?? null,
      cookieMetadata: report.cookieMetadata, meStatus: report.meStatus,
      user2Verified: state.sessionVerified, tabs: report.tabs }));
    return state.sessionVerified;
  }
  async function dispatch(action) {
    if (action === 'close') {
      if (report.created.memories.length || report.created.plans.length) await runCases(state, 'cleanup');
      input.close(); finish(); return;
    }
    if (action === 'cleanup') { await runCases(state, 'cleanup'); return; }
    if (!['inspect', 'run', 'memory', 'plan', 'schedule'].includes(action)) return;
    const verified = await inspectSession();
    if (!verified || action === 'inspect') return;
    if (action === 'run') {
      if (!report.cases.length) await runCases(state, 'all');
      else {
        const latest = new Map(report.cases.map(item => [item.case, item.status]));
        const failed = [...latest].filter(([name, status]) => name !== 'cleanup' && status === 'FAIL');
        for (const [name] of failed) await runCases(state, name);
        if (failed.length) await runCases(state, 'cleanup');
      }
    } else await runCases(state, action);
  }
  function enqueue(action) {
    queue = queue.then(() => dispatch(action)).catch(error => {
      report.failure = error.code || error.name;
      save(); console.log('RUNNER_ACTION_FAILED: ' + (error.code || error.name));
    });
  }
  input.on('line', line => enqueue(line.trim()));
  context.on('response', response => {
    const url = new URL(response.url());
    if (url.origin !== BASE || url.pathname !== '/api/auth/login' || response.request().method() !== 'POST') return;
    report.loginStatus = response.status(); save();
    if (response.status() === 200) enqueue('run');
    else { report.authentication = 'FAIL'; report.failure = 'LOGIN_REJECTED'; save(); console.log('LOGIN_REJECTED'); }
  });
  await page.goto(BASE + '/login');
  await page.evaluate(() => { document.title = 'AIVA PA DESKTOP E2E — ĐĂNG NHẬP USER 2'; });
  console.log('DESKTOP_BROWSER_READY. Commands available immediately: inspect, run, memory, plan, schedule, cleanup, close.');
  await closed;
  await pool.end();
  await browser.close();
}
async function runCases(state, action) {
  const file = path.join(__dirname, 'pa-desktop-cases.cjs');
  delete require.cache[require.resolve(file)];
  const cases = require(file);
  for (const name of action === 'all' ? ['readOnly', 'memory', 'plan', 'schedule', 'cleanup'] : [action]) {
    try {
      await cases[name](state);
      state.report.cases.push({ case: name, status: 'PASS', at: new Date().toISOString() });
      console.log('PASS: ' + name);
    } catch (error) {
      state.report.cases.push({ case: name, status: 'FAIL', error: error.code || error.name, detail: String(error.message).slice(0, 120), at: new Date().toISOString() });
      console.log('FAIL: ' + name + ' (' + (error.code || error.name) + ')');
    }
    state.save();
  }
}
main().catch(error => { report.failure = error.code || error.name; save(); console.log('RUNNER_FAILED: see report.json.'); process.exitCode = 1; });
