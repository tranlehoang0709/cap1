/** Chỉ dùng menu hiện có, không submit biểu mẫu nghiệp vụ. */
import { expect } from '@playwright/test';

export const routes = {
  user: ['Trang chủ', 'Trò chuyện AI', 'Robot của tôi', 'Cài đặt trợ lý', 'Tài khoản'],
  admin: ['Dashboard', 'Quản lý người dùng', 'Quản lý thiết bị', 'AI Management', 'API Key & Quota', 'OTA Firmware', 'Logs & Monitoring', 'System Settings'],
};
// Các kiểm thử chức năng cũ vẫn đi qua UI mới, không bỏ qua trang đã gộp.
const userDestinations = {
  Dashboard: ['Trang chủ'], 'AI Chat': ['Trò chuyện AI', 'Trò chuyện'],
  'Thiết bị của tôi': ['Robot của tôi'],
  'Cấu hình trợ lý AI': ['Cài đặt trợ lý', 'Cá nhân hóa'],
  'API Key cá nhân': ['Cài đặt trợ lý', 'Nâng cao'],
  'Lịch sử hội thoại': ['Trò chuyện AI', 'Lịch sử'],
  'Quyền riêng tư': ['Tài khoản', 'Quyền riêng tư'],
  'Tài khoản': ['Tài khoản', 'Thông tin tài khoản'],
};

export async function openChatSettings(page) {
  const details = page.locator('.st-key-chat_main details').filter({ hasText: 'Cài đặt nâng cao' });
  if (!await details.evaluate(n => n.open)) await details.locator('summary').click();
  await expect(page.getByRole('combobox', { name: 'Provider cho phiên mới', exact: true })).toBeVisible();
}
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
  const admin = await sidebar.getByRole('radio', { name: 'AI Management', exact: true }).count();
  const [destination, tab] = admin ? [name] : (userDestinations[name] || [name]);
  await sidebar.getByText(destination, { exact: true }).click();
  await expect(sidebar.getByRole('radio', { name: destination, exact: true })).toBeChecked();
  await dismissOverlaySidebar(page);
  await expect(page.locator('.st-key-portal_page_header h1')).toHaveText(destination);
  if (tab) {
    const target = page.getByRole('tab', { name: tab, exact: true });
    await target.click();
    await expect(target).toHaveAttribute('aria-selected', 'true');
  }
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
