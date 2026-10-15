import { test, expect } from '../fixtures/phien_demo.js';
import { routes, navigate } from '../helpers/dieu_huong.js';
import { assertHeader, assertOverflow } from '../helpers/bo_cuc.js';
import { setTheme } from '../helpers/chu_de.js';

for (const role of ['user', 'admin']) test.describe(role, () => {
  test.use({ demoRole: role });
  test('Header sau scroll, navigation và theme rerun @ui', async ({ page }) => {
    const sidebar = page.getByTestId('stSidebar');
    await expect(sidebar.getByRole('radio')).toHaveCount(8);
    for (const name of routes[role]) await expect(sidebar.getByRole('radio', { name, exact: true })).toHaveCount(1);
    await page.getByTestId('stMain').evaluate(main => main.scrollTo(0, 200));
    await navigate(page, routes[role].at(-1));
    await expect.poll(() => page.getByTestId('stMain').evaluate(main => main.scrollTop)).toBe(0);
    await assertHeader(page);
    for (const dark of [false, true, false]) {
      await setTheme(page, dark);
      await expect(page.locator('.st-key-portal_page_header h1')).toHaveText(routes[role].at(-1));
      await assertHeader(page);
    }
    await assertOverflow(page);
  });
});
