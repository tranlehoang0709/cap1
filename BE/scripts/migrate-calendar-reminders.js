const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();
const mysql = require('mysql2/promise');

const VERSION = '20261118-calendar-reminders';

async function migrate() {
  const required = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  if (process.env.DB_NAME !== 'aiva_iot') throw new Error('DB_NAME must be aiva_iot');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  try {
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(120) NOT NULL PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    const [applied] = await connection.execute('SELECT version FROM schema_migrations WHERE version = ?', [VERSION]);
    if (applied.length) { process.stdout.write(`${VERSION} already applied.\n`); return; }
    const sql = fs.readFileSync(path.join(__dirname, '..', 'src', 'database', 'migrations', '20261118_calendar_reminders.sql'), 'utf8');
    await connection.beginTransaction();
    try {
      for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) await connection.query(statement);
      await connection.execute('INSERT INTO schema_migrations (version) VALUES (?)', [VERSION]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
    process.stdout.write(`Applied ${VERSION}.\n`);
  } finally { await connection.end(); }
}

migrate().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
