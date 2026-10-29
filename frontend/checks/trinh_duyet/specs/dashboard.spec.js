/** Hồi quy các lỗi Dashboard đã xác nhận; không can thiệp state hoặc robot runtime. */
import { test, expect } from '../fixtures/phien_demo.js';
import { ensureSidebar, dismissOverlaySidebar, routes } from '../helpers/dieu_huong.js';
import { setTheme } from '../helpers/chu_de.js';
import { robotFrame, pauseRobot } from '../helpers/robot.js';
import { preserveIdentity, compareIdentity, reruns, waitForRerun } from '../helpers/vong_doi_iframe.js';
import { assertHeader, assertOverflow, capture } from '../helpers/bo_cuc.js';

// Tính cả alpha và opacity của caption, không chỉ so hai màu token.
function captionContrasts() {
  const rgba = value => {
    const c = value.match(/[\d.]+/g).map(Number);
    return [c[0], c[1], c[2], c[3] ?? 1];
  };
  const blend = (a, b) => a.slice(0, 3).map((v, i) => v * a[3] + b[i] * (1 - a[3]));
  const luminance = c => c.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  return [...document.querySelectorAll('[data-testid="stCaptionContainer"]')]
    .filter(n => n.checkVisibility({ visibilityProperty: true }) && n.getBoundingClientRect().width)
    .map(node => {
      const text = node.querySelector('p') || node, ancestors = [];
      for (let n = text; n; n = n.parentElement) ancestors.unshift(n);
      let background = [255, 255, 255], opacity = 1;
      for (const n of ancestors) {
        background = blend(rgba(getComputedStyle(n).backgroundColor), background);
        opacity *= Number(getComputedStyle(n).opacity);
      }
      const color = rgba(getComputedStyle(text).color); color[3] *= opacity;
      const light = [luminance(blend(color, background)), luminance(background)].sort((a, b) => a - b);
      return { text: node.textContent, ratio: (light[1] + .05) / (light[0] + .05) };
    });
}

for (const width of [1920, 1440, 1024, 769, 768, 767, 390]) test.describe(`user-dashboard-${width}`, () => {
  test.use({ demoRole: 'user', viewport: { width, height: 1080 } });
  test('Caption, metric, toolbar và chart theo theme @dashboard', async ({ page }) => {
    const frame = await robotFrame(page);
    await pauseRobot(frame);
    const identity = await preserveIdentity(frame);
    try {
      for (const dark of [false, true]) {
        await ensureSidebar(page);
        const before = reruns(page).length;
        const changed = await page.locator('.st-key-aiva_theme_switch_scope input').isChecked() !== dark;
        await setTheme(page, dark);
        if (changed) await waitForRerun(page, before);
        await dismissOverlaySidebar(page);
        await page.getByTestId('stMain').evaluate(n => n.scrollTo({ top: 0, behavior: 'instant' }));
        await assertHeader(page);
        await assertOverflow(page);
        const expand = page.getByTestId('stExpandSidebarButton');
        if (await expand.isVisible()) {
          const iconContrast = await expand.locator('[data-testid="stIconMaterial"]').evaluate(n => {
            const c = getComputedStyle(n).color.match(/[\d.]+/g).map(Number);
            const bg = getComputedStyle(document.querySelector('[data-testid="stHeader"]')).backgroundColor.match(/[\d.]+/g).map(Number);
            const alpha = c[3] ?? 1;
            const foreground = c.slice(0, 3).map((v, i) => v * alpha + bg[i] * (1 - alpha));
            const lum = color => color.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
              .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
            const values = [lum(foreground), lum(bg)].sort((a, b) => a - b);
            return (values[1] + .05) / (values[0] + .05);
          });
          expect(iconContrast).toBeGreaterThanOrEqual(3);
          await expand.focus();
          await expect(expand).toBeFocused();
          await expand.press('Enter');
          await expect(page.getByTestId('stSidebar')).toBeInViewport();
          await dismissOverlaySidebar(page);
        }
        for (const c of await page.evaluate(captionContrasts)) expect(c.ratio, c.text).toBeGreaterThanOrEqual(4.5);
        const labels = await page.locator('.st-key-dashboard_metrics [data-testid="stMetricLabel"]').evaluateAll(nodes => nodes.map(n => {
          const r = document.createRange(); r.selectNodeContents(n);
          return { label: n.textContent, available: n.getBoundingClientRect().width, text: r.getBoundingClientRect().width };
        }));
        expect(labels).toHaveLength(4);
        for (const label of labels) expect(label.text, label.label).toBeLessThanOrEqual(label.available + 1);
        const provider = page.locator('.st-key-dashboard_metrics [data-testid="stMetricValue"]').last();
        expect(await provider.evaluate(n => n.scrollWidth <= n.clientWidth + 1)).toBe(true);
        await frame.frameElement().then(e => e.scrollIntoViewIfNeeded());
        const wave = await frame.locator('#wave').evaluate(n => {
          const r = n.getBoundingClientRect(), stage = document.querySelector('#stage').getBoundingClientRect();
          return r.left >= stage.left && r.right <= stage.right && [[r.left + 2, r.top + 2], [r.right - 2, r.bottom - 2]].every(([x, y]) => {
            const hit = document.elementFromPoint(x, y); return hit === n || n.contains(hit);
          });
        });
        expect(wave).toBe(true);
        expect(Object.values(await compareIdentity(identity, frame)).every(Boolean)).toBe(true);
        expect(await frame.evaluate(() => window.__AIVA3D__.rendererInitializations)).toBe(1);
        await expect(page.getByTestId('stMain').getByText('Thao tác nhanh', { exact: true })).toHaveCount(0);
        await ensureSidebar(page);
        for (const route of routes.user) await expect(page.getByRole('radio', { name: route, exact: true })).toHaveCount(1);
        await dismissOverlaySidebar(page);
        await capture(page, `dashboard-${width}-${dark ? 'dark' : 'light'}-fixed`);
        const summary = page.getByTestId('stExpander').locator('summary').filter({ hasText: 'Thống kê sử dụng' });
        if (!await summary.evaluate(n => n.parentElement.open)) await summary.click();
        const chart = page.getByTestId('stPlotlyChart');
        await expect.poll(() => chart.evaluate(n => n.querySelector('.js-plotly-plot')?._fullLayout.paper_bgcolor)).toBe(dark ? '#10131c' : '#fdfdfe');
        const chartContrasts = await chart.evaluate(n => {
          const lum = c => c.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
            .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
          const bg = n.querySelector('.js-plotly-plot')._fullLayout.paper_bgcolor;
          const background = [1, 3, 5].map(i => parseInt(bg.slice(i, i + 2), 16));
          return [...n.querySelectorAll('svg text')].filter(t => t.textContent && t.getBoundingClientRect().width).map(t => {
            const foreground = getComputedStyle(t).fill.match(/[\d.]+/g).slice(0, 3).map(Number);
            const values = [lum(background), lum(foreground)].sort((a, b) => a - b);
            return { text: t.textContent, ratio: (values[1] + .05) / (values[0] + .05) };
          });
        });
        expect(chartContrasts.length).toBeGreaterThan(0);
        for (const c of chartContrasts) expect(c.ratio, c.text).toBeGreaterThanOrEqual(4.5);
        const colors = await chart.evaluate(n => n.querySelector('.js-plotly-plot')._fullData.map(t => t.marker.color));
        expect(colors).toEqual(['#83c9ff', '#0068c9', '#ffabab']);
        const reset = page.getByRole('button', { name: 'Xóa bộ lọc', exact: true });
        await reset.scrollIntoViewIfNeeded();
        const label = await reset.evaluate(n => {
          const r = document.createRange(); r.selectNodeContents(n.querySelector('p'));
          return { text: r.getBoundingClientRect().width, available: n.querySelector('[data-testid="stMarkdownContainer"]').getBoundingClientRect().width };
        });
        expect(label.text).toBeLessThanOrEqual(label.available + 1);
        for (const c of await page.evaluate(captionContrasts)) expect(c.ratio, c.text).toBeGreaterThanOrEqual(4.5);
        await page.getByTestId('stMain').evaluate(n => n.scrollTo({ top: 0, behavior: 'instant' }));
      }
    } finally { await identity.dispose(); }
  });
});
