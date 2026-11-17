'use strict';

const columns = {
  personal_events: {
    series_id: 'VARCHAR(36) NULL',
    recurrence_rule: 'JSON NULL',
    recurrence_index: 'INT NULL',
    recurrence_exception: 'TINYINT(1) NOT NULL DEFAULT 0',
  },
  reminder_deliveries: {
    display_token: 'VARCHAR(64) NULL',
    display_client_id: 'VARCHAR(36) NULL',
    display_lease_until: 'DATETIME NULL',
  },
};

async function migrateGroupI(connection, { apply = false } = {}) {
  const statements = [];
  for (const [table, fields] of Object.entries(columns)) {
    const [existing] = await connection.execute('SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table]);
    if (!existing.length) throw new Error(`Missing PA table: ${table}`);
    for (const [name, type] of Object.entries(fields)) {
      if (existing.some(field => field.name === name)) continue;
      const sql = `ALTER TABLE \`${table}\` ADD COLUMN \`${name}\` ${type}`;
      statements.push(sql);
      if (apply) await connection.query(sql);
    }
  }
  return statements;
}

module.exports = { migrateGroupI };
