import { test } from '../fixtures/phien_demo.js';
import { routes, navigate } from '../helpers/dieu_huong.js';
import { assertHeader, assertControls, assertOverflow } from '../helpers/bo_cuc.js';

test.use({ demoRole: 'user' });
test('Đọc đủ năm mục Người dùng @smoke @ui', async ({ page }) => {
  for (const name of routes.user) {
    await navigate(page, name);
    await assertHeader(page);
    await assertControls(page);
    await assertOverflow(page);
  }
});
