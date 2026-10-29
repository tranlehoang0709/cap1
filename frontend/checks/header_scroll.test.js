import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('entry/route changes reset scroll; same-page reruns and temporary gaps retain it', () => {
  let page = 'Dashboard', login = false, callback, observers = 0, disconnected = 0;
  const queue = new Map(); let next = 0;
  const main = {scrollTop: 96, scrollLeft: 0, resets: 0,
    querySelector: selector => selector.includes('login_header') ? login : page ? {textContent:page} : null,
    scrollTo({top}) {this.scrollTop = top; this.resets++;}};
  const window = {addEventListener(){}, removeEventListener(){}};
  const context = {window, document:{querySelector:()=>main},
    requestAnimationFrame: fn => {queue.set(++next,fn);return next;},
    cancelAnimationFrame: id => queue.delete(id),
    MutationObserver: class {constructor(fn){callback=fn;observers++;} observe(){} disconnect(){disconnected++;}}};
  const flush = () => {const batch=[...queue.values()];queue.clear();batch.forEach(fn=>fn());};
  const source=readFileSync(new URL('../ui/assets/layout/header_scroll.js',import.meta.url),'utf8');
  runInNewContext(source,context); flush();
  assert.equal(main.scrollTop,0);
  main.scrollTop=250; callback();flush();assert.equal(main.scrollTop,250);
  page=null;callback();flush();page='Dashboard';callback();flush();assert.equal(main.scrollTop,250);
  page='System Settings';callback();flush();assert.equal(main.scrollTop,0);
  main.scrollTop=300;runInNewContext(source,context);flush();assert.equal(observers,1);assert.equal(main.scrollTop,300);
  login=true;page=null;callback();flush();login=false;page='System Settings';callback();flush();assert.equal(main.scrollTop,0);
  callback();window.__aivaHeaderScroll.dispose();assert.equal(queue.size,0);assert.equal(disconnected,1);
});
