'use strict';
// Read-only startup metadata. Never print credentials, driver errors or hashes.
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '..');
const requireBE = createRequire(path.join(root, 'BE/package.json'));
async function main() {
  const dotenv = requireBE('dotenv'), mysql = requireBE('mysql2/promise');
  const environment = {...dotenv.parse(fs.readFileSync(path.join(root, 'BE/.env'))), ...process.env};
  const port = Number(environment.PORT || 3000);
  if (environment.DB_NAME !== 'aiva_iot' || !Number.isInteger(port) || port < 1 || port > 65535) throw Error('CONFIG_INVALID');
  const frontend = JSON.parse(fs.readFileSync(path.join(root, 'frontend/next-app/package.json')));
  const match = /--port\s+(\d+)/.exec(frontend.scripts.dev);
  if (!match || !/next dev/.test(frontend.scripts.dev)) throw Error('NEXT_PORT_NOT_EXPLICIT');
  const frontendPort = Number(match[1]);
  if (!Number.isInteger(frontendPort) || frontendPort < 1 || frontendPort > 65535) throw Error('NEXT_PORT_INVALID');
  let backendConfigValid = false;
  try {
    requireBE('ts-node').register({project: path.join(root, 'BE/tsconfig.json'), transpileOnly: true});
    require(path.join(root, 'BE/src/config/configuration.ts')).validateEnvironment(environment);
    backendConfigValid = true;
  } catch { /* Keep existing healthy processes; block only a fresh Backend start. */ }
  const connection = await mysql.createConnection({host: environment.DB_HOST, port: Number(environment.DB_PORT), user: environment.DB_USER,
    password: environment.DB_PASSWORD, database: environment.DB_NAME, connectTimeout: 5000,
    supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false, debug: false, trace: false});
  let bootstrapSafe = false, accounts;
  try {
    await connection.query('START TRANSACTION READ ONLY');
    const [[database]] = await connection.query('SELECT DATABASE() AS name');
    if (database.name !== 'aiva_iot') throw Error('WRONG_DATABASE');
    const [bootstrap] = await connection.execute(
      "SELECT u.status,(u.email_verified_at IS NOT NULL) AS verified,COUNT(r.id) AS role_count,MAX(r.code) AS role FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id WHERE u.email=? GROUP BY u.id,u.status,u.email_verified_at",
      [(environment.ADMIN_EMAIL || '').trim().toLowerCase()]);
    bootstrapSafe = bootstrap.length === 1 && bootstrap[0].status === 'active' && !!Number(bootstrap[0].verified) && Number(bootstrap[0].role_count) === 1 && bootstrap[0].role === 'ADMIN';
    [accounts] = await connection.query("SELECT u.id,GROUP_CONCAT(r.code ORDER BY r.code) AS roles FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id WHERE u.id IN (1,4) GROUP BY u.id");
    await connection.rollback();
  } finally { await connection.end(); }
  const aiFile = path.join(root, 'AI_SERVER/.env');
  const aiEnvPresent = fs.existsSync(aiFile);
  const ai = {...(aiEnvPresent ? dotenv.parse(fs.readFileSync(aiFile)) : {}), ...process.env};
  const aiPort = Number(ai.AI_SERVER_PORT || 8000); // Settings default in app/core/config.py.
  if (!Number.isInteger(aiPort) || aiPort < 1 || aiPort > 65535) throw Error('AI_PORT_INVALID');
  if (new Set([port, frontendPort, aiPort, 8081]).size !== 4) throw Error('SERVICE_PORT_COLLISION');
  // A restored partial .env is not enough to boot the existing integrated app.
  // Match the three service credentials to Backend without returning their values.
  const pairs = [['AI_SERVER_BACKEND_DEVICE_TOKEN', 'AI_DEVICE_SERVICE_TOKEN'],
    ['AI_SERVER_BACKEND_CONFIG_TOKEN', 'AI_CONFIG_SERVICE_TOKEN'],
    ['AI_SERVER_BACKEND_QUOTA_TOKEN', 'AI_QUOTA_SERVICE_TOKEN']];
  const aiBackendReady = aiEnvPresent && (ai.AI_SERVER_BACKEND_MODE || 'integrated') === 'integrated' &&
    ai.AI_SERVER_BACKEND_URL === `http://127.0.0.1:${port}` && ai.AI_SERVER_BACKEND_ALLOW_LOCAL_HTTP === 'true' &&
    pairs.every(([a,b]) => /^[A-Za-z0-9_-]{43,128}$/.test(ai[a] || '') && ai[a] === environment[b]) &&
    new Set(pairs.map(([a]) => ai[a])).size === 3;
  console.log(JSON.stringify({ok: true, backendPort: port, frontendPort, bootstrapSafe, backendConfigValid, accounts, aiPort, aiEnvPresent,
    aiBackendReady,
    aiLanReady: aiBackendReady && ai.AI_SERVER_HOST === '0.0.0.0' && ai.AI_SERVER_RELOAD === 'false' &&
      !!ai.AI_SERVER_TLS_CERTFILE && !!ai.AI_SERVER_TLS_KEYFILE && !!ai.AI_SERVER_LAN_PUBLIC_ORIGIN &&
      (ai.AI_SERVER_BACKEND_MODE || 'integrated') === 'integrated'}));
}
main().catch(() => { console.log(JSON.stringify({ok: false, error: 'CHECK_BACKEND_ENV_DEPENDENCIES_AND_MYSQL_LOCALLY'})); process.exitCode = 1; });
