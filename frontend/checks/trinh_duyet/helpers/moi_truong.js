/** Chỉ cho phép URL local đã xác minh; mọi artifact nằm ngoài source. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

export const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const baseURL = 'http://localhost:8501';
export const demoPassword = 'Demo123!'; // Mật khẩu demo công khai, đã được cho phép.
export const demoEmails = { user: 'user@example.test', admin: 'admin@example.test' };
process.env.AIVA_RUN_ID ||= new Date().toISOString().replace(/[:.]/g, '-');
if (!/^[A-Za-z0-9_-]+$/.test(process.env.AIVA_RUN_ID)) throw Error('AIVA_RUN_ID không hợp lệ');
export const runDir = path.resolve('E:/captone_backup/browser_runs', process.env.AIVA_RUN_ID);
const relative = path.relative(sourceRoot, runDir);
if (!relative || !relative.startsWith('..') && !path.isAbsolute(relative)) throw Error('Artifacts phải nằm ngoài source');

export function isLocalURL(value) {
  try {
    const u = new URL(value);
    return ['http:', 'ws:'].includes(u.protocol) && u.hostname === 'localhost' && u.port === '8501' && !u.username && !u.password;
  } catch { return false; }
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
  await context.route('**/*', route => {
    if (isLocalURL(route.request().url())) return route.continue();
    blocked.push(redact(route.request().url()));
    return route.abort('blockedbyclient');
  });
  await context.routeWebSocket('**/*', socket => {
    if (isLocalURL(socket.url())) return socket.connectToServer();
    blocked.push(redact(socket.url()));
    socket.close();
  });
}
