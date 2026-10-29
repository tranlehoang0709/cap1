/** Kiểm tra chính sách URL/redaction mà không mở browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { baseURL, validateTestOrigin, isLocalURL, recordPolicyBlock, restrictNetwork, metricsEndpoint, redact, demoPassword, demoEmails } from './moi_truong.js';
import { collectErrors, isBlockedMetricsMessage } from './loi_trinh_duyet.js';

test('chỉ cho HTTP/WS đúng localhost và port đã xác minh', () => {
  for (const url of ['http://localhost:8501/', 'ws://localhost:8501/_stcore/stream']) assert.equal(isLocalURL(url, 'http://localhost:8501'), true);
  for (const url of ['http://localhost:8502/', 'https://localhost:8501/', 'http://localhost.evil.test:8501/', 'http://127.0.0.1:8501/', 'file:///etc/passwd', 'http://user:pass@localhost:8501/']) assert.equal(isLocalURL(url, 'http://localhost:8501'), false);
});
test('chỉ phân loại metrics khi có bằng chứng endpoint đã bị chặn', () => {
  const message = 'Undefined metrics config - deactivating metrics tracking.';
  const url = 'http://localhost:8501/static/js/index.CKCTizkM.js';
  assert.equal(isBlockedMetricsMessage(message, url, ['https://data.streamlit.io/metrics.json'], 'http://localhost:8501'), true);
  assert.equal(isBlockedMetricsMessage(message, url, [], 'http://localhost:8501'), false);
  assert.equal(isBlockedMetricsMessage('Other error', url, ['https://data.streamlit.io/metrics.json'], 'http://localhost:8501'), false);
  assert.equal(isBlockedMetricsMessage(message, 'http://other.test/index.js', ['https://data.streamlit.io/metrics.json'], 'http://localhost:8501'), false);
});

test('origin chỉ nhận hai giá trị canonical được duyệt', () => {
  assert.equal(validateTestOrigin(), 'http://localhost:8501');
  for (const port of ['8501', '8502']) assert.equal(validateTestOrigin(`http://localhost:${port}`), `http://localhost:${port}`);
  for (const value of ['', 'http://localhost:8502/', 'http://localhost:8502/path', 'http://localhost:8502?x=1', 'http://localhost:8502#x',
    'https://localhost:8502', 'ws://localhost:8502', 'http://localhost:8503', 'http://127.0.0.1:8502', 'http://[::1]:8502',
    'http://localhost.evil.test:8502', 'http://user:pass@localhost:8502', ' http://localhost:8502', 'http://LOCALHOST:8502']) assert.throws(() => validateTestOrigin(value), /BLOCKED/);
});

for (const port of ['8501', '8502']) test(`HTTP/WS chỉ thuộc origin đã chọn ${port}`, () => {
  const origin = `http://localhost:${port}`, other = port === '8501' ? '8502' : '8501';
  assert.equal(isLocalURL(`${origin}/_stcore/health`, origin), true);
  assert.equal(isLocalURL(`ws://localhost:${port}/_stcore/stream`, origin), true);
  for (const url of [`http://localhost:${other}/`, `ws://localhost:${other}/_stcore/stream`, `http://localhost:9999/api`, 'https://example.test/api',
    `https://localhost:${port}/`, `wss://localhost:${port}/`, `http://127.0.0.1:${port}/`, `http://[::1]:${port}/`, `http://localhost.evil.test:${port}/`,
    `http://user@localhost:${port}/`, `ws://user:pass@localhost:${port}/`, 'file:///tmp/test', 'data:text/plain,test']) assert.equal(isLocalURL(url, origin), false, url);
});

test('cấu hình được kiểm tra khi import, trước browser; không dùng default cho giá trị sai', () => {
  const moduleURL = new URL('./moi_truong.js', import.meta.url).href;
  for (const value of [undefined, 'http://localhost:8502', 'http://localhost:8502/']) {
    const env = { ...process.env }; if (value === undefined) delete env.AIVA_TEST_ORIGIN; else env.AIVA_TEST_ORIGIN = value;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `const m=await import(${JSON.stringify(moduleURL)});console.log(m.baseURL)`], { env, encoding: 'utf8' });
    assert.equal(r.status, value?.endsWith('/') ? 1 : 0);
    if (r.status === 0) assert.equal(r.stdout.trim(), value || 'http://localhost:8501');
  }
  assert.equal(baseURL, process.env.AIVA_TEST_ORIGIN || 'http://localhost:8501');
});

for (const port of ['8501', '8502']) test(`telemetry chỉ đúng emitter và bằng chứng tại ${port}`, () => {
  const origin = `http://localhost:${port}`, url = `${origin}/static/js/index.test-1.js`, blocked = [metricsEndpoint];
  const message = `Failed to fetch metrics config: TypeError: Failed to fetch\n    at X.requestDefaultMetricsConfig (${url}:33:1)`;
  assert.equal(isBlockedMetricsMessage(message, url, blocked, origin), true);
  for (const emitter of [`${url}?x=1`, `${url}#x`, `${origin}/static/js/app.js`, `${origin}/other/index.test-1.js`, `http://user@localhost:${port}/static/js/index.test-1.js`, 'http://localhost:9999/static/js/index.test-1.js']) {
    assert.equal(isBlockedMetricsMessage(message, emitter, blocked, origin), false);
  }
  assert.equal(isBlockedMetricsMessage(message, url, [], origin), false);
  assert.equal(isBlockedMetricsMessage('Recording error: Container not found', url, blocked, origin), false);
  assert.equal(isBlockedMetricsMessage('Other application error', url, blocked, origin), false);
});

test('mọi lần chặn HTTP/WS ngoài dự kiến đều quan sát được, kể cả trước khi collector gắn', async () => {
  const blocked = [], page = new EventEmitter();
  recordPolicyBlock(blocked, 'https://unexpected.test/api');
  const records = collectErrors(page, blocked);
  recordPolicyBlock(blocked, 'ws://localhost:9999/stream', 'websocket');
  recordPolicyBlock(blocked, metricsEndpoint);
  assert.equal(records.filter(r => r.category === 'error').length, 2);
  recordPolicyBlock(blocked, metricsEndpoint, 'interception-error', 'interceptor failed');
  assert.equal(records.filter(r => r.category === 'error').length, 3);
  page.emit('close');
});

test('requestfailed và pageerror thật không được biến thành telemetry harmless', () => {
  const blocked = [metricsEndpoint, 'https://unexpected.test/api'], page = new EventEmitter(), records = collectErrors(page, blocked);
  const fail = (url, errorText) => page.emit('requestfailed', { url: () => url, failure: () => ({ errorText }) });
  fail(metricsEndpoint, 'net::ERR_BLOCKED_BY_CLIENT');
  fail(metricsEndpoint, 'net::ERR_CONNECTION_RESET');
  fail('https://unexpected.test/api', 'net::ERR_BLOCKED_BY_CLIENT');
  fail(`${baseURL}/unexpected`, 'net::ERR_CONNECTION_RESET');
  page.emit('pageerror', Error('Undefined metrics config - deactivating metrics tracking.'));
  assert.deepEqual(records.map(r => r.category), ['network-policy', 'error', 'error', 'error', 'error']);
  page.emit('close');
});

test('Recording console error vẫn làm gate FAIL ngay cả khi metrics đã bị chặn', () => {
  const page = new EventEmitter(), records = collectErrors(page, [metricsEndpoint]);
  const emit = (text, url) => page.emit('console', { type: () => 'error', text: () => text, location: () => ({ url }) });
  emit('Undefined metrics config - deactivating metrics tracking.', `${baseURL}/static/js/index.test.js`);
  emit('Recording error: Container not found', `${baseURL}/static/js/index.test.js`);
  emit('Undefined metrics config - deactivating metrics tracking.', `${baseURL}/app.js`);
  emit('Failed to load resource: net::ERR_BLOCKED_BY_CLIENT', 'https://unexpected.test/api');
  assert.deepEqual(records.map(r => r.category), ['network-policy', 'error', 'error', 'error']);
  page.emit('close');
});

test('biến thể CDP Inspector chỉ là ngoại lệ với đúng metrics endpoint đã chặn', () => {
  for (const suffix of ['', '.Inspector']) {
    const page = new EventEmitter(), records = collectErrors(page, [metricsEndpoint, 'https://unexpected.test/api']);
    for (const url of [metricsEndpoint, 'https://unexpected.test/api']) {
      page.emit('requestfailed', { url: () => url, failure: () => ({ errorText: `net::ERR_BLOCKED_BY_CLIENT${suffix}` }) });
      page.emit('console', { type: () => 'error', text: () => `Failed to load resource: net::ERR_BLOCKED_BY_CLIENT${suffix}`, location: () => ({ url }) });
    }
    assert.deepEqual(records.map(r => r.category), ['network-policy', 'network-policy', 'error', 'error']);
    page.emit('close');
  }
  const page = new EventEmitter(), records = collectErrors(page, []);
  page.emit('requestfailed', { url: () => metricsEndpoint, failure: () => ({ errorText: 'net::ERR_BLOCKED_BY_CLIENT.Inspector' }) });
  assert.equal(records[0].category, 'error'); page.emit('close');
});

test('interception HTTP và WebSocket chặn thật, không chỉ ghi cảnh báo', async () => {
  let http, ws; const context = { route: async (_, fn) => { http = fn; }, routeWebSocket: async (_, fn) => { ws = fn; } };
  const blocked = [], page = new EventEmitter(), records = collectErrors(page, blocked); await restrictNetwork(context, blocked);
  let continued = 0, aborted = 0, connected = 0, closed = 0;
  for (const url of [`${baseURL}/`, 'https://unexpected.test/api']) await http({ request: () => ({ url: () => url }), continue: async () => continued++, abort: async () => aborted++ });
  for (const url of [baseURL.replace('http:', 'ws:') + '/_stcore/stream', 'ws://localhost:9999/stream']) ws({ url: () => url, connectToServer: () => connected++, close: () => closed++ });
  assert.deepEqual([continued, aborted, connected, closed], [1, 1, 1, 1]);
  assert.equal(records.filter(r => r.category === 'error').length, 2);
  await http({ request: () => ({ url: () => `${baseURL}/` }), continue: async () => { throw Error('interception failed'); } });
  assert.equal(records.at(-1).category, 'error'); page.emit('close');
});
test('không để credentials demo xuất hiện trong log đã xử lý', () => {
  const result = redact(`${demoPassword} ${demoEmails.user} ${demoEmails.admin}`);
  assert.ok(!result.includes(demoPassword));
  assert.ok(!result.includes(demoEmails.user));
  assert.ok(!result.includes(demoEmails.admin));
});
