import { test } from '../fixtures/phien_demo.js';
import { setTheme, assertTheme, assertDropdown } from '../helpers/chu_de.js';
import { navigate, ensureSidebar, dismissOverlaySidebar, openChatSettings } from '../helpers/dieu_huong.js';
import { assertControls } from '../helpers/bo_cuc.js';

for (const role of ['guest', 'user', 'admin']) test.describe(role, () => {
  test.use({ demoRole: role });
  test('Light → Dark → Light và dropdown @ui', async ({ page }) => {
    if (role !== 'guest') await navigate(page, role === 'user' ? 'AI Chat' : 'AI Management');
    if (role === 'user') await openChatSettings(page);
    for (const dark of [false, true, false]) {
      if (role !== 'guest') await ensureSidebar(page);
      await setTheme(page, dark);
      await assertTheme(page, dark);
      if (role !== 'guest') {
        await dismissOverlaySidebar(page);
        await assertDropdown(page);
      }
      await assertControls(page);
    }
  });
});
