/** Chỉ cho phép URL local đã xác minh; mọi artifact nằm ngoài source. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

export const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export function validateTestOrigin(value = 'http://localhost:8501') {
  if (!['http://localhost:8501', 'http://localhost:8502'].includes(value)) {
    throw Error('BLOCKED: AIVA_TEST_ORIGIN phải là origin localhost được duyệt, không kèm path/credentials/query/fragment');
  }
  return value;
}
export const baseURL = validateTestOrigin(process.env.AIVA_TEST_ORIGIN);
export const metricsEndpoint = 'https://data.streamlit.io/metrics.json';
const policyObservers = new WeakMap();
export const demoPassword = 'Demo123!'; // Mật khẩu demo công khai, đã được cho phép.
export const demoEmails = { user: 'user@example.test', admin: 'admin@example.test' };
process.env.AIVA_RUN_ID ||= new Date().toISOString().replace(/[:.]/g, '-');
if (!/^[A-Za-z0-9_-]+$/.test(process.env.AIVA_RUN_ID)) throw Error('AIVA_RUN_ID không hợp lệ');
export const runDir = path.resolve('E:/captone_backup/browser_runs', process.env.AIVA_RUN_ID);
const relative = path.relative(sourceRoot, runDir);
if (!relative || !relative.startsWith('..') && !path.isAbsolute(relative)) throw Error('Artifacts phải nằm ngoài source');

export function isLocalURL(value, origin = baseURL) {
  try {
    const u = new URL(value);
    const trusted = new URL(validateTestOrigin(origin));
    return ['http:', 'ws:'].includes(u.protocol) && u.hostname === trusted.hostname && u.port === trusted.port && !u.username && !u.password;
  } catch { return false; }
}
/** Ghi cả lần chặn chưa phát sinh requestfailed, đặc biệt với WebSocket. */
export function recordPolicyBlock(blocked, url, kind = 'request', message = '') {
  const event = { url: redact(url), kind, message: redact(message) };
  blocked.push(event.url);
  const state = policyObservers.get(blocked) || { events: [], listeners: new Set() };
  policyObservers.set(blocked, state);
  state.events.push(event);
  for (const listener of state.listeners) listener(event);
}
export function observePolicyBlocks(blocked, listener) {
  const state = policyObservers.get(blocked) || { events: [], listeners: new Set() };
  policyObservers.set(blocked, state);
  state.listeners.add(listener);
  for (const event of state.events) listener(event);
  return () => state.listeners.delete(listener);
}
export function redact(value) {
  let text = String(value);
  for (const secret of [demoPassword, ...Object.values(demoEmails)]) text = text.replaceAll(secret, '[DEMO_REDACTED]');
  return text;
}
export async function prepareArtifacts() {
  for (const name of ['report', 'screenshots', 'traces']) await fs.mkdir(path.join(runDir, name), { recursive: true });
}
export async function verifyServer() {
  const response = await fetch(`${baseURL}/_stcore/health`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok || !/ok/i.test(await response.text())) throw Error('Server local chưa sẵn sàng');
}
export async function restrictNetwork(context, blocked = []) {
  await context.route('**/*', async route => {
    const url = route.request().url();
    try {
      if (isLocalURL(url)) return await route.continue();
      recordPolicyBlock(blocked, url);
      await route.abort('blockedbyclient');
    } catch (error) { recordPolicyBlock(blocked, url, 'interception-error', error.message); }
  });
  await context.routeWebSocket('**/*', socket => {
    const url = socket.url();
    try {
      if (isLocalURL(url)) return socket.connectToServer();
      recordPolicyBlock(blocked, url, 'websocket');
      socket.close();
    } catch (error) { recordPolicyBlock(blocked, url, 'interception-error', error.message); }
  });
}
