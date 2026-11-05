// Read-only preflight. Never seed an admin or run a migration.
const path = require('path');
const {createRequire} = require('module');
const req = createRequire(path.resolve('package.json'));
const report = {port: 3000, host: '127.0.0.1', url: '', localModelCount: 0, errors: []};
(async () => {
  try {
    const pkg = req('./package.json');
    for (const name of [...Object.keys(pkg.dependencies), 'ts-node', 'typescript']) req.resolve(name);
    if (!require('fs').existsSync(path.resolve('node_modules/@nestjs/cli/bin/nest.js'))) throw Error('Nest CLI missing');
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (major < 20 || major === 20 && minor < 19) throw Error('node');
  } catch { report.errors.push('Node >=20.19 / node_modules missing or incomplete'); }
  if (report.errors.length) return;
  req('dotenv').config({path: path.resolve('.env'), quiet: true});
  report.port = Number(process.env.PORT ?? 3000);
  report.url = process.env.AI_SERVER_URL ?? '';
  report.host = process.env.BE_HOST ?? '127.0.0.1';
  report.quotaStorage = process.env.AI_QUOTA_STORAGE ?? 'extended';
  report.v15QuotaApproved = process.env.AI_QUOTA_V15_CONTRACT_APPROVED === 'true';
  if (report.host !== '127.0.0.1') report.errors.push('Real local launcher requires BE_HOST=127.0.0.1');
  try {
    req('ts-node/register');
    const {validateEnvironment} = req('./src/config/configuration.ts');
    validateEnvironment(process.env);
  } catch {
    const keys = ['DB_HOST','DB_PORT','DB_USER','DB_PASSWORD','DB_NAME','JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','APP_ENCRYPTION_KEY','ADMIN_EMAIL','ADMIN_PASSWORD','ADMIN_DISPLAY_NAME'];
    const missing = keys.filter(key => process.env[key] === undefined || key !== 'DB_PASSWORD' && !process.env[key]);
    report.errors.push(missing.length ? 'Missing config: ' + missing.join(', ') : 'Backend environment validation failed; check configuration.ts');
    return;
  }
  if (process.env.NODE_ENV === 'test' || process.env.DB_NAME !== 'aiva_iot') {
    report.errors.push('Test/fixture database configuration rejected'); return;
  }
  let connection;
  try {
    connection = await req('mysql2/promise').createConnection({
      host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
      password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectTimeout: 5000
    });
    await connection.query('SET SESSION TRANSACTION READ ONLY');
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT u.status, u.email_verified_at, COUNT(r.code) AS role_count, MAX(r.code) AS role
       FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id
       WHERE u.email=? GROUP BY u.id,u.status,u.email_verified_at LIMIT 1`,
      [process.env.ADMIN_EMAIL.trim().toLowerCase()]);
    const admin = rows[0];
    if (!admin || Number(admin.role_count) !== 1 || admin.role !== 'ADMIN' || admin.status !== 'active' || !admin.email_verified_at)
      report.errors.push('Existing verified active Admin required: startup would seed/write or fail; Backend launch blocked');
    const [models] = await connection.execute(
      "SELECT COUNT(*) AS total FROM ai_models m JOIN ai_providers p ON p.id=m.provider_id WHERE p.code='LOCAL' AND p.is_enabled=1 AND m.is_enabled=1 AND LOWER(m.capability)='llm'");
    report.localModelCount = Number(models[0].total);
    const [extensions] = await connection.execute("SELECT COUNT(*) AS total FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='usage_records' AND COLUMN_NAME IN ('request_id','request_fingerprint','quota_policy_id','reserved_tokens','report_due_at','report_fingerprint','finalized_at')");
    report.quotaExtensionColumns = Number(extensions[0].total);
    await connection.rollback();
  } catch { report.errors.push('Read-only MySQL/Admin preflight failed; no database initialization attempted'); }
  finally { if (connection) await connection.end(); }
})().catch(() => report.errors.push('Backend preflight failed')).finally(() => {
  if (!Number.isInteger(report.port) || report.port < 1 || report.port > 65535) {
    report.errors.push('Invalid PORT; 3000 shown only as repository default'); report.port = 3000;
  }
  console.log(JSON.stringify(report));
});