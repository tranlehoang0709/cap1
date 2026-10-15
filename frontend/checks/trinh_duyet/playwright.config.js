/** Cấu hình riêng của test; không khởi động lại hoặc chỉnh cấu hình Streamlit. */
import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { baseURL, runDir } from './helpers/moi_truong.js';

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  maxFailures: 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  forbidOnly: true,
  updateSnapshots: 'none',
  outputDir: path.join(runDir, 'report', 'test-results'),
  reporter: [
    ['line'],
    ['html', { outputFolder: path.join(runDir, 'report', 'html'), open: 'never' }],
    ['json', { outputFile: path.join(runDir, 'report', 'results.json') }],
    ['./helpers/bao_cao.js'],
  ],
  use: {
    baseURL,
    channel: 'chrome',
    headless: true,
    launchOptions: { chromiumSandbox: true },
    viewport: { width: 1440, height: 1080 },
    deviceScaleFactor: 1,
    locale: 'vi-VN',
    timezoneId: 'Asia/Bangkok',
    serviceWorkers: 'block',
    actionTimeout: 15000,
    navigationTimeout: 30000,
    trace: 'off', // Fixture chỉ ghi trace sau login, không ghi credentials.
    screenshot: 'off',
    video: 'off',
  },
});
