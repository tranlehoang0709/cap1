const assert = require('node:assert/strict');

function responseFor(page, operation) {
  return page.waitForResponse(response => {
    if (!response.url().endsWith('/api/backend')) return false;
    try { return response.request().postDataJSON().operation === operation; } catch { return false; }
  }, { timeout: 15000 });
}
async function submit(page, operation, button) {
  const pending = responseFor(page, operation);
  await button.click();
  const response = await pending;
  assert.equal(response.status(), 200, operation + ' status');
  return response.json();
}
async function dismiss(page) {
  const dialog = page.getByRole('dialog');
  if (await dialog.count()) await dialog.getByRole('button', { name: 'Hủy', exact: true }).click();
}
async function memoryPanel(state, page = state.page) {
  const panel = page.locator('.ud-pa-extensions');
  await panel.getByRole('button', { name: /^Ghi nhớ/ }).click();
  return panel;
}
async function ownMemory(state, id, key) {
  const [rows] = await state.pool.execute('SELECT id,user_id,memory_key,memory_value FROM personal_memories WHERE id=?', [id]);
  assert.equal(rows.length, 1);
  assert.equal(String(rows[0].user_id), '2');
  assert.equal(rows[0].memory_key, key);
  return rows[0];
}
async function readOnly(state) {
  const { page, expect } = state;
  await page.goto(state.base + '/user/dashboard');
  await expect(page.locator('[data-plan-id="1"]')).toBeVisible();
  const original = page.locator('[data-plan-id="1"]');
  await expect(original.locator('.ud-pa-session-item')).toHaveCount(3);
  await expect(original.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  const [plans] = await state.pool.execute('SELECT * FROM personal_plans WHERE id=1 AND user_id=2');
  const [tasks] = await state.pool.execute('SELECT * FROM personal_tasks WHERE plan_id=1 AND user_id=2 ORDER BY id');
  assert.equal(state.hash({ originalPlan: plans, originalTasks: tasks }), state.baseline);
  state.report.originalPlanReadOnly = { id: '1', steps: 3, progress: 0 };
}
async function memory(state) {
  const { page, expect, report } = state;
  assert(report.created.memories.length < 4, 'Memory test budget exhausted');
  await dismiss(page);
  await page.goto(state.base + '/user/dashboard');
  let panel = await memoryPanel(state);
  const key = 'pa-ft-' + Date.now();
  const first = 'Tôi đang phát triển PA-04, PA-06 và PA-08 cho dự án AIVA-IoT.';
  const updated = 'Tôi đang phát triển ba chức năng Personal Assistant: ghi nhớ dài hạn, lập kế hoạch cá nhân và tóm tắt lịch trình.';
  await panel.getByRole('button', { name: 'Lưu ghi nhớ', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Khóa ghi nhớ (memory_key)', { exact: true }).fill(key);
  await dialog.getByLabel('Nội dung ghi nhớ', { exact: true }).fill(first);
  await dialog.getByRole('button', { name: 'Lưu ghi nhớ', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  const [before] = await state.pool.execute('SELECT COUNT(*) AS total FROM personal_memories WHERE user_id=2 AND memory_key=?', [key]);
  assert.equal(Number(before[0].total), 0, 'Consent refusal must not write');
  report.intents ??= { memories: [], plans: [] };
  report.intents.memories.push(key); state.save();
  await dialog.getByRole('checkbox').check();
  const created = await submit(page, 'personalMemoryCreate', dialog.getByRole('button', { name: 'Lưu ghi nhớ', exact: true }));
  const id = String(created.id);
  report.created.memories.push({ id, key }); state.save();
  assert.equal((await ownMemory(state, id, key)).memory_value, first);
  await expect(dialog).toHaveCount(0);
  await panel.getByLabel('Tìm thông tin đã ghi nhớ').fill(key);
  await expect(panel.getByRole('row').filter({ hasText: key })).toBeVisible();
  await page.reload(); panel = await memoryPanel(state);
  await panel.getByLabel('Tìm thông tin đã ghi nhớ').fill(key);
  await expect(panel.getByRole('row').filter({ hasText: key })).toContainText(first);
  const second = await state.context.newPage(); second.setDefaultTimeout(10000);
  try {
    await second.goto(state.base + '/user/dashboard');
    const otherPanel = await memoryPanel(state, second);
    await otherPanel.getByLabel('Tìm thông tin đã ghi nhớ').fill(key);
    await otherPanel.getByRole('row').filter({ hasText: key }).getByRole('button', { name: 'Chỉnh sửa', exact: true }).click();
    await panel.getByRole('row').filter({ hasText: key }).getByRole('button', { name: 'Chỉnh sửa', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nội dung ghi nhớ', { exact: true }).fill(updated);
    await dialog.getByRole('checkbox').check();
    await submit(page, 'personalMemoryUpdate', dialog.getByRole('button', { name: 'Lưu ghi nhớ', exact: true }));
    const stale = second.getByRole('dialog');
    await stale.getByLabel('Nội dung ghi nhớ', { exact: true }).fill(first);
    await stale.getByRole('checkbox').check();
    const pending = responseFor(second, 'personalMemoryUpdate');
    await stale.getByRole('button', { name: 'Lưu ghi nhớ', exact: true }).click();
    assert.equal((await pending).status(), 409, 'Stale edit must be rejected');
    await expect(stale).toBeVisible();
    await expect(stale.getByLabel('Nội dung ghi nhớ', { exact: true })).toHaveValue(first);
    assert.equal((await ownMemory(state, id, key)).memory_value, updated);
  } finally { await second.close(); }
  report.memoryChecks = { consent: true, create: true, listSearch: true, refresh: true, update: true, staleEdit409: true };
  page.once('dialog', native => native.accept());
  await submit(page, 'personalMemoryDelete', panel.getByRole('row').filter({ hasText: key }).getByRole('button', { name: 'Xóa', exact: true }));
  const [gone] = await state.pool.execute('SELECT id FROM personal_memories WHERE id=? AND user_id=2', [id]);
  assert.equal(gone.length, 0);
  await expect(panel.getByRole('row').filter({ hasText: key })).toHaveCount(0);
  report.memoryChecks.delete = true;
}
async function plan(state) {
  const { page, expect, report } = state;
  assert(report.created.plans.length < 4, 'Plan test budget exhausted');
  await dismiss(page); await page.goto(state.base + '/user/dashboard');
  await page.getByRole('button', { name: 'Tạo kế hoạch mới', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const title = 'Xác minh PA-06 AIVA-IoT ' + Date.now();
  await dialog.locator('[name="plan_title"]').fill(title);
  await dialog.locator('[name="plan_goal"]').fill('Hoàn thiện PA-04, PA-06 và PA-08 cho AIVA-IoT.');
  const titles = ['Hoàn thiện PA-04: Ghi nhớ dài hạn.', 'Hoàn thiện PA-06: Lập kế hoạch cá nhân.', 'Hoàn thiện PA-08: Tóm tắt lịch trình.'];
  for (const item of titles) {
    await dialog.getByRole('button', { name: 'Thêm bước thực hiện', exact: true }).click();
    await dialog.getByLabel('Công việc', { exact: true }).last().fill(item);
  }
  const confirmation = dialog.getByRole('checkbox');
  await confirmation.check();
  await dialog.locator('[name="plan_goal"]').fill('Xác minh ba chức năng Personal Assistant AIVA-IoT.');
  await expect(confirmation).not.toBeChecked();
  await confirmation.check();
  await dialog.getByRole('button', { name: 'Đưa bước 1 xuống', exact: true }).click();
  await expect(confirmation).not.toBeChecked();
  await expect(dialog.locator('[name="total_sessions"]')).toHaveValue('3');
  await confirmation.check();
  const [beforePlan] = await state.pool.execute('SELECT id FROM personal_plans WHERE user_id=2 AND title=?', [title]);
  assert.equal(beforePlan.length, 0, 'Test plan title must be new');
  report.intents ??= { memories: [], plans: [] };
  report.intents.plans.push(title); state.save();
  const fault = async route => {
    const payload = route.request().postDataJSON();
    if (payload.operation === 'personalPlanCreate') await route.abort('failed');
    else await route.continue();
  };
  await page.route('**/api/backend', fault);
  try {
    await dialog.getByRole('button', { name: 'Lưu kế hoạch', exact: true }).click();
    await expect(dialog.locator('.alert.error')).toBeVisible();
    await expect(dialog.locator('[name="plan_title"]')).toHaveValue(title);
    await expect(dialog.getByLabel('Công việc', { exact: true })).toHaveCount(3);
  } finally { await page.unroute('**/api/backend', fault); }
  let sent = 0;
  const count = request => { if (request.url().endsWith('/api/backend')) { try { if (request.postDataJSON().operation === 'personalPlanCreate') sent++; } catch {} } };
  page.on('request', count);
  let created;
  try {
    const pending = responseFor(page, 'personalPlanCreate');
    await dialog.getByRole('button', { name: 'Lưu kế hoạch', exact: true }).click({ clickCount: 2 });
    const response = await pending; assert.equal(response.status(), 200);
    created = await response.json();
  } finally { page.off('request', count); }
  const id = String(created.id);
  report.created.plans.push({ id, title, taskIds: created.sessions.map(step => String(step.id)) }); state.save();
  assert.equal(sent, 1, 'Double-click must send one create request');
  const [stored] = await state.pool.execute('SELECT id,user_id,title FROM personal_plans WHERE id=?', [id]);
  assert.equal(stored.length, 1); assert.equal(String(stored[0].user_id), '2'); assert.equal(stored[0].title, title);
  const [tasks] = await state.pool.execute('SELECT * FROM personal_tasks WHERE plan_id=? AND user_id=2 ORDER BY session_number', [id]);
  assert.equal(tasks.length, 3); assert.equal(tasks[0].title, titles[1]);
  let card = page.locator('[data-plan-id="' + id + '"]');
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  await card.getByRole('button', { name: 'Xem công việc thuộc kế hoạch', exact: true }).click();
  const first = created.sessions[0];
  const editButton = page.getByRole('button', { name: 'Chỉnh sửa ' + first.title, exact: true });
  await expect(editButton).toHaveCount(1);
  await editButton.click();
  const edit = page.getByRole('dialog');
  await edit.locator('[name="description"]').fill('Kiểm tra chức năng Personal Assistant qua giao diện và MySQL thật.');
  await edit.locator('[name="progress_percent"]').fill('50');
  await submit(page, 'personalTaskUpdate', edit.getByRole('button', { name: 'Lưu công việc', exact: true }));
  const [partial] = await state.pool.execute('SELECT progress_percent FROM personal_tasks WHERE id=? AND user_id=2 AND plan_id=?', [first.id, id]);
  assert.equal(Number(partial[0].progress_percent), 50);
  await expect(card.locator('[data-session-id="' + first.id + '"]')).toContainText('50%');
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  for (let index = 0; index < created.sessions.length; index++) {
    const step = created.sessions[index];
    await submit(page, 'personalPlanSessionComplete', card.locator('[data-session-id="' + step.id + '"]').getByRole('button'));
    await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(Math.round((index + 1) / 3 * 100)));
  }
  await page.reload(); card = page.locator('[data-plan-id="' + id + '"]');
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  const [finished] = await state.pool.execute('SELECT status FROM personal_plans WHERE id=? AND user_id=2', [id]);
  assert.equal(finished[0].status, 'completed');
  report.planChecks = { confirmationInvalidated: true, reorder: true, networkFaultPreservesDraft: true, singleRequestOnDoubleClick: true, mysqlSteps: 3, partialEdit: true, completeProgress: true, refresh: true };
}
async function schedule(state) {
  const { page, expect } = state;
  await dismiss(page); await page.goto(state.base + '/user/dashboard');
  const panel = page.locator('.panel').filter({ has: page.getByRole('heading', { name: 'Tóm tắt lịch trình · PA-08', exact: true }) });
  const [events] = await state.pool.execute('SELECT COUNT(*) AS total FROM personal_events WHERE user_id=2');
  assert.equal(Number(events[0].total), 0, 'Expected current real empty schedule');
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  for (const mode of ['day', 'week', 'range']) {
    await panel.getByLabel('Khoảng thời gian', { exact: true }).selectOption(mode);
    await panel.getByLabel('Ngày', { exact: true }).fill(date);
    if (mode === 'range') await panel.getByLabel('Đến ngày', { exact: true }).fill(date);
    await submit(page, 'personalEvents', panel.getByRole('button', { name: 'Tóm tắt lịch trình', exact: true }));
    await expect(panel.getByText('Không có hoạt động trong khoảng thời gian này.', { exact: true })).toBeVisible();
    await expect(panel.getByText(/0 hoạt động/)).toBeVisible();
  }
  const fault = async route => {
    const payload = route.request().postDataJSON();
    if (payload.operation === 'personalEvents' && payload.query?.limit === '100') await route.abort('failed');
    else await route.continue();
  };
  await page.route('**/api/backend', fault);
  try {
    await panel.getByRole('button', { name: 'Tóm tắt lịch trình', exact: true }).click();
    await expect(panel.locator('.alert.error')).toBeVisible();
    await expect(panel.getByText('Không có hoạt động trong khoảng thời gian này.', { exact: true })).toHaveCount(0);
  } finally { await page.unroute('**/api/backend', fault); }
  state.report.scheduleChecks = { day: true, week: true, range: true, realEmptyMySQL: true, networkFaultVisible: true, noFalseEmptyOnFailure: true };
}
async function authDiagnostics(state) {
  const known = {
    INVALID_CREDENTIALS: 'Email hoặc mật khẩu không đúng.',
    EMAIL_NOT_VERIFIED: 'Tài khoản chưa xác minh email. Vui lòng xác minh email để tiếp tục.',
    ACCOUNT_SUSPENDED: 'Tài khoản đang bị tạm khóa. Vui lòng liên hệ quản trị viên.',
    ACCOUNT_DISABLED: 'Tài khoản đã bị vô hiệu hóa.',
    ACCOUNT_UNAVAILABLE: 'Tài khoản hiện không thể đăng nhập.',
  };
  if (!state.authObserverAttached) {
    state.authObserverAttached = true;
    state.context.on('response', async response => {
      try {
        const url = new URL(response.url());
        if (url.origin !== state.base || url.pathname !== '/api/auth/login' || response.status() < 400) return;
        const body = await response.json();
        state.report.authResponse = { status: response.status(), code: Object.hasOwn(known, body.code) ? body.code : 'UNCLASSIFIED_AUTH_ERROR' };
        state.save();
        console.log('AUTH_RESPONSE: ' + JSON.stringify(state.report.authResponse));
      } catch { /* Diagnostics must never log raw response bodies. */ }
    });
  }
  const visible = await state.page.locator('.alert.error,[role="alert"]').allTextContents();
  const codeFromVisibleError = Object.keys(known).find(code => visible.some(text => text.trim() === known[code])) || null;
  const emailInput = state.page.locator('input[name="email"]:visible');
  const typedEmail = await emailInput.count() === 1 ? (await emailInput.inputValue()).trim().toLowerCase() : '';
  const [accounts] = await state.pool.execute("SELECT u.id,u.email,u.status,u.email_verified_at IS NOT NULL AS verified,LEFT(u.password_hash,4) IN ('$2a$','$2b$','$2y$') AS bcrypt_format,CHAR_LENGTH(u.password_hash)=60 AS bcrypt_length_valid,r.code AS role FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.id=2");
  const [entered] = await state.pool.execute('SELECT id,status,email_verified_at IS NOT NULL AS verified FROM users WHERE email=?', [typedEmail]);
  state.report.authDiagnostics = {
    codeFromVisibleError,
    invalidFields: await state.page.locator('form input:invalid').evaluateAll(inputs => inputs.map(input => ({ name: input.name, missing: input.validity.valueMissing, typeMismatch: input.validity.typeMismatch, patternMismatch: input.validity.patternMismatch }))),
    visibleMessage: codeFromVisibleError ? known[codeFromVisibleError] : null,
    submittedEmailPresent: Boolean(typedEmail),
    submittedEmailMatchesUser2: Boolean(accounts[0]) && typedEmail === accounts[0].email.trim().toLowerCase(),
    submittedEmailExists: entered.length > 0,
    submittedAccount: entered[0] ? { matchesUser2: String(entered[0].id) === '2', status: entered[0].status, verified: Boolean(entered[0].verified) } : null,
    user2: accounts[0] ? { id: '2', roles: accounts.map(row => row.role), status: accounts[0].status,
      verified: Boolean(accounts[0].verified), bcryptFormat: Boolean(accounts[0].bcrypt_format), bcryptLengthValid: Boolean(accounts[0].bcrypt_length_valid) } : null,
  };
  if (!state.authRequestObserverAttached) {
    state.authRequestObserverAttached = true;
    state.context.on('response', async response => {
      try {
        const url = new URL(response.url());
        if (url.origin !== state.base || url.pathname !== '/api/auth/login' || response.request().method() !== 'POST') return;
        const submittedEmail = String(response.request().postDataJSON().email || '').trim().toLowerCase();
        const [submitted] = await state.pool.execute('SELECT id,status,email_verified_at IS NOT NULL AS verified FROM users WHERE email=?', [submittedEmail]);
        let code = null;
        if (response.status() >= 400) {
          const body = await response.json();
          code = Object.hasOwn(known, body.code) ? body.code : 'UNCLASSIFIED_AUTH_ERROR';
        }
        state.report.exactAuthAttempt = { status: response.status(), code,
          matchesUser2: Boolean(submitted[0]) && String(submitted[0].id) === '2',
          accountExists: submitted.length > 0, statusInMySQL: submitted[0]?.status ?? null,
          verifiedInMySQL: Boolean(submitted[0]?.verified) };
        state.save(); console.log('EXACT_AUTH_ATTEMPT: ' + JSON.stringify(state.report.exactAuthAttempt));
      } catch { console.log('AUTH_DIAGNOSTIC_UNAVAILABLE'); }
    });
  }
  if (!state.report.user2EmailPrepared && accounts[0] && accounts[0].status === 'active' && accounts[0].verified) {
    const back = state.page.getByRole('button', { name: 'Quay lại đăng nhập', exact: true });
    if (await back.count()) await back.click();
    else await state.page.getByRole('tab', { name: 'Đăng nhập', exact: true }).click();
    await state.page.locator('input[name="email"]:visible').fill(accounts[0].email);
    await state.page.locator('input[name="password"]:visible').fill('');
    state.report.user2EmailPrepared = true;
  }
  state.report.cleanup = 'NOT REQUIRED';
  state.save();
  console.log('AUTH_DIAGNOSTICS: ' + JSON.stringify(state.report.authDiagnostics));
  console.log('USER2_EMAIL_PREPARED: enter the existing password manually in the current window.');
}

async function contextDiagnostics(state) {
  const tabs = [];
  for (const tab of state.context.pages()) {
    const url = new URL(tab.url());
    const inScope = ['http://127.0.0.1:3100', 'http://localhost:3100'].includes(url.origin);
    const metadata = { origin: url.origin, path: inScope ? url.pathname : '[outside AIVA]' };
    if (inScope) {
      metadata.invalidFields = await tab.locator('form input:invalid:visible').evaluateAll(inputs => inputs.map(input => ({ name: input.name, missing: input.validity.valueMissing, typeMismatch: input.validity.typeMismatch, patternMismatch: input.validity.patternMismatch })));
      metadata.loginNetworkEntries = await tab.evaluate(() => performance.getEntriesByType('resource').filter(entry => {
        const url = new URL(entry.name);
        return url.origin === location.origin && url.pathname === '/api/auth/login';
      }).map(entry => ({ path: '/api/auth/login', startUTC: new Date(performance.timeOrigin + entry.startTime).toISOString(), endUTC: new Date(performance.timeOrigin + entry.responseEnd).toISOString(), status: Number(entry.responseStatus) || null })));
    }
    tabs.push(metadata);
  }
  state.report.contextDiagnostics = { inspectedUTC: new Date().toISOString(), browserContextCount: state.context.browser().contexts().length, tabs };
  state.save();
  console.log('CONTEXT_DIAGNOSTICS: ' + JSON.stringify(state.report.contextDiagnostics));
}

async function cleanup(state) {
  if (!state.sessionVerified && !state.report.created.memories.length && !state.report.created.plans.length) {
    await contextDiagnostics(state);
    return;
  }

  // Reconcile exact submitted identifiers if a response was lost after commit.
  // No deletion is selected by prefix, and all recovered IDs remain owner-checked.
  for (const key of state.report.intents?.memories || []) {
    const [rows] = await state.pool.execute('SELECT id FROM personal_memories WHERE user_id=2 AND memory_key=?', [key]);
    for (const row of rows) if (!state.report.created.memories.some(item => item.id === String(row.id))) {
      assert(state.report.created.memories.length < 4, 'Unexpected memory count; cleanup stopped');
      state.report.created.memories.push({ id: String(row.id), key });
    }
  }
  for (const title of state.report.intents?.plans || []) {
    const [rows] = await state.pool.execute('SELECT id FROM personal_plans WHERE user_id=2 AND title=?', [title]);
    for (const row of rows) if (!state.report.created.plans.some(item => item.id === String(row.id))) {
      assert(String(row.id) !== '1' && state.report.created.plans.length < 4, 'Unexpected plan count; cleanup stopped');
      const [tasks] = await state.pool.execute('SELECT id FROM personal_tasks WHERE plan_id=? AND user_id=2', [row.id]);
      state.report.created.plans.push({ id: String(row.id), title, taskIds: tasks.map(task => String(task.id)) });
    }
  }
  state.save();
  const connection = await state.pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const memory of state.report.created.memories) {
      const [rows] = await connection.execute('SELECT user_id,memory_key FROM personal_memories WHERE id=? FOR UPDATE', [memory.id]);
      if (!rows.length) continue;
      assert.equal(String(rows[0].user_id), '2'); assert.equal(rows[0].memory_key, memory.key);
      await connection.execute('DELETE FROM personal_memories WHERE id=? AND user_id=2', [memory.id]);
    }
    for (const plan of state.report.created.plans) {
      assert.notEqual(plan.id, '1');
      const [rows] = await connection.execute('SELECT user_id,title FROM personal_plans WHERE id=? FOR UPDATE', [plan.id]);
      if (!rows.length) continue;
      assert.equal(String(rows[0].user_id), '2'); assert.equal(rows[0].title, plan.title);
      const [linkedEvents] = await connection.execute('SELECT id FROM personal_events WHERE plan_id=?', [plan.id]);
      assert.equal(linkedEvents.length, 0, 'Unsafe cleanup: linked event exists');
      const [tasks] = await connection.execute('SELECT id,user_id FROM personal_tasks WHERE plan_id=? FOR UPDATE', [plan.id]);
      for (const task of tasks) {
        assert.equal(String(task.user_id), '2');
        assert(plan.taskIds.includes(String(task.id)) && !state.baselineTaskIds.has(String(task.id)), 'Unsafe cleanup: unexpected task ID');
      }
      for (const task of tasks) await connection.execute('DELETE FROM personal_tasks WHERE id=? AND user_id=2 AND plan_id=?', [task.id, plan.id]);
      await connection.execute('DELETE FROM personal_plans WHERE id=? AND user_id=2', [plan.id]);
    }
    const [originalPlan] = await connection.execute('SELECT * FROM personal_plans WHERE id=1 AND user_id=2');
    const [originalTasks] = await connection.execute('SELECT * FROM personal_tasks WHERE plan_id=1 AND user_id=2 ORDER BY id');
    assert.equal(state.hash({ originalPlan, originalTasks }), state.baseline, 'Original plan changed');
    await connection.commit();
    state.report.cleanup = 'PASS';
  } catch (error) { await connection.rollback(); state.report.cleanup = 'BLOCKED'; throw error; }
  finally { connection.release(); }
}
module.exports = { readOnly, memory, plan, schedule, cleanup };
