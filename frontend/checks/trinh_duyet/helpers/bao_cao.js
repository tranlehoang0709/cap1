/** Tổng hợp trạng thái thật; screenshot mới chỉ là ứng viên chờ duyệt. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { runDir, redact } from './moi_truong.js';

export default class AuditReporter {
  constructor() { this.tests = []; this.reported = new Set(); this.planned = []; }
  onBegin(config, suite) { this.planned = suite.allTests(); }
  onTestEnd(test, result) {
    this.reported.add(test.id);
    this.tests.push({ title: test.titlePath().join(' / '), status: result.status === 'passed' ? 'PASS' : result.status === 'skipped' ? 'NOT RUN' : 'FAIL', duration: result.duration, errors: result.errors.map(e => redact(e.message || '')), annotations: test.annotations });
  }
  async onEnd(result) {
    for (const test of this.planned.filter(test => !this.reported.has(test.id))) {
      this.tests.push({ title: test.titlePath().join(' / '), status: 'NOT RUN', duration: 0, errors: [], annotations: test.annotations });
    }
    await fs.mkdir(path.join(runDir, 'report'), { recursive: true });
    const files = await fs.readdir(path.join(runDir, 'report'));
    const errors = [];
    for (const name of files.filter(name => /^errors-.*\.json$/.test(name))) errors.push(JSON.parse(await fs.readFile(path.join(runDir, 'report', name), 'utf8')));
    await fs.writeFile(path.join(runDir, 'errors.json'), JSON.stringify(errors, null, 2));
    await fs.writeFile(path.join(runDir, 'report', 'status.json'), JSON.stringify({ result: this.tests.length ? result.status : 'NOT RUN', tests: this.tests, screenshots: 'CANDIDATES_NOT_APPROVED' }, null, 2));
  }
}
