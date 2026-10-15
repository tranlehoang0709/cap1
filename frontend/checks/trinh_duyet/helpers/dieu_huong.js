/** Chỉ dùng menu hiện có, không submit biểu mẫu nghiệp vụ. */
import { expect } from '@playwright/test';

export const routes = {
  user: ['Dashboard', 'AI Chat', 'Thiết bị của tôi', 'Cấu hình trợ lý AI', 'API Key cá nhân', 'Lịch sử hội thoại', 'Quyền riêng tư', 'Tài khoản'],
  admin: ['Dashboard', 'Quản lý người dùng', 'Quản lý thiết bị', 'AI Management', 'API Key & Quota', 'OTA Firmware', 'Logs & Monitoring', 'System Settings'],
};
export async function ensureSidebar(page) {
  const sidebar = page.getByTestId('stSidebar');
  const rect = await sidebar.boundingBox();
  if (!await sidebar.isVisible() || !rect || rect.x + rect.width <= 1) {
    await page.getByTestId('stExpandSidebarButton').click();
  }
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toBeInViewport({ ratio: 0.5 });
  return sidebar;
}
export async function navigate(page, name) {
  const sidebar = await ensureSidebar(page);
  await sidebar.getByText(name, { exact: true }).click();
  await expect(sidebar.getByRole('radio', { name, exact: true })).toBeChecked();
  await dismissOverlaySidebar(page);
  await expect(page.locator('.st-key-portal_page_header h1')).toHaveText(name);
  await expect(page.getByTestId('stException')).toHaveCount(0);
}
export async function dismissOverlaySidebar(page) {
  const sidebar = page.getByTestId('stSidebar');
  if (!await sidebar.isVisible()) return;
  const side = await sidebar.boundingBox(), main = await page.getByTestId('stMain').boundingBox();
  if (side && main && main.x < side.x + side.width - 1) {
    await sidebar.getByTestId('stSidebarCollapseButton').getByRole('button').click();
    await expect(sidebar).not.toBeInViewport();
  }
}
