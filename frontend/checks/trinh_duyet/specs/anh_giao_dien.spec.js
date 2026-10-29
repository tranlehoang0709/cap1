import { test } from '../fixtures/phien_demo.js';
import { setTheme } from '../helpers/chu_de.js';
import { ensureSidebar, dismissOverlaySidebar } from '../helpers/dieu_huong.js';
import { assertHeader, assertOverflow, capture } from '../helpers/bo_cuc.js';
import { robotFrame, pauseRobot } from '../helpers/robot.js';

for (const role of ['guest', 'user', 'admin']) test.describe(role, () => {
  test.use({ demoRole: role, reducedMotion: 'reduce' });
  test('Chụp ứng viên baseline, chưa coi là ảnh chuẩn @screenshots', async ({ page }, testInfo) => {
    for (const width of [1920, 1440, 1024, 768]) {
      await page.setViewportSize({ width, height: 1080 });
      for (const dark of [false, true]) {
        if (role !== 'guest') await ensureSidebar(page);
        await setTheme(page, dark);
        if (role !== 'guest') await dismissOverlaySidebar(page);
        await page.getByTestId('stMain').evaluate(main => main.scrollTo(0, 0));
        await assertHeader(page, role === 'guest');
        await assertOverflow(page);
        if (role !== 'admin') await pauseRobot(await robotFrame(page));
        const name = `${role}-${width}-${dark ? 'dark' : 'light'}`;
        const file = await capture(page, name);
        await testInfo.attach(name, { path: file, contentType: 'image/png' });
        if (role !== 'guest' && width === 768) {
          await ensureSidebar(page);
          await capture(page, `${name}-sidebar`);
          await dismissOverlaySidebar(page);
        }
      }
    }
    testInfo.annotations.push({ type: 'baseline', description: 'CANDIDATE: cần người dùng duyệt; chưa thực hiện pixel comparison với ảnh chuẩn' });
  });
});
