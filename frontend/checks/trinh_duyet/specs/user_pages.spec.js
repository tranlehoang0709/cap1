/** Hồi quy sáu trang User: chỉ thao tác demo an toàn, không xóa/upload dữ liệu. */
import { test, expect } from '../fixtures/phien_demo.js';
import { navigate as navigateRoute, ensureSidebar, dismissOverlaySidebar } from '../helpers/dieu_huong.js';
import { setTheme, assertTheme } from '../helpers/chu_de.js';
import { assertHeader, assertOverflow, assertControls, capture, stableLayout } from '../helpers/bo_cuc.js';
import { preserveIdentity, compareIdentity, reruns, waitForRerun } from '../helpers/vong_doi_iframe.js';
import { runDir } from '../helpers/moi_truong.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const routes = ['Thiết bị của tôi', 'Cấu hình trợ lý AI', 'API Key cá nhân', 'Lịch sử hội thoại', 'Quyền riêng tư', 'Tài khoản'];
async function navigate(page, route) {
  const count = reruns(page).length;
  await navigateRoute(page, route); await waitForRerun(page, count);
}

// Đo đúng node chữ, có tính alpha/opacity tổ tiên và nền composited.
function contrast(selector) {
  const rgba = s => { const a = s.match(/[\d.]+/g).map(Number); return [...a.slice(0, 3), a[3] ?? 1]; };
  const blend = (a, b) => a.slice(0, 3).map((v, i) => v * a[3] + b[i] * (1 - a[3]));
  const lum = c => c.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
  return [...document.querySelectorAll(selector)].filter(n => n.checkVisibility({ visibilityProperty: true }) && n.getBoundingClientRect().width).map(n => {
    const ancestors = []; for (let p = n; p; p = p.parentElement) ancestors.unshift(p);
    let bg = [255, 255, 255], opacity = 1;
    for (const p of ancestors) { const c = getComputedStyle(p); bg = blend(rgba(c.backgroundColor), bg); opacity *= Number(c.opacity); }
    const fg = rgba(getComputedStyle(n).color); fg[3] *= opacity;
    const l = [lum(bg), lum(blend(fg, bg))].sort((a, b) => a - b);
    return { text: n.textContent, ratio: (l[1] + .05) / (l[0] + .05), color: getComputedStyle(n).color, background: bg, opacity };
  });
}
async function top(page) {
  await page.getByTestId('stMain').evaluate(n => n.scrollTo({ top: 0, behavior: 'instant' }));
  await stableLayout(page, '.st-key-portal_page_header');
}
async function theme(page, dark) {
  await ensureSidebar(page);
  const count = reruns(page).length, changed = await page.locator('.st-key-aiva_theme_switch_scope input').isChecked() !== dark;
  await setTheme(page, dark); if (changed) await waitForRerun(page, count);
  await dismissOverlaySidebar(page); await top(page);
}
async function assertText(page, selector, minimum = 4.5) {
  const measurements = await page.evaluate(contrast, selector);
  expect(measurements.length).toBeGreaterThan(0);
  for (const value of measurements) expect(value.ratio, JSON.stringify(value)).toBeGreaterThanOrEqual(minimum);
  return measurements;
}
async function toolbar(page, key) {
  const area = page.locator(`.st-key-table_toolbar_${key}`), button = area.getByRole('button', { name: 'Xóa bộ lọc', exact: true });
  await button.scrollIntoViewIfNeeded();
  const size = await button.evaluate(n => {
    const range = document.createRange(); range.selectNodeContents(n.querySelector('p'));
    const text = range.getBoundingClientRect(), box = n.getBoundingClientRect();
    const ctx = document.createElement('canvas').getContext('2d'); ctx.font = getComputedStyle(n.querySelector('p')).font;
    return { box: box.toJSON(), text: text.toJSON(), required: ctx.measureText(n.textContent).width };
  });
  expect(size.box.width).toBeGreaterThanOrEqual(size.required + 16);
  expect(size.text.right).toBeLessThanOrEqual(size.box.right);
  expect(size.text.left).toBeGreaterThanOrEqual(size.box.left);
  const search = area.getByRole('textbox'), count = reruns(page).length;
  await search.fill('AIVA_PHASE4B_NO_MATCH'); await search.press('Enter'); await waitForRerun(page, count);
  await button.click();
  await expect(search).toHaveValue('');
  return size;
}

for (const width of [1920, 1440, 1024, 769, 768, 767, 390]) test.describe(`remaining-user-${width}`, () => {
  test.use({ demoRole: 'user', viewport: { width, height: 1080 } });
  test('Sáu trang, contrast và responsive @remaining_ui', async ({ page }) => {
    test.setTimeout(240000);
    const evidence = [];
    try {
      for (const route of routes) {
        await navigate(page, route);
        for (const dark of [false, true]) {
          await theme(page, dark); await assertTheme(page, dark); await assertHeader(page); await assertOverflow(page); await assertControls(page);
          const record = { route, width, dark, captions: await assertText(page, '[data-testid="stMain"] [data-testid="stCaptionContainer"] p') };
          evidence.push(record);
          if (width === 390) {
            const expand = page.getByTestId('stExpandSidebarButton');
            record.icon = await assertText(page, '[data-testid="stExpandSidebarButton"] [data-testid="stIconMaterial"]', 3);
            await page.keyboard.press('Tab'); await expand.focus(); expect(await expand.evaluate(n => n.matches(':focus-visible'))).toBe(true);
            expect(await expand.evaluate(n => getComputedStyle(n).outlineStyle)).not.toBe('none');
          }
          if (route === 'Thiết bị của tôi') {
            record.robots = [];
            const frames = [];
            for (const f of page.frames()) if (await f.locator('#stage').count().catch(() => 0)) frames.push(f);
            expect(frames).toHaveLength(3);
            for (const f of frames) {
              const element = await f.frameElement(); await element.scrollIntoViewIfNeeded();
              await expect.poll(() => f.evaluate(() => window.__AIVA3D__?.framesRendered > 0)).toBe(true);
              const controls = await f.locator('#wave,#reset,#pause').evaluateAll(ns => ns.map(n => ({ id: n.id, rect: n.getBoundingClientRect().toJSON(), width: innerWidth })));
              for (const c of controls) { expect(c.rect.left).toBeGreaterThanOrEqual(0); expect(c.rect.right).toBeLessThanOrEqual(c.width); expect(c.rect.height).toBeGreaterThanOrEqual(24); }
              const wave = f.locator('#wave');
              if (await wave.isEnabled()) {
                const waving = page.waitForEvent('console', { predicate: m => m.text().includes('[AIVA3D] Arm poses waving') });
                await wave.click(); await waving;
              }
              const pause = f.locator('#pause');
              if (await pause.isEnabled() && await pause.getAttribute('aria-pressed') !== 'true') await pause.click();
              record.robots.push(controls); await element.dispose();
            }
            await top(page);
            const summary = page.getByTestId('stExpander').filter({ hasText: 'Quản lý liên kết' }).locator('summary');
            if (await summary.getAttribute('aria-expanded') !== 'true') await summary.click();
            record.toolbar = await toolbar(page, 'my_robots');
            await summary.click();
          }
          if (route === 'Cấu hình trợ lý AI') {
            record.fieldWidth = (await page.getByRole('textbox', { name: 'Tên trợ lý', exact: true }).boundingBox()).width;
            expect(record.fieldWidth).toBeGreaterThanOrEqual(220);
            for (const button of await page.locator('[data-testid="stTabsScrollLeft"],[data-testid="stTabsScrollRight"]').all()) {
              if (!await button.isVisible()) continue;
              const style = await button.evaluate(n => ({ background: getComputedStyle(n).backgroundImage, surface: getComputedStyle(document.documentElement).getPropertyValue('--aiva-surface') }));
              expect(style.background).not.toContain('rgb(16, 19, 28)');
              record.tabStyle = style; await page.keyboard.press('Tab'); await button.focus();
              expect(await button.evaluate(n => n.matches(':focus-visible'))).toBe(true);
              expect(await button.evaluate(n => getComputedStyle(n).outlineStyle)).not.toBe('none');
              await button.click();
            }
            await page.getByRole('tab', { name: 'Giọng nói', exact: true }).click();
            await expect(page.getByRole('combobox', { name: 'Giọng TTS mẫu', exact: true })).toBeVisible();
            await page.getByRole('tab', { name: 'Thông tin', exact: true }).click();
          }
          if (route === 'Lịch sử hội thoại') {
            record.messages = await assertText(page, '[data-testid="stTabPanel"]:has(.st-key-history_selected) [data-testid="stChatMessageContent"] p');
            record.toolbar = await toolbar(page, 'history');
            await page.getByRole('tab', { name: 'Tài liệu cá nhân', exact: true }).click();
            const uploadScope = '[data-testid="stForm"]:has([class*="st-key-FormSubmitter-knowledge_upload-"]) [data-testid="stFileUploaderDropzone"] button';
            const upload = page.locator(uploadScope);
            await expect(upload).toBeEnabled();
            record.uploader = await assertText(page, uploadScope);
            await upload.hover(); record.uploadHover = await assertText(page, uploadScope);
            await page.keyboard.press('Tab'); await upload.focus(); expect(await upload.evaluate(n => n.matches(':focus-visible'))).toBe(true);
            expect(await upload.evaluate(n => getComputedStyle(n).outlineStyle)).not.toBe('none');
            record.documentsScreenshot = await capture(page, `remaining-history-documents-${width}-${dark}`);
            await page.getByRole('tab', { name: 'Bộ nhớ dài hạn', exact: true }).click(); record.memoryToolbar = await toolbar(page, 'memory');
            await page.getByRole('tab', { name: 'Lịch sử hội thoại', exact: true }).click();
          }
          await top(page); record.screenshot = await capture(page, `remaining-${routes.indexOf(route)}-${width}-${dark}`);
          await assertOverflow(page);
        }
      }
    } finally { await fs.mkdir(path.join(runDir, 'analysis'), { recursive: true }); await fs.writeFile(path.join(runDir, `analysis/remaining-${width}.json`), JSON.stringify(evidence, null, 2)); }
  });
});

for (const width of [1440, 769, 390]) test.describe(`privacy-confirmation-${width}`, () => {
  test.use({ demoRole: 'user', viewport: { width, height: 1080 } });
  test('Đổi phạm vi phải xác nhận lại, không xóa dữ liệu @remaining_privacy', async ({ page }) => {
    await navigate(page, 'Quyền riêng tư');
    const category = page.getByRole('combobox', { name: 'Dữ liệu cần xóa', exact: true });
    const checkbox = page.getByRole('checkbox', { name: 'Xác nhận xóa dữ liệu mẫu đã chọn', exact: true });
    const label = page.getByTestId('stCheckbox').filter({ has: checkbox }).locator('label');
    const evidence = [];
    const mouseCategory = async name => { const count = reruns(page).length; await category.click(); await page.getByRole('option', { name, exact: true }).click(); await waitForRerun(page, count); };
    for (const dark of [false, true]) {
      await theme(page, dark); await expect(checkbox).not.toBeChecked();
      await label.click(); await expect(checkbox).toBeChecked();
      // Theme rerun không thay danh mục phải giữ quyền xác nhận hiện tại.
      await theme(page, !dark); await expect(checkbox).toBeChecked();
      await theme(page, dark); await expect(checkbox).toBeChecked();
      await category.click(); await page.getByRole('option', { name: 'Lịch sử hội thoại', exact: true }).click();
      await expect(checkbox).toBeChecked();
      await mouseCategory('Toàn bộ dữ liệu AI cá nhân'); await expect(checkbox).not.toBeChecked();
      await label.click(); await expect(checkbox).toBeChecked();
      await mouseCategory('Lịch sử hội thoại'); await expect(checkbox).not.toBeChecked();
      await page.keyboard.press('Tab'); await checkbox.focus(); await checkbox.press('Space'); await expect(checkbox).toBeChecked();
      let count = reruns(page).length;
      await category.focus(); await category.press('ArrowDown'); await category.press('End'); await category.press('Enter');
      await waitForRerun(page, count); await expect(checkbox).not.toBeChecked();
      await expect(category).toHaveValue('Toàn bộ dữ liệu AI cá nhân');
      await page.keyboard.press('Tab'); await checkbox.focus(); await checkbox.press('Space'); await expect(checkbox).toBeChecked();
      count = reruns(page).length;
      await category.focus(); await category.press('ArrowDown'); await category.press('Home'); await category.press('Enter');
      await waitForRerun(page, count); await expect(checkbox).not.toBeChecked();
      await expect(category).toHaveValue('Lịch sử hội thoại');
      evidence.push({ dark, initial: false, mouseABA: true, keyboardABA: true, sameCategoryRetained: true, themeRerunRetained: true, deletionClicked: false, screenshot: await capture(page, `privacy-transition-${width}-${dark}`) });
    }
    await fs.mkdir(path.join(runDir, 'analysis'), { recursive: true });
    await fs.writeFile(path.join(runDir, `analysis/privacy-${width}.json`), JSON.stringify(evidence, null, 2));
  });
});

for (const width of [1440, 769]) test.describe(`devices-lifecycle-${width}`, () => {
  test.use({ demoRole: 'user', viewport: { width, height: 1080 } });
  test('Robot Thiết bị giữ iframe và renderer khi đổi theme @remaining_lifecycle', async ({ page }) => {
    await navigate(page, 'Thiết bị của tôi');
    let frame;
    await expect(page.locator('[data-testid="stMain"] iframe')).toHaveCount(3);
    // Lấy Frame theo phần tử iframe thật, không dựa vào URL srcdoc không duy nhất.
    const handle = await page.locator('[data-testid="stMain"] iframe').first().elementHandle();
    frame = await handle.contentFrame(); await handle.scrollIntoViewIfNeeded();
    await expect.poll(() => frame.evaluate(() => window.__AIVA3D__?.framesRendered > 0)).toBe(true);
    const identity = await preserveIdentity(frame), origin = await frame.evaluate(() => performance.timeOrigin), measurements = [];
    try {
      for (const dark of [false, true, false]) {
        await theme(page, dark);
        await expect.poll(() => frame.evaluate(() => window.__AIVA3D__.theme)).toBe(dark ? 'dark' : 'light');
        const state = await compareIdentity(identity, frame);
        expect(Object.values(state).every(Boolean)).toBe(true);
        const diagnostics = await frame.evaluate(() => ({ origin: performance.timeOrigin, init: window.__AIVA3D__.rendererInitializations, frames: window.__AIVA3D__.framesRendered }));
        expect(diagnostics.origin).toBe(origin); expect(diagnostics.init).toBe(1);
        measurements.push({ dark, state, diagnostics });
      }
    } finally { await identity.dispose(); await handle.dispose(); }
    await fs.mkdir(path.join(runDir, 'analysis'), { recursive: true });
    await fs.writeFile(path.join(runDir, `analysis/devices-lifecycle-${width}.json`), JSON.stringify(measurements, null, 2));
  });
});

for (const width of [958, 959, 960]) test.describe(`remaining-boundary-${width}`, () => {
  test.use({ demoRole: 'user', viewport: { width, height: 1080 } });
  test('Biên responsive giữ đầy đủ nội dung và các tab đã gộp @remaining_ui', async ({ page }) => {
    for (const route of ['Thiết bị của tôi', 'Cấu hình trợ lý AI']) {
      await navigate(page, route);
      for (const dark of [false, true]) {
        await theme(page, dark); await assertHeader(page); await assertOverflow(page);
        if (route === 'Thiết bị của tôi') {
          const row = page.locator('[data-testid="stMain"] [data-testid="stHorizontalBlock"]').filter({ has: page.locator('iframe') }).first();
          const boxes = await row.locator(':scope > [data-testid="stColumn"]').evaluateAll(ns => ns.map(n => n.getBoundingClientRect().toJSON()));
          if (width < 960) expect(boxes[1].top).toBeGreaterThanOrEqual(boxes[0].bottom);
          else expect(Math.abs(boxes[1].top - boxes[0].top)).toBeLessThanOrEqual(1);
        } else {
          // Cá nhân hóa và Provider đã thành hai tab, không còn hai cột song song.
          const form = page.getByTestId('stForm').filter({ has: page.getByRole('button', { name: 'Lưu cá nhân hóa mẫu', exact: true }) });
          await expect(form).toBeVisible();
          const size = await form.evaluate(n => {
            const panel = n.closest('[class*="st-key-aiva_panel_"]'), css = getComputedStyle(panel);
            return { form: n.getBoundingClientRect().width, available: panel.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight) };
          });
          expect(Math.abs(size.form - size.available)).toBeLessThanOrEqual(2);
          await page.getByRole('tab', { name: 'Nâng cao', exact: true }).click();
          await expect(page.getByRole('combobox', { name: 'AI Provider', exact: true })).toBeVisible();
          await expect(page.getByRole('textbox', { name: 'Chuỗi API Key thử nghiệm', exact: true })).toBeVisible();
          await assertControls(page); await assertOverflow(page);
          await page.getByRole('tab', { name: 'Cá nhân hóa', exact: true }).click();
          await expect(form).toBeVisible();
        }
      }
    }
  });
});
