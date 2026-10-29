/** Giao diện năm mục; chỉ dùng dữ liệu demo trong phiên, không upload/xóa/gọi AI thật. */
import { test, expect } from '../fixtures/phien_demo.js';
import { routes, navigate, ensureSidebar, dismissOverlaySidebar, openChatSettings } from '../helpers/dieu_huong.js';
import { setTheme, assertTheme } from '../helpers/chu_de.js';
import { assertHeader, assertControls, assertOverflow } from '../helpers/bo_cuc.js';

for (const width of [390, 768, 1024, 1440]) test.describe(`navigation5-${width}`, () => {
  test.use({ demoRole: 'user', viewport: { width, height: 1080 } });
  test('Năm mục và các chức năng đã gộp ở cả hai theme @navigation5', async ({ page }) => {
    test.setTimeout(180000);
    for (const dark of [false, true]) {
      await ensureSidebar(page); await setTheme(page, dark);
      for (const destination of routes.user) {
        await navigate(page, destination);
        await assertTheme(page, dark); await assertHeader(page); await assertControls(page); await assertOverflow(page);
        await expect(page.getByTestId('stSidebar').getByRole('radio')).toHaveCount(5);
        await expect(page.getByRole('radio', { name: 'Quản lý người dùng', exact: true })).toHaveCount(0);
      }
      await navigate(page, 'AI Chat');
      await openChatSettings(page);
      await page.getByRole('button', { name: 'Chào Xiaozhi', exact: true }).click();
      await expect(page.getByTestId('stChatMessage')).toHaveCount(2);
      await navigate(page, 'Lịch sử hội thoại');
      await expect(page.getByRole('tab', { name: 'Lịch sử', exact: true })).toHaveAttribute('aria-selected', 'true');
      await page.getByRole('button', { name: 'Tiếp tục phiên mẫu', exact: true }).click();
      await expect(page.getByRole('tab', { name: 'Trò chuyện', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('stChatInputTextArea')).toBeEnabled();
      await expect(page.getByTestId('stChatMessage')).toHaveCount(2);
      await navigate(page, 'Cấu hình trợ lý AI');
      const prompt = page.getByRole('textbox', { name: 'System prompt', exact: true });
      await expect(prompt).toBeHidden();
      await page.getByText('Nâng cao: hướng dẫn cho AI', { exact: true }).click();
      await expect(prompt).toBeEditable();
      await navigate(page, 'API Key cá nhân');
      await expect(page.getByRole('tab', { name: 'Nâng cao', exact: true })).toHaveAttribute('aria-selected', 'true');
      await page.getByRole('textbox', { name: 'Chuỗi API Key thử nghiệm', exact: true }).fill('demo-navigation-key');
      await page.getByRole('button', { name: 'Thêm / thay thế khóa mẫu', exact: true }).click();
      await page.getByRole('button', { name: 'Kiểm tra khóa mẫu', exact: true }).click();
      await expect(page.getByText('Đạt kiểm tra kịch bản mẫu; chưa xác thực với Provider', { exact: true })).toBeVisible();
      await navigate(page, 'Quyền riêng tư');
      const consent = page.getByRole('checkbox', { name: 'Xác nhận xóa dữ liệu mẫu đã chọn', exact: true });
      await page.getByTestId('stCheckbox').filter({ has: consent }).locator('label').click();
      await expect(consent).toBeChecked();
      const category = page.getByRole('combobox', { name: 'Dữ liệu cần xóa', exact: true });
      await category.click(); await category.press('ArrowDown');
      await page.getByRole('option', { name: 'Toàn bộ dữ liệu AI cá nhân', exact: true }).click();
      await expect(consent).not.toBeChecked();
      await navigate(page, 'Tài khoản');
      await expect(page.getByRole('textbox', { name: 'Họ tên', exact: true })).toBeEditable();
      await navigate(page, 'AI Chat'); await expect(page.getByTestId('stChatMessage')).toHaveCount(2);
      await assertTheme(page, dark); await assertOverflow(page);
      await ensureSidebar(page); await expect(page.getByTestId('stSidebar').getByRole('radio')).toHaveCount(5);
      await dismissOverlaySidebar(page);
    }
  });
});
