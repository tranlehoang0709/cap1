// Focused component render and interaction checks; never authenticated E2E.
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
const directory = path.resolve('test-results/user-dashboard-ui');
await mkdir(directory, { recursive: true });
const css = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') });
const rest = await Promise.all(['src/app/aiva-backgrounds.css', 'src/app/aiva-workspace.css', 'src/app/aiva-motion.css', 'src/components/user/user-dashboard.css'].map(name => readFile(name, 'utf8')));
await writeFile(`${directory}/style.css`, [css.css, ...rest].join('\n'));
await build({ entryPoints: ['tests/user-ui-preview.tsx'], bundle: true, outfile: `${directory}/app.js`, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, banner: { js: 'var process={env:{NODE_ENV:"development"},browser:true,nextTick:(fn,...args)=>queueMicrotask(()=>fn(...args))};' }, plugins: [{ name: 'css-compiled', setup(builder) { builder.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' })); } }] });
const server = http.createServer(async (req, res) => {
  const file = req.url?.split('?')[0];
  if (file === '/app.js' || file === '/style.css') {
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/css');
    res.end(await readFile(path.join(directory, file))); return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><html lang="vi"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
const result = { kind: 'Isolated User Dashboard component, no business records', checks: [], screenshots: [], errors: [], authenticatedE2E: 'BLOCKED: no real User session and Backend supplied' };
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', error => result.errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('[data-hydrated=true]').waitFor();
  assert.deepEqual(await page.locator('nav a').evaluateAll(nodes => nodes.map(node => node.getAttribute('href'))), ['dashboard', 'chat', 'robots', 'assistant', 'conversations', 'privacy', 'account'].map(name => `/user/${name}`));
  assert.deepEqual(await page.locator('.ud-metric strong').allTextContents(), ['—', '—']);
  for (const [width, height] of [[1440, 1000], [1024, 900], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const mode of ['dark', 'light']) {
      const toggle = page.locator('[data-theme-toggle]');
      if (await toggle.getAttribute('data-theme-mode') !== mode) await toggle.click();
      await page.waitForTimeout(280);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow ${width} ${mode}`);
      const file = `${width}-${mode}.png`;
      await page.screenshot({ path: `${directory}/${file}`, fullPage: true }); result.screenshots.push(file);
    }
  }
  result.checks.push('PASS: 8 screenshots, dark/light, desktop/tablet/mobile, no page overflow, 7 unchanged navigation targets, no fabricated totals');
  await page.reload(); await page.locator('[data-hydrated=true]').waitFor();
  assert.equal(await page.locator('[data-theme-toggle]').getAttribute('data-theme-mode'), 'light');
  await page.getByRole('link', { name: 'Mở AI Chat', exact: true }).click();
  await page.getByRole('link', { name: 'Tùy chỉnh trải nghiệm', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.userUI.navigation), ['/user/chat', '/user/assistant']);
  await page.getByRole('button', { name: 'Tải lại robot', exact: true }).click();
  assert.equal(await page.evaluate(() => window.userUI.reloads), 1);
  await page.locator('input[name=from]').fill('2026-11-01'); await page.locator('input[name=to]').fill('2026-11-12');
  await page.getByRole('button', { name: 'Áp dụng', exact: true }).click();
  assert.equal(await page.evaluate(() => new Date(window.userUI.range.from).getFullYear()), 2026);
  assert.equal(await page.evaluate(() => new Date(window.userUI.range.to).getDate()), 12);
  result.checks.push('PASS: theme persistence, chat/assistant navigation callbacks, robot refresh, usage date filter callback');
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const mode of ['loading', 'error', 'empty']) {
    await page.evaluate(value => window.userUI.state(value), mode);
    if (mode === 'loading') await page.locator('.user-dashboard .skeleton-wrap').first().waitFor();
    if (mode === 'error') {
      await page.locator('.user-dashboard .resource-error').first().waitFor();
      await page.locator('.user-dashboard .resource-error button').first().click();
      assert.equal(await page.evaluate(() => window.userUI.reloads), 2);
    }
    if (mode === 'empty') await page.locator('.user-dashboard .empty-state').first().waitFor();
    await page.screenshot({ path: `${directory}/state-${mode}.png`, fullPage: true });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.user-dashboard').evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length), 0);
  assert.equal(await page.locator('canvas,iframe').count(), 0);
  await page.getByRole('button', { name: 'Khám phá NOVA 3D', exact: true }).click();
  await page.locator('.nova-companion-stage canvas').waitFor();
  assert.equal(await page.locator('canvas').count(), 1);
  await page.getByRole('button', { name: 'Đóng mô hình 3D / tiết kiệm tài nguyên', exact: true }).click();
  assert.equal(await page.locator('canvas,iframe').count(), 0);
  result.checks.push('PASS: loading/error/empty, retry callback, reduced motion, zero initial canvas/iframe; existing NOVA 3D viewer open/close controls');
  assert.deepEqual(result.errors, []);
} catch (error) { result.errors.push(error.stack); process.exitCode = 1; }
finally {
  await writeFile(`${directory}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
