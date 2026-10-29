import { test, expect } from '../fixtures/phien_demo.js';
import { robotFrame } from '../helpers/robot.js';
import { runDir } from '../helpers/moi_truong.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { reruns, waitForRerun } from '../helpers/vong_doi_iframe.js';
import { setTheme, assertTheme } from '../helpers/chu_de.js';
import { ensureSidebar, dismissOverlaySidebar } from '../helpers/dieu_huong.js';
import { assertHeader, assertOverflow, assertControls } from '../helpers/bo_cuc.js';

for (const width of [1024, 1440, 1920, 768]) for (const role of ['user', 'admin']) test.describe(`dashboard-${role}-${width}`, () => {
  test.use({ demoRole: role, viewport: { width, height: 1080 } });
  test('Metric đầy đủ và toolbar robot không bị cắt @fix_c', async ({ page }) => {
    const evidence = [];
    for (const dark of [false, true]) {
      await ensureSidebar(page);
      const previous = reruns(page).length;
      const changed = await page.locator('.st-key-aiva_theme_switch_scope input').isChecked() !== dark;
      await setTheme(page, dark);
      if (changed) await waitForRerun(page, previous);
      await expect(page.locator('.success-animation')).toHaveCount(0);
      await expect(page.locator('.st-key-dashboard_metrics'), 'Server phải nạp layout Dashboard mới').toHaveCount(1);
      const metrics = await page.getByTestId('stMetric').evaluateAll(nodes => nodes.filter(node => ['Tổng số robot','AI Provider','Tổng người dùng','Tổng robot','Đang Online','Đang Offline'].includes(node.querySelector('[data-testid="stMetricLabel"]').textContent.trim())).map(node => ({
        label: node.querySelector('[data-testid="stMetricLabel"]').textContent,
        value: node.querySelector('[data-testid="stMetricValue"]').textContent,
        rect: node.getBoundingClientRect().toJSON(),
        clipped: [...node.querySelectorAll('p,span,div')].filter(n => n.textContent.trim() && n.clientWidth > 0).some(n => n.scrollWidth > n.clientWidth + 1),
      })));
      expect(metrics).toHaveLength(4);
      if (width === 768) expect.soft(metrics.map(m => m.clipped), 'Không ellipsis metric tại 768px').toEqual([false, false, false, false]);
      let robot;
      if (role === 'user') {
        const frame = await robotFrame(page);
        const button = frame.getByRole('button', { name: 'Vẫy tay', exact: true });
        robot = await button.evaluate(node => {
          const b = node.getBoundingClientRect(), h = document.querySelector('header').getBoundingClientRect(), stage = document.querySelector('#stage').getBoundingClientRect();
          const points = [[b.left+2,b.top+2],[b.right-2,b.top+2],[b.left+2,b.bottom-2],[b.right-2,b.bottom-2]];
          return { button: b.toJSON(), header: h.toJSON(), stage: stage.toJSON(), fullyInside: b.left >= stage.left && b.right <= stage.right && b.top >= h.top && b.bottom <= h.bottom, hitTest: points.every(([x,y]) => { const hit = document.elementFromPoint(x,y); return hit === node || node.contains(hit); }) };
        });
        expect.soft(robot.fullyInside && robot.hitTest, 'Nút Vẫy tay phải hiển thị và nhận pointer đầy đủ').toBe(true);
        if (width === 768 && robot.fullyInside && robot.hitTest) {
          const waving = page.waitForEvent('console', { predicate: m => m.text().includes('[AIVA3D] Arm poses waving') });
          const idle = page.waitForEvent('console', { predicate: m => m.text().includes('[AIVA3D] Arm poses idle'), timeout: 15000 });
          await button.click(); await waving; await idle;
        }
      }
      evidence.push({ dark, metrics, robot });
      await fs.mkdir(path.join(runDir, 'analysis'), { recursive: true });
      await fs.writeFile(path.join(runDir, 'analysis', `fix-c-${role}-${width}.json`), JSON.stringify(evidence, null, 2));
      await assertHeader(page); await assertOverflow(page);
    }
  });
});

for (const width of [1920, 1440, 1024, 768]) for (const role of ['guest', 'user', 'admin']) {
  test.describe(`${role}-${width}`, () => {
    test.use({ demoRole: role, viewport: { width, height: 1080 } });
    test('Bố cục cả hai theme ở DPR 1 @responsive', async ({ page }) => {
      for (const dark of [false, true]) {
        if (role !== 'guest') await ensureSidebar(page);
        await setTheme(page, dark);
        if (role !== 'guest') await dismissOverlaySidebar(page);
        await assertTheme(page, dark);
        await assertHeader(page, role === 'guest');
        await assertOverflow(page);
        await assertControls(page);
      }
    });
  });
}
