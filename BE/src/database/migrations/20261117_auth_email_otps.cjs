'use strict';

/**
 * Additive, idempotent migration for 6-digit email verification and password reset OTPs.
 * Stores only HMAC-SHA256 hashes (never plaintext OTPs) with expiration, attempt limits, and single-use consumption.
 */
async function migrateAuthEmailOtps(connection, { apply = false } = {}) {
  const statements = [];

  const [tableRows] = await connection.execute(
    `SELECT TABLE_NAME AS name
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_email_otps'`,
  );

  if (!tableRows.length) {
    const sql = `CREATE TABLE \`auth_email_otps\` (
  \`id\` BIGINT NOT NULL AUTO_INCREMENT,
  \`user_id\` BIGINT NOT NULL,
  \`purpose\` VARCHAR(32) NOT NULL,
  \`code_hash\` CHAR(64) NOT NULL,
  \`attempts\` INT NOT NULL DEFAULT 0,
  \`max_attempts\` INT NOT NULL DEFAULT 5,
  \`expires_at\` DATETIME NOT NULL,
  \`consumed_at\` DATETIME NULL,
  \`invalidated_at\` DATETIME NULL,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  KEY \`idx_auth_email_otps_lookup\` (\`user_id\`, \`purpose\`, \`consumed_at\`, \`invalidated_at\`, \`expires_at\`),
  KEY \`idx_auth_email_otps_created\` (\`user_id\`, \`purpose\`, \`created_at\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
    statements.push(sql);
    if (apply) await connection.query(sql);
  }

  return statements;
}

if (require.main === module) {
  require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });
  const mysql = require('mysql2/promise');
  (async () => {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });
    try {
      const statements = await migrateAuthEmailOtps(connection, { apply: true });
      process.stdout.write(
        statements.length
          ? `Applied auth_email_otps migration (${statements.length} statement).\n`
          : 'auth_email_otps table already exists.\n',
      );
    } finally {
      await connection.end();
    }
  })().catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { migrateAuthEmailOtps };
