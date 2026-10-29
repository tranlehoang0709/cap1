/** Hồi quy Phase 3B qua UI demo; không gọi AI thật hoặc thay đổi robot runtime. */
import { test, expect } from '../fixtures/phien_demo.js';
import { navigate, ensureSidebar, dismissOverlaySidebar, openChatSettings } from '../helpers/dieu_huong.js';
import { setTheme } from '../helpers/chu_de.js';
import { reruns, waitForRerun } from '../helpers/vong_doi_iframe.js';
import { assertHeader, assertOverflow, stableLayout, capture } from '../helpers/bo_cuc.js';
import { runDir } from '../helpers/moi_truong.js';
import fs from 'node:fs/promises';
import path from 'node:path';

// Đo phần tử chứa chữ thật, gồm alpha và opacity tổ tiên; không đo wrapper bubble.
function contrastMeasurements() {
  const rgba = s => { const a = s.match(/[\d.]+/g).map(Number); return [...a.slice(0, 3), a[3] ?? 1]; };
  const blend = (a, b) => a.slice(0, 3).map((v, i) => v * a[3] + b[i] * (1 - a[3]));
  const lum = c => c.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
  const selectors = '[data-testid="stMain"] [data-testid="stCaptionContainer"] p,.st-key-chat_main [data-testid="stChatMessageContent"] p,[data-testid="stExpandSidebarButton"] [data-testid="stIconMaterial"]';
  return [...document.querySelectorAll(selectors)].filter(n => n.checkVisibility({ visibilityProperty: true }) && n.getBoundingClientRect().width).map(n => {
    const ancestors = []; for (let p = n; p; p = p.parentElement) ancestors.unshift(p);
    let bg = [255, 255, 255], opacity = 1;
    for (const p of ancestors) { const c = getComputedStyle(p); bg = blend(rgba(c.backgroundColor), bg); opacity *= Number(c.opacity); }
    const color = rgba(getComputedStyle(n).color); color[3] *= opacity;
    const values = [lum(blend(color, bg)), lum(bg)].sort((a, b) => a - b);
    return { text: n.textContent, icon: n.dataset.testid === 'stIconMaterial', ratio: (values[1] + .05) / (values[0] + .05) };
  });
}

for (const width of [1920, 1440, 1024, 769, 768, 767, 390, 1087, 1088, 1089]) test.describe(`ai-chat-${width}`, () => {
  test.use({ demoRole: 'user', viewport: { width, height: 1080 } });
  test('Tương phản, responsive, tìm kiếm và mock chat @chat', async ({ page }) => {
    await navigate(page, 'AI Chat');
    const fresh = page.getByRole('button', { name: '＋ Đoạn chat mới', exact: true });
    const search = page.getByRole('textbox', { name: 'Tìm kiếm hội thoại…', exact: true });
    const composer = page.getByTestId('stChatInputTextArea');
    const provider = page.getByRole('combobox', { name: 'Provider cho phiên mới', exact: true });
    const measurements = [];
    const commitSearch = async text => { const count = reruns(page).length; await search.fill(text); await search.press('Enter'); await waitForRerun(page, count); };
    const top = async () => { await page.getByTestId('stMain').evaluate(n => n.scrollTo({ top: 0, behavior: 'instant' })); await stableLayout(page, '.st-key-chat_workspace'); };
    for (const dark of [false, true]) {
      await ensureSidebar(page);
      const count = reruns(page).length, changed = await page.locator('.st-key-aiva_theme_switch_scope input').isChecked() !== dark;
      await setTheme(page, dark); if (changed) await waitForRerun(page, count);
      await dismissOverlaySidebar(page); await fresh.click(); await openChatSettings(page); await expect(provider).toBeEnabled(); await top();
      await assertHeader(page); await assertOverflow(page);
      const layout = await page.locator('.st-key-chat_history').evaluate(n => {
        const button = n.querySelector('button'), p = button.querySelector('p'), css = getComputedStyle(p), input = n.querySelector('input');
        const ctx = document.createElement('canvas').getContext('2d'); ctx.font = getComputedStyle(input).font;
        return { workspace: document.querySelector('.st-key-chat_workspace').getBoundingClientRect().width,
          history: n.getBoundingClientRect().toJSON(), main: document.querySelector('.st-key-chat_main').getBoundingClientRect().toJSON(),
          lines: p.getBoundingClientRect().height / parseFloat(css.lineHeight), input: input.clientWidth, placeholder: ctx.measureText(input.placeholder).width };
      });
      expect(layout.lines).toBeLessThanOrEqual(1.1);
      expect(layout.input).toBeGreaterThanOrEqual(layout.placeholder);
      if (width >= 768 && layout.workspace > 700) expect(layout.main.left).toBeGreaterThanOrEqual(layout.history.right);
      else expect(layout.main.top).toBeGreaterThanOrEqual(layout.history.bottom);
      await fresh.focus(); await page.keyboard.press('Tab'); await expect(search).toBeFocused();
      expect(await search.evaluate(n => n.matches(':focus-visible'))).toBe(true);
      const expand = page.getByTestId('stExpandSidebarButton');
      if (await expand.isVisible()) {
        await expand.focus(); await expect(expand).toBeFocused();
        expect(await expand.evaluate(n => getComputedStyle(n).outlineStyle)).not.toBe('none');
        await expand.press('Enter'); await expect(page.getByTestId('stSidebar')).toBeInViewport();
        // Nút thu gọn native chỉ được dựng khi con trỏ ở Sidebar sau mở bằng phím.
        await page.getByTestId('stSidebar').hover(); await dismissOverlaySidebar(page);
      }
      await expect(page.getByRole('checkbox', { name: /Internet Search/ })).toHaveCount(0);
      await capture(page, `chat-${width}-${dark ? 'dark' : 'light'}-empty`);
      await commitSearch('CHAT_NO_MATCH_3B');
      await expect(page.getByText('Không tìm thấy hội thoại phù hợp.', { exact: true })).toBeVisible();
      await expect(page.locator('.st-key-chat_history button')).toHaveCount(1);
      await capture(page, `chat-${width}-${dark ? 'dark' : 'light'}-search-empty`);
      await commitSearch('cHàO'); await expect(page.getByRole('button', { name: 'Chào Xiaozhi', exact: true })).toBeVisible();
      await expect(page.getByText('Không tìm thấy hội thoại phù hợp.', { exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Chào Xiaozhi', exact: true }).click();
      await expect(composer).toBeDisabled(); await expect(provider).toBeDisabled();
      await fresh.click(); await commitSearch(''); await expect(provider).toBeEnabled();
      await provider.click(); await provider.press('ArrowDown');
      await page.getByRole('option', { name: 'Gemini', exact: true }).click(); await expect(provider).toHaveValue('Gemini');
      await provider.click(); await provider.press('ArrowDown'); await page.getByRole('option', { name: 'Local AI', exact: true }).click();
      const text = 'KIEM TRA PHASE 3B ' + 'chuoi_khong_ngat_'.repeat(18);
      await composer.fill(text); await page.getByTestId('stChatInputSubmitButton').click();
      await expect(page.getByTestId('stChatMessage')).toHaveCount(2);
      await expect(page.getByTestId('stChatMessage').first()).toContainText(text);
      await expect(page.getByTestId('stChatMessageContent').last()).toHaveText('PHẢN HỒI AI MẪU (Local AI): Đã nhận tin nhắn của bạn. Đây là câu trả lời cố định phục vụ kiểm tra giao diện.');
      await expect(provider).toBeDisabled();
      for (let i = 0; i < 5; i++) { await composer.fill(`Tin nhắn cuộn ${i}`); await composer.press('Enter'); await expect(page.getByTestId('stChatMessage')).toHaveCount((i + 2) * 2); }
      await expect.poll(() => page.locator('.st-key-chat_messages').evaluate(n => {
        const scroller = [n, ...n.querySelectorAll('*')].find(e => e.clientHeight && e.scrollHeight > e.clientHeight && ['auto', 'scroll'].includes(getComputedStyle(e).overflowY));
        return !!scroller && Math.abs(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop) <= 2;
      })).toBe(true);
      const contrasts = await page.evaluate(contrastMeasurements);
      expect(contrasts.filter(c => !c.icon).length).toBeGreaterThan(4);
      for (const c of contrasts) expect(c.ratio, c.text).toBeGreaterThanOrEqual(c.icon ? 3 : 4.5);
      for (const fits of await page.getByTestId('stChatMessageContent').locator('p').evaluateAll(nodes => nodes.map(n => n.scrollWidth <= n.clientWidth + 1))) expect(fits).toBe(true);
      await assertOverflow(page); await composer.scrollIntoViewIfNeeded();
      expect(await page.getByTestId('stChatInputSubmitButton').evaluate(n => { const r = n.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return hit === n || n.contains(hit); })).toBe(true);
      await capture(page, `chat-${width}-${dark ? 'dark' : 'light'}-messages`);
      await page.getByRole('button', { name: '⋯ Hội thoại', exact: true }).click();
      await page.getByRole('button', { name: 'Kết thúc phiên chat', exact: true }).click(); await expect(composer).toBeDisabled();
      const resume = page.getByRole('button', { name: 'Tiếp tục trò chuyện', exact: true });
      if (!await resume.isVisible()) await page.getByRole('button', { name: '⋯ Hội thoại', exact: true }).click();
      await resume.click(); await page.keyboard.press('Escape'); await expect(composer).toBeEnabled();
      await navigate(page, 'Dashboard'); await navigate(page, 'AI Chat'); await expect(page.getByTestId('stChatMessage')).toHaveCount(12);
      await top(); measurements.push({ dark, layout, contrasts });
    }
    await fs.writeFile(path.join(runDir, 'report', `chat-${width}.json`), JSON.stringify(measurements, null, 2));
  });
});
