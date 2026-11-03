const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
  const required = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  if (process.env.DB_NAME !== 'aiva_iot') throw new Error('DB_NAME must be aiva_iot');

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: false,
  });
  try {
    await connection.query('CREATE DATABASE IF NOT EXISTS `aiva_iot` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    await connection.changeUser({ database: 'aiva_iot' });
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(120) NOT NULL PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    const [applied] = await connection.execute('SELECT version FROM schema_migrations WHERE version = ?', ['001-v15-baseline']);
    if (applied.length) {
      process.stdout.write('Migration 001-v15-baseline already applied.\n');
      return;
    }

    const [rows] = await connection.query('SHOW TABLES');
    const tables = rows.map((row) => Object.values(row)[0]).filter((name) => name !== 'schema_migrations');
    if (tables.length) {
      throw new Error('Refusing baseline migration: aiva_iot contains tables but migration 001 is not recorded. Back up and reconcile the existing schema first.');
    }

    const sqlPath = path.join(__dirname, '..', 'src', 'database', 'AIVA_IoT_V1_5_CREATE_MYSQL.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8')
      .replace(/^\s*CREATE DATABASE IF NOT EXISTS `aiva_iot`[^;]*;\s*/m, '')
      .replace(/^\s*USE `aiva_iot`;\s*/m, '');
    const statements = sql.split(';').map((statement) => statement.trim()).filter(Boolean);
    for (const statement of statements) await connection.query(statement);
    await connection.execute('INSERT INTO schema_migrations (version) VALUES (?)', ['001-v15-baseline']);
    process.stdout.write(`Applied 001-v15-baseline (${statements.length} SQL statements).\n`);
  } finally {
    await connection.end();
  }
}

migrate().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
