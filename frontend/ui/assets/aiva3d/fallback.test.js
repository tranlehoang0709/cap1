import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('the shipped bundle falls back safely when the canvas cannot create WebGL', () => {
  function element() {
    const item = new EventTarget();
    return Object.assign(item, {
      style: {}, hidden: false, disabled: false, textContent: '',
      clientWidth: 300, clientHeight: 144,
      classList: {add() {}, remove() {}},
      setAttribute() {}, remove() {}, prepend() {},
      getContext() { return null; },
    });
  }
  const ids = Object.fromEntries(['aiva-config', 'stage', 'viewport', 'fallback', 'status', 'pause', 'wave', 'reset', 'expression'].map(id => [id, element()]));
  ids['aiva-config'].textContent = JSON.stringify({hero: false, online: true, paused: false});
  const document = new EventTarget();
  document.hidden = false;
  document.getElementById = id => ids[id];
  document.createElementNS = () => element();
  document.createElement = () => element();
  const reduced = new EventTarget();
  reduced.matches = false;
  const window = new EventTarget();
  window.parent = window;
  window.document = document;
  window.getComputedStyle = () => ({colorScheme: 'dark'});
  window.queueMicrotask = queueMicrotask;
  window.MutationObserver = class { observe() {} disconnect() {} };
  document.body = {classList: {toggle() {}}};
  document.documentElement = {style: {}};
  let frames = 0;
  const context = {
    window, document, AbortController, devicePixelRatio: 1,
    matchMedia: () => reduced,
    console: {warn() {}, error() {}, log() {}},
    setTimeout, clearTimeout,
    requestAnimationFrame() { frames++; return 1; }, cancelAnimationFrame() {},
    ResizeObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() { this.callback([{isIntersecting: true}]); }
      disconnect() {}
    },
  };
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('./diagnostics.js', import.meta.url), 'utf8'), context);
  vm.runInContext(readFileSync(new URL('./robot.bundle.js', import.meta.url), 'utf8'), context);
  assert.match(ids.status.textContent, /WebGL/);
  assert.equal(ids.fallback.hidden, false);
  for (const id of ['pause', 'wave', 'reset']) assert.equal(ids[id].disabled, true);
  assert.equal(frames, 0);
  assert.equal(window.__AIVA3D__.bundleLoaded, true);
  assert.equal(window.__AIVA3D__.webgl2, false);
  assert.equal(window.__AIVA3D__.lastError.phase, 'webgl2-context');
});

test('JavaScript errors retain the real message and are not labeled unsupported WebGL', () => {
  const ids = Object.fromEntries(['stage', 'status', 'fallback', 'pause', 'wave', 'reset'].map(id => [id,
    {textContent: '', hidden: true, disabled: false, classList: {remove() {}}}]));
  const window = new EventTarget();
  const context = {window, document: {getElementById: id => ids[id]}, console: {error() {}}};
  vm.runInNewContext(readFileSync(new URL('./diagnostics.js', import.meta.url), 'utf8'), context);
  window.__AIVA3DReportError(new RangeError('Maximum call stack size exceeded'), 'first-frame');
  assert.equal(window.__AIVA3D__.lastError.kind, 'JavaScript');
  assert.match(ids.status.textContent, /Maximum call stack size exceeded/);
  assert.doesNotMatch(ids.status.textContent, /WebGL/);
  assert.equal(ids.fallback.hidden, false);
});
