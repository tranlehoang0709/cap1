/** Thu thập toàn bộ cảnh báo; chỉ phân loại mẫu baseline đã có bằng chứng. */
import { baseURL, validateTestOrigin, metricsEndpoint, observePolicyBlocks, redact } from './moi_truong.js';

const features = ['ambient-light-sensor', 'battery', 'document-domain', 'layout-animations', 'legacy-image-formats', 'oversized-images', 'vr', 'wake-lock'];
// CDP Fetch.failRequest thêm .Inspector; chỉ áp dụng cho endpoint metrics đã chặn.
const policyAbort = /^net::ERR_BLOCKED_BY_CLIENT(?:\.Inspector)?$/;
export function isBlockedMetricsMessage(text, url, blocked, origin = baseURL) {
  // Đã tái hiện tại run 2026-10-14T07-50-07-611Z và đối chiếu bundle Streamlit.
  if (!blocked.includes(metricsEndpoint)) return false;
  try {
    const emitter = new URL(url);
    if (emitter.origin !== validateTestOrigin(origin) || emitter.username || emitter.password || emitter.search || emitter.hash ||
        !/^\/static\/js\/index\.[\w-]+\.js$/.test(emitter.pathname)) return false;
  } catch { return false; }
  return text === 'Undefined metrics config - deactivating metrics tracking.' ||
    text.startsWith('Failed to fetch metrics config: TypeError: Failed to fetch\n') && text.includes('requestDefaultMetricsConfig') && text.includes(`${url}:`);
}
export function collectErrors(page, blocked) {
  const records = [];
  const unsubscribe = observePolicyBlocks(blocked, event => {
    if (event.kind === 'interception-error' || event.url !== metricsEndpoint || event.kind === 'websocket') {
      records.push({ type: 'policyblock', message: event.message || 'Request ngoài policy đã bị chặn', url: event.url, category: 'error' });
    }
  });
  page.once('close', unsubscribe);
  page.on('pageerror', error => records.push({ type: 'pageerror', message: redact(error.message), category: 'error' }));
  page.on('console', message => {
    if (!['error', 'warning'].includes(message.type())) return;
    const text = redact(message.text()), url = redact(message.location().url || '');
    const baselineWarning = message.type() === 'warning' && (
      features.some(name => text.includes(`Unrecognized feature: '${name}'`)) ||
      text.includes('An iframe which has both allow-scripts and allow-same-origin for its sandbox attribute can escape its sandboxing')
    );
    const blockedByPolicy = url === metricsEndpoint && blocked.includes(url) && /^Failed to load resource: net::ERR_BLOCKED_BY_CLIENT(?:\.Inspector)?$/.test(text) || isBlockedMetricsMessage(text, url, blocked);
    records.push({ type: message.type(), message: text, url, category: blockedByPolicy ? 'network-policy' : baselineWarning ? 'known-warning' : message.type() === 'warning' ? 'unreviewed-warning' : 'error' });
  });
  page.on('requestfailed', request => {
    const url = redact(request.url());
    const message = redact(request.failure()?.errorText || '');
    records.push({ type: 'requestfailed', url, message, category: url === metricsEndpoint && blocked.includes(url) && policyAbort.test(message) ? 'network-policy' : 'error' });
  });
  return records;
}
