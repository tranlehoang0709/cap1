/** Đọc theme thực tế từ DOM và mở dropdown mà không thay đổi lựa chọn. */
import { expect } from '@playwright/test';
import { assertControls } from './bo_cuc.js';

export async function setTheme(page, dark) {
  const scope = page.locator('.st-key-aiva_theme_switch_scope');
  const input = scope.locator('input');
  if (await input.isChecked() !== dark) await scope.locator('label:has(input[role="switch"])').click();
  await expect(input).toBeChecked({ checked: dark });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(dark ? 'dark' : 'light');
  await expect(page.locator('#aiva-application-theme')).toHaveCount(1);
}
export async function assertTheme(page, dark) {
  await expect.poll(() => page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const normalize = color => {
      const hex = color.trim();
      if (/^#[a-f0-9]{6}$/i.test(hex)) return `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
      return hex;
    };
    const app = document.querySelector('.stApp');
    const sidebar = document.querySelector('[data-testid="stSidebar"]');
    return {
      scheme: root.colorScheme,
      appMatches: getComputedStyle(app).backgroundColor === normalize(root.getPropertyValue('--aiva-bg')),
      sidebarMatches: !sidebar || getComputedStyle(sidebar).backgroundColor === normalize(root.getPropertyValue('--aiva-surface')),
    };
  })).toEqual({ scheme: dark ? 'dark' : 'light', appMatches: true, sidebarMatches: true });
}
export async function assertDropdown(page) {
  const combo = page.getByRole('combobox').filter({ visible: true }).first();
  await expect(combo).toBeEnabled();
  const original = await combo.inputValue();
  await combo.click();
  await combo.press('ArrowDown');
  const options = page.getByRole('option');
  await expect(options.first()).toBeVisible();
  const values = await options.evaluateAll(nodes => nodes.map(node => {
    const css = getComputedStyle(node);
    return { color: css.color, background: css.backgroundColor };
  }));
  expect(values.length).toBeGreaterThan(0);
  for (const value of values) expect(value.color).not.toBe(value.background);
  await assertControls(page);
  await combo.press('Escape');
  await expect(options.first()).not.toBeVisible();
  await expect(combo).toHaveValue(original);
}
