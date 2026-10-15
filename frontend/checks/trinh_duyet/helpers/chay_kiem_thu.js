/** Probe phải đạt trước khi runner được phép mở browser cho các test. */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDir, prepareArtifacts } from './moi_truong.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await prepareArtifacts();
console.log(`Artifacts: ${runDir}`);
for (const args of [
  [path.join(packageRoot, 'helpers/kiem_tra_moi_truong.js')],
  [path.join(packageRoot, 'node_modules/@playwright/test/cli.js'), 'test', ...process.argv.slice(2)],
]) {
  const result = spawnSync(process.execPath, args, { cwd: packageRoot, env: process.env, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    process.exitCode = result.status || 2;
    break;
  }
}
