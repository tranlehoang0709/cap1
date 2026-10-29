/** Chỉ mở Chrome tạm với sandbox; không dùng profile cá nhân hoặc tải browser. */
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { baseURL, runDir, prepareArtifacts, verifyServer, restrictNetwork, redact } from './moi_truong.js';

await prepareArtifacts();
const report = { date: new Date().toISOString(), baseURL, channel: 'chrome', os: process.platform, chromiumSandbox: true, status: 'BLOCKED' };
let browser;
try {
  await verifyServer();
  browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1 });
  report.blockedRequests = [];
  await restrictNetwork(context, report.blockedRequests);
  const page = await context.newPage();
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Đăng nhập mẫu', exact: true }).waitFor();
  report.version = browser.version();
  report.viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
  // Fingerprint card được đo và kiểm tra riêng trong requireCameraProfile().
  report.selectedCameraProfile = process.env.AIVA_CAMERA_PROFILE || null;
  report.status = 'ALLOWED';
  report.loginReached = true;
  await context.close();
} catch (error) {
  report.reason = redact(error.message);
  process.exitCode = 2;
} finally {
  await browser?.close();
  await fs.writeFile(path.join(runDir, 'environment.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
