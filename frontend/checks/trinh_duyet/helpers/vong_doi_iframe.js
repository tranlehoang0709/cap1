/** Quan sát protocol/DOM hiện có, không ghi vào state hoặc runtime robot. */
import { createHash } from 'node:crypto';
import { expect } from '@playwright/test';

const streams = new WeakMap();
// ForwardMsg của Streamlit 1.65: script_finished là field 6, wire type 0.
// Chỉ đọc field này; không lưu payload WebSocket hoặc dữ liệu tài khoản.
function scriptFinished(payload) {
  const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let offset = 0;
  const integer = () => {
    let value = 0, shift = 0;
    while (offset < bytes.length && shift < 53) {
      const b = bytes[offset++]; value += (b & 127) * 2 ** shift;
      if (!(b & 128)) return value;
      shift += 7;
    }
    throw Error('Protobuf không đầy đủ');
  };
  try {
    while (offset < bytes.length) {
      const key = integer(), field = Math.floor(key / 8), wire = key & 7;
      if (wire === 0) { const value = integer(); if (field === 6) return value; }
      else if (wire === 1) offset += 8;
      else if (wire === 2) { const length = integer(); offset += length; }
      else if (wire === 5) offset += 4;
      else return null;
    }
  } catch { /* Protocol khác chỉ làm phép đo này không khả dụng. */ }
  return null;
}
export function watchReruns(page) {
  const state = { finished: [] };
  streams.set(page, state);
  page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    const status = scriptFinished(payload);
    if (status !== null) state.finished.push({ at: Date.now(), status });
  }));
}
export function reruns(page) { return streams.get(page)?.finished || []; }
export async function waitForRerun(page, previousCount) {
  await expect.poll(() => reruns(page).length, { message: 'Streamlit script_finished sau thao tác UI' }).toBeGreaterThan(previousCount);
}
export async function inspectRobot(frame) {
  const element = await frame.frameElement();
  const srcdoc = await element.getAttribute('srcdoc');
  const details = await frame.evaluate(() => ({
    diagnostics: { ...window.__AIVA3D__ },
    config: JSON.parse(document.getElementById('aiva-config').textContent),
    timeOrigin: performance.timeOrigin, hidden: document.hidden,
    canvasCount: document.querySelectorAll('canvas').length,
    width: innerWidth, height: innerHeight,
  }));
  const rect = await element.boundingBox();
  const layout = await element.evaluate(element => {
    const ancestors = [];
    for (let node = element.parentElement; node; node = node.parentElement) {
      if (node.dataset.testid) ancestors.push({ testid: node.dataset.testid, index: Array.from(node.parentElement?.children || []).indexOf(node), key: [...node.classList].find(name => name.startsWith('st-key-')) || null });
    }
    return { flashPresent: !!document.querySelector('.success-animation'), ancestors };
  });
  return { ...details, rect, layout, srcdocSHA256: createHash('sha256').update(srcdoc || '').digest('hex') };
}
export async function preserveIdentity(frame) {
  const element = await frame.frameElement();
  const identity = await element.evaluateHandle(element => ({
    element, document: element.contentDocument,
    canvas: element.contentDocument.querySelector('canvas'),
    diagnostics: element.contentWindow.__AIVA3D__,
  }));
  await element.dispose();
  return identity;
}
export async function compareIdentity(identity, frame) {
  const element = await frame.frameElement();
  try {
    return await identity.evaluate((old, current) => ({
      oldConnected: old.element.isConnected,
      sameElement: old.element === current,
      sameDocument: old.document === current.contentDocument,
      sameCanvas: old.canvas === current.contentDocument.querySelector('canvas'),
      sameDiagnostics: old.diagnostics === current.contentWindow.__AIVA3D__,
    }), element);
  } finally { await element.dispose(); }
}
export function watchFrames(page) {
  const events = [], ids = new Map();
  const id = frame => { if (!ids.has(frame)) ids.set(frame, ids.size + 1); return ids.get(frame); };
  for (const frame of page.frames()) id(frame);
  const handlers = Object.fromEntries(['frameattached', 'framenavigated', 'framedetached'].map(type => [type, frame => {
    events.push({ type, at: Date.now(), id: id(frame), url: frame.url() });
  }]));
  for (const [type, fn] of Object.entries(handlers)) page.on(type, fn);
  return { events, id, stop: () => { for (const [type, fn] of Object.entries(handlers)) page.off(type, fn); } };
}
