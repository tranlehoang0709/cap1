/** Đo layout thật, không dùng isVisible làm bằng chứng duy nhất. */
import { expect } from '@playwright/test';
import path from 'node:path';
import { runDir } from './moi_truong.js';

export const credentialMask = page => [page.locator('input[type="password"], input[autocomplete="username"], input[autocomplete="email"], .sidebar-account small')];
export async function stableLayout(page, selector) {
  await page.evaluate(() => document.fonts.ready);
  let previous;
  await expect.poll(async () => {
    const rect = await page.locator(selector).boundingBox();
    const value = JSON.stringify(rect && Object.fromEntries(Object.entries(rect).map(([key, n]) => [key, Math.round(n * 10) / 10])));
    const stable = value === previous && !!rect;
    previous = value;
    return stable;
  }).toBe(true);
}
export async function assertHeader(page, guest = false) {
  const selector = guest ? '.st-key-login_header' : '.st-key-portal_page_header';
  await expect(page.locator(selector)).toBeVisible();
  await stableLayout(page, selector);
  const result = await page.locator(selector).evaluate(header => {
    const rect = header.getBoundingClientRect();
    const toolbar = document.querySelector('[data-testid="stHeader"]')?.getBoundingClientRect();
    const clips = [];
    for (let p = header.parentElement; p; p = p.parentElement) {
      const css = getComputedStyle(p), bounds = p.getBoundingClientRect();
      if (['hidden', 'clip'].includes(css.overflowY) && (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1)) clips.push(p.dataset.testid || p.tagName);
    }
    return { top: rect.top, bottom: rect.bottom, toolbarBottom: toolbar?.bottom || 0, clips };
  });
  expect(result.clips, JSON.stringify(result)).toEqual([]);
  expect(result.top, JSON.stringify(result)).toBeGreaterThanOrEqual(result.toolbarBottom - 1);
  await expect(page.locator(`${selector} .brand b`)).toContainText('AIVA-IoT');
}
export async function assertOverflow(page) {
  const read = () => page.evaluate(() => {
    const nodes = [document.documentElement, document.querySelector('[data-testid="stMain"]')].filter(Boolean);
    return nodes.filter(e => e.scrollWidth > e.clientWidth + 2).map(e => ({ tag: e.tagName, testid: e.dataset.testid, width: e.clientWidth, scrollWidth: e.scrollWidth }));
  });
  await expect.poll(read).toEqual([]);
}
export async function assertControls(page) {
  await expect(page.getByTestId('stException')).toHaveCount(0);
  const read = () => page.evaluate(() => {
    const luminance = color => {
      const c = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      if (!c) return null;
      return c.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
    };
    const result = [];
    for (const node of document.querySelectorAll('input[role="combobox"],[data-testid="stTextInputField"],[data-testid="stNumberInputField"],textarea,.stButton button,.stFormSubmitButton button,[role="option"]')) {
      if (!node.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true, opacityProperty: true }) || !node.getBoundingClientRect().width) continue;
      let bg;
      for (let p = node; p; p = p.parentElement) {
        const value = getComputedStyle(p).backgroundColor;
        if (value.startsWith('rgb(')) { bg = value; break; }
      }
      if (!bg) continue;
      const fg = getComputedStyle(node.querySelector('p') || node).color;
      const values = [luminance(fg), luminance(bg)].sort((a, b) => a - b);
      const ratio = (values[1] + .05) / (values[0] + .05);
      if (ratio < 4.5) result.push({ tag: node.tagName, testid: node.dataset.testid, disabled: node.disabled, fg, bg, ratio });
      if (node.matches('input,textarea')) {
        const token = getComputedStyle(document.documentElement).getPropertyValue(node.disabled ? '--aiva-raised' : '--aiva-surface').trim();
        const expected = /^#[a-f0-9]{6}$/i.test(token) ? `rgb(${[1, 3, 5].map(i => parseInt(token.slice(i, i + 2), 16)).join(', ')})` : token;
        if (bg !== expected) result.push({ kind: 'field-theme', testid: node.dataset.testid, bg, expected });
      }
    }
    return result;
  });
  await expect.poll(read).toEqual([]);
}
export async function capture(page, name) {
  const file = path.join(runDir, 'screenshots', `${name}.png`);
  await page.screenshot({ path: file, fullPage: false, mask: credentialMask(page), animations: 'disabled' });
  return file;
}
