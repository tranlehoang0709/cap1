import { test, expect } from '../fixtures/phien_demo.js';
import { assertHeader, assertControls } from '../helpers/bo_cuc.js';

test.use({ captureTrace: false });
test('Login và form hiện có @smoke', async ({ page }) => {
  await assertHeader(page, true);
  await expect(page.getByLabel('Email', { exact: true })).toBeEditable();
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveAttribute('type', 'password');
  await expect(page.getByRole('button', { name: 'Đăng nhập mẫu', exact: true })).toBeEnabled();
  await assertControls(page);
});
test('Đọc tab đăng ký và recovery, không gửi form @ui', async ({ page }) => {
  await page.getByRole('tab', { name: 'Đăng ký User', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tạo tài khoản User mẫu', exact: true })).toBeEnabled();
  await page.getByRole('tab', { name: 'Đăng nhập', exact: true }).click();
  await page.getByText('Quên mật khẩu', { exact: true }).click();
  await expect(page.getByLabel('Email khôi phục', { exact: true })).toBeEditable();
  await expect(page.getByRole('button', { name: 'Gửi yêu cầu khôi phục', exact: true })).toBeEnabled();
});
for (const role of ['user', 'admin']) {
  test.describe(role, () => {
    test.use({ demoRole: role });
    test('Đăng nhập demo và logout @smoke', async ({ page }) => {
      await assertHeader(page);
      await page.getByTestId('stSidebar').getByRole('button', { name: 'Đăng xuất', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Đăng nhập mẫu', exact: true })).toBeVisible();
      await assertHeader(page, true);
    });
  });
}
