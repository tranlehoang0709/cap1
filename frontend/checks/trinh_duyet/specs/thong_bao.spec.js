/** Kiểm tra flash một lần và khoảng cách thật, không dựa vào slot DOM cố định. */
import { test, expect } from '../fixtures/phien_demo.js';
import { setTheme } from '../helpers/chu_de.js';
import { navigate, ensureSidebar } from '../helpers/dieu_huong.js';
import { reruns, waitForRerun } from '../helpers/vong_doi_iframe.js';
import { assertHeader, capture } from '../helpers/bo_cuc.js';

for (const role of ['user', 'admin']) test.describe(role, () => {
  test.use({ demoRole: role, captureTrace: false });
  test('Flash đăng nhập một lần, hết sau rerun, không để khoảng trống @flash @ui', async ({ page }, testInfo) => {
    const notice = page.getByTestId('stAlert').filter({ hasText: 'Mô phỏng: Đăng nhập tài khoản mẫu. Chỉ cập nhật trong phiên, chưa lưu vào hệ thống thật.' });
    await expect(notice).toHaveCount(1);
    await expect(notice).toBeVisible();
    await expect(page.locator('.st-key-portal_flash').getByTestId('stAlert')).toHaveCount(1);
    await expect(page.locator('.success-animation')).toHaveCount(1);
    await capture(page, `flash-${role}-present`);
    const measurements = [];
    for (const dark of [false, true, false]) {
      const previous = reruns(page).length;
      await setTheme(page, dark);
      await waitForRerun(page, previous);
      await expect(notice).toHaveCount(0);
      await expect(page.locator('.success-animation')).toHaveCount(0);
      await assertHeader(page);
      const read = () => page.evaluate(() => {
        const root = document.querySelector('[data-testid="stMainBlockContainer"] [data-testid="stVerticalBlock"]');
        const children = [...root.children];
        const header = children.find(n => n.matches('.st-key-portal_page_header') || n.querySelector('.st-key-portal_page_header'));
        const next = children.slice(children.indexOf(header) + 1).find(n => n.checkVisibility() && n.getBoundingClientRect().height > 1);
        const actual = next.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
        const expected = parseFloat(getComputedStyle(root).rowGap);
        return { actual, expected, difference: Math.abs(actual - expected) };
      });
      await expect.poll(async () => (await read()).difference, { message: 'Flash rỗng không tạo thêm khoảng cách ngoài gap layout' }).toBeLessThanOrEqual(2);
      measurements.push({ dark, ...await read() });
    }
    await capture(page, `flash-${role}-cleared`);
    await navigate(page, role === 'user' ? 'Tài khoản' : 'System Settings');
    await expect(notice).toHaveCount(0);
    await expect(page.locator('.success-animation')).toHaveCount(0);
    const sidebar = await ensureSidebar(page);
    await sidebar.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Đăng nhập mẫu', exact: true })).toBeVisible();
    await expect(notice).toHaveCount(0);
    await assertHeader(page, true);
    await testInfo.attach('flash-layout.json', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
  });
});
