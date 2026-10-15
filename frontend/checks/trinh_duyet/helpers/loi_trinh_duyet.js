/** Thu thập toàn bộ cảnh báo; chỉ phân loại mẫu baseline đã có bằng chứng. */
import { redact } from './moi_truong.js';

const features = ['ambient-light-sensor', 'battery', 'document-domain', 'layout-animations', 'legacy-image-formats', 'oversized-images', 'vr', 'wake-lock'];
export function isBlockedMetricsMessage(text, url, blocked) {
  // Đã tái hiện tại run 2026-10-14T07-50-07-611Z và đối chiếu bundle Streamlit.
  if (!blocked.includes('https://data.streamlit.io/metrics.json')) return false;
  if (!/^http:\/\/localhost:8501\/static\/js\/index\.[\w-]+\.js$/.test(url)) return false;
  return text === 'Undefined metrics config - deactivating metrics tracking.' ||
    text.startsWith('Failed to fetch metrics config: TypeError: Failed to fetch') && text.includes('requestDefaultMetricsConfig');
}
export function collectErrors(page, blocked) {
  const records = [];
  page.on('pageerror', error => records.push({ type: 'pageerror', message: redact(error.message), category: 'error' }));
  page.on('console', message => {
    if (!['error', 'warning'].includes(message.type())) return;
    const text = redact(message.text()), url = redact(message.location().url || '');
    const baselineWarning = message.type() === 'warning' && (
      features.some(name => text.includes(`Unrecognized feature: '${name}'`)) ||
      text.includes('An iframe which has both allow-scripts and allow-same-origin for its sandbox attribute can escape its sandboxing')
    );
    const blockedByPolicy = blocked.includes(url) && text.includes('ERR_BLOCKED_BY_CLIENT') || isBlockedMetricsMessage(text, url, blocked);
    records.push({ type: message.type(), message: text, url, category: blockedByPolicy ? 'network-policy' : baselineWarning ? 'known-warning' : message.type() === 'warning' ? 'unreviewed-warning' : 'error' });
  });
  page.on('requestfailed', request => {
    const url = redact(request.url());
    records.push({ type: 'requestfailed', url, message: redact(request.failure()?.errorText || ''), category: blocked.includes(url) ? 'network-policy' : 'error' });
  });
  return records;
}
