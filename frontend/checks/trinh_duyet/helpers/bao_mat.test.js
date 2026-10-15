/** Kiểm tra chính sách URL/redaction mà không mở browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalURL, redact, demoPassword, demoEmails } from './moi_truong.js';
import { isBlockedMetricsMessage } from './loi_trinh_duyet.js';

test('chỉ cho HTTP/WS đúng localhost và port đã xác minh', () => {
  for (const url of ['http://localhost:8501/', 'ws://localhost:8501/_stcore/stream']) assert.equal(isLocalURL(url), true);
  for (const url of ['http://localhost:8502/', 'https://localhost:8501/', 'http://localhost.evil.test:8501/', 'http://127.0.0.1:8501/', 'file:///etc/passwd', 'http://user:pass@localhost:8501/']) assert.equal(isLocalURL(url), false);
});
test('chỉ phân loại metrics khi có bằng chứng endpoint đã bị chặn', () => {
  const message = 'Undefined metrics config - deactivating metrics tracking.';
  const url = 'http://localhost:8501/static/js/index.CKCTizkM.js';
  assert.equal(isBlockedMetricsMessage(message, url, ['https://data.streamlit.io/metrics.json']), true);
  assert.equal(isBlockedMetricsMessage(message, url, []), false);
  assert.equal(isBlockedMetricsMessage('Other error', url, ['https://data.streamlit.io/metrics.json']), false);
  assert.equal(isBlockedMetricsMessage(message, 'http://other.test/index.js', ['https://data.streamlit.io/metrics.json']), false);
});
test('không để credentials demo xuất hiện trong log đã xử lý', () => {
  const result = redact(`${demoPassword} ${demoEmails.user} ${demoEmails.admin}`);
  assert.ok(!result.includes(demoPassword));
  assert.ok(!result.includes(demoEmails.user));
  assert.ok(!result.includes(demoEmails.admin));
});
