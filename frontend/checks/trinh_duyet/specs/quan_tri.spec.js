import { test, expect } from '../fixtures/phien_demo.js';
import { setTheme } from '../helpers/chu_de.js';
import { runDir } from '../helpers/moi_truong.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { reruns, waitForRerun } from '../helpers/vong_doi_iframe.js';
import { routes, navigate } from '../helpers/dieu_huong.js';
import { assertHeader, assertControls, assertOverflow } from '../helpers/bo_cuc.js';

test.use({ demoRole: 'admin' });

test('Nhãn trục Dashboard Light đạt AA, Dark và dữ liệu giữ nguyên @fix_b', async ({ page }) => {
  const evidence = [];
  for (const dark of [true, false, true]) {
    const previous = reruns(page).length;
    const changed = await page.locator('.st-key-aiva_theme_switch_scope input').isChecked() !== dark;
    await setTheme(page, dark);
    if (changed) await waitForRerun(page, previous);
    const plot = page.locator('.js-plotly-plot').first();
    await expect(plot.locator('.xtick text').first()).toBeVisible();
    await expect.poll(() => plot.evaluate(node => node._fullLayout?.font?.color).catch(() => null)).toBe(dark ? '#a4aec3' : '#5d687d');
    await expect.poll(() => plot.evaluate(node => {
      const host = node.closest('[data-testid="stPlotlyChart"]');
      return !!host && !!node._fullLayout && Math.abs(node._fullLayout.width - host.getBoundingClientRect().width) <= 1;
    }).catch(() => false), { message: 'Đợi Plotly resize xong theo card, không đo figure mặc định 700px' }).toBe(true);
    const read = () => plot.evaluate(node => {
      const background = element => { for (let p = element; p; p = p.parentElement) { const c = getComputedStyle(p).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c; } return 'rgb(255, 255, 255)'; };
      const luminance = color => { const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]; };
      const ticks = [...node.querySelectorAll('.xtick text,.ytick text')].map(text => {
        const css = getComputedStyle(text), bg = background(node), a = luminance(css.fill), b = luminance(bg), rect = text.getBoundingClientRect();
        // Tick có thể nằm ngoài plot div nhưng vẫn nhìn thấy khi overflow:visible.
        // Chỉ ancestor thực sự clip mới quyết định nhãn có bị che hay không.
        const clipping = [];
        for (let parent = text.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
          if ((['hidden','clip','auto','scroll'].includes(style.overflowX) && (rect.left < box.left - .5 || rect.right > box.right + .5)) || (['hidden','clip','auto','scroll'].includes(style.overflowY) && (rect.top < box.top - .5 || rect.bottom > box.bottom + .5))) clipping.push(parent.tagName);
        }
        return { text: text.textContent, fill: css.fill, opacity: css.opacity, background: bg, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), fullyInside: clipping.length === 0, clipping, width: rect.width };
      });
      let source;
      for (let p = node; p && !source; p = p.parentElement) {
        const key = Object.keys(p).find(k => k.startsWith('__reactFiber'));
        for (let f = key && p[key], depth = 0; f && depth < 25; f = f.return, depth++) {
          const element = f.memoizedProps?.element;
          if (element?.spec) { const spec = JSON.parse(element.spec); source = { theme: element.theme, xTick: spec.layout?.xaxis?.tickfont?.color, yTick: spec.layout?.yaxis?.tickfont?.color }; break; }
        }
      }
      return { ticks, source, xTick: node._fullLayout.xaxis.tickfont.color, yTick: node._fullLayout.yaxis.tickfont.color, font: node._fullLayout.font.color, data: node.data.map(({ x, y }) => ({ x, y })) };
    });
    evidence.push({ dark, ...await read() });
    await fs.mkdir(path.join(runDir, 'analysis'), { recursive: true });
    await fs.writeFile(path.join(runDir, 'analysis', 'fix-b-contrast.json'), JSON.stringify(evidence, null, 2));
    if (!dark) await expect.poll(async () => Math.min(...(await read()).ticks.map(t => t.contrast))).toBeGreaterThanOrEqual(4.5);
    expect(evidence.at(-1).ticks.length).toBeGreaterThan(0);
    expect(evidence.at(-1).ticks.some(t => t.text === 'Oct 10'), 'Giữ nhãn cuối Oct 10, không che hoặc xóa để hết clipping').toBe(true);
    await expect.poll(async () => (await read()).ticks.every(t => t.fullyInside), { message: 'Mọi nhãn trục phải hiển thị sau Plotly resize, không chỉ có màu đúng' }).toBe(true);
    evidence[evidence.length - 1] = { dark, ...await read() };
    await fs.writeFile(path.join(runDir, 'analysis', 'fix-b-contrast.json'), JSON.stringify(evidence, null, 2));
  }
  expect(evidence[2]).toEqual(evidence[0]);
  expect(evidence[1].data).toEqual(evidence[0].data);
});
test('Đọc đủ tám trang Quản trị @smoke @ui', async ({ page }) => {
  for (const name of routes.admin) {
    await navigate(page, name);
    await assertHeader(page);
    await assertControls(page);
    await assertOverflow(page);
  }
});
