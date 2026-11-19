'use strict';
// Explicit isolated provisioning. Never invokes scripts/migrate.js (live DB only).
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '..');
const dbName = 'aiva_iot_test';
const secret = () => randomBytes(32).toString('base64url');
async function main() {
  if (fs.existsSync(path.join(root, '.env.test'))) throw Error('TEST_ENV_ALREADY_EXISTS_NO_OVERWRITE');
  const live = dotenv.parse(fs.readFileSync(path.join(root, '.env')));
  if (live.DB_NAME !== 'aiva_iot' || !['127.0.0.1', 'localhost'].includes(live.DB_HOST)) throw Error('UNVERIFIED_LOCAL_MYSQL');
  const baseline = fs.readFileSync(path.join(root, 'src/database/AIVA_IoT_V1_5_CREATE_MYSQL.sql'), 'utf8')
    .replace(/^\s*CREATE DATABASE IF NOT EXISTS `aiva_iot`[^;]*;\s*/m, '')
    .replace(/^\s*USE `aiva_iot`;\s*/m, '').replace(/^\s*--.*$/gm, '');
  const statements = baseline.split(';').map(s => s.trim()).filter(Boolean);
  if (statements.some(s => !/^(CREATE TABLE|ALTER TABLE|INSERT INTO|SELECT COUNT\(\*\) AS table_count FROM information_schema.tables)\s/i.test(s) || /\baiva_iot\b|\b(?:USE|TRUNCATE|DROP)\b/i.test(s))) throw Error('UNSAFE_BASELINE');
  let admin, test;
  const username = 'aiva_test_' + randomBytes(4).toString('hex');
  const password = secret();
  try {
    // Administrator is used only to create the named schema and a new scoped user.
    admin = await mysql.createConnection({ host: live.DB_HOST, port: Number(live.DB_PORT || 3306), user: live.DB_USER, password: live.DB_PASSWORD, multipleStatements: false });
    const [exists] = await admin.execute('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [dbName]);
    if (exists.length) {
      if (!process.argv.includes('--resume-empty')) throw Error('TEST_DATABASE_EXISTS_NO_RESET');
      const [[row]] = await admin.query('SELECT COUNT(*) AS cnt FROM `aiva_iot_test`.`users`');
      if (Number(row.cnt) !== 0) throw Error('REFUSE_RESUME_POPULATED_DATABASE');
    } else await admin.query('CREATE DATABASE `aiva_iot_test` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    await admin.query('CREATE USER ' + mysql.escape(username) + "@'127.0.0.1' IDENTIFIED BY " + mysql.escape(password));
    // Escape underscores in the database-level grant pattern; no live privileges.
    await admin.query('GRANT ALL PRIVILEGES ON `aiva\\_iot\\_test`.* TO ' + mysql.escape(username) + "@'127.0.0.1'");
    await admin.end(); admin = undefined;
    test = await mysql.createConnection({ host: '127.0.0.1', port: Number(live.DB_PORT || 3306), user: username, password, database: dbName, timezone: 'Z', multipleStatements: false });
    const [[identity]] = await test.query('SELECT DATABASE() AS db');
    if (identity.db !== dbName) throw Error('DATABASE_IDENTITY_MISMATCH');
    let denied = false;
    try { await test.query('SELECT id FROM `aiva_iot`.`users` LIMIT 0'); }
    catch (e) { denied = ['ER_TABLEACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR'].includes(e.code); }
    if (!denied) throw Error('TEST_USER_CAN_ACCESS_LIVE_DATABASE');
    console.log('PASS isolation: test user cannot SELECT live users; database=aiva_iot_test');
    if (!exists.length) {
      for (const sql of statements) await test.query(sql);
      await test.query('CREATE TABLE schema_migrations (version VARCHAR(120) PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
      await test.execute('INSERT INTO schema_migrations(version) VALUES (?)', ['001-v15-baseline']);
    }
    for (const [file, fn] of [
      ['20261105_robot_handover.cjs', 'migrateRobotHandover'],
      ['20261114_personal_assistant.cjs', 'migratePersonalAssistant'],
      ['20261115_group_i.cjs', 'migrateGroupI'],
      ['20261115_pa10_subtasks.cjs', 'migratePa10Subtasks'],
      ['20261117_auth_email_otps.cjs', 'migrateAuthEmailOtps'],
    ]) {
      await require(path.join(root, 'src/database/migrations', file))[fn](test, { apply: true });
      await test.execute('INSERT IGNORE INTO schema_migrations(version) VALUES (?)', [file]);
    }
    // Apply quota-admission only when missing from the checked-in baseline.
    const [quota] = await test.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='usage_records' AND COLUMN_NAME='request_id'");
    if (!quota.length) {
      const quotaSql = fs.readFileSync(path.join(root, 'src/database/migrations/20261030_quota_admission.sql'), 'utf8').replace(/^\s*--.*$/gm, '');
      for (const sql of quotaSql.split(';').map(s => s.trim()).filter(Boolean)) {
        if (!/^ALTER TABLE usage_records\s/.test(sql) || /\baiva_iot\b|\b(?:USE|TRUNCATE|DROP)\b/i.test(sql)) throw Error('UNSAFE_QUOTA_MIGRATION');
        await test.query(sql);
      }
      await test.execute('INSERT INTO schema_migrations(version) VALUES (?)', ['20261030_quota_admission.sql']);
    }
    const config = {
      NODE_ENV: 'test', MYSQL_INTEGRATION_TESTS: 'true', HOST: '127.0.0.1', PORT: '3301',
      DB_HOST: '127.0.0.1', DB_PORT: String(live.DB_PORT || 3306), DB_USER: username, DB_PASSWORD: password, DB_NAME: dbName, DB_CONNECTION_LIMIT: '5',
      JWT_ACCESS_SECRET: secret(), JWT_REFRESH_SECRET: secret(), APP_ENCRYPTION_KEY: secret(),
      ACCESS_TOKEN_TTL_SECONDS: '60', REFRESH_TOKEN_TTL_SECONDS: '3600',
      ADMIN_EMAIL: 'admin@auth.example.test', ADMIN_PASSWORD: secret(), ADMIN_DISPLAY_NAME: 'Integration Admin',
      TEST_USER_EMAIL: 'user@auth.example.test', TEST_USER_PASSWORD: secret(),
      CORS_ORIGINS: 'http://127.0.0.1:3302', HEARTBEAT_SWEEPER_ENABLED: 'false', AI_USAGE_REPORT_SWEEPER_ENABLED: 'false',
      AI_QUOTA_CONTRACT_APPROVED: 'false', DEVICE_AUTH_CONTRACT_APPROVED: 'false', AI_CONFIG_CONTRACT_APPROVED: 'false',
      SMTP_HOST: '', SMTP_PORT: '587', SMTP_SECURE: 'false', SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: '',
    };
    fs.writeFileSync(path.join(root, '.env.test'), '# Isolated local integration only. Generated secrets; never commit.\n' + Object.entries(config).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
    console.log('PASS test schema migrations; generated BE/.env.test with independent secrets and SMTP disabled');
  } finally { if (admin) await admin.end(); if (test) await test.end(); }
}
main().catch(e => { console.error('BLOCKED setup: ' + (e.code || (/^[A-Z_]+$/.test(e.message) ? e.message : 'SETUP_FAILED_DETAILS_SUPPRESSED'))); process.exitCode = 1; });
