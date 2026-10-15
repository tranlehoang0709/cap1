/** Mỗi test có context riêng; không ghi trace lúc nhập credentials. */
import { test as base, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { baseURL, runDir, demoEmails, demoPassword, redact, prepareArtifacts, verifyServer, restrictNetwork } from '../helpers/moi_truong.js';
import { collectErrors } from '../helpers/loi_trinh_duyet.js';
import { capture } from '../helpers/bo_cuc.js';
import { watchReruns } from '../helpers/vong_doi_iframe.js';

export const test = base.extend({
  demoRole: ['guest', { option: true }],
  captureTrace: [true, { option: true }],
  page: async ({ context, demoRole, captureTrace }, use, testInfo) => {
    await prepareArtifacts();
    const environment = JSON.parse(await fs.readFile(path.join(runDir, 'environment.json'), 'utf8'));
    if (environment.status !== 'ALLOWED') throw Error('BLOCKED: probe Chrome chưa đạt');
    await verifyServer();
    const blocked = [];
    await restrictNetwork(context, blocked);
    const page = await context.newPage();
    watchReruns(page);
    const records = collectErrors(page, blocked);
    const id = createHash('sha256').update(testInfo.testId).digest('hex').slice(0, 12);
    let tracing = false;
    let fixtureFailed = false;
    try {
      await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('button', { name: 'Đăng nhập mẫu', exact: true })).toBeVisible();
      if (demoRole !== 'guest') {
        if (!demoEmails[demoRole]) throw Error('BLOCKED: chưa cho phép tài khoản này');
        try {
          await page.getByLabel('Email', { exact: true }).fill(demoEmails[demoRole]);
          await page.getByLabel('Mật khẩu', { exact: true }).fill(demoPassword);
          await page.getByRole('button', { name: 'Đăng nhập mẫu', exact: true }).click();
          await expect(page.locator('.st-key-portal_page_header h1')).toHaveText('Dashboard');
        } catch (error) { throw Error(redact(error.message)); }
        // Tracing chỉ bắt đầu khi form credentials đã bị gỡ khỏi DOM.
        if (captureTrace) {
          await context.tracing.start({ screenshots: false, snapshots: false, sources: false });
          tracing = true;
        }
      }
      await use(page);
      expect(records.filter(record => record.category === 'error'), 'Browser errors mới').toEqual([]);
    } catch (error) {
      fixtureFailed = true;
      throw error;
    } finally {
      const failed = fixtureFailed || testInfo.status !== testInfo.expectedStatus;
      if (failed) await capture(page, `failure-${id}`).catch(() => {});
      if (tracing) await context.tracing.stop(failed ? { path: path.join(runDir, 'traces', `${id}.zip`) } : {});
      await fs.writeFile(path.join(runDir, 'report', `errors-${id}.json`), JSON.stringify({ test: testInfo.title, blocked, records }, null, 2));
    }
  },
});
export { expect };
