/** Hồi quy trình bày Admin, không lưu cấu hình, xóa, gán hay cung cấp OTA. */
import { test, expect } from '../fixtures/phien_demo.js';
import { routes, navigate, ensureSidebar, dismissOverlaySidebar } from '../helpers/dieu_huong.js';
import { setTheme, assertTheme, assertDropdown } from '../helpers/chu_de.js';
import { assertHeader, assertOverflow, assertControls, capture } from '../helpers/bo_cuc.js';
import { reruns, waitForRerun } from '../helpers/vong_doi_iframe.js';
import { runDir } from '../helpers/moi_truong.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const tabs = { 'Quản lý người dùng': ['Phân quyền'], 'Quản lý thiết bị': ['Yêu cầu ghép nối', 'Gán / hủy liên kết', 'Giám sát kết nối'], 'AI Management': ['Kiểm tra kết nối'], 'API Key & Quota': ['Cấu hình Quota & Rate Limit'], 'Logs & Monitoring': ['Giám sát tài nguyên'], 'System Settings': ['Bảo mật', 'Thông báo'] };
async function theme(page, dark) {
  await ensureSidebar(page);
  const count = reruns(page).length, changed = await page.locator('.st-key-aiva_theme_switch_scope input').isChecked() !== dark;
  await setTheme(page, dark); if (changed) await waitForRerun(page, count);
  await dismissOverlaySidebar(page);
  await page.getByTestId('stMain').evaluate(n => n.scrollTo({ top: 0, behavior: 'instant' }));
}
function presentation() {
  const rgb = s => s.startsWith('#') ? [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16)).concat(1) : (() => { const a = s.match(/[\d.]+/g).map(Number); return [...a.slice(0, 3), a[3] ?? 1]; })();
  const blend = (a, b) => a.slice(0, 3).map((v, i) => v * a[3] + b[i] * (1 - a[3]));
  const lum = a => a.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
  const ratio = (a, b) => { const x = [lum(a), lum(b)].sort((a, b) => a - b); return (x[1] + .05) / (x[0] + .05); };
  const visible = n => n.checkVisibility({ visibilityProperty: true }) && n.getBoundingClientRect().width;
  const contrast = n => {
    const chain = []; for (let p = n; p; p = p.parentElement) chain.unshift(p);
    let bg = [255, 255, 255], opacity = 1;
    for (const p of chain) { const c = getComputedStyle(p); bg = blend(rgb(c.backgroundColor), bg); opacity *= Number(c.opacity); }
    const css = getComputedStyle(n), fg = rgb(n instanceof SVGElement ? css.fill : css.color); fg[3] *= opacity;
    return { text: n.textContent, icon: n.dataset.testid === 'stIconMaterial', ratio: ratio(blend(fg, bg), bg) };
  };
  return {
    text: [...document.querySelectorAll('[data-testid="stMain"] [data-testid="stCaptionContainer"] p,[data-testid="stExpandSidebarButton"] [data-testid="stIconMaterial"],[data-testid="stFileUploaderDropzone"] button,.js-plotly-plot .xtick text,.js-plotly-plot .ytick text,.js-plotly-plot .legendtext,.js-plotly-plot .legendtitletext,.js-plotly-plot .gtitle')].filter(visible).map(contrast),
    metrics: [...document.querySelectorAll('[data-testid="stMetricLabel"],[data-testid="stMetricValue"]')].filter(visible).map(n => {
      const leaf = n.querySelector('p,div') || n, css = getComputedStyle(leaf), ctx = document.createElement('canvas').getContext('2d');
      ctx.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
      return { text: n.textContent, width: n.getBoundingClientRect().width, required: ctx.measureText(n.textContent).width };
    }),
    reset: [...document.querySelectorAll('[class*="st-key-reset_"] button')].filter(visible).map(n => {
      const p = n.querySelector('p'), css = getComputedStyle(p), ctx = document.createElement('canvas').getContext('2d'); ctx.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
      return { width: n.getBoundingClientRect().width, required: ctx.measureText(p.textContent).width + 16 };
    }),
    tabChrome: [...document.querySelectorAll('[data-testid="stTabsScrollLeft"],[data-testid="stTabsScrollRight"]')].filter(visible).map(n => ({ gradient: getComputedStyle(n).backgroundImage, background: getComputedStyle(document.querySelector('.stApp')).backgroundColor })),
    charts: [...document.querySelectorAll('.js-plotly-plot')].filter(visible).map(n => ({ paper: n._fullLayout.paper_bgcolor, plot: n._fullLayout.plot_bgcolor, data: n.data.map(t => ({ name: t.name, x: t.x, y: t.y })), lines: n._fullData.map(t => ({ name: t.name, color: t.line.color, contrast: ratio(rgb(t.line.color), rgb(getComputedStyle(document.querySelector('.stApp')).backgroundColor)) })) })),
  };
}
async function check(page) {
  await assertOverflow(page); await assertControls(page);
  let evidence;
  // script_finished đến trước khi React/Plotly hoàn tất áp theme/resize.
  // Chờ đúng tiêu chí cuối, không giảm contrast hoặc bỏ kiểm tra clipping.
  await expect.poll(async () => {
    evidence = await page.evaluate(presentation);
    return [
      ...evidence.text.filter(t => t.ratio < (t.icon ? 3 : 4.5)),
      ...[...evidence.metrics, ...evidence.reset].filter(m => m.width + 1 < m.required),
      ...evidence.tabChrome.filter(t => !t.gradient.includes(t.background)),
    ];
  }).toEqual([]);
  expect(evidence.text.length).toBeGreaterThan(0);
  for (const t of evidence.text) expect(t.ratio, JSON.stringify(t)).toBeGreaterThanOrEqual(t.icon ? 3 : 4.5);
  for (const m of [...evidence.metrics, ...evidence.reset]) expect(m.width + 1, JSON.stringify(m)).toBeGreaterThanOrEqual(m.required);
  for (const t of evidence.tabChrome) expect(t.gradient).toContain(t.background);
  return evidence;
}
for (const width of [1440, 1024, 768, 390]) test.describe(`admin-ui-${width}`, () => {
  test.use({ demoRole: 'admin', viewport: { width, height: 1080 } });
  test('Tám trang và tab hiện có, hai theme @admin_ui', async ({ page }) => {
    test.setTimeout(240000);
    const records = [], resources = {};
    try {
      for (const route of routes.admin) {
        const changed = !await page.getByTestId('stSidebar').getByRole('radio', { name: route, exact: true }).isChecked();
        const count = reruns(page).length; await navigate(page, route); if (changed) await waitForRerun(page, count);
        for (const dark of [false, true]) {
          await theme(page, dark); await assertTheme(page, dark); await assertHeader(page);
          const item = { route, width, dark, default: await check(page), tabs: [] }; records.push(item);
          if (width === 390) {
            const expand = page.getByTestId('stExpandSidebarButton'); await page.keyboard.press('Tab'); await expand.focus();
            expect(await expand.evaluate(n => n.matches(':focus-visible') && getComputedStyle(n).outlineStyle !== 'none')).toBe(true);
          }
          const combo = page.getByTestId('stMain').getByRole('combobox').filter({ visible: true }).first();
          if (await combo.count()) await assertDropdown(page);
          const reset = page.locator('[class*="st-key-reset_"] button').filter({ visible: true }).first();
          if (await reset.count()) {
            const area = reset.locator('xpath=ancestor::*[contains(@class,"st-key-table_toolbar_")]'), search = area.getByRole('textbox');
            const count = reruns(page).length; await search.fill('AIVA_PHASE5_NO_MATCH'); await search.press('Enter'); await waitForRerun(page, count);
            await reset.click(); await expect(search).toHaveValue('');
          }
          if (!dark && (width === 768 && ['Dashboard', 'AI Management', 'OTA Firmware'].includes(route) || width === 390 && route === 'System Settings')) item.screenshot = await capture(page, `admin-after-${route.replaceAll(' ', '_')}-${width}`);
          for (const tab of tabs[route] || []) {
            await page.getByRole('tab', { name: tab, exact: true }).click();
            if (tab === 'Giám sát tài nguyên') await expect(page.locator('.js-plotly-plot .xtick text').first()).toBeVisible();
            const result = await check(page); item.tabs.push({ tab, ...result });
            if (tab === 'Giám sát tài nguyên') {
              resources[dark ? 'dark' : 'light'] = result.charts[0];
              if (!dark) { expect(result.charts[0].paper).toBe('rgba(0,0,0,0)'); expect(result.charts[0].plot).toBe('rgba(0,0,0,0)'); for (const line of result.charts[0].lines) expect(line.contrast).toBeGreaterThanOrEqual(3); }
              else expect(result.charts[0].lines.map(t => t.color)).toEqual(['#83c9ff', '#0068c9', '#ffabab']);
              if (!dark && width === 768) item.resourceScreenshot = await capture(page, 'admin-after-resources-768');
            }
          }
          if (tabs[route]?.length) await page.getByRole('tab').first().click();
        }
      }
      expect(resources.light.data).toEqual(resources.dark.data);
    } finally { await fs.mkdir(path.join(runDir, 'analysis'), { recursive: true }); await fs.writeFile(path.join(runDir, `analysis/admin-ui-${width}.json`), JSON.stringify(records, null, 2)); }
  });
});
for (const width of [959, 960, 1199, 1200]) test.describe(`admin-boundary-${width}`, () => {
  test.use({ demoRole: 'admin', viewport: { width, height: 1080 } });
  test('Biên hàng card và resource metric @admin_boundary', async ({ page }) => {
    for (const dark of [false, true]) {
      await navigate(page, 'AI Management'); await theme(page, dark);
      const cards = page.locator('[data-testid="stHorizontalBlock"]').filter({ has: page.locator('[class*="st-key-toggle_"]') }).first();
      const layout = await cards.locator(':scope > [data-testid="stColumn"]').evaluateAll(ns => ns.map(n => n.getBoundingClientRect().toJSON()));
      expect(Math.abs(layout[0].top - layout[1].top)).toBeLessThanOrEqual(1);
      if (width < 960) expect(layout[2].top).toBeGreaterThanOrEqual(layout[0].bottom); else expect(Math.abs(layout[2].top - layout[0].top)).toBeLessThanOrEqual(1);
      await navigate(page, 'Logs & Monitoring'); await theme(page, dark); await page.getByRole('tab', { name: 'Giám sát tài nguyên', exact: true }).click();
      await check(page);
      const metrics = await page.getByTestId('stMetric').evaluateAll(ns => ns.map(n => n.getBoundingClientRect().toJSON()));
      if (width < 1200) expect(metrics[2].top).toBeGreaterThanOrEqual(metrics[0].bottom); else expect(Math.abs(metrics[2].top - metrics[0].top)).toBeLessThanOrEqual(1);
    }
  });
});
